use near_sdk::json_types::U128;
use std::collections::HashMap;

use near_sdk::{near, AccountId};

pub use crate::source::Schedule;

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
    /// ERC-20 `transfer(to, amount)` on the lot's token. The only way value leaves a lot.
    Transfer { to: String, amount: U128 },
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
    /// The NEAR mint caller and royalty beneficiary, independent of the source stream's sender.
    pub minter: AccountId,
    pub path: String,
    pub address: Option<String>,
    /// The ERC-20 the lot holds, fixed at mint. The only contract a lot signs calls to.
    pub token: String,
    /// The position that pays out to the lot address, proven from its creation log at mint.
    /// The contract never signs calls to it.
    pub source: Source,
    pub state: LotState,
    pub version: u32,
    /// Lowest nonce not yet proven consumed.
    pub next_nonce: u64,
    pub issued: Vec<Issued>,
    pub next_seq: u32,
    pub sign_in_flight: bool,
    /// Minter royalty on Quitclaim sales, in basis points. Fixed at mint.
    pub royalty_bps: u16,
    /// Only exists while Clean. Bound to the version it was listed at.
    pub listing: Option<Listing>,
    /// The title owner's standing offer to lease the lot. Only while Clean with no lease, bound to the version.
    pub lease_offer: Option<LeaseOffer>,
    /// While set, the lease holder controls the lot and the title can't move. Ends only at Clean.
    pub lease: Option<Lease>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Finality {
    Latest,
    Safe,
    Finalized,
}

#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct MintedLot {
    pub id: LotId,
    pub address: String,
}

/// The two tokens a lot can stand for: its title (`<id>`) and, while leased, its lease (`<id>-lease`).
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Item {
    Title,
    Lease,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Listing {
    pub item: Item,
    /// Price in yoctoNEAR.
    pub price: U128,
    pub version: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LeaseOffer {
    /// Price in yoctoNEAR.
    pub price: U128,
    pub ends_at_ms: u64,
    pub version: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Lease {
    pub holder: AccountId,
    pub start_ms: u64,
    pub ends_at_ms: u64,
    /// Worst case the lease holders have moved out: per nonce, the largest transfer issued there.
    pub committed: U128,
}

#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LeaseBudget {
    /// What the stream has vested since the lease started, up to its end.
    pub allowed: U128,
    pub committed: U128,
}

/// NEP-199 payout, as a view of exactly what `buy` credits.
#[near(serializers = [json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

/// Where a lot's value comes from. Anyone can pull it into the lot; nobody can redirect it.
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Source {
    /// e.g. "sablier-lockup-v4".
    pub kind: String,
    pub contract: String,
    pub id: U128,
    pub schedule: Schedule,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Config {
    pub signer: AccountId,
    /// The Sablier Lockup a lot's source stream must come from.
    pub lockup: String,
    pub finality: Finality,
}
