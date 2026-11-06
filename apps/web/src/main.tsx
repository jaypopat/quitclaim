import { createRoot } from "react-dom/client";
import { config } from "@quitclaim/shared";

function App() {
  return (
    <main>
      <h1>Quitclaim</h1>
      <p>
        Lots on chain {config.evm.chainId}, signed by {config.near.mpcSigner}.
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
