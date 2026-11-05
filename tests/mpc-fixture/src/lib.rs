//! Local-only MPC stand-in. It never signs or verifies a foreign chain.
use near_sdk::serde_json::{Value, json};
use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, env, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Fixture {
    fail_verification: bool,
}

#[near]
impl Fixture {
    #[init]
    pub fn new() -> Self {
        Self {
            fail_verification: false,
        }
    }

    pub fn set_failure(&mut self, fail: bool) {
        self.fail_verification = fail;
    }

    pub fn derived_public_key(&self) -> String {
        "secp256k1:cLjnNHX33xCBjXo1Tajm6YNc9ycqAuUCUfEKw7uTKvX6nm2hM4PFmRviYQCqfieiSDHsDzd2vd8zgRt2QuTjN14".into()
    }

    #[payable]
    pub fn verify_foreign_transaction(&mut self) -> Value {
        assert!(!self.fail_verification, "injected MPC failure");
        json!({"attested": true})
    }

    #[payable]
    pub fn sign(&mut self) {
        env::panic_str("injected signing failure");
    }

    pub fn withdraw(&mut self, lot: AccountId) -> Promise {
        Promise::new(lot).function_call(
            "withdraw_proceeds",
            b"{}".to_vec(),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(100),
        )
    }
}
