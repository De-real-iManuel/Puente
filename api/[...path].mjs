import app from "../artifacts/api-server/dist/app.mjs";

// Vercel owns the HTTP listener; Express handles the existing API routes.
export default app;
