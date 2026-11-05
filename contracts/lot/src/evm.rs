use alloy_primitives::U256;
use alloy_sol_types::{sol, SolCall};
use near_sdk::env;
use omni_transaction::evm::types::Signature;
use omni_transaction::evm::EVMTransaction;

use crate::types::{Fees, Issued, Kind};

pub const CHAIN_ID: u64 = 84532;
pub const BURN_GAS_LIMIT: u64 = 21_000;
pub const MAX_TRANSFER_GAS_LIMIT: u64 = 500_000;
pub const TRANSFER_FEE_CAP: u128 = 5_000_000_000;
pub const TRANSFER_PRIO_CAP: u128 = 1_000_000_000;
pub const BURN_FEE_CAP: u128 = 2 * TRANSFER_FEE_CAP;
pub const BURN_PRIO_CAP: u128 = 2 * TRANSFER_PRIO_CAP;
/// With a nonzero floor, the 10% bump makes every replacement strictly pricier, so the number of
/// txs at one nonce is bounded by the caps; the explicit limit bounds contract-paid storage.
pub const MIN_FEE: u128 = 1_000_000;
pub const MAX_ISSUED_PER_NONCE: usize = 16;

const SECP256K1_HALF_N: [u8; 32] = [
    0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0x5d, 0x57, 0x6e, 0x73, 0x57, 0xa4, 0x50, 0x1d, 0xdf, 0xe9, 0x2f, 0x46, 0x68, 0x1b, 0x20, 0xa0,
];

pub type Address = [u8; 20];

pub fn parse_address(s: &str) -> Option<Address> {
    let s = s.strip_prefix("0x")?;
    hex::decode(s).ok()?.try_into().ok()
}

pub fn format_address(a: &Address) -> String {
    format!("0x{}", hex::encode(a))
}

pub fn address_from_uncompressed(pk: &[u8; 64]) -> Address {
    env::keccak256_array(pk)[12..].try_into().unwrap()
}

sol! {
    function transfer(address to, uint256 amount) returns (bool);
}

pub fn transfer_calldata(to: &Address, amount: u128) -> Vec<u8> {
    transferCall { to: (*to).into(), amount: U256::from(amount) }.abi_encode()
}

/// The exact EIP-1559 tx an issued entry stands for. `lot` is the burn's self-transfer target.
pub fn build(issued: &Issued, lot: &Address, token: &Address) -> EVMTransaction {
    let (to, input) = match &issued.kind {
        Kind::Transfer { to, amount } => (*token, transfer_calldata(&parse_address(to).unwrap(), amount.0)),
        Kind::Burn => (*lot, vec![]),
    };
    EVMTransaction {
        chain_id: CHAIN_ID,
        nonce: issued.nonce,
        to: Some(to),
        value: 0,
        input,
        gas_limit: issued.gas_limit as u128,
        max_fee_per_gas: issued.fees.max_fee.0,
        max_priority_fee_per_gas: issued.fees.max_prio.0,
        access_list: vec![],
    }
}

pub fn signing_hash(tx: &EVMTransaction) -> [u8; 32] {
    env::keccak256_array(tx.build_for_signing())
}

/// A replacement at `nonce` must raise both fees by at least 10% over everything already issued
/// there: nodes reject a replacement that raises only one, and the old tx stays live.
pub fn check_fees(prior: &[Issued], nonce: u64, fees: &Fees, kind: &Kind) -> Result<(), &'static str> {
    let (fee_cap, prio_cap) = match kind {
        Kind::Transfer { .. } => (TRANSFER_FEE_CAP, TRANSFER_PRIO_CAP),
        Kind::Burn => (BURN_FEE_CAP, BURN_PRIO_CAP),
    };
    if fees.max_fee.0 > fee_cap || fees.max_prio.0 > prio_cap {
        return Err("fee above cap");
    }
    if fees.max_prio.0 < MIN_FEE || fees.max_fee.0 < MIN_FEE {
        return Err("fees below the 1 Mwei floor");
    }
    if fees.max_prio.0 > fees.max_fee.0 {
        return Err("priority fee above max fee");
    }
    let at_nonce = prior.iter().filter(|i| i.nonce == nonce);
    if at_nonce.clone().count() >= MAX_ISSUED_PER_NONCE {
        return Err("too many txs issued at this nonce");
    }
    let prev_fee = at_nonce.clone().map(|i| i.fees.max_fee.0).max();
    let prev_prio = at_nonce.map(|i| i.fees.max_prio.0).max();
    if let (Some(pf), Some(pp)) = (prev_fee, prev_prio)
        && (fees.max_fee.0 * 10 < pf * 11 || fees.max_prio.0 * 10 < pp * 11)
    {
        return Err("replacement must raise both fees by >= 10%");
    }
    Ok(())
}

pub struct SignedTx {
    pub hash: String,
    pub raw: String,
}

/// Accepts (r, s, v) only when it recovers to `lot` over `tx`. Without this, anyone could sign
/// the same payload with their own key, mine it from their own address and fake a consumed nonce.
pub fn assemble(tx: &EVMTransaction, r: [u8; 32], s: [u8; 32], v: u8, lot: &Address) -> Option<SignedTx> {
    if v > 1 || s > SECP256K1_HALF_N {
        return None;
    }
    let mut rs = [0u8; 64];
    rs[..32].copy_from_slice(&r);
    rs[32..].copy_from_slice(&s);
    let pk = env::ecrecover(&signing_hash(tx), &rs, v, true)?;
    if &address_from_uncompressed(&pk) != lot {
        return None;
    }
    let strip = |b: &[u8]| b.iter().skip_while(|x| **x == 0).copied().collect::<Vec<u8>>();
    let raw = tx.build_with_signature(&Signature { v: v as u64, r: strip(&r), s: strip(&s) });
    Some(SignedTx {
        hash: format!("0x{}", hex::encode(env::keccak256_array(&raw))),
        raw: format!("0x{}", hex::encode(raw)),
    })
}
