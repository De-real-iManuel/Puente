# Integration matrix

| Capability | Primary source | Exact version | Network / asset | Permission | Test result | Evidence | Unresolved issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Pollar client wallet and ramp UI | https://www.npmjs.com/package/@pollar/core | `@pollar/core@0.10.1`, `@pollar/react@0.10.1` | Configured `testnet` or `mainnet`; asset not assumed | Publishable browser key and worker authorization | Package pinned in lockfile; build pending | `pnpm-lock.yaml`, `pollar-tools.tsx` | Organizer must confirm event version, supported BOB off-ramp asset, quote and payout status contract |
| x402 HTTP negotiation | https://docs.x402.org/getting-started/quickstart-for-sellers | Current docs observed 2026-09-17 | Official examples: EVM, Solana, Algorand | Facilitator plus buyer signer | General protocol verified; Puente Stellar integration blocked | Official quickstart | No official Stellar mechanism or Pollar facilitator/signing sample found |
| Stellar account/signing | https://developers.stellar.org/ | Not selected | Not selected | Buyer signer and worker-controlled signer | Not implemented | Architecture contract | Exact network, asset issuer/contract, decimals and signing flow required |
| Model | https://developers.openai.com/api/docs/guides/function-calling | HTTPS Responses API | N/A | Server API key | Adapter exists; live call not verified | `model.ts` | Account model name and key required |
| African funding | Organizer-provided contract required | None | NGN to supported asset | Operator confirmation and liquidity authorization | Manual adapter contract only | `ARCHITECTURE.md` | Provider or organizer-approved semi-manual evidence contract required |
| BOB cash-out | https://docs.pollar.xyz/docs | Pollar SDK pinned above | Not confirmed | Worker consent and provider eligibility/KYC | Wallet/ramp UI only; no payout claimed | `pollar-tools.tsx` | Quote fields, expiry, minimum, webhook/polling and terminal paid status required |

`REPLAY` records are deterministic product evidence, not financial evidence. They never produce a live-looking transaction or payout reference. `LIVE` modes must refuse to start until every required configuration field is present.
