import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { timingSafeEqual } from "node:crypto";
import {
  Store,
  hash,
  token,
  now,
  publicTask,
  type Session,
  type Task,
} from "./store";
import { answer, modelConfigured } from "./model";

const router = Router();
const store = new Store(process.env.DATA_DIR || ".data");
store.prune();
setInterval(() => store.prune(), 60000).unref();
const locks = new Set<string>();
const rates = new Map<string, { count: number; until: number }>();
function problem(res: Response, code: number, message: string) {
  return res.status(code).json({ error: message });
}
function cookie(req: Request) {
  const raw = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("puente_session="))
    ?.slice(15);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : "";
}
function session(req: Request) {
  return store.sessions[hash(cookie(req))];
}
function getSession(req: Request, res: Response) {
  const s = session(req);
  if (!s || Date.parse(s.createdAt) < Date.now() - 86400000) {
    problem(res, 401, "Start a new chat to continue.");
    return;
  }
  return s;
}
function sameSecret(a: string, b: string) {
  return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
function limited(key: string, limit = 40) {
  const time = Date.now();
  if (rates.size > 5000)
    for (const [k, v] of rates) if (v.until < time) rates.delete(k);
  let r = rates.get(key);
  if (!r || r.until < time) {
    r = { count: 0, until: time + 60000 };
    rates.set(key, r);
  }
  return ++r.count > limit;
}
function safeText(v: unknown, max = 8000) {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : null;
}
function view(s: Session) {
  return {
    messages: s.messages,
    offer: s.offer || null,
    task: publicTask(s.taskId ? store.tasks[s.taskId] : undefined),
    chatMode: "live",
    paymentMode: "unavailable",
  };
}
function reviewer(req: Request, res: Response) {
  const t = store.tasks[String(req.params.id)];
  const key = req.headers.authorization?.replace(/^Bearer /, "") || "";
  if (
    !t ||
    !store.sessions[t.sessionId] ||
    Date.parse(store.sessions[t.sessionId].createdAt) < Date.now() - 86400000 ||
    !sameSecret(hash(key), t.reviewerHash)
  ) {
    problem(res, 404, "This review link is missing, expired, or invalid.");
    return;
  }
  return t;
}

router.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Cache-Control", "no-store");
  if (limited(req.ip || "unknown", 120)) {
    problem(res, 429, "Too many requests. Please wait a minute.");
    return;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (
          new URL(origin).host !== req.headers.host &&
          origin !== "https://puente-tau.vercel.app"
        ) {
          problem(res, 403, "Please use Puente from its own website.");
          return;
        }
      } catch {
        problem(res, 403, "Invalid origin.");
        return;
      }
    }
  }
  next();
});
router.get("/config", (_req, res) =>
  res.json({
    chatMode: "live",
    paymentMode: "unavailable",
    accessRequired: true,
    pollarConfigured: !!process.env.POLLAR_PUBLISHABLE_KEY,
    pollarPublishableKey: /^pub_(testnet|mainnet)_/.test(
      process.env.POLLAR_PUBLISHABLE_KEY || "",
    )
      ? process.env.POLLAR_PUBLISHABLE_KEY
      : null,
    pollarNetwork:
      process.env.POLLAR_NETWORK === "mainnet" ? "mainnet" : "testnet",
  }),
);
router.post("/session", (req, res) => {
  {
    if (!process.env.APP_ACCESS_CODE || process.env.APP_ACCESS_CODE.length < 16)
      return problem(
        res,
        503,
        "Set the private access code APP_ACCESS_CODE to at least 16 characters in this Render service, then redeploy.",
      );
    if (
      !sameSecret(
        String(req.body?.accessCode || ""),
        process.env.APP_ACCESS_CODE,
      )
    )
      return problem(res, 401, "Enter the private access code.");
  }
  if (Object.keys(store.sessions).length > 1000) store.prune();
  if (Object.keys(store.sessions).length > 1000)
    return problem(res, 503, "This service is at capacity. Try again later.");
  const { secret, session: s } = store.create(true);
  res.cookie("puente_session", secret, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 86400000,
    path: "/",
  });
  return res.json(view(s));
});
router.get("/session", (req, res) => {
  const s = getSession(req, res);
  if (s) return res.json(view(s));
  return;
});
router.post("/chat", async (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  if (!s.authorizedLive)
    return problem(res, 401, "Unlock live chat with the access code.");
  if (!modelConfigured()) return problem(res, 503, "Live model configuration is unavailable.");
  const content = safeText(req.body?.message, 4000);
  if (!content)
    return problem(res, 400, "Write a message of 1–4,000 characters.");
  if (s.messages.length >= 80)
    return problem(
      res,
      409,
      "Start a new chat; this conversation has reached its limit.",
    );
  if (locks.has(s.id))
    return problem(res, 409, "An answer is already being prepared.");
  if (limited("model:" + s.id, 12))
    return problem(res, 429, "Please wait a minute before asking again.");
  locks.add(s.id);
  try {
    const message = { role: "user" as const, content, at: now() };
    const result = await answer([...s.messages, message]);
    s.messages.push(message, {
      role: "assistant",
      content: result.reply,
      at: now(),
    });
    if (result.offer && !s.taskId)
      s.offer = {
        ...result.offer,
        id: token(),
        amountCents: 500,
        expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
      };
    store.save();
    return res.json(view(s));
  } catch (e) {
    return problem(
      res,
      503,
      e instanceof Error ? e.message : "Could not prepare the answer.",
    );
  } finally {
    locks.delete(s.id);
  }
});
router.post("/review/approve", (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  if (s.taskId) return res.json({ ...view(s), alreadyApproved: true });
  if (locks.has(s.id))
    return problem(res, 409, "Wait for the current answer before approving.");
  if (!s.offer || req.body?.offerId !== s.offer.id)
    return problem(
      res,
      409,
      "This review offer has changed. Refresh the chat.",
    );
  if (Date.parse(s.offer.expiresAt) < Date.now())
    return problem(
      res,
      409,
      "This offer expired. Ask the agent for a new review offer.",
    );
  if (req.body?.consent !== true)
    return problem(
      res,
      400,
      "Approve the price and sharing the displayed text first.",
    );
  const key = token(),
    id = token().slice(0, 16);
  const t: Task = {
    id,
    sessionId: s.id,
    text: s.offer.text,
    reason: s.offer.reason,
    amountCents: s.offer.amountCents,
    reviewerHash: hash(key),
    status: "open",
    payment: "unpaid",
    payout: "not_requested",
    createdAt: now(),
  };
  store.tasks[id] = t;
  s.taskId = id;
  delete s.offer;
  s.messages.push({
    role: "assistant",
    content:
      "Your review request is ready. Only the text you approved is shared. A worker must reserve it before your agent can purchase it. Direct payment is prepayment, not escrow, and refunds require the worker to authorize a separate transfer.",
    at: now(),
  });
  store.save();
  return res.json({ ...view(s), reviewerPath: `/review/${id}#${key}` });
});
router.post("/review/link", (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  const t = s.taskId ? store.tasks[s.taskId] : undefined;
  if (!t) return problem(res, 404, "No review request yet.");
  const key = token();
  t.reviewerHash = hash(key);
  store.save();
  return res.json({ reviewerPath: `/review/${t.id}#${key}` });
});
router.get("/review/:id", (req, res) => {
  const t = reviewer(req, res);
  if (t) return res.json({ task: publicTask(t) });
  return;
});
router.post("/review/:id/accept", (req, res) => {
  const t = reviewer(req, res);
  if (!t) return;
  if (t.status === "open") {
    t.status = "reserved";
    t.reservationExpiresAt = new Date(Date.now() + 15 * 60000).toISOString();
    store.save();
  }
  return res.json({ task: publicTask(t) });
});
router.post("/review/purchase", (req, res) => {
  const session = getSession(req, res);
  if (!session) return;
  const task = session.taskId ? store.tasks[session.taskId] : undefined;
  if (!task) return problem(res, 404, "No review request yet.");
  if (task.status !== "reserved") return problem(res, 409, "A worker must hold an active reservation before purchase.");
  if (!safeText(req.headers["idempotency-key"], 200)) return problem(res, 400, "An Idempotency-Key header is required.");
  return problem(res, 503, "Purchase is unavailable: a supported Stellar x402 facilitator, asset, and signing adapter have not been supplied. No payment was attempted.");
});
router.post("/review/:id/submit", (req, res) => {
  const t = reviewer(req, res);
  if (!t) return;
  if (t.status === "submitted") return res.json({ task: publicTask(t) });
  if (t.status !== "working" || t.payment !== "confirmed")
    return problem(res, 409, "The buyer must complete the reserved purchase before work can be submitted.");
  const correction = safeText(req.body?.correction),
    explanation = safeText(req.body?.explanation, 2000);
  if (!correction || !explanation)
    return problem(res, 400, "Add the revised text and a short explanation.");
  t.correction = correction;
  t.explanation = explanation;
  t.status = "submitted";
  t.submittedAt = now();
  store.save();
  return res.json({ task: publicTask(t) });
});
router.post("/review/incorporate", async (req, res) => {
  const s = getSession(req, res);
  if (!s) return;
  if (!s.authorizedLive)
    return problem(res, 401, "Unlock live chat first.");
  const t = s.taskId ? store.tasks[s.taskId] : undefined;
  if (!t || t.status !== "submitted" || !t.correction || !t.explanation)
    return problem(res, 409, "The reviewer has not submitted an answer yet.");
  if (t.incorporated) return res.json(view(s));
  if (locks.has(s.id))
    return problem(res, 409, "An answer is already being prepared.");
  locks.add(s.id);
  try {
    const result = await answer(s.messages, {
      correction: t.correction,
      explanation: t.explanation,
    });
    s.messages.push({ role: "assistant", content: result.reply, at: now() });
    t.incorporated = true;
    store.save();
    return res.json(view(s));
  } catch (e) {
    return problem(
      res,
      503,
      e instanceof Error ? e.message : "Could not use the review.",
    );
  } finally {
    locks.delete(s.id);
  }
});

export default router;
