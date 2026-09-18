import express, { type Express } from "express";
import path from "node:path";
import puente from "./puente/routes";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/puente", puente);
app.use("/api", router);
const frontend = path.resolve(process.cwd(), "artifacts/puente/dist/public");
app.use(express.static(frontend));
app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) =>
  res.sendFile(path.join(frontend, "index.html")),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = (err as { status?: number }).status;
    res
      .status(status === 413 ? 413 : status === 400 ? 400 : 500)
      .json({
        error:
          status === 413
            ? "Request too large."
            : "The request could not be completed.",
      });
  },
);

export default app;
