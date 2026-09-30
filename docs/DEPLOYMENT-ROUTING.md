# Deployment routing repair

Vercel serves the frontend and forwards `/api/*` to `https://puente-5mww.onrender.com/api/*`. It no longer starts a second Express backend in a Vercel Function. Render owns the backend, background worker and session storage.

The frontend continues to use same-origin requests. Session cookies are returned through the Vercel proxy, so no cross-site cookie change is needed. The backend accepts the exact production frontend origin `https://puente-tau.vercel.app` as well as its existing same-host requests. Other cross-origin writes remain rejected. Preview domains are intentionally not allowed by this change.

Deploy the backend update and the Vercel frontend update. Keep backend secrets on Render. Vercel does not need DATA_DIR or database/model secrets for this static frontend deployment.

The existing JSON chat store still requires a persistent disk on Render, with DATA_DIR set to the mounted directory, and one backend instance. This patch does not migrate chat storage to PostgreSQL. The database connection must separately use a reachable Supabase endpoint; successful HTTP startup does not prove database connectivity.

Verification after deployment:
1. `/api/puente/config` on the Vercel domain returns JSON instead of a filesystem error.
2. Session creation with the private access code succeeds from the production frontend.
3. The next session request returns the same conversation, and a private reviewer link works.
4. Database-backed operations succeed and worker logs no longer show connection errors.

This is a post-submission deployment repair. It does not establish hackathon permission or verify payment settlement.
