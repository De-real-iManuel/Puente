# Working on Puente

Keep the main experience to one buyer conversation and one reviewer task page. Preserve the buyer → agent → human reviewer concept and the intended x402/Pollar payment path.

Never commit keys, environment files, wallet secrets, runtime conversations or reviewer access links. Configuration names belong in docs; values belong in private hosting settings. Never log prompts, authorization headers or secrets.

Do not invent SDK methods or claim that simulated funds were settled. Read the official Pollar documentation before changing wallet or ramp code. Keep signing and spending rules outside the language model. Changes to payment state must be checked server-side and safe to retry.

Write for a reader who has never used a crypto wallet. Explain what works today and what is still pending. Do not promise a prize.

Run `pnpm typecheck`, `pnpm build:puente`, `pnpm test:puente` and `pnpm check:secrets` before committing. Use pnpm 10.28.2 and Node 22+. Do not use multiple server processes with the local JSON store.
