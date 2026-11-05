mod evm;
mod mpc;
mod nft;
mod types;

#[cfg(test)]
mod tests;

use near_contract_standards::non_fungible_token::events::{NftMint, NftTransfer};
use near_sdk::serde_json::Value;
use near_sdk::store::{IterableMap, LookupSet};
use near_sdk::{
    env, log, near, require, AccountId, Gas, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub use types::{Fees, Finality, Issued, Kind, Lot, LotId, LotState};

const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    signer: AccountId,
    admin: AccountId,
    finality: Finality,
    lots: IterableMap<LotId, Lot>,
    paths: LookupSet<String>,
    next_id: LotId,
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
        let vesting = evm::parse_address(&lot.vesting).unwrap();
        let payload = evm::signing_hash(&evm::build(&item, &Self::lot_address(&lot), &vesting));
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
    pub fn new(signer: AccountId, admin: AccountId, finality: Finality) -> Self {
        Self {
            signer,
            admin,
            finality,
            lots: IterableMap::new(b"l"),
            paths: LookupSet::new(b"p"),
            next_id: 0,
        }
    }

    /// Admin-only (issuer provisioning). Paths are unique: two lots on one path would share an address.
    pub fn mint(&mut self, path: String, vesting: String, owner_id: AccountId, issuer: AccountId) -> Promise {
        require!(env::predecessor_account_id() == self.admin, "only the admin can mint");
        require!(evm::parse_address(&vesting).is_some(), "vesting must be a 0x address");
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
                vesting,
                state: LotState::Minting,
                version: 0,
                next_nonce: 0,
                issued: vec![],
                next_seq: 0,
                sign_in_flight: false,
                prove_in_flight: false,
            },
        );
        Promise::new(self.signer.clone())
            .function_call(
                "derived_public_key".to_string(),
                mpc::derived_key_args(&path, env::current_account_id().as_str()),
                near_sdk::NearToken::from_yoctonear(0),
                Gas::from_tgas(10),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_derived(id))
    }

    #[private]
    pub fn on_derived(&mut self, id: LotId, #[callback_result] key: Result<String, PromiseError>) -> Option<String> {
        let mut lot = self.lot(id);
        let Some(pk) = key.ok().as_deref().and_then(mpc::parse_derived_key) else {
            log!("lot {} derivation failed; mint rolled back", id);
            self.paths.remove(&lot.path);
            self.lots.remove(&id);
            return None;
        };
        let address = evm::format_address(&evm::address_from_uncompressed(&pk));
        lot.address = Some(address.clone());
        lot.state = LotState::Active;
        NftMint { owner_id: &lot.owner, token_ids: &[&id.to_string()], memo: Some(&address) }.emit();
        self.lots.insert(id, lot);
        Some(address)
    }

    #[payable]
    pub fn request_claim(&mut self, id: LotId, to: String, gas_limit: u64, fees: Fees) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        Self::require_owner(&lot);
        require!(lot.state == LotState::Active, "lot is not Active");
        require!(evm::parse_address(&to).is_some(), "to must be a 0x address");
        require!((evm::BURN_GAS_LIMIT..=evm::MAX_CLAIM_GAS_LIMIT).contains(&gas_limit), "gas limit out of range");
        let nonce = lot.next_nonce;
        self.issue(id, lot, nonce, Kind::Claim { to }, gas_limit, fees)
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

    /// Anyone may re-sign the burn at the highest outstanding nonce with higher fees, so a seller
    /// who seals and walks away can't strand the lot. Burns are 0-value self-transfers.
    #[payable]
    pub fn rebump(&mut self, id: LotId, fees: Fees) -> Promise {
        require_deposit();
        let lot = self.lot(id);
        require!(lot.state == LotState::Sealing, "lot is not Sealing");
        let nonce = lot.issued.iter().map(|i| i.nonce).max().unwrap_or(lot.next_nonce);
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
        self.lots.insert(id, lot);
    }

    #[private]
    pub fn on_signed(&mut self, id: LotId, seq: u32, #[callback_result] sig: Result<Value, PromiseError>) -> Option<String> {
        let mut lot = self.lot(id);
        lot.sign_in_flight = false;
        let lot_addr = Self::lot_address(&lot);
        let vesting = evm::parse_address(&lot.vesting).unwrap();
        let Some(pos) = lot.issued.iter().position(|i| i.seq == seq) else {
            log!("lot {} seq {} already cleared by a proof", id, seq);
            self.lots.insert(id, lot);
            return None;
        };
        let signed = sig.ok().and_then(mpc::parse_signature).and_then(|(r, s, v)| {
            evm::assemble(&evm::build(&lot.issued[pos], &lot_addr, &vesting), r, s, v, &lot_addr)
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
        let vesting = evm::parse_address(&lot.vesting).unwrap();
        let pos = lot.issued.iter().position(|i| i.seq == seq).unwrap_or_else(|| env::panic_str("no such issued tx"));
        let word = |h: &str| -> [u8; 32] {
            hex::decode(h.trim_start_matches("0x")).ok().and_then(|b| b.try_into().ok())
                .unwrap_or_else(|| env::panic_str("r and s must be 32-byte hex"))
        };
        let tx = evm::build(&lot.issued[pos], &lot_addr, &vesting);
        let signed = evm::assemble(&tx, word(&r), word(&s), v, &lot_addr)
            .unwrap_or_else(|| env::panic_str("signature does not recover to the lot address"));
        lot.issued[pos].tx_hash = Some(signed.hash);
        lot.issued[pos].raw_tx = Some(signed.raw.clone());
        self.lots.insert(id, lot);
        signed.raw
    }

    /// Anyone may ask MPC to attest that an issued tx is mined. The hash comes from contract state.
    #[payable]
    pub fn prove(&mut self, id: LotId, seq: u32) -> Promise {
        require_deposit();
        let mut lot = self.lot(id);
        require!(!lot.prove_in_flight, "a proof is already in flight");
        let issued = lot.issued.iter().find(|i| i.seq == seq).unwrap_or_else(|| env::panic_str("no such issued tx"));
        let hash = issued.tx_hash.clone().unwrap_or_else(|| env::panic_str("issued tx has no recorded signature"));
        let nonce = issued.nonce;
        lot.prove_in_flight = true;
        self.lots.insert(id, lot);
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
        lot.prove_in_flight = false;
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

    pub fn get_config(&self) -> (AccountId, AccountId, Finality) {
        (self.signer.clone(), self.admin.clone(), self.finality)
    }
}

impl Contract {
    /// The only path by which a title moves.
    fn internal_transfer(&mut self, id: LotId, receiver_id: AccountId, memo: Option<String>) {
        let mut lot = self.lot(id);
        Self::require_owner(&lot);
        require!(lot.state == LotState::Clean, "lot is not Clean");
        require!(receiver_id != lot.owner, "receiver is already the owner");
        let old = std::mem::replace(&mut lot.owner, receiver_id);
        lot.state = LotState::Active;
        lot.version += 1;
        NftTransfer {
            old_owner_id: &old,
            new_owner_id: &lot.owner,
            token_ids: &[&id.to_string()],
            authorized_id: None,
            memo: memo.as_deref(),
        }
        .emit();
        self.lots.insert(id, lot);
    }
}
