import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { useParams } from "wouter";
import { Check, Globe2, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api, money, type Config, type Task } from "@/lib/puente-api";
import logo from "@assets/generated_images/puente-logo-mark.png";
import "./chat.css";
const PollarTools = lazy(() => import("@/components/pollar-tools"));
export default function Reviewer() {
  const { id } = useParams<{ id: string }>();
  const [key] = useState(() => {
    const k =
      location.hash.slice(1) ||
      sessionStorage.getItem("review-key:" + id) ||
      "";
    if (k) {
      sessionStorage.setItem("review-key:" + id, k);
      history.replaceState(null, "", location.pathname);
    }
    return k;
  });
  const [task, setTask] = useState<Task | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [correction, setCorrection] = useState(""),
    [explanation, setExplanation] = useState("");
  useEffect(() => {
    Promise.all([
      api<{ task: Task }>(`/review/${id}`, undefined, key).then((r) => {
        setTask(r.task);
        setCorrection(r.task.correction || r.task.text);
        setExplanation(r.task.explanation || "");
      }),
      api<Config>("/config").then(setConfig),
    ]).catch((e) => setError(e.message));
  }, [id, key]);
  async function act(action: string, body: unknown = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ task: Task }>(`/review/${id}/${action}`, body, key);
      setTask(r.task);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void act("submit", { correction, explanation });
  }
  return (
    <div className="chat-shell">
      <header className="chat-header">
        <a href="/" className="chat-brand">
          <img src={logo} alt="" />
          puente<span>.</span>
        </a>
        <span className="mode-label">Reviewer · worker-controlled wallet</span>
      </header>
      <main className="reviewer-main">
        <span className="overline">
          <Globe2 size={14} /> A HUMAN TOUCH
        </span>
        <h1>Your local perspective matters.</h1>
        <p>
          Read the text, improve what needs changing, and explain your choices.
        </p>
        {error && (
          <div className="chat-error" role="alert">
            {error}
          </div>
        )}
        {!task && !error && <p>Loading your review…</p>}
        {task && (
          <>
            <section className="task-card">
              <div className="offer-heading">
                <span className="human-icon">
                  <UserRound size={22} />
                </span>
                <div>
                  <h2>Bolivian Spanish review</h2>
                  <p>{money(task.amountCents)} USDC ? asset and network pending integration</p>
                </div>
              </div>
              <p>{task.reason}</p>
              <details open>
                <summary>Text the buyer agreed to share</summary>
                <blockquote>{task.text}</blockquote>
              </details>
              {task.status === "open" && (
                <>
                  <div className="notice">
                    Accepting reserves this task; it does not move money. The buyer agent must purchase the reservation before work begins. Direct payment is prepayment, not escrow, and refunds require your separate authorization. Only the approved text is shared with you,
                    not the buyer’s private chat.
                  </div>
                  <div className="offer-actions">
                    <Button disabled={busy} onClick={() => act("accept")}>
                      {busy ? <Loader2 className="animate-spin" /> : null}Accept
                      review
                    </Button>
                  </div>
                </>
              )}
              {task.status === "reserved" && (
                <div className="notice">Reserved for you. Wait for the buyer agent purchase; do not begin work yet.</div>
              )}
              {task.status === "payment_pending" && (
                <div className="notice">Payment outcome is pending reconciliation. Do not ask the buyer to pay again.</div>
              )}
              {task.status === "working" && (
                <form onSubmit={submit}>
                  <label htmlFor="correction">Your suggested version</label>
                  <Textarea
                    id="correction"
                    value={correction}
                    onChange={(e) => setCorrection(e.target.value)}
                    maxLength={8000}
                    required
                  />
                  <label htmlFor="reason">What did you change, and why?</label>
                  <Textarea
                    id="reason"
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                    maxLength={2000}
                    required
                    placeholder="Explain the tone, expressions or context you would adjust."
                  />
                  <div className="offer-actions">
                    <Button
                      type="submit"
                      disabled={
                        busy || !correction.trim() || !explanation.trim()
                      }
                    >
                      Send review to the buyer
                    </Button>
                  </div>
                </form>
              )}
              {task.status === "submitted" && (
                <>
                  <div className="notice">
                    <Check size={18} /> Your review is delivered. The buyer can
                    use it in their chat.
                  </div>
                  <details>
                    <summary>Your submitted review</summary>
                    <blockquote>{task.correction}</blockquote>
                    <p>{task.explanation}</p>
                  </details>
                  <p className="notice">Use the Pollar controls below to review an actual provider quote and authorize cash-out from your own wallet. Puente does not mark a payout complete without provider evidence.</p>
               </>
              )}
            </section>
            {config && (
              <Suspense fallback={<p>Loading wallet tools…</p>}>
                <PollarTools config={config} />
              </Suspense>
            )}
          </>
        )}
      </main>
    </div>
  );
}
