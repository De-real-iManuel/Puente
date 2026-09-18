# Puente — power-aware execution plan

## Working deadline

The supplied brief lists 18 September 2026 at 13:00 UTC, which is 14:00 in Nigeria. Confirm with the organizer. Use 12:00 Nigeria time as the internal submission target, preserving a two-hour buffer. Do not assume the “five days” sentence extends the deadline.

Your constraint is reliable powered working time, not ambition. Preserve the product and front-load external dependencies. Work at the event venue as early as practical on 17 September. The schedule below is a proposed allocation, not an assumption about event hours or your arrival.

## Tonight, from your phone

- Save this handoff and identify the coding agent/repository you will use.
- Ask the organizer for the canonical SDK/repository, working Stellar x402 example, facilitator access and BOB cash-out test slot. Question checklist is in SOURCES.md.
- Confirm a willing Bolivian reviewer or organizer participant for the campaign-review demo. Do not send funds just to reserve their participation.
- Confirm the exact submission deadline, video duration, repository visibility and required links from the hackathon form.
- Arrange charging/power access and carry laptop charger, extension if available, phone cable and hotspot backup.

These tasks reduce waiting at the venue; they do not require writing code on a dead laptop.

## First powered session — September 17

| Active work block | Deliverable | Exit evidence |
|---|---|---|
| 0–45 minutes | Repo, SDK access and integration matrix | Exact versions/network and first sample outcome |
| 45–120 minutes | External integration spike | Supported x402 payment and Pollar wallet/quote test, or precise blocker |
| 2–4 hours | Persistence and task lifecycle | Reservation, purchase intent, submission, result work in fixture mode |
| 4–6 hours | Agent and payment integration | Agent paid request activates task once |
| 6–8 hours | African funding and Pollar cash-out | Linked records and provider status evidence |
| 8–10 hours | UI, real reviewer and first recording | Entire story visible with accurate mode labels |

Move these blocks around event commitments. Record a rough demo as soon as the first full flow works; do not wait for visual perfection. If you have fewer powered hours, use hosted agent execution only if your chosen platform actually supports it. A local process will stop when the laptop loses power.

## Final morning — September 18

- Early block: resolve the highest-risk integration defect and reconcile any pending payment.
- Next block: critical tests, clean-start instructions and final README evidence.
- By 11:00 Nigeria time: final screen recording and access/link check.
- By 12:00: complete submission, then retain confirmation or screenshot.
- 12:00–14:00: buffer for upload or form failures and organizer-requested corrections.

Confirm venue access that morning; do not make success depend on it without confirmation.

## Power-loss protocol

After each milestone: update STATUS.md, save all files, commit verified work where authorized, push to the configured remote when authorized and available, and record the next exact command. Keep secrets in the runtime secret manager, not in checkpoint text. Preserve transaction/payout references before shutting down. Hosted durable jobs should continue independently; on restart query status rather than replaying the payment.

STATUS.md template:

```text
Current milestone:
Last passing command and time:
Current commit / uncommitted files:
Integration modes:
Pending transaction or payout references (no secrets):
Known failure and reproduction:
Organizer answer still needed:
Next exact action:
```

## Integration blockers without product deletion

| Blocker | Continue immediately | Submission implication |
|---|---|---|
| SDK credentials delayed | Domain, fixtures, UI and agent result loop | Pollar remains unverified until actual test |
| Stellar x402 example missing | Buyer policy and adapter contract; request working implementation | Do not call homemade payload standards-compatible |
| BOB payout approval delayed | Quote/consent/pending flow; reserve organizer test slot | State payout pending; do not claim fiat arrival |
| No live African provider | Document semi-manual operator and liquidity path | Allowed by supplied brief; disclose exact mode |
| No real reviewer available | Team member runs worker view transparently | Demonstrates workflow, not independent demand |
| Power fails | Hosted jobs continue if configured; resume from checkpoint | Reconcile external operations before retry |

The full product stays represented. Status labels distinguish implemented, integrated, demonstrated and planned. Do not make unsupported live claims to hide a blocker.
