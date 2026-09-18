# Setup without the confusion

Start with the rehearsal. You and your teammate can complete the whole review flow without creating another account or entering a secret.

## Turn on real AI conversation

Set these values in your hosting provider's private environment settings, then restart the backend. Do not put their values in GitHub, screenshots, browser code, or chat messages.

| Setting | Purpose |
| --- | --- |
| CHAT_MODE | Use `live` for a language model; `demo` is the default scripted rehearsal. |
| OPENAI_API_KEY | Your server-side OpenAI key. |
| OPENAI_MODEL | A model available to your account that supports Responses API function calling. |
| APP_ACCESS_CODE | A private code of at least 16 characters, protecting the public demo from unauthorised model usage. |
| DATA_DIR | A private persistent directory; defaults to `.data`. |
| API_PORT | Backend port; defaults to 3001, or PORT if provided. |
| FRONTEND_PORT | Development frontend port; defaults to 5173. |
| NODE_ENV | Set to `production` on an HTTPS deployment to secure the session cookie. |

The browser asks for the demo access code. The model proposes a review; the application enforces the price and approval. Model failures display an error, not a fake AI answer.

## Enable Pollar's wallet controls

Set POLLAR_PUBLISHABLE_KEY to a Pollar **publishable** key and POLLAR_NETWORK to `testnet` or `mainnet`. The publishable key is intentionally returned to the browser. Never use a Pollar secret key here. No wallet private key is required in this app: the reviewer connects their external Freighter wallet and signs through it.

The review page then exposes the SDK wallet and ramp controls. Availability depends on your Pollar account, network, provider and eligibility checks. Testnet assets are not cash. These controls are separate from the simulated task balance.

## Hosting

Build with `pnpm build:puente` and run `pnpm start` from the root. The backend serves both the API and built frontend. Use one process with a persistent private DATA_DIR; the JSON store is not safe for multiple server replicas. The dev proxy handles `/api` locally.

Sessions expire after 24 hours. A minute-by-minute cleanup removes expired conversations and their tasks while the server runs. Treat the data directory and any hosting backups as private. No environment files are included in the repository.
