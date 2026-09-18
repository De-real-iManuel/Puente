# Sources, verification and organizer questions

Research date: 16 September 2026. The source list separates accessible primary documentation from supplied material and unresolved provider details.

| Source | Link | What it establishes |
|---|---|---|
| Boundless event | https://www.boundlessfi.xyz/hackathons/pollar-hackathon-build-on-pollar?tab=overview | User supplied complete brief; live page could not be retrieved. Dates, prize pool and corridor acceptance are attributed to pasted brief, not independently verified |
| x402 introduction | https://docs.x402.org/introduction | General HTTP payment negotiation and facilitator roles; does not prove Stellar/Pollar compatibility |
| x402 migration guide | https://docs.x402.org/guides/migration-v1-to-v2 | Version-specific integration reference; do not mix old and new headers |
| x402 seller quickstart | https://docs.x402.org/getting-started/quickstart-for-sellers | Working general integration examples and settlement lifecycle; its documented examples are not a Pollar Stellar recipe |
| x402 repository | https://github.com/coinbase/x402 | Accessible repository with examples/specifications; displayed as a fork of x402-foundation/x402 at research time. Follow official docs to the current canonical implementation |
| Stellar developer portal | https://developers.stellar.org/ | Primary starting point for network, account, signing and contract documentation |

The architecture is original proposed engineering design. Generic protocol summaries are intentionally short; most content is Puente-specific implementation planning. No first-place README was verified in this session, so the pitch is original and is not presented as copied from an award-winning repository. No competition scoring weights are invented.

## Pollar-specific facts still needed

Do not turn search snippets into implementation evidence. Searches surfaced mentions of Pollar documentation but not a reliably inspectable canonical SDK contract. Obtain these from the organizer:

1. Canonical SDK repository/docs URL, package name, pinned version, API base URL and credentials flow.
2. Working x402 buyer/server example for the supported Stellar network, including facilitator endpoint, protocol version, scheme, asset identifier and decimals.
3. Does the implementation support dynamically paying the reserved worker wallet? How is settlement queried after a timeout? Are duplicate authorizations safely detected?
4. Pollar wallet key ownership, signer interfaces and whether an external buyer agent signer is supported.
5. Does the BOB ramp support cash-out now? Which network/asset, minimum amount, fees, KYC and recipient details are required?
6. Are quote expiry, webhook signing, payout lookup and idempotency supported? Which statuses prove actual fiat payout?
7. Can the organizer run the Bolivian end of a small authorized test, and when is the available test slot?
8. Can testnet be used with any ramp sandbox? If mainnet is required, document the separate live funding and amount before execution.
9. Confirm acceptance of the documented Nigerian semi-manual operator flow, including pre-funded stablecoin liquidity and explicit funding reconciliation.
10. Confirm final deadline/time zone, scoring rubric, required artifacts, video length, repository visibility and demo access expectations.

## Record answers in the build repository

Use INTEGRATION_MATRIX.md with columns: capability, official URL, exact version, supported network/asset, method signatures, permission required, test result, evidence reference and unresolved issue. Screenshot a private answer only with permission and redact secrets. Public claims should use the public primary source when possible.
