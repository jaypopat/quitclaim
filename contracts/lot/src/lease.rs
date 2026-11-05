//! Leases. The title owner offers a Clean lot for a term; whoever takes it holds a second token,
//! `<id>-lease`, and controls the lot until the term runs out. The lease holder may move out at most
//! what the stream vests during the lease. A lease ends only at Clean, so every signature its holders
//! received is burned and proven before control returns to the owner.

use near_contract_standards::non_fungible_token::events::{NftBurn, NftMint};
use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::{nft, sale, Contract, ContractExt, Item, Kind, Lease, LeaseBudget, LeaseOffer, Lot, LotId, LotState, Schedule};

/// Vested from the lease's start up to now, capped at its end.
fn allowed(schedule: &Schedule, lease: &Lease, now_ms: u64) -> u128 {
    schedule.vested(now_ms.min(lease.ends_at_ms) / 1000) - schedule.vested(lease.start_ms / 1000)
}

impl Contract {
    /// Who may sign, seal, unseal and list: the lease holder while a lease exists, else the owner.
    pub(crate) fn controller(lot: &Lot) -> &AccountId {
        lot.lease.as_ref().map_or(&lot.owner, |l| &l.holder)
    }

    pub(crate) fn require_controller(lot: &Lot) {
        require!(env::predecessor_account_id() == *Self::controller(lot), "not the lot controller");
    }

    pub(crate) fn holder(lot: &Lot, item: Item) -> &AccountId {
        match item {
            Item::Title => &lot.owner,
            Item::Lease => &lot.lease.as_ref().unwrap_or_else(|| env::panic_str("lot is not leased")).holder,
        }
    }

    pub(crate) fn lease_budget_of(lot: &Lot) -> LeaseBudget {
        let lease = lot.lease.as_ref().unwrap_or_else(|| env::panic_str("lot is not leased"));
        LeaseBudget { allowed: U128(allowed(&lot.source.schedule, lease, env::block_timestamp_ms())), committed: lease.committed }
    }

    pub(crate) fn lease_run_out(lot: &Lot) -> bool {
        lot.lease.as_ref().is_some_and(|l| env::block_timestamp_ms() >= l.ends_at_ms)
    }

    /// Run out and Clean: the lease is over, whether or not a call has closed it yet.
    pub(crate) fn lease_over(lot: &Lot) -> bool {
        lot.state == LotState::Clean && Self::lease_run_out(lot)
    }

    pub(crate) fn live_lease(lot: &Lot) -> Option<&Lease> {
        lot.lease.as_ref().filter(|_| !Self::lease_over(lot))
    }

    /// The lot as a call should see it: a lease that ran out while the lot sat Clean ends first.
    pub(crate) fn load_mut(&mut self, id: LotId) -> &mut Lot {
        let lot = self.lot_mut(id);
        if Self::lease_over(lot) {
            Self::close_lease(id, lot);
        }
        lot
    }

    pub(crate) fn load(&mut self, id: LotId) -> Lot {
        self.load_mut(id).clone()
    }

    pub(crate) fn close_lease(id: LotId, lot: &mut Lot) {
        let lease = lot.lease.take().expect("a lease to close");
        NftBurn { owner_id: &lease.holder, token_ids: &[&nft::token_id(id, Item::Lease)], authorized_id: None, memo: None }.emit();
        lot.listing = None;
        lot.version += 1;
    }

    /// Only one tx per nonce can land, so a transfer costs only what it adds over the largest
    /// transfer already issued at its nonce.
    pub(crate) fn charge_lease(lot: &mut Lot, nonce: u64, amount: u128) {
        let prior = lot
            .issued
            .iter()
            .filter(|i| i.nonce == nonce)
            .filter_map(|i| match &i.kind {
                Kind::Transfer { amount, .. } => Some(amount.0),
                Kind::Burn => None,
            })
            .max()
            .unwrap_or(0);
        let schedule = &lot.source.schedule;
        let Some(lease) = lot.lease.as_mut() else { return };
        let now = env::block_timestamp_ms();
        require!(now < lease.ends_at_ms, "the lease has run out");
        let committed = lease.committed.0 + amount.saturating_sub(prior);
        require!(committed <= allowed(schedule, lease, now), "over the lease budget");
        lease.committed = U128(committed);
    }
}

#[near]
impl Contract {
    /// Owner offers a Clean lot for lease until `ends_at_ms`. Bound to the version, like a listing.
    pub fn offer_lease(&mut self, id: LotId, price: U128, ends_at_ms: u64) {
        let lot = self.load_mut(id);
        require!(lot.lease.is_none(), "lot is already leased");
        require!(env::predecessor_account_id() == lot.owner, "not the lot owner");
        require!(lot.state == LotState::Clean, "lot is not Clean");
        require!(price.0 > 0, "price must be positive");
        require!(ends_at_ms > env::block_timestamp_ms(), "the lease must end in the future");
        lot.listing = None;
        lot.lease_offer = Some(LeaseOffer { price, ends_at_ms, version: lot.version });
    }

    /// Pays the owner and the minter royalty in state, mints the lease token and hands the caller control.
    #[payable]
    pub fn take_lease(&mut self, id: LotId, version: u32) {
        let mut lot = self.load(id);
        let offer = lot.lease_offer.clone().unwrap_or_else(|| env::panic_str("no lease offer"));
        require!(lot.state == LotState::Clean, "lot is not Clean");
        require!(offer.version == lot.version && version == lot.version, "lease offer is stale");
        require!(env::attached_deposit().as_yoctonear() == offer.price.0, "attach exactly the lease price");
        let now = env::block_timestamp_ms();
        require!(now < offer.ends_at_ms, "the lease offer has run out");
        let lessee = env::predecessor_account_id();
        require!(lessee != lot.owner, "the owner can't lease their own lot");

        let (owner_share, royalty) = sale::split(offer.price.0, lot.royalty_bps);
        let (owner, minter) = (lot.owner.clone(), lot.minter.clone());
        NftMint { owner_id: &lessee, token_ids: &[&nft::token_id(id, Item::Lease)], memo: None }.emit();
        lot.lease = Some(Lease { holder: lessee, start_ms: now, ends_at_ms: offer.ends_at_ms, committed: U128(0) });
        lot.lease_offer = None;
        lot.state = LotState::Active;
        lot.version += 1;
        self.lots.insert(id, lot);
        self.credit(&owner, owner_share);
        self.credit(&minter, royalty);
    }

    /// The lease holder hands control back early. Only while Clean, like expiry.
    pub fn surrender_lease(&mut self, id: LotId) {
        let lot = self.load_mut(id);
        require!(env::predecessor_account_id() == *Self::holder(lot, Item::Lease), "not the lease holder");
        require!(lot.state == LotState::Clean, "lot is not Clean");
        Self::close_lease(id, lot);
    }

    /// Anyone closes a lease that ran out while its lot was already Clean.
    pub fn end_lease(&mut self, id: LotId) {
        let lot = self.lot_mut(id);
        require!(Self::lease_over(lot), "no lease has run out on a Clean lot");
        Self::close_lease(id, lot);
    }

    pub fn lease_budget(&self, id: LotId) -> LeaseBudget {
        Self::lease_budget_of(&self.lot(id))
    }
}
