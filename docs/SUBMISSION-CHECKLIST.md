# Puente — Submission checklist

Deadline: **18 September 2026, 13:00 UTC / 14:00 Nigeria time**

Complete every item in this file before submitting. Do not submit with placeholder links.

---

## 1. Blockers (must fix before submission)

| # | Item | Status | Notes |
|---|------|--------|-------|
| B1 | Stellar x402 facilitator connected | ❌ Blocking | `UnsupportedStellarX402Adapter` throws on all methods. Obtain facilitator URL, supported network/asset, and mechanism package from organiser. Wire into `purchase-service.ts` and `job-worker.ts`. Purchase route returns 503 today. |
| B2 | Live demo URL accessible by judges | ❌ Missing | No deployment configuration exists. Deploy to a public host (e.g. Railway, Render, Fly.io). Add URL to README submission links table. |
| B3 | Demo video recorded and linked | ❌ Missing | Follow the script in `docs/DEMO.md`. Add public video URL to README. |

---

## 2. Verification required

| # | Item | Status | Notes |
|---|------|--------|-------|
| V1 | Testnet USDC transfer — Stellar tx reference | ❌ Not verified | Operator must send real testnet USDC, obtain the Stellar testnet transaction hash, and call `/api/operator/funding/:id/asset-confirmed`. Record the hash here and add it to the README evidence table. |
| V2 | Pollar wallet connect works on deployed host | ❌ Not verified | `POLLAR_PUBLISHABLE_KEY` must be set in the hosting environment. Open `/` with Freighter installed, click Connect, confirm the wallet address appears and the testnet badge shows. |
| V3 | Pollar ramp modal opens | ❌ Not verified | After wallet connect, click "Open Pollar cash-out" in the reviewer view. Confirm the modal opens without errors. This requires a connected wallet and a valid publishable key. |
| V4 | Full buyer-to-reviewer flow on deployed host | ❌ Not verified | Run the demo walkthrough from `docs/DEMO.md` against the live deployment, not just locally. |
| V5 | x402 purchase completes end-to-end | ❌ Blocked by B1 | Once facilitator is wired, run `tests/integration/x402-flow.integration.test.mjs` against the live adapter, then complete a real testnet purchase. Record the settlement `providerReference`. |
| V6 | CI passes on final commit | ❌ Not verified | Check `.github/workflows/check.yml` — `pnpm typecheck`, `pnpm build:puente`, `pnpm test:puente`, `pnpm check:secrets` must all pass green. |
| V7 | `pnpm run db:push` runs from clean checkout | ❌ Not verified | Test against a fresh PostgreSQL database with only `DATABASE_URL` set. Confirm all 13 tables are created. |

---

## 3. Links to add to README

Replace `_add before submission_` in the README submission links table with real URLs.

| Item | Placeholder location | Required value |
|------|---------------------|---------------|
| Live demo URL | README § Submission links | Public HTTPS URL to the deployed app |
| Demo video | README § Submission links | Public video URL (YouTube, Loom, etc.) |
| Stellar testnet tx (funding) | README § What works today — V1 row | Stellar testnet explorer link to asset-confirmed tx |
| x402 settlement reference | README § What works today — x402 row | Provider reference from a real testnet purchase |

---

## 4. Configuration checklist for deployment

Confirm these environment variables are set in the hosting environment's secret store. Never commit values to the repository.

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `OPENAI_API_KEY` | Yes | Server-side only |
| `OPENAI_MODEL` | Yes | e.g. `gpt-4o` |
| `APP_ACCESS_CODE` | Yes | ≥ 16 chars; share with judges separately |
| `OPERATOR_SECRET` | Yes | ≥ 32 chars; share with demo operator only |
| `POLLAR_PUBLISHABLE_KEY` | Yes for wallet demo | Must match `pub_testnet_…` pattern |
| `POLLAR_NETWORK` | Yes | `testnet` |
| `X402_FACILITATOR_URL` | Yes when B1 is resolved | From organiser |
| `X402_NETWORK` | Yes when B1 is resolved | From organiser |
| `X402_ASSET_ID` | Yes when B1 is resolved | From organiser |
| `X402_ASSET_DECIMALS` | Yes when B1 is resolved | From organiser |
| `NODE_ENV` | Recommended | `production` to enable secure cookies |

---

## 5. Documentation to update before submission

| File | Required update |
|------|----------------|
| `README.md` | Fill in submission links table; update "Implemented, not verified" rows to "Verified on testnet" where evidence exists |
| `docs/SUBMISSION-CHECKLIST.md` | Mark all items ✅ |

---

## 6. Repository hygiene

| # | Check |
|---|-------|
| G1 | `.env` is in `.gitignore` and not committed |
| G2 | `.data/puente.json` does not contain real conversations, access codes, or wallet addresses |
| G3 | `pnpm check:secrets` passes with exit code 0 |
| G4 | No private keys, testnet seeds, or reviewer links in commit history |
| G5 | `LICENSE` file present (current `package.json` lists MIT) |
| G6 | `README.md` does not contain any secret values |

---

## 7. Submission content per organiser requirements

Confirm each item the Pollar hackathon submission form likely requires:

| Item | Status |
|------|--------|
| Project name and one-line description | ✅ README |
| Team / builder name | ✅ README |
| Live demo link | ❌ Add to README |
| Video demo link | ❌ Add to README |
| GitHub repository link | ❌ Confirm repo is public or shared with judges |
| Description of Pollar integration | ✅ README §6, docs/ARCHITECTURE.md §9 |
| Africa–Latin America corridor description | ✅ README §6, docs/AFRICAN-PATH.md |
| What is mocked vs live | ✅ README §9 evidence table |
