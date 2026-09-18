/**
 * source-mode-guard.ts
 *
 * Runtime guards for adapter sourceMode fields and Pollar publishable key
 * validation. Every adapter response must carry a valid sourceMode; a missing
 * or unrecognised value causes the calling route to return HTTP 502 rather
 * than silently treating a misconfigured response as legitimate.
 *
 * Requirements: 9.3, 4.3, 4.4
 */

import type { SourceMode } from "../puente/integrations";

// ---------------------------------------------------------------------------
// Valid SourceMode values (mirrors the union type for runtime use)
// ---------------------------------------------------------------------------

const VALID_SOURCE_MODES = new Set<string>([
  "LIVE",
  "TESTNET",
  "SANDBOX",
  "MANUAL",
  "FIXTURE",
]);

// ---------------------------------------------------------------------------
// assertSourceMode
// ---------------------------------------------------------------------------

/**
 * Asserts that `response` is a plain object carrying a valid `sourceMode`
 * string. Throws a descriptive error (suitable for surfacing as HTTP 502)
 * when the contract is not met.
 *
 * Use this at every adapter call-site so a misconfigured or misbehaving
 * adapter is caught before its output is written to the database.
 */
export function assertSourceMode(
  response: unknown,
): asserts response is { sourceMode: SourceMode } {
  if (response === null || typeof response !== "object") {
    throw new Error(
      `HTTP 502: adapter response is not an object (received ${response === null ? "null" : typeof response})`,
    );
  }

  const record = response as Record<string, unknown>;

  if (!("sourceMode" in record)) {
    throw new Error(
      "HTTP 502: adapter response is missing the required `sourceMode` field",
    );
  }

  const mode = record["sourceMode"];

  if (typeof mode !== "string") {
    throw new Error(
      `HTTP 502: adapter response \`sourceMode\` must be a string (received ${typeof mode})`,
    );
  }

  if (!VALID_SOURCE_MODES.has(mode)) {
    throw new Error(
      `HTTP 502: adapter response \`sourceMode\` has unrecognised value "${mode}"; ` +
        `expected one of: ${[...VALID_SOURCE_MODES].join(", ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pollar publishable key validation
// ---------------------------------------------------------------------------

/**
 * Pattern for a valid Pollar publishable key.
 * Matches `pub_testnet_<alphanumeric>` or `pub_mainnet_<alphanumeric>`.
 * Requirements: 4.3, 4.4
 */
export const POLLAR_KEY_RE = /^pub_(testnet|mainnet)_[A-Za-z0-9]+$/;

/**
 * Validates a Pollar publishable key against `POLLAR_KEY_RE`.
 *
 * Returns the key string when it is present and matches the pattern.
 * Returns `null` when `key` is `undefined` or does not match — callers
 * should treat `null` as "key absent or malformed" and display a visible
 * configuration error to the user without exposing the raw value.
 */
export function assertPollarKey(key: string | undefined): string | null {
  if (key === undefined) {
    return null;
  }
  return POLLAR_KEY_RE.test(key) ? key : null;
}

/**
 * Alias for `assertPollarKey` — kept for callers that use the design-doc name.
 * Both names behave identically.
 */
export const validatePollarKey = assertPollarKey;
