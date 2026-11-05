mod evm;
mod mpc;
mod nft;
mod sale;
mod source;
mod types;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::events::{NftMint, NftTransfer};
use near_sdk::json_types::U128;
use near_sdk::serde_json::Value;
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub use source::CreationLog;
pub use types::{Config, Fees, Finality, Issued, Kind, Listing, Lot, LotId, LotState, MintedLot, Payout, Source};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const MAX_NAME_LEN: usize = 64;
/// Room to forward the verify call (50 Tgas) and schedule its callback.
const DERIVED_CALLBACK_GAS: Gas = Gas::from_tgas(90);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    signer: AccountId,
    lockup: evm::Address,
    finality: Finality,
    lots: IterableMap<LotId, Lot>,
    paths: LookupSet<String>,
    next_id: LotId,
    /// Sale proceeds owed to each account, pulled with `withdraw_proceeds`.
    proceeds: LookupMap<AccountId, u128>,
}

fn require_deposit() {
    require!(
        env::attached_deposit() >= mpc::REQUEST_DEPOSIT,
        "attach 1 yoctoNEAR (the MPC request deposit)"
    );
}

impl Contract {
    fn lot(&self, id: LotId) -> Lot {
        self.lots.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such lot"))
    }

    fn lot_address(lot: &Lot) -> evm::Address {
        evm::parse_address(lot.address.as_deref().expect("lot has no address")).unwrap()
    }

    fn require_owner(lot: &Lot) {
        require!(env::predecessor_account_id() == lot.owner, "not the lot owner");
    }

    /// Records the tx as issued, then asks MPC to sign it.
    fn issue(&mut self, id: LotId, mut lot: Lot, nonce: u64, kind: Kind, gas_limit: u64, fees: Fees) -> Promise {
        require!(!lot.sign_in_flight, "a sign request is already in flight");
        if let Err(e) = evm::check_fees(&lot.issued, nonce, &fees, &kind) {
            env::panic_str(e);
        }
        let item = Issued { seq: lot.next_seq, nonce, kind, gas_limit, fees, tx_hash: None, raw_tx: None };
        let token = evm::parse_address(&lot.token).unwrap();
        let payload = evm::signing_hash(&evm::build(&item, &Self::lot_address(&lot), &token));
        let seq = item.seq;
        lot.issued.push(item);
        lot.next_seq += 1;
        lot.sign_in_flight = true;
        let path = lot.path.clone();
        self.lots.insert(id, lot);

        Promise::new(self.signer.clone())
            .function_call("sign".to_string(), mpc::sign_args(&path, &payload), mpc::REQUEST_DEPOSIT, mpc::REQUEST_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(id, seq))
    }

    fn burn(&mut self, id: LotId, lot: Lot, nonce: u64, fees: Fees) -> Promise {
        self.issue(id, lot, nonce, Kind::Burn, evm::BURN_GAS_LIMIT, fees)
    }

    fn mark_clean(lot: &mut Lot) {
        lot.state = LotState::Clean;
        lot.version += 1;
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(signer: AccountId, lockup: String, finality: Finality) -> Self {
        Self {
            signer,
            lockup: evm::parse_address(&lockup).unwrap_or_else(|| env::panic_str("lockup must be a 0x address")),
            finality,
            lots: IterableMap::new(b"l"),
            paths: LookupSet::new(b"p"),
            next_id: 0,
            proceeds: LookupMap::new(b"r"),
        }
    }

    /// Mints a lot whose source is a Sablier stream the caller created, proven by MPC from the
    /// stream's creation log. The path is `<caller>/<name>`, so a lot's address belongs to its
    /// issuer's namespace: nobody else can mint a title over a stream paying that address.
    ///
    /// The caller pays for the lot's storage; any excess deposit is refunded, and a mint that rolls
    /// back refunds the storage too.
    #[payable]
    pub fn mint_proven(&mut self, name: String, owner_id: AccountId, royalty_bps: u16, log: CreationLog) -> Promise {
        require!(royalty_bps <= sale::MAX_ROYALTY_BPS, "royalty above the 10% cap");
        require!(
            (1..=MAX_NAME_LEN).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)),
            "name must be 1-64 chars of [A-Za-z0-9._-]"
        );
        let stream = source::decode(&log, &self.lockup).unwrap_or_else(|e| env::panic_str(e));
        source::verify_args(&log, self.finality).unwrap_or_else(|e| env::panic_str(e));
        let before = env::storage_usage();
        let issuer = env::predecessor_account_id();
        let path = format!("{issuer}/{name}");
        require!(self.paths.insert(path.clone()), "path already used");
        let id = self.next_id;
        self.next_id += 1;
        self.lots.insert(
            id,
            Lot {
                owner: owner_id,
                issuer,
                path: path.clone(),
                address: None,
                token: evm::format_address(&stream.token),
                source: Source {
                    kind: source::SOURCE_KIND.to_string(),
                    contract: evm::format_address(&self.lockup),
                    id: U128(stream.id),
                },
                state: LotState::Minting,
                version: 0,
                next_nonce: 0,
                issued: vec![],
                next_seq: 0,
                sign_in_flight: false,
                royalty_bps,
                listing: None,
            },
        );
        let storage = env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128);
        let needed = storage.saturating_add(mpc::REQUEST_DEPOSIT);
        let attached = env::attached_deposit();
        require!(attached >= needed, format!("attach at least {} yoctoNEAR: storage plus the MPC deposit", needed.as_yoctonear()));
        if attached > needed {
            Promise::new(env::predecessor_account_id()).transfer(attached.saturating_sub(needed)).detach();
        }
        Promise::new(self.signer.clone())
            .function_call(
                "derived_public_key".to_string(),
                mpc::derived_key_args(&path, env::current_account_id().as_str()),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(DERIVED_CALLBACK_GAS)
                    .on_derived(id, evm::format_address(&stream.recipient), log, storage),
            )
    }

    #[private]
    pub fn on_derived(
        &mut self,
        id: LotId,
        recipient: String,
        log: CreationLog,
        storage: NearToken,
        #[callback_result] key: Result<String, PromiseError>,
    ) -> PromiseOrValue<Option<MintedLot>> {
        let Some(pk) = key.ok().as_deref().and_then(mpc::parse_derived_key) else {
            return PromiseOrValue::Value(self.roll_back(id, "derivation failed", storage));
        };
        let address = evm::format_address(&evm::address_from_uncompressed(&pk));
        if address != recipient {
            return PromiseOrValue::Value(self.roll_back(id, "the stream does not pay this lot's address", storage));
        }
        let args = match source::verify_args(&log, self.finality) {
            Ok(args) => args,
            Err(e) => return PromiseOrValue::Value(self.roll_back(id, e, storage)),
        };
        let mut lot = self.lot(id);
        lot.address = Some(address);
        self.lots.insert(id, lot);
        PromiseOrValue::Promise(
            Promise::new(self.signer.clone())
                .function_call("verify_foreign_transaction".to_string(), args, mpc::REQUEST_DEPOSIT, mpc::REQUEST_GAS)
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_mint_verified(id, storage)),
        )
    }

    /// MPC answers only if Base has exactly the attested log at the contract's finality.
    #[private]
    pub fn on_mint_verified(&mut self, id: LotId, storage: NearToken, #[callback_result] r: Result<Value, PromiseError>) -> Option<MintedLot> {
        if r.is_err() {
            return self.roll_back(id, "MPC did not attest the creation log", storage);
        }
        let mut lot = self.lot(id);
        let address = lot.address.clone().expect("set in on_derived");
        lot.state = LotState::Active;
        NftMint { owner_id: &lot.owner, token_ids: &[&id.to_string()], memo: Some(&address) }.emit();
        self.lots.insert(id, lot);
        Some(MintedLot { id, address })
    }

    #[payable]
    pub fn request_transfer(&mut self, id: LotId, to: String, amount: U128, gas_limit: u64, fees: Fees) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        Self::require_owner(&lot);
        require!(lot.state == LotState::Active, "lot is not Active");
        require!(evm::parse_address(&to).is_some(), "to must be a 0x address");
        require!(amount.0 > 0, "amount must be positive");
        require!((evm::BURN_GAS_LIMIT..=evm::MAX_TRANSFER_GAS_LIMIT).contains(&gas_limit), "gas limit out of range");
        let nonce = lot.next_nonce;
        self.issue(id, lot, nonce, Kind::Transfer { to, amount }, gas_limit, fees)
    }

    /// Owner freezes the lot. With nothing outstanding it is Clean at once; otherwise a burn
    /// is signed at the outstanding nonce.
    #[payable]
    pub fn seal(&mut self, id: LotId, fees: Fees) -> PromiseOrValue<LotState> {
        require_deposit();
        let mut lot = self.lot(id);
        Self::require_owner(&lot);
        require!(lot.state == LotState::Active, "lot is not Active");
        require!(!lot.sign_in_flight, "a sign request is already in flight");
        if lot.issued.is_empty() {
            Self::mark_clean(&mut lot);
            self.lots.insert(id, lot);
            return PromiseOrValue::Value(LotState::Clean);
        }
        lot.state = LotState::Sealing;
        let nonce = lot.next_nonce;
        PromiseOrValue::Promise(self.burn(id, lot, nonce, fees))
    }

    /// Anyone may re-sign the burn at an outstanding nonce with higher fees, so a seller who seals
    /// and walks away can't strand the lot. The nonce is explicit: after a rescue, the burn at the
    /// stuck nonce must still be repriceable. Burns are 0-value self-transfers.
    #[payable]
    pub fn rebump(&mut self, id: LotId, nonce: u64, fees: Fees) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        require!(lot.state == LotState::Sealing, "lot is not Sealing");
        require!(
            lot.issued.iter().any(|i| i.nonce == nonce && i.kind == Kind::Burn),
            "no burn outstanding at that nonce"
        );
        self.burn(id, lot, nonce, fees)
    }

    /// A tx that mines but reverts can never be proven. A burn at the next nonce can only mine
    /// after the stuck one is consumed, so proving it proves both.
    #[payable]
    pub fn rescue(&mut self, id: LotId, fees: Fees) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        require!(lot.state == LotState::Sealing, "lot is not Sealing");
        require!(
            !lot.issued.is_empty() && lot.issued.iter().all(|i| i.nonce == lot.next_nonce),
            "rescue needs an outstanding nonce and no rescue burn yet"
        );
        let nonce = lot.next_nonce + 1;
        self.burn(id, lot, nonce, fees)
    }

    /// Owner returns the lot to Active. Bumping the version cancels anything bound to the old one.
    pub fn unseal(&mut self, id: LotId) {
        let mut lot = self.lot(id);
        Self::require_owner(&lot);
        require!(matches!(lot.state, LotState::Sealing | LotState::Clean), "lot is not Sealing or Clean");
        require!(
            lot.issued.iter().all(|i| i.nonce == lot.next_nonce),
            "a rescue burn is outstanding; prove it first"
        );
        lot.state = LotState::Active;
        lot.version += 1;
        lot.listing = None;
        self.lots.insert(id, lot);
    }

    #[private]
    pub fn on_signed(&mut self, id: LotId, seq: u32, #[callback_result] sig: Result<Value, PromiseError>) -> Option<String> {
        let mut lot = self.lot(id);
        lot.sign_in_flight = false;
        let lot_addr = Self::lot_address(&lot);
        let token = evm::parse_address(&lot.token).unwrap();
        let Some(pos) = lot.issued.iter().position(|i| i.seq == seq) else {
            log!("lot {} seq {} already cleared by a proof", id, seq);
            self.lots.insert(id, lot);
            return None;
        };
        let signed = sig.ok().and_then(mpc::parse_signature).and_then(|(r, s, v)| {
            evm::assemble(&evm::build(&lot.issued[pos], &lot_addr, &token), r, s, v, &lot_addr)
        });
        let raw = signed.map(|t| {
            lot.issued[pos].tx_hash = Some(t.hash);
            lot.issued[pos].raw_tx = Some(t.raw.clone());
            t.raw
        });
        if raw.is_none() {
            log!("lot {} seq {} has no valid signature recorded; it stays issued", id, seq);
        }
        self.lots.insert(id, lot);
        raw
    }

    /// Fallback when `on_signed` recorded nothing: anyone submits the public MPC signature.
    pub fn register_signature(&mut self, id: LotId, seq: u32, r: String, s: String, v: u8) -> String {
        let mut lot = self.lot(id);
        let lot_addr = Self::lot_address(&lot);
        let token = evm::parse_address(&lot.token).unwrap();
        let pos = lot.issued.iter().position(|i| i.seq == seq).unwrap_or_else(|| env::panic_str("no such issued tx"));
        let word = |h: &str| -> [u8; 32] {
            hex::decode(h.trim_start_matches("0x")).ok().and_then(|b| b.try_into().ok())
                .unwrap_or_else(|| env::panic_str("r and s must be 32-byte hex"))
        };
        let tx = evm::build(&lot.issued[pos], &lot_addr, &token);
        let signed = evm::assemble(&tx, word(&r), word(&s), v, &lot_addr)
            .unwrap_or_else(|| env::panic_str("signature does not recover to the lot address"));
        lot.issued[pos].tx_hash = Some(signed.hash);
        lot.issued[pos].raw_tx = Some(signed.raw.clone());
        self.lots.insert(id, lot);
        signed.raw
    }

    /// Anyone may ask MPC to attest that an issued tx is mined. The hash comes from contract state.
    /// No per-lot lock: a failing proof only times out at MPC, and `on_proved` ignores stale ones,
    /// so a griefer proving a tx that never mined can't block an honest proof.
    #[payable]
    pub fn prove(&mut self, id: LotId, seq: u32) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        let issued = lot.issued.iter().find(|i| i.seq == seq).unwrap_or_else(|| env::panic_str("no such issued tx"));
        let hash = issued.tx_hash.clone().unwrap_or_else(|| env::panic_str("issued tx has no recorded signature"));
        let nonce = issued.nonce;
        Promise::new(self.signer.clone())
            .function_call(
                "verify_foreign_transaction".to_string(),
                mpc::verify_args(&hash, self.finality.as_str()),
                mpc::REQUEST_DEPOSIT,
                mpc::REQUEST_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_proved(id, nonce))
    }

    /// One mined tx at `nonce` proves every nonce up to it consumed.
    #[private]
    pub fn on_proved(&mut self, id: LotId, nonce: u64, #[callback_result] r: Result<Value, PromiseError>) -> bool {
        let mut lot = self.lot(id);
        let consumed = r.is_ok() && nonce >= lot.next_nonce;
        if consumed {
            lot.issued.retain(|i| i.nonce > nonce);
            lot.next_nonce = nonce + 1;
            if lot.state == LotState::Sealing && lot.issued.is_empty() {
                Self::mark_clean(&mut lot);
            }
        } else {
            log!("lot {} nonce {} not proven", id, nonce);
        }
        self.lots.insert(id, lot);
        consumed
    }

    pub fn get_lot(&self, id: LotId) -> Option<Lot> {
        self.lots.get(&id).cloned()
    }

    pub fn get_config(&self) -> Config {
        Config { signer: self.signer.clone(), lockup: evm::format_address(&self.lockup), finality: self.finality }
    }
}

impl Contract {
    /// Frees the lot and its path and refunds the issuer's storage deposit.
    fn roll_back(&mut self, id: LotId, why: &str, storage: NearToken) -> Option<MintedLot> {
        log!("lot {} not minted: {}", id, why);
        if let Some(lot) = self.lots.remove(&id) {
            self.paths.remove(&lot.path);
            if !storage.is_zero() {
                Promise::new(lot.issuer).transfer(storage).detach();
            }
        }
        None
    }

    /// Every title move goes through here: `nft_transfer` by the owner, or `buy`.
    fn move_title(&mut self, id: LotId, mut lot: Lot, receiver_id: AccountId, memo: Option<&str>) {
        require!(lot.state == LotState::Clean, "lot is not Clean");
        require!(receiver_id != lot.owner, "receiver is already the owner");
        let old = std::mem::replace(&mut lot.owner, receiver_id);
        lot.state = LotState::Active;
        lot.version += 1;
        lot.listing = None;
        NftTransfer {
            old_owner_id: &old,
            new_owner_id: &lot.owner,
            token_ids: &[&id.to_string()],
            authorized_id: None,
            memo,
        }
        .emit();
        self.lots.insert(id, lot);
    }

    fn internal_transfer(&mut self, id: LotId, receiver_id: AccountId, memo: Option<String>) {
        let lot = self.lot(id);
        Self::require_owner(&lot);
        self.move_title(id, lot, receiver_id, memo.as_deref());
    }
}
