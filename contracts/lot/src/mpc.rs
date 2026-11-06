//! Calls to the MPC signer, built from its own interface and SDK crates (pinned to the revision
//! `v1.signer-prod.testnet` runs), so request and response shapes can't drift from the contract.

use near_mpc_contract_interface::call_args::{
    DerivedPublicKeyArgs, SignArgs, VerifyForeignTransactionArgs,
};
use near_mpc_contract_interface::deposits::SIGN_DEPOSIT_YOCTONEAR;
use near_mpc_contract_interface::types::{
    DomainId, EvmFinality, EvmTxId, Payload, PublicKey, SignatureResponse,
    VerifyForeignTransactionRequestArgs,
};
use near_mpc_sdk::foreign_chain::ForeignChainRequestBuilder;
use near_mpc_sdk::sign::SignRequestBuilder;
use near_sdk::serde_json;
use near_sdk::{AccountId, Gas, NearToken};

use crate::types::Finality;

pub use near_mpc_contract_interface::method_names::{
    DERIVED_PUBLIC_KEY, SIGN, VERIFY_FOREIGN_TRANSACTION,
};

pub const SIGN_DOMAIN: u64 = 0;
pub const FOREIGN_TX_DOMAIN: u64 = 3;
pub const REQUEST_DEPOSIT: NearToken = NearToken::from_yoctonear(SIGN_DEPOSIT_YOCTONEAR);
/// The signer requires >= 15 Tgas on the forwarded call; the rest covers its yield bookkeeping.
pub const REQUEST_GAS: Gas = Gas::from_tgas(50);

pub fn sign_args(path: &str, payload: &[u8; 32]) -> Vec<u8> {
    let request = SignRequestBuilder::new()
        .with_path(path.to_string())
        .with_payload(Payload::Ecdsa((*payload).into()))
        .with_domain_id(DomainId(SIGN_DOMAIN))
        .build();
    serde_json::to_vec(&SignArgs::new(request)).unwrap()
}

pub fn derived_key_args(path: &str, predecessor: &AccountId) -> Vec<u8> {
    let predecessor = predecessor
        .as_str()
        .parse()
        .expect("a NEAR account id is a valid MPC account id");
    serde_json::to_vec(&DerivedPublicKeyArgs::new(
        path.to_string(),
        Some(predecessor),
        Some(DomainId(SIGN_DOMAIN)),
    ))
    .unwrap()
}

pub fn evm_finality(f: Finality) -> EvmFinality {
    match f {
        Finality::Latest => EvmFinality::Latest,
        Finality::Safe => EvmFinality::Safe,
        Finality::Finalized => EvmFinality::Finalized,
    }
}

/// No extractors: an answer at all means "mined, status 1, canonical, at `finality`".
pub fn mined_request(tx_hash: [u8; 32], finality: Finality) -> VerifyForeignTransactionRequestArgs {
    let (_, args) = ForeignChainRequestBuilder::new_base()
        .with_tx_id(EvmTxId::from(tx_hash))
        .with_finality(evm_finality(finality))
        .with_domain_id(DomainId(FOREIGN_TX_DOMAIN))
        .build()
        .expect("a request with no extractors always builds");
    args
}

pub fn verify_args(request: VerifyForeignTransactionRequestArgs) -> Vec<u8> {
    serde_json::to_vec(&VerifyForeignTransactionArgs::new(request)).unwrap()
}

/// (r, s, v). `v` is the MPC recovery id used as EIP-1559 yParity unchanged.
pub fn parse_signature(response: SignatureResponse) -> Option<([u8; 32], [u8; 32], u8)> {
    let SignatureResponse::Secp256k1(sig) = response else {
        return None;
    };
    let r: [u8; 32] = sig.big_r.affine_point[1..33].try_into().ok()?;
    Some((r, sig.s.scalar, sig.recovery_id))
}

/// The 64-byte uncompressed secp256k1 key behind a derived public key.
pub fn derived_key(key: PublicKey) -> Option<[u8; 64]> {
    match key {
        PublicKey::Secp256k1(pk) => Some(*pk.as_bytes()),
        _ => None,
    }
}
