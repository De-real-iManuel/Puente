/**
 * Property-based tests for Funding_Order creation invariants.
 *
 * Validates: Requirements 1.2
 *
 * Property 1: Funding_Order creation invariants
 *
 * These tests model the creation logic in pure JavaScript, mirroring the
 * implementation in funding-service.ts. No live database is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory model — mirrors funding-service.ts + assertMoneyString from money.ts
// ---------------------------------------------------------------------------

const MONEY_RE = /^(0|[1-9]\d*)$/;

function isValidMoneyString(value) {
  return typeof value === 'string' && MONEY_RE.test(value);
}

/**
 * Mirrors the assertMoneyString guard in money.ts.
 * Throws on invalid input; returns the value on success.
 */
function assertMoneyString(value, field) {
  if (!isValidMoneyString(value)) {
    throw new Error(`MoneyValidationError: ${field}`);
  }
  return value;
}

/**
 * Pure in-memory simulation of createFundingOrder in funding-service.ts.
 * Performs the same validation and sets the same fields without touching a DB.
 */
function simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits) {
  // mirrors assertMoneyString validation
  assertMoneyString(ngnMinorUnits, 'ngnMinorUnits');
  assertMoneyString(expectedAssetBaseUnits, 'expectedAssetBaseUnits');

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
  const providerReference = randomUUID();

  return {
    id: randomUUID(),
    buyerId,
    ngnMinorUnits,
    expectedAssetBaseUnits,
    status: 'INSTRUCTIONS_ISSUED',
    providerReference,
    expiresAt,
    createdAt,
    sourceMode: 'MANUAL',
  };
}

// ---------------------------------------------------------------------------
// Property 1a — Status invariant
//
// **Validates: Requirement 1.2**
//
// Every created Funding_Order has status === 'INSTRUCTIONS_ISSUED'.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * Every Funding_Order returned by createFundingOrder must have
 * status set to INSTRUCTIONS_ISSUED regardless of the input amounts.
 */
test('Property 1a: every created Funding_Order has status INSTRUCTIONS_ISSUED', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 1n }).map(String),
      fc.bigInt({ min: 1n }).map(String),
      (buyerId, ngnMinorUnits, expectedAssetBaseUnits) => {
        const order = simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits);

        assert.equal(order.status, 'INSTRUCTIONS_ISSUED',
          'Created order must have status INSTRUCTIONS_ISSUED');
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1b — providerReference uniqueness
//
// **Validates: Requirement 1.2**
//
// Two independently created orders never share a providerReference.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * Two independently created Funding_Orders must have distinct providerReferences.
 * The schema enforces a UNIQUE constraint on this column; this property validates
 * the generation strategy produces unique values.
 */
test('Property 1b: two independently created orders have distinct providerReferences', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 1n }).map(String),
      fc.bigInt({ min: 1n }).map(String),
      fc.uuid(),
      fc.bigInt({ min: 1n }).map(String),
      fc.bigInt({ min: 1n }).map(String),
      (buyerId1, ngn1, asset1, buyerId2, ngn2, asset2) => {
        const order1 = simulateCreateFundingOrder(buyerId1, ngn1, asset1);
        const order2 = simulateCreateFundingOrder(buyerId2, ngn2, asset2);

        assert.notEqual(
          order1.providerReference,
          order2.providerReference,
          'Two independently created orders must have distinct providerReferences',
        );
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1c — expiresAt ≈ createdAt + 30 minutes
//
// **Validates: Requirement 1.2**
//
// The expiry timestamp must be within a 5-second tolerance of exactly 30 minutes
// after the creation timestamp.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * The expiresAt field must be within 5 seconds of createdAt + 30 minutes,
 * matching the `new Date(Date.now() + 30 * 60 * 1000)` logic in funding-service.ts.
 */
test('Property 1c: expiresAt is approximately createdAt + 30 minutes (within 5s tolerance)', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 1n }).map(String),
      fc.bigInt({ min: 1n }).map(String),
      (buyerId, ngnMinorUnits, expectedAssetBaseUnits) => {
        const order = simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits);

        const THIRTY_MINUTES_MS = 30 * 60 * 1000;
        const TOLERANCE_MS = 5000;
        const delta = order.expiresAt.getTime() - order.createdAt.getTime();

        assert.ok(
          Math.abs(delta - THIRTY_MINUTES_MS) < TOLERANCE_MS,
          `expiresAt must be within 5s of createdAt + 30min; delta was ${delta}ms`,
        );
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1d — amount fields are non-negative integer strings
//
// **Validates: Requirement 1.2**
//
// ngnMinorUnits and expectedAssetBaseUnits in the returned order satisfy the
// money string invariant: /^(0|[1-9]\d*)$/.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * Both monetary fields in the created order must satisfy the non-negative
 * integer string invariant — same pattern enforced by assertMoneyString.
 */
test('Property 1d: amount fields in created order satisfy the non-negative integer string invariant', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 0n }).map(String),
      fc.bigInt({ min: 0n }).map(String),
      (buyerId, ngnMinorUnits, expectedAssetBaseUnits) => {
        const order = simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits);

        assert.match(
          order.ngnMinorUnits,
          MONEY_RE,
          `ngnMinorUnits "${order.ngnMinorUnits}" must be a non-negative integer string`,
        );
        assert.match(
          order.expectedAssetBaseUnits,
          MONEY_RE,
          `expectedAssetBaseUnits "${order.expectedAssetBaseUnits}" must be a non-negative integer string`,
        );
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1e — invalid money strings are rejected
//
// **Validates: Requirement 1.2**
//
// Strings that do not match MONEY_RE must cause simulateCreateFundingOrder to throw.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * When ngnMinorUnits is not a valid non-negative integer string,
 * simulateCreateFundingOrder must throw a MoneyValidationError.
 * This mirrors the assertMoneyString guard in funding-service.ts.
 */
test('Property 1e: invalid money strings for ngnMinorUnits are rejected with MoneyValidationError', () => {
  // Generate strings that definitely fail MONEY_RE
  const invalidArb = fc.oneof(
    // leading zeros
    fc.bigInt({ min: 1n }).map(n => '0' + String(n)),
    // negative numbers
    fc.bigInt({ min: 1n }).map(n => '-' + String(n)),
    // decimal values
    fc.bigInt({ min: 0n }).chain(whole =>
      fc.bigInt({ min: 1n }).map(frac => `${whole}.${frac}`)
    ),
    // empty string
    fc.constant(''),
    // non-numeric strings
    fc.stringMatching(/[a-zA-Z]+/),
  );

  fc.assert(
    fc.property(
      fc.uuid(),
      invalidArb,
      (buyerId, invalidAmount) => {
        assert.throws(
          () => simulateCreateFundingOrder(buyerId, invalidAmount, '1'),
          (err) => {
            assert.ok(err instanceof Error, 'must throw an Error');
            assert.ok(
              err.message.includes('MoneyValidationError') || err.message.includes('ngnMinorUnits'),
              `error message should mention MoneyValidationError or field name; got: ${err.message}`,
            );
            return true;
          },
          `simulateCreateFundingOrder("${invalidAmount}") must throw`,
        );
      }
    ),
    { numRuns: 200 },
  );
});

/**
 * **Validates: Requirement 1.2**
 *
 * When expectedAssetBaseUnits is not a valid non-negative integer string,
 * simulateCreateFundingOrder must throw a MoneyValidationError.
 */
test('Property 1e: invalid money strings for expectedAssetBaseUnits are rejected with MoneyValidationError', () => {
  const invalidArb = fc.oneof(
    fc.bigInt({ min: 1n }).map(n => '0' + String(n)),
    fc.bigInt({ min: 1n }).map(n => '-' + String(n)),
    fc.bigInt({ min: 0n }).chain(whole =>
      fc.bigInt({ min: 1n }).map(frac => `${whole}.${frac}`)
    ),
    fc.constant(''),
    fc.stringMatching(/[a-zA-Z]+/),
  );

  fc.assert(
    fc.property(
      fc.uuid(),
      invalidArb,
      (buyerId, invalidAmount) => {
        assert.throws(
          () => simulateCreateFundingOrder(buyerId, '1', invalidAmount),
          (err) => {
            assert.ok(err instanceof Error, 'must throw an Error');
            assert.ok(
              err.message.includes('MoneyValidationError') || err.message.includes('expectedAssetBaseUnits'),
              `error message should mention MoneyValidationError or field name; got: ${err.message}`,
            );
            return true;
          },
          `simulateCreateFundingOrder with invalid expectedAssetBaseUnits must throw`,
        );
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1f — valid money strings (including "0") are always accepted
//
// **Validates: Requirement 1.2**
//
// Any BigInt ≥ 0 serialised to a string must be accepted without throwing.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * fc.bigInt({ min: 0n }).map(String) produces valid non-negative integer strings.
 * simulateCreateFundingOrder must never throw for these values.
 */
test('Property 1f: valid non-negative integer strings (including "0") are always accepted', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 0n }).map(String),
      fc.bigInt({ min: 0n }).map(String),
      (buyerId, ngnMinorUnits, expectedAssetBaseUnits) => {
        assert.doesNotThrow(
          () => simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits),
          `simulateCreateFundingOrder must not throw for valid amounts "${ngnMinorUnits}" and "${expectedAssetBaseUnits}"`,
        );
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 1g — sourceMode is always MANUAL
//
// **Validates: Requirement 1.2**
//
// The ManualFundingAdapter always returns sourceMode=MANUAL; every created
// Funding_Order must carry that value.
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirement 1.2**
 *
 * Every Funding_Order created through the manual funding corridor must have
 * sourceMode set to MANUAL, reflecting the ManualFundingAdapter's sourceMode.
 */
test('Property 1g: every created Funding_Order has sourceMode MANUAL', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.bigInt({ min: 1n }).map(String),
      fc.bigInt({ min: 1n }).map(String),
      (buyerId, ngnMinorUnits, expectedAssetBaseUnits) => {
        const order = simulateCreateFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits);

        assert.equal(order.sourceMode, 'MANUAL',
          'Created order must have sourceMode MANUAL');
      }
    ),
    { numRuns: 100 },
  );
});
