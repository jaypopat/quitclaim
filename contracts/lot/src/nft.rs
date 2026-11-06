//! NEP-171 core + NEP-177 metadata + NEP-181 enumeration over titles (`<id>`) and live leases
//! (`<id>-lease`). Approvals (NEP-178) are not implemented, and `nft_transfer_call` (required by
//! NEP-171) refuses: anything holding a transfer right outside this contract could move a token
//! without the Clean check.

use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::base64::prelude::{BASE64_STANDARD, Engine};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, PromiseOrValue, assert_one_yocto, env, near, require};

use crate::{Contract, ContractExt, Item, Lot, LotId, LotState};

const LEASE_SUFFIX: &str = "-lease";

pub fn token_id(id: LotId, item: Item) -> TokenId {
    match item {
        Item::Title => id.to_string(),
        Item::Lease => format!("{id}{LEASE_SUFFIX}"),
    }
}

fn try_parse(token_id: &str) -> Option<(LotId, Item)> {
    let (id, item) = token_id
        .strip_suffix(LEASE_SUFFIX)
        .map_or((token_id, Item::Title), |id| (id, Item::Lease));
    Some((id.parse().ok()?, item))
}

pub fn parse_token(token_id: &str) -> (LotId, Item) {
    try_parse(token_id)
        .unwrap_or_else(|| env::panic_str("token_id must be a lot id, or one followed by -lease"))
}

/// A lot is an NFT only once MPC has attested its source; `Minting` lots are invisible.
fn is_minted(lot: &Lot) -> bool {
    lot.state != LotState::Minting
}

fn until(ms: u64) -> String {
    chrono::DateTime::from_timestamp_millis(ms as i64)
        .map_or_else(String::new, |d| d.format("%Y-%m-%d %H:%M UTC").to_string())
}

/// A card rendered on chain, so wallets show the token without any hosted image.
fn card(heading: &str, label: &str, address: &str, detail: &str, footer: &str) -> String {
    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><rect width="400" height="240" rx="16" fill="#101418"/><text x="24" y="52" fill="#f2efe6" font-family="monospace" font-size="26">{heading}</text><text x="24" y="100" fill="#9aa4ad" font-family="monospace" font-size="12">{label}</text><text x="24" y="122" fill="#f2efe6" font-family="monospace" font-size="12">{address}</text><text x="24" y="150" fill="#9aa4ad" font-family="monospace" font-size="12">{detail}</text><text x="24" y="210" fill="#d9a441" font-family="monospace" font-size="14">{footer}</text></svg>"##
    );
    format!("data:image/svg+xml;base64,{}", BASE64_STANDARD.encode(svg))
}

fn token(id: LotId, lot: &Lot, item: Item) -> Token {
    let address = lot.address.as_deref().unwrap_or("");
    let stream = lot.source.id.0;
    let (owner_id, title, description, media) = match item {
        Item::Title => (
            lot.owner.clone(),
            format!("Quitclaim lot #{id}"),
            format!("Title to {address} on Base Sepolia, holding Sablier stream {stream}"),
            card(
                &format!("Quitclaim lot #{id}"),
                "Title to",
                address,
                &format!("Base Sepolia · Sablier stream {stream}"),
                &format!("{:?}", lot.state),
            ),
        ),
        Item::Lease => {
            let lease = lot.lease.as_ref().expect("a live lease");
            let ends = until(lease.ends_at_ms);
            let left = Contract::lease_budget_of(lot).allowed.0 - lease.committed.0;
            (
                lease.holder.clone(),
                format!("Leasehold on Quitclaim lot #{id}"),
                format!("Lease of {address} on Base Sepolia until {ends}"),
                card(
                    &format!("Leasehold on lot #{id}"),
                    &format!("Until {ends}, control of"),
                    address,
                    &format!("Budget left {left} of Sablier stream {stream}"),
                    &format!("{:?}", lot.state),
                ),
            )
        }
    };
    Token {
        token_id: token_id(id, item),
        owner_id,
        metadata: Some(TokenMetadata {
            title: Some(title),
            description: Some(description),
            media: Some(media),
            ..Default::default()
        }),
        approved_account_ids: None,
    }
}

type Holding<'a> = (LotId, &'a Lot, Item, &'a AccountId);

/// near-contract-standards' enumeration bounds, checked on the wide integers before narrowing:
/// on wasm32 a `usize` cast would wrap an offset of 2^32 to the first page.
fn page(held: Vec<Holding>, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
    let start = from_index.map_or(0, |i| i.0);
    require!(
        held.len() as u128 >= start,
        "Out of bounds, please use a smaller from_index."
    );
    let limit = limit.map_or(usize::MAX, |l| usize::try_from(l).unwrap_or(usize::MAX));
    require!(limit != 0, "Cannot provide limit of 0.");
    held.into_iter()
        .skip(start as usize)
        .take(limit)
        .map(|(id, l, item, _)| token(id, l, item))
        .collect()
}

impl Contract {
    /// Every live token with its holder: each minted lot's title, then its lease while one is live.
    fn holdings(&self) -> impl Iterator<Item = Holding<'_>> {
        self.lots
            .iter()
            .filter(|(_, l)| is_minted(l))
            .flat_map(|(id, l)| {
                let lease = Self::live_lease(l).map(|lease| (*id, l, Item::Lease, &lease.holder));
                std::iter::once((*id, l, Item::Title, &l.owner)).chain(lease)
            })
    }

    /// The lot and holder of a token the views show: a minted lot's title, or its live lease.
    pub(crate) fn live_token(&self, id: LotId, item: Item) -> Option<(&Lot, &AccountId)> {
        let lot = self.lots.get(&id).filter(|l| is_minted(l))?;
        let holder = match item {
            Item::Title => &lot.owner,
            Item::Lease => &Self::live_lease(lot)?.holder,
        };
        Some((lot, holder))
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u32>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        require!(approval_id.is_none(), "approvals are not supported");
        let (id, item) = parse_token(&token_id);
        self.internal_transfer(id, item, receiver_id, memo);
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
        env::panic_str(
            "nft_transfer_call is not supported: tokens move only through nft_transfer or a sale",
        )
    }

    pub fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        let (id, item) = try_parse(&token_id)?;
        let (lot, _) = self.live_token(id, item)?;
        Some(token(id, lot, item))
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
        U128(self.holdings().count() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        page(self.holdings().collect(), from_index, limit)
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(
            self.holdings()
                .filter(|(.., holder)| **holder == account_id)
                .count() as u128,
        )
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        page(
            self.holdings()
                .filter(|(.., holder)| **holder == account_id)
                .collect(),
            from_index,
            limit,
        )
    }
}
