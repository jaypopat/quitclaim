mod evm;
mod lease;
mod mpc;
mod nft;
mod sale;
mod source;
mod types;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::events::{NftMint, NftTransfer};
use near_sdk::json_types::U128;
use near_mpc_contract_interface::types::{PublicKey, SignatureResponse};
use near_sdk::serde_json::{self, Value};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub use source::CreationLog;
pub use types::{
    Config, Fees, Finality, Issued, Item, Kind, Lease, LeaseBudget, LeaseOffer, Listing, Lot, LotId, LotState, MintedLot, Payout,
    Schedule, Source,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const MAX_NAME_LEN: usize = 64;
/// Room to forward the verify call (50 Tgas) and schedule its callback.
const DERIVED_CALLBACK_GAS: Gas = Gas::from_tgas(90);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    signer: AccountId,
    lockup: [u8; 20],
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

    fn lot_mut(&mut self, id: LotId) -> &mut Lot {
        self.lots.get_mut(&id).unwrap_or_else(|| env::panic_str("no such lot"))
    }

    fn lot_address(lot: &Lot) -> evm::Address {
        lot.address.as_deref().expect("lot has no address").parse().unwrap()
    }

    /// Records the tx as issued, then asks MPC to sign it.
    fn issue(&mut self, id: LotId, mut lot: Lot, nonce: u64, kind: Kind, gas_limit: u64, fees: Fees) -> Promise {
        require!(!lot.sign_in_flight, "a sign request is already in flight");
        if let Err(e) = evm::check_fees(&lot.issued, nonce, &fees, &kind) {
            env::panic_str(e);
        }
        let item = Issued { seq: lot.next_seq, nonce, kind, gas_limit, fees, tx_hash: None, raw_tx: None };
        let token = lot.token.parse::<evm::Address>().unwrap();
        let payload = evm::signing_hash(&evm::build(&item, &Self::lot_address(&lot), &token));
        let seq = item.seq;
        lot.issued.push(item);
        lot.next_seq += 1;
        lot.sign_in_flight = true;
        let path = lot.path.clone();
        self.lots.insert(id, lot);

        Promise::new(self.signer.clone())
            .function_call(mpc::SIGN.to_string(), mpc::sign_args(&path, &payload), mpc::REQUEST_DEPOSIT, mpc::REQUEST_GAS)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(id, seq))
    }

    fn burn(&mut self, id: LotId, lot: Lot, nonce: u64, fees: Fees) -> Promise {
        self.issue(id, lot, nonce, Kind::Burn, evm::BURN_GAS_LIMIT, fees)
    }

    /// A lease that has run out ends the moment its lot is Clean.
    fn mark_clean(id: LotId, lot: &mut Lot) {
        lot.state = LotState::Clean;
        lot.version += 1;
        if Self::lease_over(lot) {
            Self::close_lease(id, lot);
        }
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(signer: AccountId, lockup: String, finality: Finality) -> Self {
        Self {
            signer,
            lockup: lockup.parse::<evm::Address>().unwrap_or_else(|_| env::panic_str("lockup must be a 0x address")).into_array(),
            finality,
            lots: IterableMap::new(b"l"),
            paths: LookupSet::new(b"p"),
            next_id: 0,
            proceeds: LookupMap::new(b"r"),
        }
    }

    /// Mints a lot from an MPC-proven Sablier creation log. The path is `<caller>/<name>`,
    /// so the stream must pay the address in the minter's namespace. The caller chooses
    /// the initial owner and receives the royalty; no source-sender authorization is required.
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
        let evm_log = log.to_evm_log().unwrap_or_else(|e| env::panic_str(e));
        let stream = source::decode(&evm_log, &self.lockup.into()).unwrap_or_else(|e| env::panic_str(e));
        source::verify_request(&evm_log, self.finality).unwrap_or_else(|e| env::panic_str(e));
        let recipient = format!("{:#x}", stream.recipient);
        let before = env::storage_usage();
        let minter = env::predecessor_account_id();
        let path = format!("{minter}/{name}");
        require!(self.paths.insert(path.clone()), "path already used");
        let id = self.next_id;
        self.next_id += 1;
        self.lots.insert(
            id,
            Lot {
                owner: owner_id,
                minter,
                path: path.clone(),
                address: None,
                token: format!("{:#x}", stream.token),
                source: Source {
                    kind: source::SOURCE_KIND.to_string(),
                    contract: format!("{:#x}", evm::Address::from(self.lockup)),
                    id: U128(stream.id),
                    schedule: stream.schedule,
                },
                state: LotState::Minting,
                version: 0,
                next_nonce: 0,
                issued: vec![],
                next_seq: 0,
                sign_in_flight: false,
                royalty_bps,
                listing: None,
                lease_offer: None,
                lease: None,
            },
        );
        self.lots.flush();
        // A lot that survives the mint has the recipient as its address, which `on_derived` stores later.
        let address_bytes = near_sdk::borsh::object_length(&recipient).unwrap() as u64;
        let storage = env::storage_byte_cost().saturating_mul((env::storage_usage() - before + address_bytes) as u128);
        let needed = storage.saturating_add(mpc::REQUEST_DEPOSIT);
        let attached = env::attached_deposit();
        require!(attached >= needed, format!("attach at least {} yoctoNEAR: storage plus the MPC deposit", needed.as_yoctonear()));
        if attached > needed {
            Promise::new(env::predecessor_account_id()).transfer(attached.saturating_sub(needed)).detach();
        }
        Promise::new(self.signer.clone())
            .function_call(
                mpc::DERIVED_PUBLIC_KEY.to_string(),
                mpc::derived_key_args(&path, &env::current_account_id()),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(DERIVED_CALLBACK_GAS)
                    .on_derived(id, recipient, log, storage),
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
        let Some(pk) = key.ok().and_then(|k| k.parse::<PublicKey>().ok()).and_then(mpc::derived_key) else {
            return PromiseOrValue::Value(self.roll_back(id, "derivation failed", storage));
        };
        let address = format!("{:#x}", evm::Address::from_raw_public_key(&pk));
        if address != recipient {
            return PromiseOrValue::Value(self.roll_back(id, "the stream does not pay this lot's address", storage));
        }
        let args = match log.to_evm_log().and_then(|l| source::verify_request(&l, self.finality)) {
            Ok(request) => mpc::verify_args(request),
            Err(e) => return PromiseOrValue::Value(self.roll_back(id, e, storage)),
        };
        self.lot_mut(id).address = Some(address);
        PromiseOrValue::Promise(
            Promise::new(self.signer.clone())
                .function_call(mpc::VERIFY_FOREIGN_TRANSACTION.to_string(), args, mpc::REQUEST_DEPOSIT, mpc::REQUEST_GAS)
                .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_mint_verified(id, storage)),
        )
    }

    /// MPC answers only if Base has exactly the attested log at the contract's finality.
    #[private]
    pub fn on_mint_verified(&mut self, id: LotId, storage: NearToken, #[callback_result] r: Result<Value, PromiseError>) -> Option<MintedLot> {
        if r.is_err() {
            return self.roll_back(id, "MPC did not attest the creation log", storage);
        }
        let lot = self.lot_mut(id);
        let address = lot.address.clone().expect("set in on_derived");
        lot.state = LotState::Active;
        NftMint { owner_id: &lot.owner, token_ids: &[&id.to_string()], memo: Some(&address) }.emit();
        Some(MintedLot { id, address })
    }

    #[payable]
    pub fn request_transfer(&mut self, id: LotId, to: String, amount: U128, gas_limit: u64, fees: Fees) -> Promise {
        require_deposit();
        let mut lot = self.load(id);
        Self::require_controller(&lot);
        require!(lot.state == LotState::Active, "lot is not Active");
        require!(to.parse::<evm::Address>().is_ok(), "to must be a 0x address");
        require!(amount.0 > 0, "amount must be positive");
        require!((evm::BURN_GAS_LIMIT..=evm::MAX_TRANSFER_GAS_LIMIT).contains(&gas_limit), "gas limit out of range");
        let nonce = lot.next_nonce;
        Self::charge_lease(&mut lot, nonce, amount.0);
        self.issue(id, lot, nonce, Kind::Transfer { to, amount }, gas_limit, fees)
    }

    /// The controller freezes the lot, and so may anyone once its lease has run out. With nothing
    /// outstanding it is Clean at once; otherwise a burn is signed at the outstanding nonce.
    #[payable]
    pub fn seal(&mut self, id: LotId, fees: Fees) -> PromiseOrValue<LotState> {
        require_deposit();
        let mut lot = self.load(id);
        if !Self::lease_run_out(&lot) {
            Self::require_controller(&lot);
        }
        require!(lot.state == LotState::Active, "lot is not Active");
        require!(!lot.sign_in_flight, "a sign request is already in flight");
        if lot.issued.is_empty() {
            Self::mark_clean(id, &mut lot);
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

    /// The controller returns the lot to Active. Bumping the version cancels anything bound to the old one.
    /// Refused once the lease has run out, so expiry always reaches Clean.
    pub fn unseal(&mut self, id: LotId) {
        let lot = self.load_mut(id);
        Self::require_controller(lot);
        require!(!Self::lease_run_out(lot), "the lease has run out");
        require!(matches!(lot.state, LotState::Sealing | LotState::Clean), "lot is not Sealing or Clean");
        require!(
            lot.issued.iter().all(|i| i.nonce == lot.next_nonce),
            "a rescue burn is outstanding; prove it first"
        );
        lot.state = LotState::Active;
        lot.version += 1;
        lot.listing = None;
        lot.lease_offer = None;
    }

    #[private]
    pub fn on_signed(&mut self, id: LotId, seq: u32, #[callback_result] sig: Result<Value, PromiseError>) -> Option<String> {
        let lot = self.lot_mut(id);
        lot.sign_in_flight = false;
        let lot_addr = Self::lot_address(lot);
        let token = lot.token.parse::<evm::Address>().unwrap();
        let Some(pos) = lot.issued.iter().position(|i| i.seq == seq) else {
            log!("lot {} seq {} already cleared by a proof", id, seq);
            return None;
        };
        let signed = sig.ok().and_then(|v| serde_json::from_value::<SignatureResponse>(v).ok()).and_then(mpc::parse_signature).and_then(|(r, s, v)| {
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
        raw
    }

    /// Fallback when `on_signed` recorded nothing: anyone submits the public MPC signature.
    pub fn register_signature(&mut self, id: LotId, seq: u32, r: String, s: String, v: u8) -> String {
        let lot = self.lot_mut(id);
        let lot_addr = Self::lot_address(lot);
        let token = lot.token.parse::<evm::Address>().unwrap();
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
        let tx: [u8; 32] = hex::decode(hash.trim_start_matches("0x")).ok().and_then(|b| b.try_into().ok()).expect("recorded hashes are 32-byte hex");
        let nonce = issued.nonce;
        Promise::new(self.signer.clone())
            .function_call(
                mpc::VERIFY_FOREIGN_TRANSACTION.to_string(),
                mpc::verify_args(mpc::mined_request(tx, self.finality)),
                mpc::REQUEST_DEPOSIT,
                mpc::REQUEST_GAS,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_proved(id, nonce))
    }

    /// One mined tx at `nonce` proves every nonce up to it consumed.
    #[private]
    pub fn on_proved(&mut self, id: LotId, nonce: u64, #[callback_result] r: Result<Value, PromiseError>) -> bool {
        let lot = self.lot_mut(id);
        let consumed = r.is_ok() && nonce >= lot.next_nonce;
        if consumed {
            lot.issued.retain(|i| i.nonce > nonce);
            lot.next_nonce = nonce + 1;
            if lot.state == LotState::Sealing && lot.issued.is_empty() {
                Self::mark_clean(id, lot);
            }
        } else {
            log!("lot {} nonce {} not proven", id, nonce);
        }
        consumed
    }

    pub fn get_lot(&self, id: LotId) -> Option<Lot> {
        self.lots.get(&id).cloned()
    }

    pub fn get_config(&self) -> Config {
        Config { signer: self.signer.clone(), lockup: format!("{:#x}", evm::Address::from(self.lockup)), finality: self.finality }
    }
}

impl Contract {
    /// Frees the lot and its path and refunds the minter's storage deposit.
    fn roll_back(&mut self, id: LotId, why: &str, storage: NearToken) -> Option<MintedLot> {
        log!("lot {} not minted: {}", id, why);
        if let Some(lot) = self.lots.remove(&id) {
            self.paths.remove(&lot.path);
            if !storage.is_zero() {
                Promise::new(lot.minter).transfer(storage).detach();
            }
        }
        None
    }

    /// Every title or lease move goes through here: `nft_transfer` by its holder, or `buy`.
    fn move_title(&mut self, id: LotId, mut lot: Lot, item: Item, receiver_id: AccountId, memo: Option<&str>) {
        require!(lot.state == LotState::Clean, "lot is not Clean");
        let holder = match item {
            Item::Title => {
                require!(lot.lease.is_none(), "the title can't move during a lease");
                &mut lot.owner
            }
            Item::Lease => &mut lot.lease.as_mut().unwrap_or_else(|| env::panic_str("lot is not leased")).holder,
        };
        require!(receiver_id != *holder, "receiver already holds this token");
        let old = std::mem::replace(holder, receiver_id.clone());
        lot.state = LotState::Active;
        lot.version += 1;
        lot.listing = None;
        lot.lease_offer = None;
        NftTransfer {
            old_owner_id: &old,
            new_owner_id: &receiver_id,
            token_ids: &[&nft::token_id(id, item)],
            authorized_id: None,
            memo,
        }
        .emit();
        self.lots.insert(id, lot);
    }

    fn internal_transfer(&mut self, id: LotId, item: Item, receiver_id: AccountId, memo: Option<String>) {
        let lot = self.load(id);
        require!(env::predecessor_account_id() == *Self::holder(&lot, item), "not the token holder");
        self.move_title(id, lot, item, receiver_id, memo.as_deref());
    }
}
