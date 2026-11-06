//! Proving a lot's source at mint. The minter hands in Sablier's `CreateLockupLinearStream` log; the
//! contract decodes it with Sablier's own event definition, checks what a buyer relies on (emitter,
//! recipient, non-cancelable, non-transferable, token), and asks MPC to attest that exact log mined
//! at the contract's finality. The request and its expected payload hash come from `near-mpc-sdk`.

use alloy_primitives::{B256, U256};
use alloy_sol_types::{SolEvent, sol};
use near_mpc_contract_interface::types::{
    DomainId, EvmLog, EvmTxId, VerifyForeignTransactionRequestArgs,
};
use near_mpc_sdk::foreign_chain::ForeignChainRequestBuilder;
use near_sdk::json_types::U128;
use near_sdk::near;
use near_sdk::serde_json;

use crate::evm::Address;
use crate::mpc;
use crate::types::Finality;

pub const SOURCE_KIND: &str = "sablier-lockup-v4";

/// Bounds what a caller can make the contract store and hash before MPC has attested anything.
pub const MAX_LOG_DATA_BYTES: usize = 1024;

sol! {
    /// From Sablier Lockup v4 (`ISablierLockupLinear`, `Lockup.CreateEventCommon`).
    struct Timestamps { uint40 start; uint40 end; }
    struct CreateEventCommon {
        address funder;
        address sender;
        address recipient;
        uint128 depositAmount;
        address token;
        bool cancelable;
        bool transferable;
        Timestamps timestamps;
        string shape;
    }
    struct UnlockAmounts { uint128 start; uint128 cliff; }
    event CreateLockupLinearStream(
        uint256 indexed streamId,
        CreateEventCommon commonParams,
        uint40 cliffTime,
        uint40 granularity,
        UnlockAmounts unlockAmounts
    );
}

/// The log as `mint_proven` takes it: MPC's `EvmLog` shape, with an ABI schema of our own (MPC's
/// `abi` feature only builds inside MPC's workspace). Converted into `EvmLog`, whose hex types
/// reject malformed hashes and addresses.
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

impl CreationLog {
    pub fn to_evm_log(&self) -> Result<EvmLog, &'static str> {
        serde_json::to_value(self)
            .ok()
            .and_then(|v| serde_json::from_value(v).ok())
            .ok_or("log hashes, address or topics are malformed")
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Stream {
    pub id: u128,
    pub recipient: Address,
    pub token: Address,
    pub schedule: Schedule,
}

/// A linear stream's vesting terms, from its attested creation log. Times are Unix seconds; a
/// `cliff` of 0 means none. Sablier never stores a granularity of 0.
#[near(serializers = [json, borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Schedule {
    pub deposit: U128,
    pub start: u64,
    pub cliff: u64,
    pub end: u64,
    pub granularity: u64,
    pub start_unlock: U128,
    pub cliff_unlock: U128,
}

impl Schedule {
    /// Sablier Lockup v4 `LockupMath.calculateStreamedAmountLL` at time `t`. Its fallback for a
    /// streamed amount above the deposit is unreachable for a stream Sablier accepted, so it is left out.
    pub fn vested(&self, t: u64) -> u128 {
        if self.start > t {
            return 0;
        }
        if self.cliff > t {
            return self.start_unlock.0;
        }
        if self.end <= t {
            return self.deposit.0;
        }
        let unlocks = self.start_unlock.0 + self.cliff_unlock.0;
        if unlocks >= self.deposit.0 {
            return self.deposit.0;
        }
        let from = if self.cliff == 0 {
            self.start
        } else {
            self.cliff
        };
        let units = U256::from((t - from) / self.granularity);
        let streamed = units * U256::from(self.deposit.0 - unlocks) * U256::from(self.granularity)
            / U256::from(self.end - from);
        unlocks + streamed.to::<u128>()
    }
}

fn log_data(log: &EvmLog) -> Result<Vec<u8>, &'static str> {
    let hex = log
        .data
        .strip_prefix("0x")
        .ok_or("log data must start with 0x")?;
    if hex.len() / 2 > MAX_LOG_DATA_BYTES {
        return Err("log data must be hex of at most 1024 bytes");
    }
    hex::decode(hex).map_err(|_| "log data must be hex of at most 1024 bytes")
}

/// Checks the log is a Sablier linear-stream creation from `lockup` that can't be cancelled or
/// moved, and returns what the lot binds to. The recipient is checked later against the derived address.
pub fn decode(log: &EvmLog, lockup: &Address) -> Result<Stream, &'static str> {
    let data = log_data(log)?;
    if log.removed {
        return Err("log was removed by a reorg");
    }
    if Address::from(log.address.0) != *lockup {
        return Err("log is not from the configured Sablier Lockup");
    }
    let topics = log.topics.iter().map(|t| B256::from(t.0));
    let event = CreateLockupLinearStream::decode_raw_log(topics, &data)
        .map_err(|_| "log is not CreateLockupLinearStream")?;
    let common = event.commonParams;
    if common.cancelable {
        return Err("stream is cancelable");
    }
    if common.transferable {
        return Err("stream is transferable");
    }
    Ok(Stream {
        id: event
            .streamId
            .try_into()
            .map_err(|_| "stream id exceeds u128")?,
        recipient: common.recipient,
        token: common.token,
        schedule: Schedule {
            deposit: U128(common.depositAmount),
            start: common.timestamps.start.to(),
            cliff: event.cliffTime.to(),
            end: common.timestamps.end.to(),
            granularity: event.granularity.to(),
            start_unlock: U128(event.unlockAmounts.start),
            cliff_unlock: U128(event.unlockAmounts.cliff),
        },
    })
}

/// A Base request for this tx that MPC answers only if it extracts exactly `log` at `log.log_index`.
pub fn verify_request(
    log: &EvmLog,
    f: Finality,
) -> Result<VerifyForeignTransactionRequestArgs, &'static str> {
    let (_, args) = ForeignChainRequestBuilder::new_base()
        .with_tx_id(EvmTxId::from(log.transaction_hash.0))
        .with_finality(mpc::evm_finality(f))
        .with_expected_log(log.log_index, log.clone())
        .with_domain_id(DomainId(mpc::FOREIGN_TX_DOMAIN))
        .build()
        .map_err(|_| "could not build the MPC request")?;
    Ok(args)
}
