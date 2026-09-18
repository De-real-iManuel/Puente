import app from "./app";
import { logger } from "./lib/logger";
import { startJobWorker } from "./puente/job-worker";

const port = Number(process.env.API_PORT || process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the durable reconciliation job worker using the lazy DB accessor
  // so DATABASE_URL is not required at module load time.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { db } = require("@workspace/db") as typeof import("@workspace/db");
    startJobWorker(db);
  } catch (err) {
    logger.warn({ err }, "Could not start job worker — DATABASE_URL may be absent");
  }
});
