import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  Globe2,
  Loader2,
  MessageCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  api,
  ApiError,
  money,
  type Config,
  type Conversation,
} from "@/lib/puente-api";

import logo from "@assets/generated_images/puente-logo-mark.png";
import NigerianFundingCard from "@/components/nigerian-funding-card";
import { TestnetBadge } from "@/components/testnet-badge";
import "./chat.css";

const example =
  "Write a warm, playful love letter to my Bolivian girlfriend in Spanish. I want the wording to feel natural. Offer a local human review if it would help.";
export default function Chat() {
  const [config, setConfig] = useState<Config | null>(null),
    [conversation, setConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState(""),
    [access, setAccess] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [reviewerPath, setReviewerPath] = useState(""),
    [showHelp, setShowHelp] = useState(false),
    [resetOpen, setResetOpen] = useState(false),
    [copied, setCopied] = useState(false),
    [loaded, setLoaded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.all([
      api<Config>("/config").then(setConfig),
      api<Conversation>("/session")
        .then(setConversation)
        .catch((e) => {
          if (!(e instanceof ApiError && e.status === 401)) throw e;
        }),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversation?.messages.length, busy]);
  useEffect(() => {
    if (!conversation?.task || conversation.task.incorporated) return;
    const timer = setInterval(() => {
      api<Conversation>("/session")
        .then(setConversation)
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [conversation?.task?.id, conversation?.task?.incorporated]);
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input;
    await perform(async () => {
      if (!conversation) await api("/session", { accessCode: access });
      const next = await api<Conversation>("/chat", { message: text });
      setConversation(next);
      setInput("");
      setConsent(false);
    });
  }
  async function approve() {
    await perform(async () => {
      const next = await api<Conversation>("/review/approve", {
        offerId: conversation?.offer?.id,
        consent,
      });
      setConversation(next);
      setReviewerPath(next.reviewerPath || "");
    });
  }
  async function purchase() {
    await perform(async () => {
      await api("/review/purchase", {}, undefined, { "Idempotency-Key": crypto.randomUUID() });
    });
  }
  async function copyLink() {
    await perform(async () => {
      let link = reviewerPath;
      if (!link) {
        const r = await api<{ reviewerPath: string }>("/review/link", {});
        link = r.reviewerPath;
        setReviewerPath(link);
      }
      await navigator.clipboard.writeText(location.origin + link);
      setCopied(true);
    });
  }
  const task = conversation?.task,
    offer = conversation?.offer;
  return (
    <div className="chat-shell">
      <header className="chat-header">
        <a className="chat-brand" href="/">
          <img src={logo} alt="" />
          puente<span>.</span>
        </a>
        <div className="header-actions">
          <span className="mode-label">
            Live AI ? payment integration unavailable
          </span>
          <TestnetBadge visible={config?.pollarNetwork === "testnet"} />
          <Button
            variant="ghost"
            size="icon"
            aria-label="How Puente works"
            onClick={() => setShowHelp(true)}
          >
            <MessageCircle size={19} />
          </Button>
          <Button variant="outline" onClick={() => setResetOpen(true)}>
            <Plus size={16} /> New chat
          </Button>
        </div>
      </header>
      <main className="conversation">
        <div className="conversation-heading">
          <span className="overline">
            <Globe2 size={14} /> A LITTLE LOCAL UNDERSTANDING
          </span>
          <h1>Your ideas. A local perspective.</h1>
          <p>
            Talk to your agent. Bring in a person when their experience matters.
          </p>
        </div>
        {!conversation?.messages.length && (
          <div className="welcome">
            <div className="agent-icon">
              <Sparkles size={25} />
            </div>
            <h2>What would you like to create?</h2>
            <p>
              A love letter, a campaign, a message that sounds like you.
              <br />
              Start with an idea. We’ll take it from there.
            </p>
            <button className="example-card" onClick={() => setInput(example)}>
              <span>🇧🇴</span>
              <div>
                <strong>A love letter, with a local touch</strong>
                <small>Write in Spanish for someone special in Bolivia.</small>
              </div>
              <ArrowUpRight size={19} />
            </button>
          </div>
        )}
        <div className="messages" aria-live="polite">
          {conversation?.messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <span className="message-avatar">
                {m.role === "user" ? (
                  <UserRound size={17} />
                ) : (
                  <Sparkles size={17} />
                )}
              </span>
              <div>
                <span className="message-name">
                  {m.role === "user" ? "You" : "Puente"}
                </span>
                <p>{m.content}</p>
              </div>
            </div>
          ))}
          {busy && (
            <div className="thinking">
              <Loader2 size={16} className="animate-spin" /> Working on it…
            </div>
          )}
        </div>
        {offer && (
          <section className="review-offer">
            <div className="offer-heading">
              <span className="human-icon">
                <UserRound size={21} />
              </span>
              <div>
                <h2>A human perspective?</h2>
                <p>
                  Bolivian Spanish review · {money(offer.amountCents)} USDC (asset not yet configured)
                </p>
              </div>
            </div>
            <p>{offer.reason}</p>
            <details>
              <summary>See exactly what the reviewer will receive</summary>
              <blockquote>{offer.text}</blockquote>
            </details>
            <label className="consent-row">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
              />
              <span>
                I approve this budget and sharing only the text shown above
                with the reviewer.
              </span>
            </label>
            <div className="offer-actions">
              <Button disabled={!consent || busy} onClick={approve}>
                Request human review <ArrowUpRight size={16} />
              </Button>
              <span>No real money moves.</span>
            </div>
          </section>
        )}
        {task && (
          <section className="task-card">
            <div className="offer-heading">
              <span className="human-icon">
                {task.status === "submitted" ? (
                  <Check size={22} />
                ) : (
                  <UserRound size={22} />
                )}
              </span>
              <div>
                <h2>
                  {task.status === "open"
                    ? "Your reviewer can join now"
                    : task.status === "reserved" || task.status === "payment_pending"
                      ? "Your worker reserved the task"
                      : task.status === "working"
                      ? "Your review is underway"
                      : "Your human review is here"}
                </h2>
                <p>
                  {task.status === "open"
                    ? "Send the private link to your assigned worker."
                    : task.status === "reserved" || task.status === "payment_pending"
                      ? "Your agent must purchase the reservation before work begins."
                      : task.status === "working"
                      ? "This chat will update when they submit their answer."
                      : "Use their feedback to finish the answer in this chat."}
                </p>
              </div>
            </div>
            {task.correction && (
              <details open>
                <summary>Read the human feedback</summary>
                <blockquote>{task.correction}</blockquote>
                <p>{task.explanation}</p>
              </details>
            )}
            <div className="offer-actions">
              {task.status === "open" && (
                <>
                  <Button variant="outline" disabled={busy} onClick={copyLink}>
                    <Copy size={15} />
                    {copied ? "Link copied" : "Copy reviewer link"}
                  </Button>
                  {reviewerPath && (
                    <a
                      className="reviewer-link"
                      href={reviewerPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open reviewer view ↗
                    </a>
                  )}
                </>
              )}
              {task.status === "reserved" && (
                <div>
                  <p className="notice">Direct payment happens before delivery. Puente has no escrow or clawback; a refund requires a separate worker-authorized transfer.</p>
                  <Button disabled={busy} onClick={purchase}>Purchase reserved review</Button>
                </div>
              )}
              {task.status === "submitted" && !task.incorporated && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    perform(async () =>
                      setConversation(
                        await api<Conversation>("/review/incorporate", {}),
                      ),
                    )
                  }
                >
                  Use the human feedback <Sparkles size={16} />
                </Button>
              )}
            </div>
            <small>
              Payment:{" "}
              {task.payment === "confirmed" ? "confirmed" : task.status === "reserved" ? "integration unavailable" : "not started"}{" "}
              · Cash-out:{" "}
              {task.payout}
            </small>
          </section>
        )}
        {conversation && (
          <NigerianFundingCard
            ngnMinorUnits="150000"
            expectedAssetBaseUnits="1000000"
          />
        )}
        {error && (
          <div className="chat-error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={15} />
            </button>
          </div>
        )}
        <div ref={bottom} />
      </main>
      <div className="composer-wrap">
        <form onSubmit={send} className="composer">
          {config?.accessRequired && !conversation && (
            <label className="access-label">
              Private access code
              <input
                type="password"
                value={access}
                onChange={(e) => setAccess(e.target.value)}
                autoComplete="off"
                placeholder="Provided by the service owner"
              />
            </label>
          )}
          <div className="composer-input">
            <Textarea
              aria-label="Message Puente"
              placeholder="Tell Puente what you have in mind…"
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!busy && input.trim())
                    e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !loaded || !input.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={21} />
            </Button>
          </div>
          <div className="composer-caption">
            <ShieldCheck size={13} /> You choose what is shared and what is
            spent. <span>Enter to send</span>
          </div>
        </form>
        <p className="privacy-note">
          "AI can make mistakes. Ask a human when local judgment matters."{" "}
          Chats expire after 24 hours.
        </p>
      </div>
      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>One chat. A human when you need one.</DialogTitle>
            <DialogDescription>
              Describe what you need. The agent drafts an answer and may offer
              local review. You approve the text and price, a reviewer responds,
              and the agent uses their feedback.
            </DialogDescription>
          </DialogHeader>
          <p>
            Payments remain unavailable until the supported x402 and African funding contracts are configured. Pollar wallet tools are available separately when configured and never authorize a cash-out without the worker.
          </p>
          <p>
            A review link grants access to its task. Share it only with your
            intended reviewer.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start another conversation?</DialogTitle>
            <DialogDescription>
              Your current chat will no longer be shown on this device. Existing
              reviewer links remain usable until the task expires.
            </DialogDescription>
          </DialogHeader>
          {config?.accessRequired && (
            <input
              aria-label="Private access code"
              type="password"
              value={access}
              onChange={(e) => setAccess(e.target.value)}
              placeholder="Private access code"
            />
          )}
          <Button
            disabled={busy}
            onClick={() =>
              perform(async () => {
                setConversation(
                  await api<Conversation>("/session", { accessCode: access }),
                );
                setReviewerPath("");
                setConsent(false);
                setCopied(false);
                setResetOpen(false);
              })
            }
          >
            Start new chat
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
