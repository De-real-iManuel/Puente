// Monetary value constants for the Puente payment corridor.
// All monetary values are integer bigints encoded as decimal strings; JS number
// arithmetic is never used for money (per project requirement).

export const USDC_DECIMALS = 6;
export const KOBO_DECIMALS = 2;

// ---------------------------------------------------------------------------
// MoneyValidationError
// ---------------------------------------------------------------------------

export class MoneyValidationError extends Error {
  constructor(
    public readonly field: string,
    detail: string,
  ) {
    super(`${field}: ${detail}`);
    this.name = "MoneyValidationError";
  }
}

// ---------------------------------------------------------------------------
// assertMoneyString
// ---------------------------------------------------------------------------

/** Non-negative integer decimal strings with no leading zeros.
 *  Valid:   "0", "1", "1000000"
 *  Invalid: "", "-1", "1.5", "01", "abc"
 */
const MONEY_RE = /^(0|[1-9]\d*)$/;

export function assertMoneyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !MONEY_RE.test(value)) {
    throw new MoneyValidationError(
      field,
      `expected a non-negative integer decimal string (no leading zeros, no sign, no decimal point), got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// formatNaira
// ---------------------------------------------------------------------------

/**
 * Formats a kobo string (smallest NGN unit, 1 kobo = 0.01 ₦) as a
 * human-readable Naira string with two decimal places and comma-separated
 * thousands.
 *
 * Examples:
 *   "10050"   → "₦100.50"
 *   "1000000" → "₦10,000.00"
 *   "0"       → "₦0.00"
 */
export function formatNaira(kobo: string): string {
  assertMoneyString(kobo, "kobo");

  const koboInt = BigInt(kobo);
  const wholePart = koboInt / 100n;
  const fracPart = koboInt % 100n;

  // Format the whole part with comma separators.
  const wholeStr = wholePart.toString();
  const commaStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Pad fractional part to exactly 2 digits.
  const fracStr = fracPart.toString().padStart(2, "0");

  return `₦${commaStr}.${fracStr}`;
}
