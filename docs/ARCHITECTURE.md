# Puente — Architecture

This document covers component relationships, trust boundaries, data flow, state machines, and the adapter contract. It is the reference for anyone extending or verifying the implementation.

---

## 1. Repository layout

```
Puente/
├── artifacts/
│   ├── api-server/          Express API — chat, funding, x402, payout, receipt
│   ├── agent-signer/        Ed25519 signing library (Node crypto + Web Crypto mirrors)
│   └── puente/              React + Vite frontend (buyer chat, reviewer page, operator page)
├── lib/
│   ├── db/                  Drizzle ORM schema + PostgreSQL migrations
│   ├── api-client-react/    React Query hooks for the API
│   ├── api-spec/            Shared API type definitions
│   └── api-zod/             Zod validation schemas
├── tests/
│   ├── flow.test.mjs        Server smoke test (no credentials)
│   ├── integration/         In-memory model tests (no DB or network)
│   └── properties/          Property-based tests using fast-check
├── scripts/                 Dev runner, secret scanner, pnpm guard
└── .data/puente.json        Runtime chat + task state (file store)
```

---

## 2. Component diagram

```mermaid
flowchart TD
    subgraph Browser ["Browser (no server secrets)"]
        UI["React pages\n/ chat\n/review/:id\n/operator"]
        Policy["SpendingPolicyForm\n+ checkPolicy"]
        Crypto["Web Crypto Ed25519\nnon-extractable key pair"]
        PollarSDK["@pollar/core + @pollar/react\nFreighter wallet connect\nopenRampModal"]
    end

    subgraph APIServer ["API Server (Node 22 — server secrets only)"]
        PuenteRoutes["/api/puente/*\nchat, session, offer,\napprove, submit, incorporate"]
        FileStore[".data/puente.json\nsessions + tasks"]
        FundingRoutes["/api/funding-orders\n/api/operator/funding/*"]
        PaymentRoutes["/api/reservations/:id/purchase"]
        PayoutRoutes["/api/payout-quotes\n/api/payouts"]
        ReceiptRoute["/api/receipts/:taskId"]
        PollarRoutes["/api/pollar/config\n/api/pollar/sponsored-check"]
        JobWorker["Job worker\nRECONCILE_PURCHASE\npoll every 10 s"]
    end

    subgraph Adapters ["Adapters (sourceMode on every response)"]
        ManualFunding["ManualFundingAdapter\nsourceMode = MANUAL\nno external calls"]
        X402Adapter["UnsupportedStellarX402Adapter\nthrows on all methods\n(facilitator pending)"]
        FixtureRamp["FixtureRampAdapter\nsourceMode = FIXTURE\nmock BOB quote"]
        PollarTestnet["PollarTestnetAdapter\nthrows on balance/check\n(server-side SDK gap)"]
    end

    subgraph External ["External services"]
        OpenAI["OpenAI API\n/v1/responses\nreal HTTP call"]
        Stellar["Stellar testnet\n(intended — not yet connected)"]
        PollarRamp["Pollar BOB ramp\n(intended — not yet connected)"]
    end

    subgraph DB ["PostgreSQL (Drizzle ORM)"]
        Tables["13 tables:\nfunding_orders, agent_budgets,\ntask_intents, reservations,\npurchases, settlements,\npayout_orders, jobs,\naudit_events, …"]
    end

    UI --> PuenteRoutes
    UI --> FundingRoutes
    UI --> PaymentRoutes
    UI --> PayoutRoutes
    UI --> ReceiptRoute
    UI --> PollarRoutes
    Policy --> Crypto
    Crypto --> PaymentRoutes
    UI --> PollarSDK

    PuenteRoutes --> FileStore
    FundingRoutes --> ManualFunding
    FundingRoutes --> DB
    PaymentRoutes --> X402Adapter
    PaymentRoutes --> DB
    PayoutRoutes --> FixtureRamp
    PayoutRoutes --> DB
    PollarRoutes --> PollarTestnet
    ReceiptRoute --> DB
    JobWorker --> X402Adapter
    JobWorker --> DB

    PuenteRoutes --> OpenAI
    X402Adapter -. "intended" .-> Stellar
    FixtureRamp -. "intended" .-> PollarRamp
```

---

## 3. Trust boundaries

| Boundary | What crosses it | What does not |
|----------|----------------|---------------|
| Browser → API server | Session cookie (httpOnly, SameSite=Strict), JSON request body, `X-Payment` header (signed payload), `Idempotency-Key` | Private keys, `OPENAI_API_KEY`, `OPERATOR_SECRET`, `DATABASE_URL` |
| API server → OpenAI | Message history (last 20 turns), system prompt, tool definitions | Buyer identity, wallet addresses, payment amounts |
| API server → PostgreSQL | All payment state, funding orders, audit events | Raw secrets |
| Reviewer link | Token in URL fragment (`#key`) — browser never sends fragment to server; client extracts and sends as `Authorization: Bearer` | Wallet keys, payment references |
| Operator endpoints | `Authorization: Bearer <OPERATOR_SECRET>` — SHA-256 hashed, timing-safe comparison | Secret value is never logged or echoed |
| `POLLAR_PUBLISHABLE_KEY` | Returned by `/api/pollar/config` only after passing regex `pub_(testnet\|mainnet)_[A-Za-z0-9]+` | Raw value not returned when validation fails |

The buyer's Ed25519 private key is generated with `{ extractable: false }` in the browser's Web Crypto API. It never leaves the JavaScript execution context and is discarded on page reload. The server receives only the `authorizationPayload` (base64url envelope containing the public key, signed canonical request, and signature).

The agent signer library (`artifacts/agent-signer`) mirrors the same signing logic for server-side or CLI use. Its private key material must be supplied only through environment or secrets management — never source control.

---

## 4. Data flow: buyer conversation to incorporated review

```mermaid
sequenceDiagram
    participant B as Buyer browser
    participant S as API server
    participant F as File store (.data/puente.json)
    participant O as OpenAI
    participant R as Reviewer browser

    B->>S: POST /api/puente/session (access code)
    S->>F: create session (authorizedLive = true)
    S-->>B: session cookie

    B->>S: POST /api/puente/chat
    S->>O: POST /v1/responses (messages, propose_local_review tool)
    O-->>S: reply + optional function_call propose_local_review{text, reason}
    S->>F: append messages, store offer if tool called
    S-->>B: {messages, offer, task: null}

    B->>S: POST /api/puente/review/approve (offerId, consent=true)
    S->>F: create task, clear offer, set taskId on session
    S-->>B: {task: {id, status:open}, reviewerPath: /review/:id#token}

    note over B: Buyer shares reviewer link (e.g. opens in second tab)

    R->>S: POST /api/puente/review/:id/accept (Bearer token)
    S->>F: task.status = reserved, reservationExpiresAt = +15 min
    S-->>R: task reserved

    note over B,R: x402 purchase (intended — 503 today)
    B->>S: POST /api/puente/review/purchase (Idempotency-Key)
    S-->>B: 503 facilitator pending

    note over B,R: When purchase is confirmed, task → working

    R->>S: POST /api/puente/review/:id/submit (correction, explanation)
    S->>F: task.correction, task.explanation, task.status = submitted
    S-->>R: task submitted

    B->>S: POST /api/puente/review/incorporate
    S->>O: POST /v1/responses (messages + untrusted reviewer data)
    O-->>S: improved reply
    S->>F: append message, task.incorporated = true
    S-->>B: {messages with revised text}
```

---

## 5. Data flow: Nigerian funding corridor

```mermaid
sequenceDiagram
    participant B as Buyer browser
    participant S as API server
    participant M as ManualFundingAdapter
    participant D as PostgreSQL
    participant Op as Operator (human)

    B->>S: POST /api/funding-orders {ngnMinorUnits, expectedAssetBaseUnits}
    S->>M: createInstructions(buyerId, ngnMinorUnits, …)
    M-->>S: {providerReference, bankAccountName, accountNumber, bankName, sourceMode=MANUAL}
    S->>D: INSERT funding_orders (status=INSTRUCTIONS_ISSUED, sourceMode=MANUAL)
    S-->>B: funding order with placeholder bank details + 30 min expiry

    note over B: Buyer transfers NGN (manual step)
    note over Op: Operator verifies receipt independently

    Op->>S: POST /api/operator/funding/:id/confirm (Bearer OPERATOR_SECRET)\n{ngnReceiptReference}
    S->>D: UPDATE status=FIAT_CONFIRMED
    S-->>Op: updated order

    Op->>S: POST /api/operator/funding/:id/release {releaseReference}
    S->>D: UPDATE status=RELEASE_PENDING
    S-->>Op: updated order

    Op->>S: POST /api/operator/funding/:id/asset-confirmed\n{stellarTxReference, confirmedBaseUnits}
    S->>D: UPDATE status=ASSET_CONFIRMED, sourceMode=TESTNET
    S->>D: credit agent_budgets by confirmedBaseUnits (SELECT FOR UPDATE)
    S->>D: INSERT audit_event FUNDING_ORDER_ASSET_CONFIRMED (sourceMode=TESTNET)
    S-->>Op: updated order with Stellar tx reference
```

After `ASSET_CONFIRMED`, the buyer's `agent_budgets.balance_base_units` is incremented atomically in the same transaction. The `sourceMode` switches from `MANUAL` to `TESTNET` at this step.

---

## 6. Data flow: x402 purchase (intended path)

The purchase route is fully coded. `UnsupportedStellarX402Adapter` blocks it at the adapter layer. The sequence below shows the intended flow once a facilitator is supplied.

```mermaid
sequenceDiagram
    participant B as Buyer browser
    participant S as API server
    participant D as PostgreSQL
    participant X as Stellar x402 facilitator

    B->>S: POST /api/reservations/:id/purchase (no X-Payment header)
    S->>X: issueRequirement(terms)
    X-->>S: {requirement: {network, assetId, assetDecimals, recipient, amountBaseUnits, expiresAt}}
    S-->>B: HTTP 402, WWW-Authenticate: x402, {requirement}

    note over B: checkPolicy() runs in browser — policy violation stops here
    note over B: Ed25519 key pair generated (non-extractable)
    note over B: buildAuthorizationPayload() signs canonical JSON

    B->>S: POST /api/reservations/:id/purchase (X-Payment: authorizationPayload)
    S->>D: debit agent_budgets (SELECT FOR UPDATE, atomic)
    S->>D: INSERT purchases (status=CREATED)
    S->>X: verifyAndSettle(authorizationPayload, terms, purchaseId)
    X-->>S: {status: CONFIRMED | FAILED | UNKNOWN, providerReference}

    alt CONFIRMED
        S->>D: INSERT settlements ON CONFLICT DO NOTHING
        S->>D: UPDATE purchases status=CONFIRMED
        S->>D: UPDATE task_intents status=IN_PROGRESS
        S-->>B: HTTP 202
    else UNKNOWN
        S->>D: INSERT jobs (RECONCILE_PURCHASE)
        S-->>B: HTTP 202 pending=true
        note over S: Job worker polls every 10 s, calls x402 lookup
    else FAILED
        S->>D: UPDATE purchases status=FAILED
        S->>D: restore agent_budgets
        S-->>B: HTTP 402
    end
```

Idempotency: the same `Idempotency-Key` + matching request hash returns the original response without re-debiting. A different request body with the same key returns 409.

---

## 7. State machines

### Funding order

```mermaid
stateDiagram-v2
    [*] --> INSTRUCTIONS_ISSUED : POST /api/funding-orders
    INSTRUCTIONS_ISSUED --> FIAT_CONFIRMED : operator confirm
    INSTRUCTIONS_ISSUED --> EXPIRED : 30 min elapsed, read triggers transition
    FIAT_CONFIRMED --> RELEASE_PENDING : operator release
    RELEASE_PENDING --> ASSET_CONFIRMED : operator asset-confirmed\n→ credits agent budget (sourceMode=TESTNET)
    FIAT_CONFIRMED --> FAILED : operator marks failed
    RELEASE_PENDING --> FAILED : operator marks failed
```

### Purchase

```mermaid
stateDiagram-v2
    [*] --> CREATED : debit budget + INSERT purchases
    CREATED --> VERIFYING : best-effort update
    VERIFYING --> CONFIRMED : verifyAndSettle CONFIRMED
    VERIFYING --> FAILED : verifyAndSettle FAILED → restore budget
    VERIFYING --> UNKNOWN : verifyAndSettle UNKNOWN → queue job
    UNKNOWN --> CONFIRMED : job worker reconciles → CONFIRMED
    UNKNOWN --> FAILED : job worker reconciles → FAILED → restore budget
```

### Chat task (file store)

```mermaid
stateDiagram-v2
    [*] --> open : buyer approves offer
    open --> reserved : reviewer accepts (15 min window)
    reserved --> open : reservation expires
    reserved --> payment_pending : purchase initiated (intended)
    payment_pending --> working : payment confirmed (intended)
    working --> submitted : reviewer submits correction
    submitted --> [*] : buyer incorporates feedback
```

### Payout order

```mermaid
stateDiagram-v2
    [*] --> SIMULATED : POST /api/payouts (FixtureRampAdapter)
    note right of SIMULATED : Always FIXTURE sourceMode\nNo real Pollar ramp call
```

---

## 8. Database schema (key tables)

Defined in `lib/db/drizzle/0000_far_proemial_gods.sql`. Applied via `pnpm run db:push`.

| Table | Purpose | Key constraints |
|-------|---------|----------------|
| `users` | Buyers, workers, operators | `auth_subject` unique |
| `agent_budgets` | Buyer USDC balance (base units, bigint) | `buyer_id` unique; credits/debits use `SELECT FOR UPDATE` |
| `funding_orders` | NGN→USDC corridor state machine | `provider_reference` unique |
| `task_intents` | Task content, locale, deadline | Indexed on `(buyer_id, created_at)` |
| `reservations` | Worker assignment per task | `task_id` unique (one active reservation) |
| `purchases` | x402 payment state | `(buyer_id, idempotency_key)` unique; `reservation_id` unique |
| `settlements` | Confirmed payment records | `(network, provider_reference)` unique — prevents double-credit |
| `jobs` | Durable reconciliation queue | `(kind, aggregate_id, status)` unique — prevents duplicate jobs |
| `payout_orders` | BOB payout records | `(worker_id, idempotency_key)` unique |
| `audit_events` | Immutable event log | Append-only; every state transition writes an event |
| `webhook_events` | Idempotent webhook deduplication | `(provider, event_id)` unique |

All monetary values are stored as `bigint` base units. Currency, network, and asset issuer are stored alongside amounts — no implicit asset assumptions.

---

## 9. Adapter contract

Every adapter response carries `sourceMode: "LIVE" | "TESTNET" | "SANDBOX" | "MANUAL" | "FIXTURE"`. The `assertSourceMode()` guard in `lib/source-mode-guard.ts` runs at every call site; a missing or unrecognised value returns HTTP 502 rather than silently writing bad state.

| Adapter | Class | sourceMode | External calls |
|---------|-------|-----------|----------------|
| Nigerian funding | `ManualFundingAdapter` | `MANUAL` | None — placeholder bank details |
| x402 settlement | `UnsupportedStellarX402Adapter` | `LIVE` (never reached) | None — throws `IntegrationConfigurationError` on every method |
| BOB ramp | `FixtureRampAdapter` | `FIXTURE` | None — deterministic mock values |
| Pollar server wallet | `PollarTestnetAdapter` | `TESTNET` (never reached) | None — throws; `@pollar/core` does not expose server-side wallet helpers |

The `assertLivePaymentConfiguration()` guard prevents the server from starting in live payment mode without all required `X402_*` environment variables. Even with those variables present, it throws — a supported Stellar mechanism package must be installed and wired before live mode can operate.

---

## 10. Security notes

- **CSRF:** mutations use SameSite=Strict cookies; the server also checks that the `Origin` header matches the `Host` header for non-GET requests.
- **Rate limiting:** 120 requests/minute per IP globally; 12 model calls/minute per session.
- **Session cap:** 1,000 concurrent sessions; sessions older than 24 hours are pruned.
- **Reviewer text sandboxing:** reviewer `correction` and `explanation` are passed to the LLM wrapped in an explicit untrusted-data prompt that forbids instruction following. The model cannot raise spend limits or alter payment state.
- **Operator secret:** minimum 32 characters; hashed before timing-safe comparison; never logged or echoed.
- **No raw identity documents:** KYC status is stored as a provider reference only. Worker country/language is self-declared.
- **Secret scan:** `pnpm check:secrets` runs in CI and on commit.
