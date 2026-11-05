//! Fixtures are from the Nov 5 Base Sepolia run of `spikes/07-lot` (lot `lot-a` on
//! `lot.quitclaim-spike-43135.testnet`): the signer's real response for claim 0 and the raw tx
//! Base accepted for it, plus the same payload signed by an unrelated key.

use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{testing_env, AccountId, NearToken, PromiseError};

use crate::*;

const LOT_KEY: &str = "secp256k1:7G395b6eYSAYYkT7Zywkkxk6FbPjqzdaSq141BgyLUVAwEzW9tKUE1CdsqxsPXSxm9cBQjYJmGZRYiEGfLvP9KM";
const LOT_ADDR: &str = "0xf041bac925e422bc8761e5b1d7aa398d046a1615";
const VESTING: &str = "0xDd63fC251AAcDFf29793Dbf0567A462739769b95";
const ALICE_EVM: &str = "0x000000000000000000000000000000000000A11c";
const CLAIM0_MPC: &str = r#"{"scheme":"Secp256k1","big_r":{"affine_point":"02ad2f4799fe7e08a997d93301daddf13f842b61580189b54e31bda09dfef08f5b"},"s":{"scalar":"1d879d7ced0c2d6d7bb5ca877cd4f224b1481d5705e57d8604e633f2f929c7a8"},"recovery_id":0}"#;
const CLAIM0_RAW: &str = "0x02f89183014a3480830f42408402faf080830249f094dd63fc251aacdff29793dbf0567a462739769b9580a41e83409a000000000000000000000000000000000000000000000000000000000000a11cc080a0ad2f4799fe7e08a997d93301daddf13f842b61580189b54e31bda09dfef08f5ba01d879d7ced0c2d6d7bb5ca877cd4f224b1481d5705e57d8604e633f2f929c7a8";
const FORGED_R: &str = "0x85c99cdb3b07134b51f252ef89a74669e711b3ff8d68f9260f4e81affdb390ed";
const FORGED_S: &str = "0x5ff26c34ff16e0fc9572f46826dfea9ed6175c1ba817576e9180d0a55c233511";

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

fn active_lot() -> Contract {
    call(admin(), 0);
    let mut c = Contract::new(acc("v1.signer-prod.testnet"), admin(), Finality::Safe);
    let _ = c.mint("lot-a".into(), VESTING.into(), alice(), admin());
    as_contract();
    assert_eq!(c.on_derived(0, Ok(LOT_KEY.into())), Some(MintedLot { id: 0, address: LOT_ADDR.into() }));
    c
}

fn signed_claim0() -> Contract {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
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
    call(admin(), 0);
    let mut c = Contract::new(acc("v1.signer-prod.testnet"), admin(), Finality::Safe);
    let _ = c.mint("lot-a".into(), VESTING.into(), alice(), admin());
    as_contract();
    assert_eq!(c.on_derived(0, Err(PromiseError::Failed)), None);
    assert!(c.get_lot(0).is_none());
    call(admin(), 0);
    let _ = c.mint("lot-a".into(), VESTING.into(), alice(), admin());
}

#[test]
#[should_panic(expected = "path already used")]
fn paths_are_unique() {
    let mut c = active_lot();
    call(admin(), 0);
    let _ = c.mint("lot-a".into(), VESTING.into(), bob(), admin());
}

#[test]
#[should_panic(expected = "only the admin can mint")]
fn only_admin_mints() {
    let mut c = active_lot();
    call(alice(), 0);
    let _ = c.mint("lot-b".into(), VESTING.into(), alice(), admin());
}

#[test]
fn reproduces_the_exact_tx_base_accepted() {
    let c = signed_claim0();
    let issued = &c.get_lot(0).unwrap().issued[0];
    assert_eq!(issued.raw_tx.as_deref(), Some(CLAIM0_RAW));
    assert_eq!(issued.tx_hash.as_deref(), Some("0xab2c3fb96de348fda4a7e68b510f6ffbef191e1b1afc145f667cf6fab6e0ec03"));
}

#[test]
fn issued_is_recorded_before_the_signature_arrives() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
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
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "attach 1 yoctoNEAR")]
fn request_needs_the_mpc_deposit() {
    let mut c = active_lot();
    call(alice(), 0);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "a sign request is already in flight")]
fn one_sign_request_at_a_time() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, fees(60_000_000, 2_000_000));
}

#[test]
#[should_panic(expected = "replacement must raise both fees by >= 10%")]
fn replacement_must_raise_the_priority_fee_too() {
    let mut c = signed_claim0();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, fees(100_000_000, 1_000_000));
}

#[test]
#[should_panic(expected = "fee above cap")]
fn fees_are_capped() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, fees(evm::CLAIM_FEE_CAP + 1, 1));
}

#[test]
#[should_panic(expected = "signature does not recover to the lot address")]
fn forged_signature_over_the_same_payload_is_rejected() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
    as_contract();
    let _ = c.on_signed(0, 0, Err(PromiseError::Failed));
    call(bob(), 0);
    c.register_signature(0, 0, FORGED_R.into(), FORGED_S.into(), 0);
}

#[test]
fn public_mpc_signature_can_be_registered_after_a_lost_callback() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
    as_contract();
    let _ = c.on_signed(0, 0, Err(PromiseError::Failed));
    call(bob(), 0);
    let raw = c.register_signature(
        0,
        0,
        "0xad2f4799fe7e08a997d93301daddf13f842b61580189b54e31bda09dfef08f5b".into(),
        "0x1d879d7ced0c2d6d7bb5ca877cd4f224b1481d5705e57d8604e633f2f929c7a8".into(),
        0,
    );
    assert_eq!(raw, CLAIM0_RAW);
}

#[test]
fn proving_a_claim_advances_the_nonce_and_stays_active() {
    let mut c = signed_claim0();
    assert!(prove_ok(&mut c, 0));
    let lot = c.get_lot(0).unwrap();
    assert_eq!((lot.state, lot.next_nonce, lot.issued.len()), (LotState::Active, 1, 0));
}

#[test]
fn failed_proof_changes_nothing() {
    let mut c = signed_claim0();
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
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
    call(bob(), 1);
    let _ = c.prove(0, 0);
}

#[test]
fn late_signature_for_a_cleared_entry_is_a_no_op() {
    let mut c = signed_claim0();
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, fees(55_000_000, 1_100_000));
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
    let mut c = signed_claim0();
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
    let mut c = signed_claim0();
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
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
    c.nft_transfer(bob(), "0".into(), None, None);
}

#[test]
#[should_panic(expected = "lot is not Active")]
fn no_claims_while_sealing() {
    let mut c = signed_claim0();
    call(alice(), 1);
    let _ = c.seal(0, fees(55_000_000, 1_100_000));
    as_contract();
    let _ = c.on_signed(0, 1, Err(PromiseError::Failed));
    call(alice(), 1);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, fees(70_000_000, 2_000_000));
}

#[test]
#[should_panic(expected = "lot is not Active")]
fn no_claims_while_clean() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
}

#[test]
#[should_panic(expected = "not the lot owner")]
fn old_owner_is_locked_out_after_transfer() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.seal(0, fees(1, 1));
    c.nft_transfer(bob(), "0".into(), None, None);
    let _ = c.request_claim(0, ALICE_EVM.into(), 150_000, claim_fees());
}

#[test]
fn anyone_can_rebump_a_sealing_burn() {
    let mut c = signed_claim0();
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
    let mut c = signed_claim0();
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
    let mut c = signed_claim0();
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
#[should_panic(expected = "approvals are not supported")]
fn approvals_are_refused() {
    let mut c = active_lot();
    call(alice(), 1);
    c.nft_approve("0".into(), bob(), None);
}

#[test]
#[should_panic(expected = "nft_transfer_call is not supported")]
fn transfer_call_is_refused() {
    let mut c = active_lot();
    call(alice(), 1);
    let _ = c.nft_transfer_call(bob(), "0".into(), None, None, String::new());
}

fn sealing_with_burn() -> Contract {
    let mut c = signed_claim0();
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
    let mut c = signed_claim0();
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
