//! Wire format of `v1.signer-prod.testnet` (near/mpc 3.18.0), read from its source and snapshots.

use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{Gas, NearToken};

pub const SIGN_DOMAIN: u32 = 0;
pub const FOREIGN_TX_DOMAIN: u32 = 3;
pub const FOREIGN_CHAIN: &str = "Base";
pub const REQUEST_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
/// The signer requires >= 15 Tgas on the forwarded call; the rest covers its yield bookkeeping.
pub const REQUEST_GAS: Gas = Gas::from_tgas(50);

pub fn sign_args(path: &str, payload: &[u8; 32]) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "request": {
            "path": path,
            "payload_v2": { "Ecdsa": hex::encode(payload) },
            "domain_id": SIGN_DOMAIN,
        }
    }))
    .unwrap()
}

pub fn derived_key_args(path: &str, predecessor: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({ "path": path, "predecessor": predecessor, "domain_id": SIGN_DOMAIN })).unwrap()
}

/// Empty extractors: an answer at all means "mined, status 1, canonical, at `finality`".
pub fn verify_args(tx_hash: &str, finality: &str) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "request": {
            "request": { FOREIGN_CHAIN: {
                "tx_id": tx_hash.trim_start_matches("0x"),
                "extractors": [],
                "finality": finality,
            }},
            "domain_id": FOREIGN_TX_DOMAIN,
            "payload_version": 1,
        }
    }))
    .unwrap()
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Response {
    big_r: AffinePoint,
    s: Scalar,
    recovery_id: u8,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct AffinePoint {
    affine_point: String,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Scalar {
    scalar: String,
}

/// (r, s, v). `v` is the MPC recovery id used as EIP-1559 yParity unchanged.
pub fn parse_signature(v: Value) -> Option<([u8; 32], [u8; 32], u8)> {
    let resp: Response = serde_json::from_value(v).ok()?;
    let big_r = hex::decode(&resp.big_r.affine_point).ok()?;
    let r: [u8; 32] = big_r.get(1..33)?.try_into().ok()?;
    let s: [u8; 32] = hex::decode(&resp.s.scalar).ok()?.try_into().ok()?;
    Some((r, s, resp.recovery_id))
}

/// `secp256k1:<base58 of 64 uncompressed bytes>`.
pub fn parse_derived_key(key: &str) -> Option<[u8; 64]> {
    let encoded = key.strip_prefix("secp256k1:")?;
    bs58::decode(encoded).into_vec().ok()?.try_into().ok()
}
