//! NEP-171 core + NEP-177 metadata + NEP-181 enumeration. Approvals (NEP-178) are not implemented,
//! and `nft_transfer_call` (required by NEP-171) refuses: anything holding a transfer right outside this contract
//! could move a lot without the Clean check.

use near_contract_standards::non_fungible_token::metadata::{NFTContractMetadata, TokenMetadata, NFT_METADATA_SPEC};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{assert_one_yocto, env, near, require, AccountId, PromiseOrValue};

use crate::{Contract, ContractExt, Lot, LotId, LotState};

fn parse_id(token_id: &str) -> LotId {
    token_id.parse().unwrap_or_else(|_| env::panic_str("token_id must be a lot id"))
}

/// A lot is an NFT only once MPC has attested its source; `Minting` lots are invisible.
fn is_minted(lot: &Lot) -> bool {
    lot.state != LotState::Minting
}

fn token(id: LotId, lot: &Lot) -> Token {
    Token {
        token_id: id.to_string(),
        owner_id: lot.owner.clone(),
        metadata: Some(TokenMetadata {
            title: Some(format!("Quitclaim lot #{id}")),
            description: lot.address.as_ref().map(|a| format!("Title to {a} on Base Sepolia")),
            ..Default::default()
        }),
        approved_account_ids: None,
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: TokenId, approval_id: Option<u32>, memo: Option<String>) {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        self.internal_transfer(parse_id(&token_id), receiver_id, memo);
    }

    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u32>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        env::panic_str("nft_transfer_call is not supported: lots move only through nft_transfer or a sale")
    }

    pub fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        let id = token_id.parse().ok()?;
        self.lots.get(&id).filter(|l| is_minted(l)).map(|l| token(id, l))
    }

    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Quitclaim".to_string(),
            symbol: "QCLM".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.lots.values().filter(|l| is_minted(l)).count() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.lots
            .iter()
            .filter(|(_, l)| is_minted(l))
            .skip(from_index.map_or(0, |i| i.0 as usize))
            .take(limit.map_or(usize::MAX, |l| l as usize))
            .map(|(id, l)| token(*id, l))
            .collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.lots.values().filter(|l| is_minted(l) && l.owner == account_id).count() as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.lots
            .iter()
            .filter(|(_, l)| is_minted(l) && l.owner == account_id)
            .skip(from_index.map_or(0, |i| i.0 as usize))
            .take(limit.map_or(usize::MAX, |l| l as usize))
            .map(|(id, l)| token(*id, l))
            .collect()
    }
}
