# Puente — Demo walkthrough

This document is a two-minute recording plan. The left column describes what appears on screen; the right column is the suggested narration. Record with browser and terminal visible if possible.

---

## Pre-recording setup

Before starting the recording:

- [ ] Server running: `pnpm start` (or `pnpm dev`) with `OPENAI_API_KEY`, `OPENAI_MODEL`, `APP_ACCESS_CODE`, `OPERATOR_SECRET`, and `DATABASE_URL` configured
- [ ] Two browser windows ready: Window A (buyer), Window B (reviewer)
- [ ] Window A: `http://localhost:3001`
- [ ] Terminal ready for operator API calls
- [ ] Testnet badge visible in Window A if `POLLAR_PUBLISHABLE_KEY` is configured
- [ ] No real personal data or secrets visible on screen

---

## Recording script

| Time | Screen action | Narration |
|------|--------------|-----------|
| 0:00–0:10 | Show the Puente homepage — access code prompt | "Puente connects an AI agent to a human reviewer across an Africa-to-Bolivia payment corridor. I'll walk you through the full journey in two minutes." |
| 0:10–0:15 | Enter the access code and click Start | "The access code gates session creation — it lives only in the server's environment, never in source code." |
| 0:15–0:30 | Type: _"I need three campaign headlines for Bolivia. Something about fresh ingredients and local pride."_ and send | "The buyer sends a message. Puente calls OpenAI using a real API key — there is no fixture for this step." |
| 0:30–0:45 | Wait for the agent response — it drafts three headlines, then the review offer panel appears | "The agent drafts the headlines, then offers a paid local review. The exact text and the price are shown before the buyer commits to anything." |
| 0:45–0:55 | Click **Approve** — consent checkbox checked | "The buyer approves. Only the displayed text will be shared with the reviewer. The agent budget, spending policy, and reviewer link are created server-side in one atomic step." |
| 0:55–1:05 | Copy the reviewer link from the response. Open it in Window B (or incognito) | "The reviewer receives a private link. The access token is in the URL fragment — it never appears in server logs because browsers don't send URL fragments to the server." |
| 1:05–1:15 | Window B: reviewer accepts the task | "The reviewer accepts, locking a 15-minute reservation window." |
| 1:15–1:25 | Window A: show the SpendingPolicyForm — fill in network, asset code, issuer, max amount, recipient | "Back on the buyer side: the spending policy stays in the browser. The Ed25519 private key is generated here and never extracted — the server only ever sees a signed payload." |
| 1:25–1:35 | Click **Initiate Purchase** — watch the step indicator progress through policy check → signing → submitting | "When the buyer initiates payment, the browser checks the policy first. If the price or recipient doesn't match, the payment is blocked before it reaches the server." |
| 1:35–1:40 | The panel shows the 503 message: _"Facilitator pending"_ | "Today the x402 facilitator is not yet connected — the server returns 503. The full signing and retry flow is implemented; this is the one remaining integration to complete." |
| 1:40–1:50 | Window B: reviewer types a correction and explanation, clicks Submit | "The reviewer submits their correction and a one-sentence rationale. The server validates the format — it does not score the content." |
| 1:50–2:00 | Window A: click **Incorporate feedback** — wait for the agent's revised response | "The buyer incorporates the feedback. The agent makes a second LLM call, treating the reviewer's text as untrusted input — it cannot follow instructions embedded in the correction." |
| 2:00–2:10 | Scroll to the BOB payout card — show the FIXTURE badge and the mock quote | "The reviewer's payout card shows a mock quote — approximately 95 BOB. The FIXTURE badge is always visible. No real Pollar ramp call is made in this hackathon demo, as agreed with the organisers." |
| 2:10–2:15 | Click **Authorise Payout** — show the SIMULATED confirmation with payout reference | "The reviewer authorises the payout. A reference is recorded in the database with sourceMode FIXTURE. The receipt service links funding, payment, and payout under one task ID." |
| 2:15–2:20 | End on the buyer's updated conversation showing the revised headlines | "That is the full corridor: a Nigerian-funded AI buyer, a structured review by a local human, and a mocked Bolivian cash-out — all traceable to a single task receipt." |

---

## Sandbox and mocked steps — explicit callouts

During recording, call these out verbally so judges see them clearly:

1. **Nigerian funding:** show the `MANUAL` source-mode badge on the funding card and say _"This is a manual operator flow — the Nigerian bank details are placeholders for the hackathon. The state machine and four-step confirmation are implemented in full."_

2. **x402 purchase:** when the 503 appears, say _"The Stellar facilitator is the one missing piece. The 402 negotiation, the Ed25519 signing, idempotency, and budget accounting are all implemented and tested — we just need the facilitator URL and supported mechanism package."_

3. **BOB payout:** when authorising, say _"This payout is intentionally mocked — the organisers confirmed the BOB ramp integration is not required for the hackathon submission."_

---

## Alternative demo path (if LLM is unavailable)

If `OPENAI_API_KEY` is not available during recording:

1. Explain that the server requires a real OpenAI key and there is no fixture fallback.
2. Show the `chatMode: "live"` and `paymentMode: "unavailable"` values from `GET /api/puente/config` as evidence of the configuration check.
3. Screen-share a previous recording or walkthrough screenshots instead.
4. Demonstrate the funding state machine and payout flow via direct API calls with `curl` to show the underlying mechanics.

---

## Direct API evidence for judges (no browser required)

These `curl` examples demonstrate the funding state machine without a browser. Replace `<OPERATOR_SECRET>` and `<ORDER_ID>` with real values. Never include actual secret values in a public recording or document.

```bash
# Create a funding order
curl -s -X POST http://localhost:3001/api/funding-orders \
  -H "Content-Type: application/json" \
  -H "x-buyer-id: demo-buyer-1" \
  -d '{"ngnMinorUnits":"5000000","expectedAssetBaseUnits":"1000000"}'

# Confirm NGN receipt (operator)
curl -s -X POST http://localhost:3001/api/operator/funding/<ORDER_ID>/confirm \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <OPERATOR_SECRET>" \
  -d '{"ngnReceiptReference":"DEMO-RECEIPT-001"}'

# Release (operator)
curl -s -X POST http://localhost:3001/api/operator/funding/<ORDER_ID>/release \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <OPERATOR_SECRET>" \
  -d '{"releaseReference":"DEMO-RELEASE-001"}'

# Asset confirmed (operator) — use a real Stellar testnet tx hash
curl -s -X POST http://localhost:3001/api/operator/funding/<ORDER_ID>/asset-confirmed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <OPERATOR_SECRET>" \
  -d '{"stellarTxReference":"<STELLAR_TX_HASH>","confirmedBaseUnits":"1000000"}'
```

The response at each step shows the updated `status` and `sourceMode`. The final response shows `status: "ASSET_CONFIRMED"` and `sourceMode: "TESTNET"`.
