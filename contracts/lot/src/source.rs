//! Proving a lot's source at mint. The issuer hands in Sablier's `CreateLockupLinearStream` log;
//! the contract checks what a buyer relies on (emitter, recipient, non-cancelable, non-transferable,
//! token), then asks MPC to attest that exact log mined at the contract's finality.

use near_mpc_contract_interface::types::{
    EvmExtractedValue, ExtractedValue, ForeignChainRpcRequest, ForeignTxPayloadVersion, ForeignTxSignPayload, EvmLog,
};
use near_sdk::near;
use near_sdk::serde_json::{self, json};

use crate::evm::{self, Address};
use crate::mpc;
use crate::types::Finality;

pub const SOURCE_KIND: &str = "sablier-lockup-v4";

/// keccak256("CreateLockupLinearStream(uint256,(address,address,address,uint128,address,bool,bool,(uint40,uint40),string),uint40,uint40,(uint128,uint128))")
pub const CREATE_LOCKUP_LINEAR: &str = "bc42cec3f2bd75ce97894dacc83ec6c4b682220d349b5a52d5743e7b46eba2d0";

/// A Base event log as MPC extracts it. Hex fields carry no `0x` except `data`.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreationLog {
    pub removed: bool,
    pub log_index: u64,
    pub transaction_index: u64,
    pub transaction_hash: String,
    pub block_hash: String,
    pub block_number: u64,
    pub address: String,
    pub data: String,
    pub topics: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Stream {
    pub id: u128,
    pub recipient: Address,
    pub token: Address,
    pub deposit: u128,
}

fn word(data: &[u8], i: usize) -> Result<&[u8], &'static str> {
    data.get(i * 32..i * 32 + 32).ok_or("log data too short")
}

fn address_word(w: &[u8]) -> Result<Address, &'static str> {
    if w[..12].iter().any(|b| *b != 0) {
        return Err("malformed address word");
    }
    Ok(w[12..].try_into().unwrap())
}

fn u128_word(w: &[u8]) -> Result<u128, &'static str> {
    if w[..16].iter().any(|b| *b != 0) {
        return Err("value exceeds u128");
    }
    Ok(u128::from_be_bytes(w[16..].try_into().unwrap()))
}

fn bool_word(w: &[u8]) -> Result<bool, &'static str> {
    match u128_word(w)? {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err("malformed bool word"),
    }
}

/// Checks the log is a Sablier linear-stream creation from `lockup` that can't be cancelled or
/// moved, and returns what the lot binds to. The recipient is checked later against the derived address.
/// Bounds what a caller can make the contract store and hash before MPC has attested anything.
pub const MAX_LOG_DATA_BYTES: usize = 1024;

fn exact_hex(s: &str, bytes: usize) -> bool {
    let s = s.strip_prefix("0x").unwrap_or(s);
    s.len() == bytes * 2 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Every field MPC will hash must be well formed, so building the request can't fail after state is written.
fn check_shape(log: &CreationLog) -> Result<(), &'static str> {
    if !exact_hex(&log.transaction_hash, 32) || !exact_hex(&log.block_hash, 32) {
        return Err("log hashes must be 32-byte hex");
    }
    if !exact_hex(&log.address, 20) {
        return Err("log address must be 20-byte hex");
    }
    if !log.topics.iter().all(|t| exact_hex(t, 32)) {
        return Err("log topics must be 32-byte hex");
    }
    let data = log.data.strip_prefix("0x").ok_or("log data must start with 0x")?;
    if data.len() % 2 != 0 || data.len() / 2 > MAX_LOG_DATA_BYTES || !data.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("log data must be hex of at most 1024 bytes");
    }
    Ok(())
}

pub fn decode(log: &CreationLog, lockup: &Address) -> Result<Stream, &'static str> {
    check_shape(log)?;
    if log.removed {
        return Err("log was removed by a reorg");
    }
    if evm::parse_address(&format!("0x{}", log.address.trim_start_matches("0x"))).as_ref() != Some(lockup) {
        return Err("log is not from the configured Sablier Lockup");
    }
    if log.topics.len() != 2 || log.topics[0].trim_start_matches("0x") != CREATE_LOCKUP_LINEAR {
        return Err("log is not CreateLockupLinearStream");
    }
    let id_bytes = hex::decode(log.topics[1].trim_start_matches("0x")).map_err(|_| "bad stream id")?;
    let id = u128_word(id_bytes.get(..32).ok_or("bad stream id")?)?;
    let data = hex::decode(log.data.trim_start_matches("0x")).map_err(|_| "log data is not hex")?;
    let offset = u128_word(word(&data, 0)?)?;
    if offset % 32 != 0 {
        return Err("misaligned event params");
    }
    let base = (offset / 32) as usize;
    let recipient = address_word(word(&data, base + 2)?)?;
    let deposit = u128_word(word(&data, base + 3)?)?;
    let token = address_word(word(&data, base + 4)?)?;
    if bool_word(word(&data, base + 5)?)? {
        return Err("stream is cancelable");
    }
    if bool_word(word(&data, base + 6)?)? {
        return Err("stream is transferable");
    }
    Ok(Stream { id, recipient, token, deposit })
}

fn rpc_request(log: &CreationLog, finality: Finality) -> serde_json::Value {
    json!({ mpc::FOREIGN_CHAIN: {
        "tx_id": log.transaction_hash.trim_start_matches("0x"),
        "extractors": [{ "Log": { "log_index": log.log_index } }],
        "finality": finality.as_str(),
    }})
}

/// sha256(borsh(payload)) exactly as MPC signs it, so the request can demand this log and no other.
pub fn expected_hash(log: &CreationLog, finality: Finality) -> Result<String, &'static str> {
    let request: ForeignChainRpcRequest = serde_json::from_value(rpc_request(log, finality)).map_err(|_| "unrepresentable MPC request")?;
    let extracted: EvmLog = serde_json::from_value(json!(log)).map_err(|_| "unrepresentable log")?;
    let payload = ForeignTxSignPayload::new(
        ForeignTxPayloadVersion::V1,
        request,
        vec![ExtractedValue::EvmExtractedValue(EvmExtractedValue::Log(extracted))],
    );
    Ok(hex::encode(payload.compute_msg_hash().map_err(|_| "payload hashing failed")?.0))
}

pub fn verify_args(log: &CreationLog, finality: Finality) -> Result<Vec<u8>, &'static str> {
    Ok(serde_json::to_vec(&json!({
        "request": {
            "request": rpc_request(log, finality),
            "domain_id": mpc::FOREIGN_TX_DOMAIN,
            "payload_version": 1,
            "expected_payload_hash": expected_hash(log, finality)?,
        }
    }))
    .unwrap())
}
