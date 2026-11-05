use std::{path::PathBuf, sync::Arc};

use near_api::types::transaction::actions::{Action, DeleteAccountAction, FunctionCallAction};
use near_api::{
    Account, AccountId, Contract, NearGas, NearToken, NetworkConfig, Signer, Transaction,
};
use near_sandbox::Sandbox;
use serde_json::{Value, json};

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const ONE_NEAR: u128 = 10u128.pow(24);
const LOCKUP: &str = "0xa65a1ecef02c2b9bdc604951c6a6d02335d4532e";
const LOT_ADDRESS: &str = "0x96b717a62aafebcd4ba7f6646f10f84f680c405a";

struct TestChain {
    sandbox: Sandbox,
    network: NetworkConfig,
    signer: Arc<Signer>,
    lot: AccountId,
    mpc: AccountId,
    alice: AccountId,
    bob: AccountId,
    issuer: AccountId,
}

impl TestChain {
    async fn start() -> Result<Self> {
        let sandbox = Sandbox::start_sandbox().await?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;
        let chain = Self {
            sandbox,
            network,
            signer,
            lot: "lot.sandbox".parse()?,
            mpc: "mpc.sandbox".parse()?,
            alice: "alice.sandbox".parse()?,
            bob: "bob.sandbox".parse()?,
            issuer: "issuer.sandbox".parse()?,
        };
        for id in [
            &chain.lot,
            &chain.mpc,
            &chain.alice,
            &chain.bob,
            &chain.issuer,
        ] {
            chain
                .sandbox
                .create_account(id.as_str().parse()?)
                .initial_balance(NearToken::from_near(30))
                .send()
                .await?;
        }
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        for (id, artifact) in [
            (&chain.lot, "quitclaim_lot"),
            (&chain.mpc, "quitclaim_mpc_fixture"),
        ] {
            let wasm = std::fs::read(root.join(format!("target/near/{artifact}/{artifact}.wasm")))?;
            Contract::deploy(id.clone())
                .use_code(wasm)
                .without_init_call()
                .with_signer(chain.signer.clone())
                .send_to(&chain.network)
                .await?
                .into_result()?;
        }
        chain
            .call(&chain.mpc, &chain.mpc, "new", json!({}), 0)
            .await?;
        chain
            .call(
                &chain.lot,
                &chain.lot,
                "new",
                json!({"signer":chain.mpc,"lockup":LOCKUP,"finality":"Safe"}),
                0,
            )
            .await?;
        Ok(chain)
    }

    async fn call(
        &self,
        who: &AccountId,
        contract: &AccountId,
        method: &str,
        args: Value,
        deposit: u128,
    ) -> Result<Value> {
        let result = Contract(contract.clone())
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(300))
            .deposit(NearToken::from_yoctonear(deposit))
            .with_signer(who.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?
            .into_result()?;
        Ok(if result.raw_bytes()?.is_empty() {
            Value::Null
        } else {
            result.json()?
        })
    }

    async fn view(&self, method: &str, args: Value) -> Result<Value> {
        Ok(Contract(self.lot.clone())
            .call_function(method, args)
            .read_only::<Value>()
            .fetch_from(&self.network)
            .await?
            .data)
    }

    async fn mint(&self, name: &str) -> Result<Value> {
        self.call(
            &self.issuer,
            &self.lot,
            "mint_proven",
            json!({
                "name":name,"owner_id":self.alice,"royalty_bps":250,"log":creation_log(),
            }),
            ONE_NEAR,
        )
        .await
    }
}

// The MPC fixture returns a fixed public key. This log pays that key's address;
// cryptographic attestation stays covered by the real Base/MPC e2e suite.
fn creation_log() -> Value {
    let num = |n: u128| format!("{n:064x}");
    let address = |s: &str| format!("{:0>64}", s.trim_start_matches("0x"));
    let data = [
        num(0xa0),
        num(0),
        num(1),
        num(0),
        num(0),
        address("0x8af686edd999e3ab397cfe47e9e5b5d0dbc89e4d"),
        address("0x8af686edd999e3ab397cfe47e9e5b5d0dbc89e4d"),
        address(LOT_ADDRESS),
        num(1000),
        address("0xcdf24142f02ea7fcf5db8b1dfbc1dd25bf021f64"),
        num(0),
        num(0),
        num(1),
        num(2),
        num(0x140),
        num(6),
        format!("{:0<64}", "6c696e656172"),
    ]
    .concat();
    json!({"removed":false,"log_index":0,"transaction_index":0,"transaction_hash":"11".repeat(32),
        "block_hash":"22".repeat(32),"block_number":1,"address":LOCKUP.trim_start_matches("0x"),
        "data":format!("0x{data}"),"topics":["bc42cec3f2bd75ce97894dacc83ec6c4b682220d349b5a52d5743e7b46eba2d0",num(7)]})
}

#[tokio::test]
async fn failed_mint_refunds_storage_and_callbacks_reject_external_calls() -> Result {
    let c = TestChain::start().await?;
    c.call(&c.mpc, &c.mpc, "set_failure", json!({"fail":true}), 0)
        .await?;
    let before = Account(c.issuer.clone())
        .tokens()
        .near_balance()
        .fetch_from(&c.network)
        .await?
        .total;
    let execution = Contract(c.lot.clone())
        .call_function(
            "mint_proven",
            json!({
                "name":"retry","owner_id":c.alice,"royalty_bps":250,"log":creation_log(),
            }),
        )
        .transaction()
        .gas(NearGas::from_tgas(300))
        .deposit(NearToken::from_near(1))
        .with_signer(c.issuer.clone(), c.signer.clone())
        .send_to(&c.network)
        .await?
        .into_result()?;
    assert_eq!(execution.json::<Value>()?, Value::Null);
    let fees: u128 = execution
        .outcomes()
        .iter()
        .map(|outcome| outcome.tokens_burnt.as_yoctonear())
        .sum();
    assert_eq!(c.view("nft_total_supply", json!({})).await?, "0");
    assert_eq!(c.view("get_lot", json!({"id":0})).await?, Value::Null);
    let after = Account(c.issuer.clone())
        .tokens()
        .near_balance()
        .fetch_from(&c.network)
        .await?
        .total;
    assert!(
        before.as_yoctonear() - after.as_yoctonear() <= fees + 1,
        "mint may charge receipt fees and the 1 yocto MPC deposit, but must refund all storage"
    );

    c.call(&c.mpc, &c.mpc, "set_failure", json!({"fail":false}), 0)
        .await?;
    assert_eq!(
        c.mint("retry").await?["id"],
        1,
        "rollback must free the path"
    );
    for (method, args) in [
        (
            "on_derived",
            json!({"id":1,"recipient":LOT_ADDRESS,"log":creation_log(),"storage":"0"}),
        ),
        ("on_mint_verified", json!({"id":1,"storage":"0"})),
        ("on_signed", json!({"id":1,"seq":0})),
        ("on_proved", json!({"id":1,"nonce":0})),
        ("on_withdraw", json!({"account":c.alice,"amount":"999"})),
    ] {
        let error = c.call(&c.alice, &c.lot, method, args, 0).await.unwrap_err();
        assert!(error.to_string().contains("private"), "{method}: {error}");
    }
    assert_eq!(c.view("get_lot", json!({"id":1})).await?["state"], "Active");
    Ok(())
}

#[tokio::test]
async fn failed_payout_restores_credit_and_failed_signing_keeps_the_issued_nonce() -> Result {
    let c = TestChain::start().await?;
    assert_eq!(c.mint("sale").await?["id"], 0);
    c.call(
        &c.alice,
        &c.lot,
        "seal",
        json!({"id":0,"fees":{"max_fee":"1000000","max_prio":"1000000"}}),
        1,
    )
    .await?;
    c.call(
        &c.alice,
        &c.lot,
        "list",
        json!({"id":0,"price":(5 * ONE_NEAR).to_string()}),
        0,
    )
    .await?;
    c.call(
        &c.bob,
        &c.lot,
        "buy",
        json!({"id":0,"version":1}),
        5 * ONE_NEAR,
    )
    .await?;
    let proceeds = json!({"account_id":c.alice});
    let expected = (5 * ONE_NEAR * 9750 / 10000).to_string();
    assert_eq!(c.view("proceeds_of", proceeds.clone()).await?, expected);
    assert_eq!(
        c.view("get_lot", json!({"id":0})).await?["owner"],
        c.bob.as_str()
    );

    // The same receipt schedules a withdrawal and then deletes the recipient.
    // Its later payout receipt must fail, exercising the real callback and refund.
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    Contract::deploy(c.alice.clone())
        .use_code(std::fs::read(root.join(
            "target/near/quitclaim_mpc_fixture/quitclaim_mpc_fixture.wasm",
        ))?)
        .without_init_call()
        .with_signer(c.signer.clone())
        .send_to(&c.network)
        .await?
        .into_result()?;
    c.call(&c.alice, &c.alice, "new", json!({}), 0).await?;
    let result = Transaction::construct(c.alice.clone(), c.alice.clone())
        .add_action(Action::FunctionCall(Box::new(FunctionCallAction {
            method_name: "withdraw".into(),
            args: serde_json::to_vec(&json!({"lot":c.lot}))?,
            gas: NearGas::from_tgas(200),
            deposit: NearToken::from_yoctonear(0),
        })))
        .add_action(Action::DeleteAccount(DeleteAccountAction {
            beneficiary_id: c.bob.clone(),
        }))
        .with_signer(c.signer.clone())
        .send_to(&c.network)
        .await?
        .into_result()?;
    assert_eq!(
        result
            .receipt_outcomes()
            .iter()
            .flat_map(|receipt| &receipt.logs)
            .filter(|log| log.contains("restored"))
            .count(),
        1,
        "the failed transfer must run the restoration callback exactly once"
    );
    assert_eq!(c.view("proceeds_of", proceeds.clone()).await?, expected);
    c.sandbox
        .create_account(c.alice.as_str().parse()?)
        .initial_balance(NearToken::from_near(30))
        .send()
        .await?;
    assert_eq!(
        c.call(&c.alice, &c.lot, "withdraw_proceeds", json!({}), 0)
            .await?,
        true
    );
    assert_eq!(c.view("proceeds_of", proceeds).await?, "0");
    assert!(
        c.call(&c.alice, &c.lot, "withdraw_proceeds", json!({}), 0)
            .await
            .is_err()
    );

    assert_eq!(
        c.call(
            &c.bob,
            &c.lot,
            "request_transfer",
            json!({"id":0,"to":LOT_ADDRESS,"amount":"1","gas_limit":80000,
        "fees":{"max_fee":"1000000","max_prio":"1000000"}}),
            1
        )
        .await?,
        Value::Null
    );
    let lot = c.view("get_lot", json!({"id":0})).await?;
    assert_eq!(lot["sign_in_flight"], false);
    assert_eq!(lot["issued"].as_array().unwrap().len(), 1);
    assert_eq!(lot["next_nonce"], 0);
    assert!(
        c.call(
            &c.bob,
            &c.lot,
            "nft_transfer",
            json!({"token_id":"0","receiver_id":c.alice}),
            1
        )
        .await
        .is_err()
    );
    Ok(())
}
