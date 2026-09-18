import { Component, useState, type ReactNode } from "react";
import { PollarProvider, usePollar } from "@pollar/react";
import { Button } from "@/components/ui/button";
import type { Config } from "@/lib/puente-api";
class PollarBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p>
        Pollar could not load. Your human review is saved; please try wallet
        setup again later.
      </p>
    ) : (
      this.props.children
    );
  }
}
function WalletControls() {
  const {
    wallet,
    verified,
    login,
    logout,
    openRampModal,
    openWalletBalanceModal,
  } = usePollar();
  const [error, setError] = useState("");
  return (
    <>
      <p>
        Connect your own Freighter wallet. Rehearsal earnings are not real USDC
        and cannot be withdrawn.
      </p>
      {wallet && <p className="pollar-address">{wallet.address}</p>}
      <div className="offer-actions">
        {!wallet ? (
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              try {
                login({ provider: "freighter-native" });
              } catch {
                setError(
                  "Could not start Freighter. Check the extension and Pollar configuration.",
                );
              }
            }}
          >
            Connect with Pollar
          </Button>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={!verified}
              onClick={openWalletBalanceModal}
            >
              Wallet balance
            </Button>
            <Button
              variant="outline"
              disabled={!verified}
              onClick={openRampModal}
            >
              Open Pollar cash-out
            </Button>
            <Button variant="ghost" onClick={logout}>
              Disconnect
            </Button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <p>
        These are real wallet controls. Review the network, fees and provider
        terms inside Pollar before authorizing anything. Opening the widget does
        not mark this task paid.
      </p>
    </>
  );
}
export default function PollarTools({ config }: { config: Config }) {
  if (!config.pollarPublishableKey)
    return (
      <div className="pollar-tools">
        <h3>Pollar wallet connection</h3>
        <p>
          The wallet connection is ready for configuration. The owner needs to
          add the Pollar publishable key to the server’s private settings. No
          key belongs in GitHub.
        </p>
      </div>
    );
  return (
    <div className="pollar-tools">
      <h3>Pollar · {config.pollarNetwork}</h3>
      <PollarBoundary>
        <PollarProvider
          client={{
            apiKey: config.pollarPublishableKey,
            stellarNetwork: config.pollarNetwork,
          }}
        >
          <WalletControls />
        </PollarProvider>
      </PollarBoundary>
    </div>
  );
}
