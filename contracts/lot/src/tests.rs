//! Fixtures are a real MPC-signed ERC-20 transfer mined on Base Sepolia on Nov 5 (`spikes/11-fixture`:
//! path `fixture-0` on `quitclaim-spike-43135.testnet`, nonce 0, 10 QTT to 0x…a11c,
//! https://sepolia.basescan.org/tx/0xfdebf0c7ec8838b09f3a379688b32c7948564e677dbf5e6a4a67e41258451060),
//! the signer's response for it, and the same payload signed by an unrelated key. `REAL_CREATION_LOG` is
//! Sablier stream 112's creation log, whose payload hash MPC attested in spike 12.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

use crate::*;

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

fn call(who: AccountId, yocto: u128) {
    let ctx = VMContextBuilder::new()
        .current_account_id(acc("lot.testnet"))
        .predecessor_account_id(who)
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .prepaid_gas(Gas::from_tgas(300))
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
        num(1), num(2), num(0x140), num(6),
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
        topics: vec![source::CREATE_LOCKUP_LINEAR.into(), num(7)],
    }
}

/// Runs the whole `mint_proven` chain with the given derived key and MPC verdict.
#[allow(clippy::too_many_arguments)]
fn mint(c: &mut Contract, issuer: AccountId, name: &str, owner: AccountId, royalty_bps: u16, key: &str, log: CreationLog, verdict: Result<Value, PromiseError>) -> Option<MintedLot> {
    call(issuer, ONE_NEAR);
    let _ = c.mint_proven(name.into(), owner, royalty_bps, log.clone());
    let id = c.next_id - 1;
    let recipient = evm::format_address(&source::decode(&log, &evm::parse_address(LOCKUP).unwrap()).unwrap().recipient);
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
fn paths_are_namespaced_by_issuer() {
    let mut c = active_lot();
    call(bob(), ONE_NEAR);
    let _ = c.mint_proven("lot-a".into(), bob(), 250, creation_log(LOT_ADDR, false, false));
    let (a, b) = (c.get_lot(0).unwrap(), c.get_lot(1).unwrap());
    assert_eq!((a.path.as_str(), b.path.as_str()), ("admin.testnet/lot-a", "bob.testnet/lot-a"));
    assert_eq!((a.issuer, b.issuer), (admin(), bob()));
}

#[test]
fn hashes_the_creation_log_exactly_as_mpc_attested() {
    let log: CreationLog = serde_json::from_str(REAL_CREATION_LOG).unwrap();
    assert_eq!(source::expected_hash(&log, Finality::Latest).unwrap(), "512781a3776f692f4b6123a4d48b7bb2207128df9e50c249ec6d88abe5db092f");
    let stream = source::decode(&log, &evm::parse_address(LOCKUP).unwrap()).unwrap();
    assert_eq!((stream.id, evm::format_address(&stream.recipient)), (112, "0x0650899c81daacc773353a0fcd74c80b38f0fa07".into()));
    assert_eq!(stream.deposit, 1_000 * 10u128.pow(18));
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
#[should_panic(expected = "not the lot owner")]
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
#[should_panic(expected = "not the lot owner")]
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
    lot.issued[2].tx_hash = Some("0x01".into());
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

#[test]
#[should_panic(expected = "too many txs issued at this nonce")]
fn txs_per_nonce_are_bounded() {
    let mut c = sealing_with_burn();
    let (mut fee, mut prio) = (55_000_000u128, 1_100_000u128);
    for seq in 2..evm::MAX_ISSUED_PER_NONCE as u32 {
        fee = fee * 11 / 10 + 1;
        prio = prio * 11 / 10 + 1;
        call(bob(), 1);
        let _ = c.rebump(0, 0, fees(fee, prio));
        as_contract();
        let _ = c.on_signed(0, seq, Err(PromiseError::Failed));
    }
    assert_eq!(c.get_lot(0).unwrap().issued.len(), evm::MAX_ISSUED_PER_NONCE);
    call(bob(), 1);
    let _ = c.rebump(0, 0, fees(fee * 11 / 10 + 1, prio * 11 / 10 + 1));
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
fn buy_moves_the_title_and_credits_seller_and_issuer() {
    let mut c = listed_lot();
    call(bob(), PRICE);
    c.buy(0, 1);
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.owner, lot.state, lot.version, lot.listing), (bob(), LotState::Active, 2, None));
    assert_eq!(c.proceeds_of(alice()).0, 975_000, "seller gets the price minus 2.5%");
    assert_eq!(c.proceeds_of(admin()).0, 25_000, "issuer gets 2.5%");
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
#[should_panic(expected = "the owner can't buy their own lot")]
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
fn issuer_selling_their_own_lot_gets_the_sum() {
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
    let source = Source { kind: "sablier-lockup-v4".into(), contract: LOCKUP.to_lowercase(), id: U128(7) };
    assert_eq!((lot.token, lot.source, lot.issuer), (TOKEN.to_lowercase(), source, admin()));
}

#[test]
#[should_panic(expected = "log hashes must be 32-byte hex")]
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
fn the_issuer_pays_for_storage() {
    let mut c = new_contract(Finality::Safe);
    call(admin(), 1);
    let _ = c.mint_proven("lot-a".into(), alice(), 250, creation_log(LOT_ADDR, false, false));
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
