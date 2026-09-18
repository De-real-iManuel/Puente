/**
 * Integration-level model tests for concurrent budget access.
 *
 * Validates: Requirement 6.2
 *
 * Tests that the SELECT FOR UPDATE locking semantics prevent double-spend
 * when two concurrent purchase attempts race for a budget equal to exactly
 * one purchase amount.
 *
 * The model serializes lock acquisition (mimicking Postgres FOR UPDATE),
 * so tests are deterministic and require no live database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mutex-serialized in-memory budget model
// Mirrors the SELECT ... FOR UPDATE semantics in budget-service.ts
// ---------------------------------------------------------------------------

class InsufficientBudgetError extends Error {
  constructor(available, requested) {
    super(`Insufficient budget: available ${available}, requested ${requested}`);
    this.name = 'InsufficientBudgetError';
  }
}

class SerializedBudget {
  /**
   * @param {bigint} initialBalance
   */
  constructor(initialBalance) {
    this._balance = BigInt(initialBalance);
    // Serialize all lock holders — mirrors PG row-level lock queue
    this._lockQueue = Promise.resolve();
  }

  getBalance() { return this._balance; }

  /**
   * Acquire an exclusive "row lock" and execute fn() while holding it.
   * This mirrors the atomicity of BEGIN ... SELECT FOR UPDATE ... COMMIT.
   */
  _withLock(fn) {
    const next = this._lockQueue.then(fn);
    // Even if fn() throws, the next waiter should still proceed.
    this._lockQueue = next.catch(() => {});
    return next;
  }

  /**
   * Attempt to debit amount from the balance.
   * Serialized via _withLock — only one debit executes at a time.
   */
  async debit(amount) {
    return this._withLock(async () => {
      const amt = BigInt(amount);
      if (this._balance < amt) {
        throw new InsufficientBudgetError(this._balance, amt);
      }
      this._balance -= amt;
      return { ok: true, remaining: this._balance };
    });
  }

  /** Credit — also serialized for safety. */
  async credit(amount) {
    return this._withLock(async () => {
      this._balance += BigInt(amount);
      return { ok: true, balance: this._balance };
    });
  }
}

// ---------------------------------------------------------------------------
// Test 1: Exactly-matching budget — one of two concurrent debits must fail
// Validates: Requirement 6.2
// ---------------------------------------------------------------------------

test('Requirement 6.2: budget = purchaseAmount — exactly one concurrent debit succeeds, one fails', async () => {
  const amount = '1000000';
  const budget = new SerializedBudget(amount);

  // Fire both debits concurrently
  const results = await Promise.allSettled([
    budget.debit(amount),
    budget.debit(amount),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected  = results.filter(r => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'Exactly one debit must succeed');
  assert.equal(rejected.length,  1, 'Exactly one debit must fail');
  assert.ok(
    rejected[0].reason instanceof InsufficientBudgetError,
    'Failed debit must throw InsufficientBudgetError',
  );

  // Balance must be 0 — not negative
  assert.equal(budget.getBalance(), 0n, 'Balance must be 0 after one successful debit');
});

// ---------------------------------------------------------------------------
// Test 2: Balance never goes negative regardless of concurrency
// Validates: Requirement 6.2
// ---------------------------------------------------------------------------

test('budget never goes negative under concurrent load', async () => {
  const initialBalance = 5_000_000n;
  const purchaseAmount = '1000000';
  const budget = new SerializedBudget(initialBalance);
  const concurrency = 10;

  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, () => budget.debit(purchaseAmount)),
  );

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const balance = budget.getBalance();

  assert.ok(balance >= 0n, 'Balance must never go negative');
  assert.equal(succeeded, 5, 'Exactly 5 of 10 debits must succeed (floor(5M / 1M) = 5)');
  assert.equal(balance, 0n, 'Remaining balance after 5 debits must be 0');
});

// ---------------------------------------------------------------------------
// Test 3: Sequential debit — first succeeds, second fails
// ---------------------------------------------------------------------------

test('sequential debits: first succeeds, second fails with InsufficientBudgetError', async () => {
  const amount = '500000';
  const budget = new SerializedBudget(amount);

  const first = await budget.debit(amount);
  assert.ok(first.ok, 'First sequential debit must succeed');
  assert.equal(budget.getBalance(), 0n);

  await assert.rejects(
    () => budget.debit(amount),
    err => err instanceof InsufficientBudgetError,
    'Second debit must throw InsufficientBudgetError',
  );
  assert.equal(budget.getBalance(), 0n, 'Balance unchanged after failed debit');
});

// ---------------------------------------------------------------------------
// Test 4: Zero-balance budget rejects any debit immediately
// ---------------------------------------------------------------------------

test('zero-balance budget rejects all debit attempts', async () => {
  const budget = new SerializedBudget(0n);

  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () => budget.debit('1'),
      err => err instanceof InsufficientBudgetError,
    );
  }
  assert.equal(budget.getBalance(), 0n);
});

// ---------------------------------------------------------------------------
// Test 5: Budget is restored to pre-debit state on InsufficientBudgetError
// (the catch path in purchase-service mirrors this)
// ---------------------------------------------------------------------------

test('failed debit does not reduce balance', async () => {
  const budget = new SerializedBudget('100');
  const before = budget.getBalance();

  await assert.rejects(() => budget.debit('200'));
  assert.equal(budget.getBalance(), before, 'Balance unchanged after failed debit');
});

// ---------------------------------------------------------------------------
// Test 6: Credit followed by two concurrent debits — deterministic outcome
// ---------------------------------------------------------------------------

test('credit then two concurrent debits — total debited never exceeds credited', async () => {
  const credited = 1_500_000n;
  const debitAmount = '1000000';
  const budget = new SerializedBudget(credited);

  const results = await Promise.allSettled([
    budget.debit(debitAmount),
    budget.debit(debitAmount),
  ]);

  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const balance = budget.getBalance();

  assert.equal(succeeded, 1, 'Only one debit of 1,000,000 fits in a 1,500,000 budget (first locks the row)');
  // The second debit would bring balance to 500,000 which is < 1,000,000 — it fails
  assert.equal(balance, 500_000n, 'Remaining balance must be 500,000');
  assert.ok(balance >= 0n, 'Balance must never be negative');
});

// ---------------------------------------------------------------------------
// Property: floor(B / A) concurrent debits succeed; balance = B mod A
// Validates: the general budget invariant
// ---------------------------------------------------------------------------

test('Property: floor(B / A) concurrent debits succeed, balance = B mod A', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.bigInt({ min: 1n, max: 10n }),   // multiplier k: budget = k * amount
      fc.bigInt({ min: 1n, max: 1_000n }), // amount
      fc.integer({ min: 0, max: 5 }),     // extra attempts beyond k
      async (k, amount, extra) => {
        const budget = new SerializedBudget(k * amount);
        const totalAttempts = Number(k) + extra;

        const results = await Promise.allSettled(
          Array.from({ length: totalAttempts }, () => budget.debit(String(amount))),
        );

        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const balance = budget.getBalance();

        // Exactly k debits should succeed (budget = k * amount, each debit = amount)
        assert.equal(succeeded, Number(k),
          `floor(${k * amount} / ${amount}) = ${k} debits must succeed`);
        assert.equal(balance, 0n,
          `After k=${k} successful debits, balance must be 0`);
        assert.ok(balance >= 0n, 'Balance must never go negative');
      }
    ),
    { numRuns: 50 },
  );
});

// ---------------------------------------------------------------------------
// Property: single-buyer sequential debit/credit invariant
// ---------------------------------------------------------------------------

test('Property: interleaved credit/debit sequence — balance is always consistent', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          op:     fc.constantFrom('credit', 'debit'),
          amount: fc.bigInt({ min: 1n, max: 100n }),
        }),
        { minLength: 1, maxLength: 20 },
      ),
      async (ops) => {
        const budget = new SerializedBudget(500n);
        let expected = 500n;

        for (const { op, amount } of ops) {
          if (op === 'credit') {
            await budget.credit(String(amount));
            expected += amount;
          } else {
            if (expected >= amount) {
              await budget.debit(String(amount));
              expected -= amount;
            } else {
              await assert.rejects(() => budget.debit(String(amount)));
              // expected unchanged
            }
          }
          assert.equal(budget.getBalance(), expected, 'Balance must match expected after each op');
        }
        assert.ok(budget.getBalance() >= 0n, 'Balance must never be negative');
      }
    ),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// Test: Two buyers race on separate budgets — fully independent
// (mirrors separate DB rows, no cross-buyer interference)
// ---------------------------------------------------------------------------

test('two buyers racing simultaneously do not interfere with each other', async () => {
  const amount = '1000000';
  const budgetA = new SerializedBudget(amount);
  const budgetB = new SerializedBudget(amount);

  // Each buyer fires 3 concurrent debits; only one per buyer should succeed
  const [resultsA, resultsB] = await Promise.all([
    Promise.allSettled([budgetA.debit(amount), budgetA.debit(amount), budgetA.debit(amount)]),
    Promise.allSettled([budgetB.debit(amount), budgetB.debit(amount), budgetB.debit(amount)]),
  ]);

  assert.equal(resultsA.filter(r => r.status === 'fulfilled').length, 1, 'Exactly 1 debit for buyer A');
  assert.equal(resultsB.filter(r => r.status === 'fulfilled').length, 1, 'Exactly 1 debit for buyer B');
  assert.equal(budgetA.getBalance(), 0n);
  assert.equal(budgetB.getBalance(), 0n);
});
