use near_sdk::json_types::U128;
use std::collections::HashMap;

use near_sdk::{near, AccountId};

pub type LotId = u32;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LotState {
    /// Waiting for MPC to return the derived address.
    Minting,
    /// The owner may request contract-built signatures.
    Active,
    /// No new claims. A burn is outstanding until an issued tx is proven mined.
    Sealing,
    /// Every issued nonce is proven consumed. Only now may the title move.
    Clean,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Kind {
    Claim { to: String },
    Burn,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Fees {
    pub max_fee: U128,
    pub max_prio: U128,
}

/// A tx the contract has asked MPC to sign. Recorded before the request, because the signature
/// is public in the signer's receipt the moment MPC answers.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Issued {
    pub seq: u32,
    pub nonce: u64,
    pub kind: Kind,
    pub gas_limit: u64,
    pub fees: Fees,
    pub tx_hash: Option<String>,
    pub raw_tx: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Lot {
    pub owner: AccountId,
    pub issuer: AccountId,
    pub path: String,
    pub address: Option<String>,
    pub vesting: String,
    pub state: LotState,
    pub version: u32,
    /// Lowest nonce not yet proven consumed.
    pub next_nonce: u64,
    pub issued: Vec<Issued>,
    pub next_seq: u32,
    pub sign_in_flight: bool,
    /// Issuer royalty on Quitclaim sales, in basis points. Fixed at mint.
    pub royalty_bps: u16,
    /// Only exists while Clean. Bound to the version it was listed at.
    pub listing: Option<Listing>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Finality {
    Latest,
    Safe,
    Finalized,
}

impl Finality {
    pub fn as_str(&self) -> &'static str {
        match self {
            Finality::Latest => "Latest",
            Finality::Safe => "Safe",
            Finality::Finalized => "Finalized",
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MintedLot {
    pub id: LotId,
    pub address: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Listing {
    /// Price in yoctoNEAR.
    pub price: U128,
    pub version: u32,
}

/// NEP-199 payout, as a view of exactly what `buy` credits.
#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}
