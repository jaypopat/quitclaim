//! Fixtures are a real MPC-signed ERC-20 transfer mined on Base Sepolia on Nov 5 (`spikes/11-fixture`:
//! path `fixture-0` on `quitclaim-spike-43135.testnet`, nonce 0, 10 QTT to 0x…a11c,
//! https://sepolia.basescan.org/tx/0xfdebf0c7ec8838b09f3a379688b32c7948564e677dbf5e6a4a67e41258451060),
//! the signer's response for it, and the same payload signed by an unrelated key. `REAL_CREATION_LOG` is
//! Sablier stream 112's creation log, whose payload hash MPC attested in spike 12.

use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

use crate::*;
use alloy_sol_types::SolEvent;
use near_sdk::base64::prelude::Engine;

const REAL_CREATION_LOG: &str = r#"{"removed":false,"log_index":28,"transaction_index":3,"transaction_hash":"3bcd6f5681d33388a3990e3e39fa4c7b4a58d63982750d71e2e2eef5b6455dba","block_hash":"9823e6cc70237f30175ffab02e6f681604d848b8d049c1daa1ce74569f113254","block_number":54789566,"address":"a65a1ecef02c2b9bdc604951c6a6d02335d4532e","data":"0x00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008af686edd999e3ab397cfe47e9e5b5d0dbc89e4d0000000000000000000000008af686edd999e3ab397cfe47e9e5b5d0dbc89e4d0000000000000000000000000650899c81daacc773353a0fcd74c80b38f0fa0700000000000000000000000000000000000000000000003635c9adc5dea00000000000000000000000000000cdf24142f02ea7fcf5db8b1dfbc1dd25bf021f6400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006aec6ee6000000000000000000000000000000000000000000000000000000006aec7cf6000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000066c696e6561720000000000000000000000000000000000000000000000000000","topics":["bc42cec3f2bd75ce97894dacc83ec6c4b682220d349b5a52d5743e7b46eba2d0","0000000000000000000000000000000000000000000000000000000000000070"]}"#;
const LOT_KEY: &str = "secp256k1:cLjnNHX33xCBjXo1Tajm6YNc9ycqAuUCUfEKw7uTKvX6nm2hM4PFmRviYQCqfieiSDHsDzd2vd8zgRt2QuTjN14";
const LOT_ADDR: &str = "0x96b717a62aafebcd4ba7f6646f10f84f680c405a";
const TOKEN: &str = "0xCdF24142F02eA7fcF5dB8B1DFbc1Dd25BF021f64";
const AMOUNT: u128 = 10_000_000_000_000_000_000;
const ALICE_EVM: &str = "0x000000000000000000000000000000000000A11c";
const CLAIM0_MPC: &str = r#"{"scheme":"Secp256k1","big_r":{"affine_point":"027a6c1bc1d0adbf320bf1aecaec0004a1e73d28f61a9c0d4c6bb420ee4a5b80da"},"s":{"scalar":"79debfc0980274b0b80868004bd634d1b286b2a3f331f3bd63f9e30e82768468"},"recovery_id":1}"#;
const CLAIM0_RAW: &str = "0x02f8b283014a3480830f42408402faf080830249f094cdf24142f02ea7fcf5db8b1dfbc1dd25bf021f6480b844a9059cbb000000000000000000000000000000000000000000000000000000000000a11c0000000000000000000000000000000000000000000000008ac7230489e80000c001a07a6c1bc1d0adbf320bf1aecaec0004a1e73d28f61a9c0d4c6bb420ee4a5b80daa079debfc0980274b0b80868004bd634d1b286b2a3f331f3bd63f9e30e82768468";
const FORGED_R: &str = "0x2d3458b6c16a4128deacc73bb11df4e0e709fe80abd5be30a6b826641ba211f9";
const FORGED_S: &str = "0x42ecce777b9c8c879d4de2da64bc709cd2b90f0c229294f523d64f508847a1e0";
const FORGED_V: u8 = 1;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn admin() -> AccountId {
    acc("admin.testnet")
}
fn alice() -> AccountId {
    acc("alice.testnet")
}
fn bob() -> AccountId {
    acc("bob.testnet")
}
fn fees(max_fee: u128, max_prio: u128) -> Fees {
    Fees { max_fee: U128(max_fee), max_prio: U128(max_prio) }
}
fn claim_fees() -> Fees {
    fees(50_000_000, 1_000_000)
}

thread_local! {
    static NOW_MS: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Sets the block time, in milliseconds, for every later call in this test.
fn clock(ms: u64) {
    NOW_MS.set(ms);
}

fn call(who: AccountId, yocto: u128) {
    let ctx = VMContextBuilder::new()
        .current_account_id(acc("lot.testnet"))
        .predecessor_account_id(who)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .prepaid_gas(Gas::from_tgas(300))
        .block_timestamp(NOW_MS.get() * 1_000_000)
        .build();
    testing_env!(ctx);
}
fn mpc_sig() -> Result<Value, PromiseError> {
    Ok(serde_json::from_str(CLAIM0_MPC).unwrap())
}
fn attested() -> Result<Value, PromiseError> {
    Ok(json!({"payload_hash": "00", "signature": {}}))
}
fn as_contract() {
    call(acc("lot.testnet"), 0);
}

const LOCKUP: &str = "0xA65A1ecEf02C2B9BDc604951c6A6D02335D4532e";
const ONE_NEAR: u128 = 10u128.pow(24);
const STORAGE: NearToken = NearToken::from_millinear(5);

fn new_contract(finality: Finality) -> Contract {
    call(admin(), 0);
    Contract::new(acc("v1.signer-prod.testnet"), LOCKUP.into(), finality)
}

/// The fixture stream vests `AMOUNT * 100` linearly over these seconds: 1e18 per second.
const STREAM_START: u64 = 1_000;
const STREAM_END: u64 = 2_000;

/// A Sablier `CreateLockupLinearStream` log with the fields a mint checks.
fn creation_log(recipient: &str, cancelable: bool, transferable: bool) -> CreationLog {
    let word = |hex40: &str| format!("{:0>64}", hex40.trim_start_matches("0x"));
    let num = |n: u128| format!("{n:064x}");
    let data = [
        num(0xa0), num(0), num(1), num(0), num(0),
        word("0x8af686edd999e3ab397cfe47e9e5b5d0dbc89e4d"),
        word("0x8af686edd999e3ab397cfe47e9e5b5d0dbc89e4d"),
        word(recipient),
        num(AMOUNT * 100),
        word(TOKEN),
        num(cancelable as u128),
        num(transferable as u128),
        num(STREAM_START as u128), num(STREAM_END as u128), num(0x140), num(6),
        format!("{:0<64}", hex::encode("linear")),
    ]
    .concat();
    CreationLog {
        removed: false,
        log_index: 28,
        transaction_index: 3,
        transaction_hash: "11".repeat(32),
        block_hash: "22".repeat(32),
        block_number: 1,
        address: LOCKUP.trim_start_matches("0x").to_lowercase(),
        data: format!("0x{data}"),
        topics: vec![hex::encode(source::CreateLockupLinearStream::SIGNATURE_HASH), num(7)],
    }
}

/// Runs the whole `mint_proven` chain with the given derived key and MPC verdict.
#[allow(clippy::too_many_arguments)]
fn mint(c: &mut Contract, minter: AccountId, name: &str, owner: AccountId, royalty_bps: u16, key: &str, log: CreationLog, verdict: Result<Value, PromiseError>) -> Option<MintedLot> {
    call(minter, ONE_NEAR);
    let _ = c.mint_proven(name.into(), owner, royalty_bps, log.clone());
    let id = c.next_id - 1;
    let recipient = format!("{:#x}", source::decode(&log.to_evm_log().unwrap(), &LOCKUP.parse().unwrap()).unwrap().recipient);
    as_contract();
    if let PromiseOrValue::Value(v) = c.on_derived(id, recipient, log, STORAGE, Ok(key.into())) {
        return v;
    }
    as_contract();
    c.on_mint_verified(id, STORAGE, verdict)
}

fn active_lot() -> Contract {
    let mut c = new_contract(Finality::Safe);
    let minted = mint(&mut c, admin(), "lot-a", alice(), 250, LOT_KEY, creation_log(LOT_ADDR, false, false), attested());
    assert_eq!(minted, Some(MintedLot { id: 0, address: LOT_ADDR.into() }));
    c
}

fn signed_transfer0() -> Contract {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    as_contract();
    assert_eq!(c.on_signed(0, 0, mpc_sig()).as_deref(), Some(CLAIM0_RAW));
    c
}

fn prove_ok(c: &mut Contract, seq: u32) -> bool {
    call(bob(), 1);
    let _ = c.prove(0, seq);
    let nonce = c.get_lot(0).unwrap().issued.iter().find(|i| i.seq == seq).unwrap().nonce;
    as_contract();
    c.on_proved(0, nonce, attested())
}

#[test]
fn mint_learns_the_address_from_mpc() {
    let c = active_lot();
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.state, LotState::Active);
    assert_eq!(lot.address.as_deref(), Some(LOT_ADDR));
    assert_eq!(c.nft_token("0".into()).unwrap().owner_id, alice());
}

#[test]
fn failed_derivation_rolls_the_mint_back() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), ONE_NEAR);
    let log = creation_log(LOT_ADDR, false, false);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log.clone());
    as_contract();
    assert!(matches!(c.on_derived(0, LOT_ADDR.into(), log, STORAGE, Err(PromiseError::Failed)), PromiseOrValue::Value(None)));
    assert!(c.get_lot(0).is_none());
    assert!(mint(&mut c, admin(), "lot-a", alice(), 250, LOT_KEY, creation_log(LOT_ADDR, false, false), attested()).is_some(), "the path is free again");
}

#[test]
fn a_failed_mpc_verification_rolls_the_mint_back() {
    let mut c = new_contract(Finality::Safe);
    assert_eq!(mint(&mut c, admin(), "lot-a", alice(), 250, LOT_KEY, creation_log(LOT_ADDR, false, false), Err(PromiseError::Failed)), None);
    assert!(c.get_lot(0).is_none());
    assert!(mint(&mut c, admin(), "lot-a", alice(), 250, LOT_KEY, creation_log(LOT_ADDR, false, false), attested()).is_some());
}

#[test]
fn a_stream_paying_another_address_is_refused() {
    let mut c = new_contract(Finality::Safe);
    let other = "0x0650899c81daacc773353a0fcd74c80b38f0fa07";
    assert_eq!(mint(&mut c, admin(), "lot-a", alice(), 250, LOT_KEY, creation_log(other, false, false), attested()), None);
    assert!(c.get_lot(0).is_none());
}

#[test]
#[should_panic(expected = "stream is cancelable")]
fn a_cancelable_stream_is_refused() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, creation_log(LOT_ADDR, true, false));
}

#[test]
#[should_panic(expected = "stream is transferable")]
fn a_transferable_stream_is_refused() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, creation_log(LOT_ADDR, false, true));
}

#[test]
#[should_panic(expected = "log is not from the configured Sablier Lockup")]
fn a_log_from_another_contract_is_refused() {
    let mut c = new_contract(Finality::Safe);
    let mut log = creation_log(LOT_ADDR, false, false);
    log.address = "e4e4ecc586a79aaeab423b2c6da8f7510de811c5".into();
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log);
}

#[test]
#[should_panic(expected = "log is not CreateLockupLinearStream")]
fn another_event_is_refused() {
    let mut c = new_contract(Finality::Safe);
    let mut log = creation_log(LOT_ADDR, false, false);
    log.topics[0] = "ff".repeat(32);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log);
}

#[test]
#[should_panic(expected = "path already used")]
fn paths_are_unique() {
    let mut c = active_lot();
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), bob(), 250, creation_log(LOT_ADDR, false, false));
}

#[test]
fn paths_are_namespaced_by_minter() {
    let mut c = active_lot();
    call(bob(), ONE_NEAR);
    let _ = c.mint_proven("lot-a".into(), bob(), 250, creation_log(LOT_ADDR, false, false));
    let (a, b) = (c.get_lot(0).unwrap(), c.get_lot(1).unwrap());
    assert_eq!((a.path.as_str(), b.path.as_str()), ("admin.testnet/lot-a", "bob.testnet/lot-a"));
    assert_eq!((a.minter, b.minter), (admin(), bob()));
}

#[test]
fn hashes_the_creation_log_exactly_as_mpc_attested() {
    let log: CreationLog = serde_json::from_str(REAL_CREATION_LOG).unwrap();
    let evm_log = log.to_evm_log().unwrap();
    let request = source::verify_request(&evm_log, Finality::Latest).unwrap();
    assert_eq!(hex::encode(request.expected_payload_hash.unwrap().0), "512781a3776f692f4b6123a4d48b7bb2207128df9e50c249ec6d88abe5db092f");
    let stream = source::decode(&evm_log, &LOCKUP.parse().unwrap()).unwrap();
    assert_eq!((stream.id, format!("{:#x}", stream.recipient)), (112, "0x0650899c81daacc773353a0fcd74c80b38f0fa07".into()));
    assert_eq!(stream.schedule.deposit.0, 1_000 * 10u128.pow(18));
}

#[test]
fn reproduces_the_exact_tx_base_accepted() {
    let c = signed_transfer0();
    let issued = &c.get_lot(0).unwrap().issued[0];
    assert_eq!(issued.raw_tx.as_deref(), Some(CLAIM0_RAW));
    assert_eq!(issued.tx_hash.as_deref(), Some("0xfdebf0c7ec8838b09f3a379688b32c7948564e677dbf5e6a4a67e41258451060"));
}

#[test]
fn issued_is_recorded_before_the_signature_arrives() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.issued.len(), 1);
    assert!(lot.sign_in_flight);
    as_contract();
    assert_eq!(c.on_signed(0, 0, Err(PromiseError::Failed)), None);
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.issued.len(), 1, "a failed callback never un-issues a tx");
    assert!(!lot.sign_in_flight);
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn non_owner_cannot_request() {
    let mut c = active_lot();
    call(bob(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "attach 1 yoctoNEAR")]
fn request_needs_the_mpc_deposit() {
    let mut c = active_lot();
    call(alice(), 0);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "a sign request is already in flight")]
fn one_sign_request_at_a_time() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, fees(60_000_000, 2_000_000));
}

#[test]
#[should_panic(expected = "replacement must raise both fees by >= 10%")]
fn replacement_must_raise_the_priority_fee_too() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, fees(100_000_000, 1_000_000));
}

#[test]
#[should_panic(expected = "fee above cap")]
fn fees_are_capped() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, fees(evm::TRANSFER_FEE_CAP + 1, 1));
}

#[test]
#[should_panic(expected = "signature does not recover to the lot address")]
fn forged_signature_over_the_same_payload_is_rejected() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    as_contract();
    let _ = c.on_signed(0, 0, Err(PromiseError::Failed));
    call(bob(), 0);
    c.register_signature(0, 0, FORGED_R.into(), FORGED_S.into(), FORGED_V);
}

#[test]
fn public_mpc_signature_can_be_registered_after_a_lost_callback() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    as_contract();
    let _ = c.on_signed(0, 0, Err(PromiseError::Failed));
    call(bob(), 0);
    let raw = c.register_signature(
        0,
        0,
        "0x7a6c1bc1d0adbf320bf1aecaec0004a1e73d28f61a9c0d4c6bb420ee4a5b80da".into(),
        "0x79debfc0980274b0b80868004bd634d1b286b2a3f331f3bd63f9e30e82768468".into(),
        1,
    );
    assert_eq!(raw, CLAIM0_RAW);
}

#[test]
fn proving_a_claim_advances_the_nonce_and_stays_active() {
    let mut c = signed_transfer0();
    assert!(prove_ok(&mut c, 0));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.next_nonce, lot.issued.len()), (LotState::Active, 1, 0));
}

#[test]
fn failed_proof_changes_nothing() {
    let mut c = signed_transfer0();
    call(bob(), 1);
    let _ = c.prove(0, 0);
    as_contract();
    assert!(!c.on_proved(0, 0, Err(PromiseError::Failed)));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.next_nonce, lot.issued.len()), (0, 1));
}

#[test]
#[should_panic(expected = "issued tx has no recorded signature")]
fn cannot_prove_without_a_recorded_signature() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    call(bob(), 1);
    let _ = c.prove(0, 0);
}

#[test]
fn late_signature_for_a_cleared_entry_is_a_no_op() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, fees(55_000_000, 1_100_000));
    call(bob(), 1);
    let _ = c.prove(0, 0);
    as_contract();
    assert!(c.on_proved(0, 0, attested()));
    as_contract();
    assert_eq!(c.on_signed(0, 1, mpc_sig()), None);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.next_nonce, lot.issued.len(), lot.sign_in_flight), (1, 0, false));
}

#[test]
fn stale_proof_is_a_no_op() {
    let mut c = signed_transfer0();
    assert!(prove_ok(&mut c, 0));
    as_contract();
    assert!(!c.on_proved(0, 0, attested()));
    assert_eq!(c.get_lot(0).unwrap().next_nonce, 1);
}

#[test]
fn seal_with_nothing_outstanding_is_clean_at_once() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.version), (LotState::Clean, 1));
}

#[test]
fn full_handover_alice_to_bob() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    assert_eq!(c.get_lot(0).unwrap().state, LotState::Sealing);
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(bob(), 0);
    assert!(prove_ok(&mut c, 0), "the retained claim mined first; that consumes the nonce too");
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.version, lot.next_nonce), (LotState::Clean, 1, 1));

    call(alice(), 1);
    c.nft_transfer(bob(), "0".into(), None, None);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.owner, lot.state, lot.version), (bob(), LotState::Active, 2));
}

#[test]
#[should_panic(expected = "lot is not Clean")]
fn transfer_with_a_pending_request_is_refused() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    c.nft_transfer(bob(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "lot is not Active")]
fn no_claims_while_sealing() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, fees(70_000_000, 2_000_000));
}

#[test]
#[should_panic(expected = "lot is not Active")]
fn no_claims_while_clean() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn old_owner_is_locked_out_after_transfer() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    c.nft_transfer(bob(), "0".into(), None, None);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
}

#[test]
fn anyone_can_rebump_a_sealing_burn() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(bob(), 1);
    let _ = c.rebump(0, 0, fees(61_000_000, 1_210_000));
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.issued.len(), 3);
    assert!(lot.issued.iter().all(|i| i.nonce == 0));
}

#[test]
fn rescue_burn_at_next_nonce_proves_the_stuck_one() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(bob(), 1);
    let _ = c.rescue(0, fees(55_000_000, 1_100_000));
    let rescue_seq = 2;
    let mut lot = c.get_lot(0).unwrap();
    lot.issued[2].tx_hash = Some(format!("0x{}", "01".repeat(32)));
    c.lots.insert(0, lot);
    call(bob(), 1);
    let _ = c.prove(0, rescue_seq);
    as_contract();
    assert!(c.on_proved(0, 1, attested()));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.next_nonce, lot.issued.len()), (LotState::Clean, 2, 0));
}

#[test]
#[should_panic(expected = "a rescue burn is outstanding")]
fn unseal_refused_while_a_rescue_burn_is_outstanding() {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(bob(), 1);
    let _ = c.rescue(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 2, Err(PromiseError::Failed));
    call(alice(), 0);
    c.unseal(0);
}

#[test]
#[should_panic(expected = "nft_transfer_call is not supported")]
fn transfer_call_is_refused() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.nft_transfer_call(bob(), "0".into(), None, None, String::new());
}

fn sealing_with_burn() -> Contract {
    let mut c = signed_transfer0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    c
}

#[test]
#[should_panic(expected = "fees below the 1 Mwei floor")]
fn zero_fees_are_rejected() {
    let mut c = sealing_with_burn();
    call(bob(), 1);
    let _ = c.rebump(0, 0, fees(0, 0));
}

fn bump(f: Fees) -> Fees {
    fees(f.max_fee.0 * 11 / 10 + 1, f.max_prio.0 * 11 / 10 + 1)
}

/// MPC fails to sign the request just issued, so it stays issued with no signature.
fn sign_fails(c: &mut Contract) {
    let seq = c.get_lot(0).unwrap().next_seq - 1;
    as_contract();
    assert_eq!(c.on_signed(0, seq, Err(PromiseError::Failed)), None);
}

/// Alice uses up the transfers at nonce 0, none of them signed. Returns the next valid fees.
fn failed_transfers() -> (Contract, Fees) {
    let mut c = active_lot();
    let mut f = fees(evm::MIN_FEE, evm::MIN_FEE);
    for _ in 0..evm::MAX_ISSUED_PER_NONCE {
        call(alice(), 1);
        let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, f);
        sign_fails(&mut c);
        f = bump(f);
    }
    (c, f)
}

/// After the failed transfers, Alice seals and anyone rebumps the burn until nonce 0 holds every burn it may.
fn burns_used_up() -> (Contract, Fees) {
    let (mut c, mut f) = failed_transfers();
    call(alice(), 1);
    let _ = c.seal(0, f);
    sign_fails(&mut c);
    for _ in 1..evm::MAX_ISSUED_PER_NONCE {
        f = bump(f);
        call(bob(), 1);
        let _ = c.rebump(0, 0, f);
        sign_fails(&mut c);
    }
    (c, bump(f))
}

#[test]
fn failed_transfers_never_use_up_the_seal_or_the_rescue() {
    let (mut c, _) = burns_used_up();
    call(bob(), 1);
    let _ = c.rescue(0, fees(evm::MIN_FEE, evm::MIN_FEE));
    let lot = c.get_lot(0).unwrap();
    let count = |nonce: u64, burn: bool| lot.issued.iter().filter(|i| i.nonce == nonce && (i.kind == Kind::Burn) == burn).count();
    let max = evm::MAX_ISSUED_PER_NONCE;
    assert_eq!(lot.state, LotState::Sealing);
    assert_eq!((count(0, false), count(0, true), count(1, true)), (max, max, 1), "every issued entry is kept until proof");
}

#[test]
#[should_panic(expected = "too many transfers issued at this nonce")]
fn transfers_per_nonce_are_bounded() {
    let (mut c, f) = failed_transfers();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, f);
}

#[test]
#[should_panic(expected = "too many burns issued at this nonce")]
fn burns_per_nonce_are_bounded() {
    let (mut c, f) = burns_used_up();
    call(bob(), 1);
    let _ = c.rebump(0, 0, f);
}

#[test]
fn burn_at_the_stuck_nonce_stays_repriceable_after_a_rescue() {
    let mut c = sealing_with_burn();
    call(bob(), 1);
    let _ = c.rescue(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 2, Err(PromiseError::Failed));
    call(bob(), 1);
    let _ = c.rebump(0, 0, fees(61_000_000, 1_210_000));
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.issued.iter().filter(|i| i.nonce == 0 && i.kind == Kind::Burn).count(), 2);
}

#[test]
#[should_panic(expected = "no burn outstanding at that nonce")]
fn rebump_needs_a_burn_at_that_nonce() {
    let mut c = sealing_with_burn();
    call(bob(), 1);
    let _ = c.rebump(0, 1, fees(61_000_000, 1_210_000));
}

#[test]
fn a_proof_in_flight_does_not_block_another() {
    let mut c = signed_transfer0();
    call(bob(), 1);
    let _ = c.prove(0, 0);
    let _ = c.prove(0, 0);
    as_contract();
    assert!(!c.on_proved(0, 0, Err(PromiseError::Failed)), "the griefer's proof times out");
    as_contract();
    assert!(c.on_proved(0, 0, attested()), "the honest proof still lands");
    as_contract();
    assert!(!c.on_proved(0, 0, attested()), "a duplicate success is stale");
}

const PRICE: u128 = 1_000_000;

fn clean_lot() -> Contract {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    assert_eq!(c.get_lot(0).unwrap().state, LotState::Clean);
    c
}

fn listed_lot() -> Contract {
    let mut c = clean_lot();
    call(alice(), 0);
    c.list(0, U128(PRICE));
    c
}

#[test]
#[should_panic(expected = "lot is not Clean")]
fn only_a_clean_lot_can_be_listed() {
    let mut c = active_lot();
    call(alice(), 0);
    c.list(0, U128(PRICE));
}

#[test]
fn buy_moves_the_title_and_credits_seller_and_minter() {
    let mut c = listed_lot();
    call(bob(), PRICE);
    c.buy(0, 1);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.owner, lot.state, lot.version, lot.listing), (bob(), LotState::Active, 2, None));
    assert_eq!(c.proceeds_of(alice()).0, 975_000, "seller gets the price minus 2.5%");
    assert_eq!(c.proceeds_of(admin()).0, 25_000, "minter gets 2.5%");
}

#[test]
#[should_panic(expected = "attach exactly the listing price")]
fn buy_needs_the_exact_price() {
    let mut c = listed_lot();
    call(bob(), PRICE - 1);
    c.buy(0, 1);
}

#[test]
#[should_panic(expected = "listing is stale")]
fn buy_is_bound_to_the_version_the_buyer_saw() {
    let mut c = listed_lot();
    call(bob(), PRICE);
    c.buy(0, 0);
}

#[test]
#[should_panic(expected = "lot is not listed")]
fn unseal_cancels_the_listing() {
    let mut c = listed_lot();
    call(alice(), 0);
    c.unseal(0);
    call(bob(), PRICE);
    c.buy(0, 2);
}

#[test]
#[should_panic(expected = "the seller can't buy their own listing")]
fn owner_cannot_buy() {
    let mut c = listed_lot();
    call(alice(), PRICE);
    c.buy(0, 1);
}

#[test]
#[should_panic(expected = "lot is not listed")]
fn a_sold_lot_cannot_be_bought_again() {
    let mut c = listed_lot();
    call(bob(), PRICE);
    c.buy(0, 1);
    call(acc("carol.testnet"), PRICE);
    c.buy(0, 2);
}

#[test]
#[should_panic(expected = "royalty above the 10% cap")]
fn royalty_is_capped_at_mint() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), sale::MAX_ROYALTY_BPS + 1, creation_log(LOT_ADDR, false, false));
}

#[test]
fn rounding_favours_the_seller() {
    assert_eq!(sale::split(39, 250), (39, 0));
    assert_eq!(sale::split(400, 250), (390, 10));
}

#[test]
fn nft_payout_matches_what_buy_credits() {
    let mut c = listed_lot();
    call(alice(), 0);
    let payout = c.nft_payout("0".into(), U128(PRICE), Some(2)).payout;
    call(bob(), PRICE);
    c.buy(0, 1);
    assert_eq!(payout.get(&alice()).map(|v| v.0), Some(c.proceeds_of(alice()).0));
    assert_eq!(payout.get(&admin()).map(|v| v.0), Some(c.proceeds_of(admin()).0));
}

#[test]
fn minter_selling_their_own_lot_gets_the_sum() {
    let mut c = new_contract(Finality::Safe);
    assert!(mint(&mut c, alice(), "lot-a", alice(), 250, LOT_KEY, creation_log(LOT_ADDR, false, false), attested()).is_some());
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    c.list(0, U128(PRICE));
    let payout = c.nft_payout("0".into(), U128(PRICE), None).payout;
    assert_eq!((payout.len(), payout.get(&alice()).map(|v| v.0)), (1, Some(PRICE)));
    call(bob(), PRICE);
    c.buy(0, 1);
    assert_eq!(c.proceeds_of(alice()).0, PRICE);
}

#[test]
fn withdraw_zeroes_first_and_restores_once_on_failure() {
    let mut c = listed_lot();
    call(bob(), PRICE);
    c.buy(0, 1);
    call(alice(), 0);
    let _ = c.withdraw_proceeds();
    assert_eq!(c.proceeds_of(alice()).0, 0, "zeroed before the transfer");
    as_contract();
    assert!(!c.on_withdraw(alice(), U128(975_000), Err(PromiseError::Failed)));
    assert_eq!(c.proceeds_of(alice()).0, 975_000, "restored after a failed transfer");
    call(alice(), 0);
    let _ = c.withdraw_proceeds();
    as_contract();
    assert!(c.on_withdraw(alice(), U128(975_000), Ok(())));
    assert_eq!(c.proceeds_of(alice()).0, 0);
}

#[test]
#[should_panic(expected = "no proceeds")]
fn withdraw_with_nothing_owed_fails() {
    let mut c = active_lot();
    call(bob(), 0);
    let _ = c.withdraw_proceeds();
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn zero_amount_transfers_are_rejected() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(0), 150_000, claim_fees());
}

#[test]
fn mint_binds_the_token_and_stream_from_the_proven_log() {
    let c = active_lot();
    let lot = c.get_lot(0).unwrap();
    let schedule = Schedule {
        deposit: U128(AMOUNT * 100),
        start: STREAM_START,
        cliff: 0,
        end: STREAM_END,
        granularity: 1,
        start_unlock: U128(0),
        cliff_unlock: U128(0),
    };
    let source = Source { kind: "sablier-lockup-v4".into(), contract: LOCKUP.to_lowercase(), id: U128(7), schedule };
    assert_eq!((lot.token, lot.source, lot.minter), (TOKEN.to_lowercase(), source, admin()));
}

#[test]
#[should_panic(expected = "log hashes, address or topics are malformed")]
fn a_malformed_log_is_refused_before_any_state_is_written() {
    let mut c = new_contract(Finality::Safe);
    let mut log = creation_log(LOT_ADDR, false, false);
    log.transaction_hash = "zz".into();
    call(admin(), ONE_NEAR);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log);
}

#[test]
#[should_panic(expected = "log data must be hex of at most 1024 bytes")]
fn oversized_log_data_is_refused() {
    let mut c = new_contract(Finality::Safe);
    let mut log = creation_log(LOT_ADDR, false, false);
    log.data = format!("0x{}", "00".repeat(source::MAX_LOG_DATA_BYTES + 1));
    call(admin(), ONE_NEAR);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log);
}

#[test]
#[should_panic(expected = "storage plus the MPC deposit")]
fn the_minter_pays_for_storage() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, creation_log(LOT_ADDR, false, false));
}

/// Runs the real mint chain in one context, so storage usage accumulates across the callbacks.
#[test]
fn the_minter_pays_for_the_lots_persisted_storage() {
    let mut c = new_contract(Finality::Safe);
    call(acc("lot.testnet"), ONE_NEAR);
    let before = env::storage_usage();
    let _ = c.mint_proven("lot-a".into(), alice(), 250, creation_log(LOT_ADDR, false, false));
    let actions: Vec<MockAction> = near_sdk::test_utils::get_created_receipts().into_iter().flat_map(|r| r.actions).collect();
    let refund = actions.iter().find_map(|a| match a { MockAction::Transfer { deposit, .. } => Some(*deposit), _ => None }).unwrap();
    let args: Value = actions.iter().find_map(|a| match a {
        MockAction::FunctionCallWeight { method_name, args, .. } if method_name == b"on_derived" => serde_json::from_slice(args).ok(),
        _ => None,
    }).unwrap();
    let storage: NearToken = serde_json::from_value(args["storage"].clone()).unwrap();
    assert_eq!(refund.saturating_add(storage).saturating_add(mpc::REQUEST_DEPOSIT).as_yoctonear(), ONE_NEAR, "the minter keeps paying only storage and the MPC deposit");

    let log: CreationLog = serde_json::from_value(args["log"].clone()).unwrap();
    let _ = c.on_derived(0, args["recipient"].as_str().unwrap().into(), log, storage, Ok(LOT_KEY.into()));
    assert!(c.on_mint_verified(0, storage, attested()).is_some());
    c.lots.flush();
    assert_eq!(storage, env::storage_byte_cost().saturating_mul((env::storage_usage() - before) as u128));
}

#[test]
#[should_panic(expected = "name must be 1-64 chars")]
fn names_are_bounded() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), ONE_NEAR);
    let _ = c.mint_proven("x".repeat(65), alice(), 250, creation_log(LOT_ADDR, false, false));
}

#[test]
fn a_lot_awaiting_mpc_is_not_an_nft_yet() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), ONE_NEAR);
    let log = creation_log(LOT_ADDR, false, false);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, log.clone());
    as_contract();
    let _ = c.on_derived(0, LOT_ADDR.into(), log, STORAGE, Ok(LOT_KEY.into()));
    assert_eq!(c.get_lot(0).unwrap().state, LotState::Minting);
    assert!(c.nft_token("0".into()).is_none());
    assert_eq!((c.nft_total_supply().0, c.nft_tokens(None, None).len()), (0, 0));
}

#[test]
fn tokens_carry_an_on_chain_title_card() {
    let c = active_lot();
    let meta = c.nft_token("0".into()).unwrap().metadata.unwrap();
    let media = meta.media.unwrap();
    let svg = near_sdk::base64::prelude::BASE64_STANDARD.decode(media.trim_start_matches("data:image/svg+xml;base64,")).unwrap();
    let svg = String::from_utf8(svg).unwrap();
    assert!(svg.contains("Quitclaim lot #0") && svg.contains(LOT_ADDR) && svg.contains("Sablier stream 7"));
}

fn carol() -> AccountId {
    acc("carol.testnet")
}

const TOKEN_UNIT: u128 = 10u128.pow(18);
/// Bob takes the lease 100 s into the stream; it runs 600 s.
const TAKEN: u64 = 1_100_000;
const ENDS: u64 = 1_700_000;

fn offered() -> Contract {
    let mut c = clean_lot();
    call(alice(), 0);
    c.offer_lease(0, U128(PRICE), ENDS);
    c
}

fn leased() -> Contract {
    let mut c = offered();
    clock(TAKEN);
    call(bob(), PRICE);
    c.take_lease(0, 1);
    c
}

/// Bob requests a transfer at the next nonce; signing fails, so it stays issued and unsigned.
fn lessee_requests(c: &mut Contract, amount: u128, fees: Fees) {
    call(bob(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(amount), 150_000, fees);
    let seq = c.get_lot(0).unwrap().next_seq - 1;
    as_contract();
    let _ = c.on_signed(0, seq, Err(PromiseError::Failed));
}

/// Bob signs the fixture transfer at nonce 0, seals, and the transfer is proven: Clean, lease still live.
fn lessee_withdrew_and_sealed() -> Contract {
    let mut c = leased();
    clock(TAKEN + 30_000);
    call(bob(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    as_contract();
    assert_eq!(c.on_signed(0, 0, mpc_sig()).as_deref(), Some(CLAIM0_RAW));
    call(bob(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    assert!(prove_ok(&mut c, 0));
    c
}

fn lessee_sealed_clean() -> Contract {
    let mut c = leased();
    call(bob(), 1);
    let _ = c.seal(0, fees(1, 1));
    assert_eq!(c.get_lot(0).unwrap().state, LotState::Clean);
    c
}

fn committed(c: &Contract) -> u128 {
    c.lease_budget(0).committed.0
}

fn token_ids(tokens: Vec<near_contract_standards::non_fungible_token::Token>) -> Vec<String> {
    tokens.into_iter().map(|t| t.token_id).collect()
}

fn burned_lease_token() -> bool {
    near_sdk::test_utils::get_logs().iter().any(|l| l.contains(r#""event":"nft_burn""#) && l.contains(r#""0-lease""#))
}

#[test]
fn taking_a_lease_pays_owner_and_minter_and_hands_over_control() {
    let c = leased();
    let lot = c.get_lot(0).unwrap();
    let lease = lot.lease.clone().unwrap();
    assert_eq!((lot.state, lot.version, lot.lease_offer), (LotState::Active, 2, None));
    assert_eq!((lease.holder, lease.start_ms, lease.ends_at_ms, lease.committed.0), (bob(), TAKEN, ENDS, 0));
    assert_eq!((c.proceeds_of(alice()).0, c.proceeds_of(admin()).0), (975_000, 25_000));
    assert_eq!(c.nft_token("0-lease".into()).unwrap().owner_id, bob());
    assert_eq!(c.nft_token("0".into()).unwrap().owner_id, alice());
}

#[test]
fn the_budget_grows_with_the_stream_and_a_nonce_is_charged_its_largest_transfer() {
    let mut c = leased();
    clock(TAKEN + 30_000);
    call(bob(), 0);
    assert_eq!(c.lease_budget(0).allowed.0, 30 * TOKEN_UNIT);
    lessee_requests(&mut c, 10 * TOKEN_UNIT, claim_fees());
    assert_eq!(committed(&c), 10 * TOKEN_UNIT);
    lessee_requests(&mut c, 25 * TOKEN_UNIT, fees(55_000_000, 1_100_000));
    assert_eq!(committed(&c), 25 * TOKEN_UNIT, "a larger replacement costs only the difference");
    lessee_requests(&mut c, 5 * TOKEN_UNIT, fees(60_500_000, 1_210_000));
    assert_eq!(committed(&c), 25 * TOKEN_UNIT, "a smaller replacement costs nothing");
    clock(TAKEN + 60_000);
    call(bob(), 0);
    assert_eq!(c.lease_budget(0).allowed.0, 60 * TOKEN_UNIT);
}

#[test]
#[should_panic(expected = "over the lease budget")]
fn a_transfer_over_the_budget_is_refused() {
    let mut c = leased();
    clock(TAKEN + 30_000);
    lessee_requests(&mut c, 25 * TOKEN_UNIT, claim_fees());
    lessee_requests(&mut c, 31 * TOKEN_UNIT, fees(55_000_000, 1_100_000));
}

#[test]
fn the_budget_stops_at_the_lease_end() {
    let c = leased();
    clock(ENDS + 100_000);
    call(bob(), 0);
    assert_eq!(c.lease_budget(0).allowed.0, 600 * TOKEN_UNIT);
}

#[test]
#[should_panic(expected = "the lease has run out")]
fn the_lessee_cannot_transfer_after_the_lease_runs_out() {
    let mut c = leased();
    clock(ENDS);
    lessee_requests(&mut c, 1, claim_fees());
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn the_owner_cannot_request_during_a_lease() {
    let mut c = leased();
    clock(TAKEN + 30_000);
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(1), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn the_owner_cannot_seal_during_a_lease() {
    let mut c = leased();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn the_owner_cannot_unseal_during_a_lease() {
    let mut c = lessee_sealed_clean();
    call(alice(), 0);
    c.unseal(0);
}

#[test]
#[should_panic(expected = "not the lot controller")]
fn the_owner_cannot_list_during_a_lease() {
    let mut c = lessee_sealed_clean();
    call(alice(), 0);
    c.list(0, U128(PRICE));
}

#[test]
#[should_panic(expected = "the title can't move during a lease")]
fn the_title_cannot_move_during_a_lease() {
    let mut c = lessee_sealed_clean();
    call(alice(), 1);
    c.nft_transfer(carol(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "lot is already leased")]
fn a_leased_lot_cannot_be_offered_again() {
    let mut c = lessee_sealed_clean();
    call(alice(), 0);
    c.offer_lease(0, U128(PRICE), ENDS + 1);
}

#[test]
fn anyone_seals_a_run_out_lease_and_control_returns_to_the_owner() {
    let mut c = leased();
    clock(ENDS);
    call(carol(), 1);
    assert!(matches!(c.seal(0, fees(1, 1)), PromiseOrValue::Value(LotState::Clean)));
    assert!(burned_lease_token());
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.lease), (LotState::Clean, None));
    assert!(c.nft_token("0-lease".into()).is_none());
    call(alice(), 0);
    c.unseal(0);
    call(alice(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(1), 150_000, claim_fees());
}

#[test]
fn expiry_burns_and_proves_the_lessees_signature_before_control_returns() {
    let mut c = leased();
    clock(TAKEN + 30_000);
    call(bob(), 1);
    let _ = c.request_transfer(0, ALICE_EVM.into(), U128(AMOUNT), 150_000, claim_fees());
    as_contract();
    assert_eq!(c.on_signed(0, 0, mpc_sig()).as_deref(), Some(CLAIM0_RAW), "bob keeps a signed transfer");
    clock(ENDS);
    call(carol(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    assert!(c.nft_token("0-lease".into()).is_some(), "the lease holds until its signatures are proven consumed");
    assert!(prove_ok(&mut c, 0));
    assert!(burned_lease_token());
    let lot = c.get_lot(0).unwrap();
    assert_eq!(*Contract::controller(&lot), alice());
    assert_eq!((lot.state, lot.lease, lot.next_nonce), (LotState::Clean, None, 1));
}

#[test]
#[should_panic(expected = "the lease has run out")]
fn the_lessee_cannot_unseal_after_the_lease_runs_out() {
    let mut c = leased();
    clock(TAKEN + 30_000);
    lessee_requests(&mut c, TOKEN_UNIT, claim_fees());
    clock(ENDS);
    call(carol(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    call(bob(), 0);
    c.unseal(0);
}

#[test]
fn surrender_at_clean_returns_control() {
    let mut c = lessee_sealed_clean();
    call(bob(), 0);
    c.surrender_lease(0);
    assert!(burned_lease_token());
    call(alice(), 0);
    c.list(0, U128(PRICE));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease, lot.listing.unwrap().item), (None, Item::Title));
}

#[test]
#[should_panic(expected = "lot is not Clean")]
fn surrender_needs_clean() {
    let mut c = leased();
    call(bob(), 0);
    c.surrender_lease(0);
}

#[test]
#[should_panic(expected = "not the lease holder")]
fn only_the_lease_holder_surrenders() {
    let mut c = lessee_sealed_clean();
    call(carol(), 0);
    c.surrender_lease(0);
}

#[test]
fn a_lease_that_runs_out_at_clean_ends_on_the_next_call() {
    let mut c = lessee_sealed_clean();
    clock(ENDS);
    call(alice(), 0);
    assert!(c.get_lot(0).unwrap().lease.is_some(), "nothing has closed it yet");
    assert!(c.nft_token("0-lease".into()).is_none());
    assert_eq!((c.nft_supply_for_owner(bob()).0, c.nft_total_supply().0), (0, 1));
    c.list(0, U128(PRICE));
    assert!(burned_lease_token());
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease, lot.listing.unwrap().item), (None, Item::Title));
}

#[test]
fn anyone_ends_a_lease_that_ran_out_at_clean() {
    let mut c = lessee_sealed_clean();
    let version = c.get_lot(0).unwrap().version;
    clock(ENDS);
    call(carol(), 0);
    c.end_lease(0);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease, lot.version), (None, version + 1));
}

#[test]
#[should_panic(expected = "no lease has run out on a Clean lot")]
fn end_lease_refuses_a_live_lease() {
    let mut c = lessee_sealed_clean();
    call(carol(), 0);
    c.end_lease(0);
}

#[test]
#[should_panic(expected = "lease offer is stale")]
fn a_lease_offer_is_bound_to_the_version_the_taker_saw() {
    let mut c = offered();
    call(bob(), PRICE);
    c.take_lease(0, 0);
}

#[test]
#[should_panic(expected = "no lease offer")]
fn unseal_cancels_the_lease_offer() {
    let mut c = offered();
    call(alice(), 0);
    c.unseal(0);
    call(bob(), PRICE);
    c.take_lease(0, 2);
}

#[test]
#[should_panic(expected = "the lease offer has run out")]
fn a_run_out_offer_cannot_be_taken() {
    let mut c = offered();
    clock(ENDS);
    call(bob(), PRICE);
    c.take_lease(0, 1);
}

#[test]
#[should_panic(expected = "the owner can't lease their own lot")]
fn the_owner_cannot_take_their_own_lease() {
    let mut c = offered();
    call(alice(), PRICE);
    c.take_lease(0, 1);
}

#[test]
fn a_listing_and_a_lease_offer_replace_each_other() {
    let mut c = offered();
    call(alice(), 0);
    c.list(0, U128(PRICE));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease_offer, lot.listing.map(|l| l.item)), (None, Some(Item::Title)));
    c.offer_lease(0, U128(PRICE), ENDS);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease_offer.is_some(), lot.listing), (true, None));
    c.delist(0);
    assert_eq!(c.get_lot(0).unwrap().lease_offer, None);
}

#[test]
fn lease_resale_pays_the_lessee_and_minter_and_carries_the_budget() {
    let mut c = lessee_withdrew_and_sealed();
    assert_eq!(c.get_lot(0).unwrap().state, LotState::Clean);
    call(bob(), 0);
    c.list(0, U128(PRICE));
    let lot = c.get_lot(0).unwrap();
    assert_eq!(lot.listing.as_ref().unwrap().item, Item::Lease);
    let payout = c.nft_payout("0-lease".into(), U128(PRICE), None).payout;
    assert_eq!((payout.get(&bob()).map(|v| v.0), payout.get(&admin()).map(|v| v.0)), (Some(975_000), Some(25_000)));
    call(carol(), PRICE);
    c.buy(0, lot.version);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.owner, lot.lease.as_ref().unwrap().holder.clone(), lot.state), (alice(), carol(), LotState::Active));
    assert_eq!((c.proceeds_of(bob()).0, c.proceeds_of(admin()).0), (975_000, 50_000), "the minter earns on the take and the resale");
    assert_eq!(committed(&c), AMOUNT, "the budget carries over");
}

#[test]
fn the_lease_token_moves_by_nft_transfer_from_clean() {
    let mut c = lessee_sealed_clean();
    let version = c.get_lot(0).unwrap().version;
    call(bob(), 1);
    c.nft_transfer(carol(), "0-lease".into(), None, None);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.lease.unwrap().holder, lot.state, lot.version), (carol(), LotState::Active, version + 1));
    assert!(near_sdk::test_utils::get_logs().iter().any(|l| l.contains(r#""event":"nft_transfer""#) && l.contains(r#""0-lease""#)));
}

#[test]
#[should_panic(expected = "lot is not Clean")]
fn the_lease_moves_only_from_clean() {
    let mut c = leased();
    call(bob(), 1);
    c.nft_transfer(carol(), "0-lease".into(), None, None);
}

#[test]
#[should_panic(expected = "not the token holder")]
fn only_the_lease_holder_moves_the_lease() {
    let mut c = lessee_sealed_clean();
    call(carol(), 1);
    c.nft_transfer(carol(), "0-lease".into(), None, None);
}

#[test]
fn nft_views_include_live_lease_tokens() {
    let c = leased();
    clock(TAKEN + 30_000);
    call(bob(), 0);
    assert_eq!(c.nft_total_supply().0, 2);
    assert_eq!(token_ids(c.nft_tokens(None, None)), ["0", "0-lease"]);
    assert_eq!(token_ids(c.nft_tokens(Some(U128(1)), Some(1))), ["0-lease"]);
    assert_eq!((c.nft_supply_for_owner(bob()).0, c.nft_supply_for_owner(alice()).0), (1, 1));
    assert_eq!(token_ids(c.nft_tokens_for_owner(bob(), None, None)), ["0-lease"]);
    let media = c.nft_token("0-lease".into()).unwrap().metadata.unwrap().media.unwrap();
    let svg = near_sdk::base64::prelude::BASE64_STANDARD.decode(media.trim_start_matches("data:image/svg+xml;base64,")).unwrap();
    let svg = String::from_utf8(svg).unwrap();
    assert!(svg.contains("Leasehold on lot #0") && svg.contains("Until 1970-01-01 00:28 UTC") && svg.contains("Budget left 30000000000000000000"), "{svg}");
}

#[test]
fn a_page_may_start_at_the_end_of_titles_and_leases() {
    let c = leased();
    call(bob(), 0);
    assert!(c.nft_tokens(Some(U128(2)), None).is_empty());
    assert!(c.nft_tokens_for_owner(bob(), Some(U128(1)), None).is_empty());
}

#[test]
#[should_panic(expected = "Out of bounds, please use a smaller from_index.")]
fn an_offset_past_u32_is_out_of_bounds_not_the_first_page() {
    let c = leased();
    call(bob(), 0);
    let _ = c.nft_tokens(Some(U128(1 << 32)), None);
}

#[test]
#[should_panic(expected = "Out of bounds, please use a smaller from_index.")]
fn an_owner_offset_past_their_tokens_is_out_of_bounds() {
    let c = leased();
    call(bob(), 0);
    let _ = c.nft_tokens_for_owner(bob(), Some(U128(2)), None);
}

#[test]
#[should_panic(expected = "Cannot provide limit of 0.")]
fn a_zero_limit_is_refused() {
    let c = leased();
    call(bob(), 0);
    let _ = c.nft_tokens(None, Some(0));
}

/// `streamedAmountOf` read from Sablier Lockup v4 on Base Sepolia at a block with that timestamp.
/// Stream 112's schedule comes from its real creation log; the others from Sablier's getters.
#[test]
fn vested_matches_sablier_on_the_real_creation_log() {
    let log: CreationLog = serde_json::from_str(REAL_CREATION_LOG).unwrap();
    let schedule = source::decode(&log.to_evm_log().unwrap(), &LOCKUP.parse().unwrap()).unwrap().schedule;
    for (t, streamed) in [
        (1793880382, 166_666_666_666_666_666_666),
        (1793881582, 500_000_000_000_000_000_000),
        (1793883381, 999_722_222_222_222_222_222),
        (1793883500, 1_000_000_000_000_000_000_000),
    ] {
        assert_eq!(schedule.vested(t), streamed, "stream 112 at {t}");
    }
}

#[test]
fn vested_matches_sablier_across_cliffs_unlocks_and_granularity() {
    let schedule = |deposit: u128, start, cliff, end, granularity, start_unlock: u128| Schedule {
        deposit: U128(deposit),
        start,
        cliff,
        end,
        granularity,
        start_unlock: U128(start_unlock),
        cliff_unlock: U128(0),
    };
    let cases = [
        ("76: cliff ahead, start unlock", schedule(1_000 * TOKEN_UNIT, 1790208000, 1805846400, 1821744000, 1, 100 * TOKEN_UNIT), 1793911308, 100 * TOKEN_UNIT),
        ("99: no cliff, start unlock", schedule(20_000 * TOKEN_UNIT, 1791169008, 0, 1822705008, 1, 2_000 * TOKEN_UNIT), 1793911332, 3_565_253_424_657_534_246_575),
        ("53: past the cliff", schedule(200_000_000_000_000, 1784100080, 1786692080, 1815636080, 1, 0), 1793911344, 49_884_355_997_788),
        ("45: ended, daily granularity", schedule(5_000 * TOKEN_UNIT, 1779539575, 0, 1782522000, 86_400, 0), 1793911345, 5_000 * TOKEN_UNIT),
    ];
    for (name, s, t, streamed) in cases {
        assert_eq!(s.vested(t), streamed, "stream {name}");
    }
    let daily = schedule(1_000, 0, 0, 864_000, 86_400, 0);
    assert_eq!((daily.vested(86_399), daily.vested(3 * 86_400 + 5_000)), (0, 300), "whole granularity units only");
}
