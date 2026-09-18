# Puente — demo and pitch guide

## Thirty-second pitch

An AI can write an advertising campaign for Bolivia, but how does it ask a Bolivian person whether that campaign actually makes sense? Puente turns local human judgment into a tool an AI can purchase. A Nigerian-funded agent commissions a Bolivian reviewer through x402, uses their structured feedback to improve its campaign, and connects the worker to BOB cash-out through Pollar. We trace the whole journey from funding to human contribution to payout.

Use present tense for implemented capabilities only. Until implementation is verified, use “we are building.” Do not announce a successful fiat payout unless provider evidence confirms it.

## Two-minute screen recording

This is a recommended duration; confirm the actual organizer limit.

| Time | Screen action | Narration purpose |
|---|---|---|
| 0:00–0:15 | Original AI campaign and local-review need | Establish the gap: local judgment and payment |
| 0:15–0:30 | Nigerian funding and agent budget | Show local funding mode and liquidity reference |
| 0:30–0:50 | Worker acceptance, 402 challenge and paid retry | Prove the agent purchased the service |
| 0:50–1:10 | Worker enters structured correction | Show actual human contribution |
| 1:10–1:30 | Agent receives result and revises campaign | Prove that buying the work changed the outcome |
| 1:30–1:50 | Worker authorizes quote; payout status | Show Pollar's role and actual cash-out evidence |
| 1:50–2:00 | Linked receipt and final product line | Tie both continents and both outcomes together |

Do not film a fake instantaneous payout. If processing takes longer, record the actual later result and label the time jump. If payout is pending, say so. For fixture/testnet components, keep a small mode label visible throughout. Do not expose keys, bank account details or private KYC data.

## Backup technical walkthrough

Show one repeated paid request returning the same task without another settlement. Show a delayed payout staying pending while reconciliation checks the existing reference. Point to the source file implementing each real integration. Keep a backup recording available in case live internet fails; label recorded footage.

## Judge questions and honest answers

**Why x402?** It lets the buyer agent purchase a defined service through the API it already calls. Task work then completes asynchronously; polling the purchased result does not incur a second charge.

**Why a human?** The task requests local judgment, not merely text generation. The demo compares the agent's initial and revised output and shows the human rationale.

**Why Pollar?** Its supported wallet/ramp capabilities are intended to connect the worker's crypto payment to local BOB access. Cite the integration that actually works in the final code.

**Where is the African leg?** Point to the funding order, bank/provider or manual confirmation, explicit liquidity release and matching buyer wallet receipt. Say exactly which parts are live or sandbox.

**What if the worker disappears?** Direct prepayment has counterparty risk. The system tracks deadline, dispute and requested refund, but cannot seize the worker's funds. A future escrow implementation would require explicit release/refund design.

**Is this unique?** The specific focus is agent-purchased local judgment with a traceable Africa–Bolivia corridor. We have not completed a market-wide uniqueness audit.

**How would it make money?** A potential service fee on completed paid work; validate willingness to pay, task economics and fee collection later. No speculative revenue numbers are needed for the demo.

## Submission checklist

- Confirm exact deadline, form fields, repository visibility, video duration and access requirements.
- Add actual demo URL, video URL, repo URL and a clear project description.
- Verify new visitor/judge can access the intended demo without your personal account.
- README evidence distinguishes implemented, demonstrated and planned.
- Source links, reused code attribution and license are present.
- No secrets or private banking data in repository, screenshots or video.
- Submission is made before the internal buffer deadline and confirmation retained.
- Do not claim “first-place winner” before results. Compete with evidence, not a predicted award.
