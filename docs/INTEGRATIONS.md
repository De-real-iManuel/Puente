# What is connected, and what still needs connecting

| Part | Current state |
| --- | --- |
| Buyer approval and human review | Implemented with server validation and private links. |
| Real AI | Responses API adapter implemented; requires your private key and chosen model. No live model call verified during this build. |
| Pollar | React/core SDK 0.10.1 installed; external wallet and ramp controls implemented. No funded live transaction verified. |
| x402 | Planned, not implemented. Do not present the simulated acceptance step as x402. |
| African funding | Not connected. A documented manual or sandbox path still needs a real provider or organiser-approved process. |
| Bolivia cash-out | SDK ramp controls available when configured; task payout remains an illustrative simulation. |

## Complete the money path

1. Obtain Pollar's supported Stellar x402 example and facilitator details. Confirm network, token, header format, signing method and settlement confirmation. Do not guess these from an unrelated implementation.
2. Choose a reviewer wallet and an exact task price. The buyer must approve recipient, amount, asset, network and expiry. Keep signing permission outside the language model.
3. Connect buyer funding. Record whether funding was real, sandbox or manual, with evidence. Never infer funding from a balance displayed in the browser.
4. Add the x402 purchase to the review service. Verify settlement server-side, record the transaction identifier, and prevent a retry from purchasing twice. A timeout after broadcast requires reconciliation before retrying.
5. Only mark a task paid after confirmed settlement. Direct payment before work has delivery risk; this version has no escrow or automatic refunds.
6. For real cash-out, use the provider's current quote, fees, expiry and status. A submitted request is not proof that the bank received funds. Keep the reviewer in control of signing and identity checks.
7. Replace the rehearsal receipt with verified references only after an end-to-end test. Keep simulation available and labelled for safe practice.

## Links

- [Pollar documentation](https://docs.pollar.xyz/docs)
- [Pollar full documentation for coding agents](https://docs.pollar.xyz/llms-full.txt)
- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Hackathon brief](https://www.boundlessfi.xyz/hackathons/pollar-hackathon-build-on-pollar?tab=overview)

## A question you can post yourself

“Could you share a working Stellar x402 example compatible with Pollar 0.10.1, including the facilitator endpoint and supported wallet signing method? Which network should we use to test the BOB cash-out, and what African funding evidence is acceptable for a documented manual corridor?”

This asks for the missing technical details without disclosing the product.
