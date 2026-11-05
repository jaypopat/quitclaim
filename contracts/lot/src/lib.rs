use near_sdk::store::IterableMap;
use near_sdk::{near, AccountId, PanicOnDefault};

pub const CHAIN_ID: u64 = 84532;
pub const FOREIGN_CHAIN: &str = "Base";
pub const SIGN_DOMAIN: u32 = 0;
pub const FOREIGN_TX_DOMAIN: u32 = 3;

pub type LotId = u32;

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Debug)]
pub enum LotState {
    Minting,
    Active,
    Sealing,
    Clean,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Lot {
    pub owner: AccountId,
    pub path: String,
    pub address: Option<String>,
    pub state: LotState,
    pub version: u32,
    pub next_nonce: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    signer: AccountId,
    lots: IterableMap<LotId, Lot>,
    next_id: LotId,
}

#[near]
impl Contract {
    #[init]
    pub fn new(signer: AccountId) -> Self {
        Self {
            signer,
            lots: IterableMap::new(b"l"),
            next_id: 0,
        }
    }

    pub fn signer(&self) -> AccountId {
        self.signer.clone()
    }

    pub fn get_lot(&self, id: LotId) -> Option<Lot> {
        self.lots.get(&id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_contract_has_no_lots() {
        let c = Contract::new("v1.signer-prod.testnet".parse().unwrap());
        assert!(c.get_lot(0).is_none());
        assert_eq!(c.signer().as_str(), "v1.signer-prod.testnet");
    }
}
