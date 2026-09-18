# How Puente works

The buyer authorises a specific review. The agent helps with the writing. The reviewer is a separate person who receives only the approved text.

```mermaid
sequenceDiagram
    participant B as Buyer
    participant A as Puente server
    participant L as Language model
    participant R as Reviewer
    B->>A: Ask for a Spanish letter
    A->>L: Request draft and optional review proposal
    L-->>A: Draft and reason for review
    A-->>B: Show exact text and $5 price
    B->>A: Approve sharing and price
    A-->>B: Private review link
    B->>R: Share link personally
    R->>A: Accept task
    Note over A,R: Payment is simulated in this build
    R->>A: Submit correction and explanation
    B->>A: Use the completed review
    A->>L: Improve answer with reviewer feedback
    L-->>B: Final answer through Puente
```

In rehearsal mode, a script supplies the draft and returns the human's correction. Live mode calls the model on the server. Neither mode currently moves task funds.

```mermaid
flowchart TD
    B[Buyer chat] --> API[Express API]
    R[Private reviewer page] --> API
    API --> MODEL[Server-side model adapter]
    API --> STORE[Private local task storage]
    R --> SDK[Pollar wallet and ramp controls]
    SDK --> W[External wallet signing]
    API -. planned .-> PAY[x402 settlement adapter]
```

## Where to work

- `artifacts/puente/src/pages/chat.tsx`: buyer conversation.
- `artifacts/puente/src/pages/reviewer.tsx`: reviewer task and correction.
- `artifacts/puente/src/components/pollar-tools.tsx`: configured SDK controls.
- `artifacts/api-server/src/puente/routes.ts`: consent, access checks and task progression.
- `artifacts/api-server/src/puente/model.ts`: live model and scripted rehearsal.
- `artifacts/api-server/src/puente/store.ts`: private single-process persistence.

The browser cannot choose the price. A model proposal cannot make a purchase. Task acceptance and submission are repeat-safe. Buyer sessions use an HTTP-only cookie; reviewer links carry a secret in the fragment, moved into session storage before API access. Rotating a link invalidates the old one. Possessing that link grants access; it does not prove someone lives in Bolivia.
