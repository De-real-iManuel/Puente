# Puente implementation status

Current milestone: Mock and replay implementation removed; repository flattened and live-only surfaces compile.

Completed work:

- Flattened the application into the Git repository root.
- Removed mock sandbox, guided simulation, fabricated balances, operator simulator, fake receipt, replay model/payment, and simulated payout endpoint.
- Reduced the web app to buyer chat and private worker task routes.
- Added the PostgreSQL marketplace schema and durable jobs table.
- Kept the real OpenAI model adapter and pinned Pollar SDK integration.
- Live x402 purchase fails closed before any money action because Stellar support is unverified.
- Replaced the Unix-only install guard with a cross-platform Node script.

Last verified command: `pnpm --filter @workspace/api-server typecheck` and `pnpm --filter @workspace/puente typecheck` passed on 2026-09-17.

Current commit / uncommitted files: Clean baseline commit pending final build/test/secret checks. No push authorized.

Integration modes: Model `LIVE`; Pollar client `LIVE/TESTNET` according to configured provider key/network; x402 `UNAVAILABLE`; African funding `MANUAL_UNCONNECTED`; BOB payout `PROVIDER_UI_ONLY`.

Known failing issue: Official x402 sources reviewed do not establish a Stellar mechanism compatible with Pollar. Purchase returns HTTP 503 and does not synthesize a 402 payload.

Source URLs:

- https://docs.x402.org/getting-started/quickstart-for-sellers
- https://docs.x402.org/guides/migration-v1-to-v2
- https://github.com/coinbase/x402
- https://www.npmjs.com/package/@pollar/core
- https://docs.pollar.xyz/docs

Organizer answers still needed: canonical event SDK version; supported Stellar network and asset identifier/decimals; facilitator and buyer signing example; settlement lookup; Pollar BOB quote/submit/status/webhook contracts; African funding evidence contract; authorized test slot.

Next exact action: Run `pnpm build:puente`, `pnpm test:puente`, and `pnpm check:secrets`; inspect the diff; commit the verified baseline.
