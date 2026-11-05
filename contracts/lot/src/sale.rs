//! Fixed-price sale with an issuer royalty and pulled payouts. `buy` is one synchronous call: it
//! moves the title and credits proceeds in contract state, so title and credit can't diverge.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::TokenId;
use near_sdk::json_types::U128;
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, Promise, PromiseError};

use crate::{Contract, ContractExt, Listing, LotId, LotState, Payout};

pub const MAX_ROYALTY_BPS: u16 = 1_000;
const WITHDRAW_CALLBACK_GAS: Gas = Gas::from_tgas(10);

/// (seller, issuer royalty). Integer rounding favours the seller.
pub fn split(price: u128, royalty_bps: u16) -> (u128, u128) {
    let royalty = price * royalty_bps as u128 / 10_000;
    (price - royalty, royalty)
}

impl Contract {
    fn credit(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let balance = self.proceeds.get(account).copied().unwrap_or(0);
        self.proceeds.insert(account.clone(), balance + amount);
    }
}

#[near]
impl Contract {
    /// Owner lists a Clean lot. Nothing can sign while Clean, so the position can't change under the offer.
    pub fn list(&mut self, id: LotId, price: U128) {
        let mut lot = self.lot(id);
        Self::require_owner(&lot);
        require!(lot.state == LotState::Clean, "lot is not Clean");
        require!(price.0 > 0, "price must be positive");
        lot.listing = Some(Listing { price, version: lot.version });
        self.lots.insert(id, lot);
    }

    pub fn delist(&mut self, id: LotId) {
        let mut lot = self.lot(id);
        Self::require_owner(&lot);
        lot.listing = None;
        self.lots.insert(id, lot);
    }

    /// `version` is the lot version the buyer saw, so a relisted or unsealed lot can't be bought by surprise.
    #[payable]
    pub fn buy(&mut self, id: LotId, version: u32) {
        let lot = self.lot(id);
        let listing = lot.listing.clone().unwrap_or_else(|| env::panic_str("lot is not listed"));
        require!(listing.version == lot.version && version == lot.version, "listing is stale");
        require!(env::attached_deposit().as_yoctonear() == listing.price.0, "attach exactly the listing price");
        let buyer = env::predecessor_account_id();
        require!(buyer != lot.owner, "the owner can't buy their own lot");

        let (seller_share, royalty) = split(listing.price.0, lot.royalty_bps);
        let (seller, issuer) = (lot.owner.clone(), lot.issuer.clone());
        self.move_title(id, lot, buyer, Some("quitclaim sale"));
        self.credit(&seller, seller_share);
        self.credit(&issuer, royalty);
    }

    /// Pull payment. The balance is zeroed before the transfer and restored once if it fails.
    pub fn withdraw_proceeds(&mut self) -> Promise {
        let account = env::predecessor_account_id();
        let amount = self.proceeds.remove(&account).unwrap_or(0);
        require!(amount > 0, "no proceeds");
        Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(WITHDRAW_CALLBACK_GAS).on_withdraw(account, U128(amount)))
    }

    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128, #[callback_result] r: Result<(), PromiseError>) -> bool {
        if r.is_err() {
            log!("withdrawal to {} failed; {} restored", account, amount.0);
            self.credit(&account, amount.0);
            return false;
        }
        true
    }

    pub fn proceeds_of(&self, account_id: AccountId) -> U128 {
        U128(self.proceeds.get(&account_id).copied().unwrap_or(0))
    }

    /// NEP-199, view only: exactly what `buy` would credit for `balance`.
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let id: LotId = token_id.parse().unwrap_or_else(|_| env::panic_str("token_id must be a lot id"));
        let lot = self.lot(id);
        let (seller_share, royalty) = split(balance.0, lot.royalty_bps);
        let mut payout: HashMap<AccountId, U128> = HashMap::new();
        for (account, amount) in [(lot.owner, seller_share), (lot.issuer, royalty)] {
            if amount > 0 {
                payout.entry(account).or_insert(U128(0)).0 += amount;
            }
        }
        require!(max_len_payout.is_none_or(|m| payout.len() as u32 <= m), "payout exceeds max_len_payout");
        Payout { payout }
    }
}
