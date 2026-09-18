interface TestnetBadgeProps {
  /** Show when connected to testnet. Hidden on mainnet or when wallet is absent. */
  visible: boolean;
}

/**
 * Persistent pill badge shown while the wallet is connected on testnet.
 * Reminds judges and users that no real funds move.
 */
export function TestnetBadge({ visible }: TestnetBadgeProps) {
  if (!visible) return null;
  return (
    <span
      className="testnet-badge"
      aria-label="Connected to testnet — no real funds move"
      title="This is a testnet environment. No real funds move."
    >
      Testnet
    </span>
  );
}
