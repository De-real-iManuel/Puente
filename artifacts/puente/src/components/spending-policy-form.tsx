import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { ShieldCheck, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types (mirrored from @workspace/agent-signer — not imported to avoid
// Node.js dependency in the browser bundle)
// ---------------------------------------------------------------------------

export type SpendingPolicy = {
  network: string;
  assetCode: string;
  assetIssuer: string;
  assetDecimals: number;
  maxBaseUnits: string; // positive integer string, > 0
  recipientAllowlist: string[];
  expiresAt: string; // ISO 8601 UTC
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Matches a positive integer with no leading zeros (e.g. "1", "1000000"). */
const POSITIVE_INT_RE = /^[1-9]\d*$/;

/** Validates that a value is a non-negative integer 0–18. */
function isValidDecimals(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 18 && String(n) === value.trim();
}

/** Validates that a value is a positive integer > 0. */
function isPositiveInt(value: string): boolean {
  return POSITIVE_INT_RE.test(value.trim());
}

type FormState = {
  network: string;
  assetCode: string;
  assetIssuer: string;
  assetDecimals: string;
  maxBaseUnits: string;
  recipientAllowlist: string;
  validityDurationSeconds: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  network: "",
  assetCode: "",
  assetIssuer: "",
  assetDecimals: "",
  maxBaseUnits: "",
  recipientAllowlist: "",
  validityDurationSeconds: "",
};

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};

  if (!form.network.trim()) {
    errors.network = "Network identifier is required.";
  } else if (form.network.trim().length > 80) {
    errors.network = "Network identifier must be 80 characters or fewer.";
  }

  if (!form.assetCode.trim()) {
    errors.assetCode = "Asset code is required.";
  } else if (form.assetCode.trim().length > 12) {
    errors.assetCode = "Asset code must be 12 characters or fewer.";
  }

  if (!form.assetIssuer.trim()) {
    errors.assetIssuer = "Asset issuer address is required.";
  }

  if (!isValidDecimals(form.assetDecimals)) {
    errors.assetDecimals = "Asset decimals must be a whole number from 0 to 18.";
  }

  if (!isPositiveInt(form.maxBaseUnits)) {
    errors.maxBaseUnits =
      "Max base units must be a positive integer with no leading zeros (e.g. 1000000).";
  }

  const addresses = form.recipientAllowlist
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (addresses.length === 0) {
    errors.recipientAllowlist = "At least one recipient address is required.";
  }

  if (!isPositiveInt(form.validityDurationSeconds)) {
    errors.validityDurationSeconds =
      "Validity duration must be a positive integer (number of seconds).";
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PolicySummary({
  policy,
  onClear,
}: {
  policy: SpendingPolicy;
  onClear: () => void;
}) {
  return (
    <div className="spf-summary" role="region" aria-label="Active spending policy">
      <div className="spf-summary-header">
        <h4>
          <ShieldCheck size={14} style={{ display: "inline", marginRight: 6 }} />
          Active Spending Policy
        </h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClear}
          aria-label="Clear spending policy"
        >
          <X size={14} /> Clear policy
        </Button>
      </div>
      <div className="spf-summary-rows">
        <div className="spf-summary-row">
          <span className="spf-summary-label">Network</span>
          <span className="spf-summary-value">{policy.network}</span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Asset code</span>
          <span className="spf-summary-value">{policy.assetCode}</span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Asset issuer</span>
          <span className="spf-summary-value">{policy.assetIssuer}</span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Decimals</span>
          <span className="spf-summary-value">{policy.assetDecimals}</span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Max base units</span>
          <span className="spf-summary-value">{policy.maxBaseUnits}</span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Recipients</span>
          <span className="spf-summary-value">
            <div className="spf-allowlist">
              {policy.recipientAllowlist.map((addr) => (
                <span key={addr} className="spf-allowlist-addr">
                  {addr}
                </span>
              ))}
            </div>
          </span>
        </div>
        <div className="spf-summary-row">
          <span className="spf-summary-label">Expires at</span>
          <span className="spf-expires-at">
            {new Date(policy.expiresAt).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SpendingPolicyFormProps {
  /** Called whenever the stored policy changes (including when cleared). */
  onPolicyChange?: (policy: SpendingPolicy | null) => void;
}

export default function SpendingPolicyForm({
  onPolicyChange,
}: SpendingPolicyFormProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [policy, setPolicy] = useState<SpendingPolicy | null>(null);

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    // Clear per-field error on change
    if (errors[name as keyof FormState]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = validate(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const validitySeconds = parseInt(form.validityDurationSeconds.trim(), 10);
    const expiresAt = new Date(
      Date.now() + validitySeconds * 1000,
    ).toISOString();

    const addresses = form.recipientAllowlist
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const newPolicy: SpendingPolicy = {
      network: form.network.trim(),
      assetCode: form.assetCode.trim(),
      assetIssuer: form.assetIssuer.trim(),
      assetDecimals: parseInt(form.assetDecimals.trim(), 10),
      maxBaseUnits: form.maxBaseUnits.trim(),
      recipientAllowlist: addresses,
      expiresAt,
    };

    setPolicy(newPolicy);
    setErrors({});
    onPolicyChange?.(newPolicy);
  }

  function handleClear() {
    setPolicy(null);
    onPolicyChange?.(null);
  }

  const hasError = (field: keyof FormState) => !!errors[field];

  return (
    <section className="spf-form" aria-label="Spending policy configuration">
      <h3>Configure Spending Policy</h3>
      <p>
        The policy stays on your device. Your private key is never shared with
        the Puente server.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="spf-fields">
          {/* Network */}
          <div className="spf-field">
            <label htmlFor="spf-network">Network identifier</label>
            <input
              id="spf-network"
              name="network"
              type="text"
              value={form.network}
              onChange={handleChange}
              className={hasError("network") ? "spf-invalid" : ""}
              placeholder="e.g. testnet"
              maxLength={80}
              aria-describedby={hasError("network") ? "spf-network-err" : undefined}
            />
            {hasError("network") && (
              <span id="spf-network-err" className="spf-field-error" role="alert">
                {errors.network}
              </span>
            )}
          </div>

          {/* Asset code */}
          <div className="spf-field">
            <label htmlFor="spf-asset-code">Asset code</label>
            <input
              id="spf-asset-code"
              name="assetCode"
              type="text"
              value={form.assetCode}
              onChange={handleChange}
              className={hasError("assetCode") ? "spf-invalid" : ""}
              placeholder="e.g. USDC"
              maxLength={12}
              aria-describedby={hasError("assetCode") ? "spf-asset-code-err" : undefined}
            />
            {hasError("assetCode") && (
              <span id="spf-asset-code-err" className="spf-field-error" role="alert">
                {errors.assetCode}
              </span>
            )}
          </div>

          {/* Asset issuer */}
          <div className="spf-field">
            <label htmlFor="spf-asset-issuer">Asset issuer (Stellar address)</label>
            <input
              id="spf-asset-issuer"
              name="assetIssuer"
              type="text"
              value={form.assetIssuer}
              onChange={handleChange}
              className={hasError("assetIssuer") ? "spf-invalid" : ""}
              placeholder="e.g. GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
              aria-describedby={hasError("assetIssuer") ? "spf-asset-issuer-err" : undefined}
            />
            {hasError("assetIssuer") && (
              <span id="spf-asset-issuer-err" className="spf-field-error" role="alert">
                {errors.assetIssuer}
              </span>
            )}
          </div>

          {/* Asset decimals */}
          <div className="spf-field">
            <label htmlFor="spf-asset-decimals">Asset decimals</label>
            <input
              id="spf-asset-decimals"
              name="assetDecimals"
              type="number"
              min={0}
              max={18}
              step={1}
              value={form.assetDecimals}
              onChange={handleChange}
              className={hasError("assetDecimals") ? "spf-invalid" : ""}
              placeholder="e.g. 6"
              aria-describedby={hasError("assetDecimals") ? "spf-asset-decimals-err" : undefined}
            />
            {hasError("assetDecimals") && (
              <span id="spf-asset-decimals-err" className="spf-field-error" role="alert">
                {errors.assetDecimals}
              </span>
            )}
          </div>

          {/* Max base units */}
          <div className="spf-field">
            <label htmlFor="spf-max-base-units">Max base units per payment</label>
            <input
              id="spf-max-base-units"
              name="maxBaseUnits"
              type="text"
              inputMode="numeric"
              value={form.maxBaseUnits}
              onChange={handleChange}
              className={hasError("maxBaseUnits") ? "spf-invalid" : ""}
              placeholder="e.g. 5000000 (= 5 USDC with 6 decimals)"
              aria-describedby={
                hasError("maxBaseUnits") ? "spf-max-base-units-err" : "spf-max-base-units-hint"
              }
            />
            <span id="spf-max-base-units-hint" className="spf-hint">
              Positive integer, no leading zeros.
            </span>
            {hasError("maxBaseUnits") && (
              <span id="spf-max-base-units-err" className="spf-field-error" role="alert">
                {errors.maxBaseUnits}
              </span>
            )}
          </div>

          {/* Recipient allowlist */}
          <div className="spf-field">
            <label htmlFor="spf-allowlist">Recipient allowlist</label>
            <textarea
              id="spf-allowlist"
              name="recipientAllowlist"
              value={form.recipientAllowlist}
              onChange={handleChange}
              className={hasError("recipientAllowlist") ? "spf-invalid" : ""}
              placeholder="Comma-separated Stellar addresses, one or more"
              aria-describedby={
                hasError("recipientAllowlist")
                  ? "spf-allowlist-err"
                  : "spf-allowlist-hint"
              }
            />
            <span id="spf-allowlist-hint" className="spf-hint">
              Separate multiple addresses with commas.
            </span>
            {hasError("recipientAllowlist") && (
              <span id="spf-allowlist-err" className="spf-field-error" role="alert">
                {errors.recipientAllowlist}
              </span>
            )}
          </div>

          {/* Validity duration */}
          <div className="spf-field">
            <label htmlFor="spf-validity">Validity duration (seconds)</label>
            <input
              id="spf-validity"
              name="validityDurationSeconds"
              type="number"
              min={1}
              step={1}
              value={form.validityDurationSeconds}
              onChange={handleChange}
              className={hasError("validityDurationSeconds") ? "spf-invalid" : ""}
              placeholder="e.g. 300 (= 5 minutes)"
              aria-describedby={
                hasError("validityDurationSeconds") ? "spf-validity-err" : undefined
              }
            />
            {hasError("validityDurationSeconds") && (
              <span id="spf-validity-err" className="spf-field-error" role="alert">
                {errors.validityDurationSeconds}
              </span>
            )}
          </div>
        </div>

        <div className="spf-actions">
          <Button type="submit">
            <ShieldCheck size={15} />
            {policy ? "Update policy" : "Set policy"}
          </Button>
        </div>
      </form>

      {policy && <PolicySummary policy={policy} onClear={handleClear} />}
    </section>
  );
}
