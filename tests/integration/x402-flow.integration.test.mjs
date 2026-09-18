/**
 * Integration-level model tests for the x402 payment flow.
 *
 * Validates: Requirements 5.3, 5.4, 5.6, 5.7
 *
 * Models the full x402 lifecycle — issue requirement → sign → execute →
 * CONFIRMED, duplicate settlement replay, and idempotency — in pure in-memory
 * JavaScript. No live database, network, or compiled TypeScript is required.
 *
 * The model mirrors the logic in purchase-service.ts, budget-service.ts,
 * and the AgentSigner signing flow.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory model — mirrors purchase-service.ts, budget-service.ts
// ---------------------------------------------------------------------------

class InsufficientBudgetError extends Error {
  constructor(available, requested) {
    super(`Insufficient budget: available ${available}, requested ${requested}`);
    this.name = 'InsufficientBudgetError';
  }
}

class X402FlowModel {
  constructor() {
    this.budgets      = new Map(); // buyerId → bigint
    this.purchases    = new Map(); // purchaseId → purchase
    this.settlements  = new Map(); // `${network}:${providerRef}` → settlement
    this.taskStatuses = new Map(); // taskId → status
    this.jobs         = [];
    this.auditEvents  = [];
    // Idempotency: buyerId:idempotencyKey → { requestHash, status, purchaseId }
    this.idempotency  = new Map();
  }

  // ---- budget helpers -------------------------------------------------------
  credit(buyerId, amount) {
    const current = this.budgets.get(buyerId) ?? 0n;
    this.budgets.set(buyerId, current + BigInt(amount));
  }

  debit(buyerId, amount, purchaseId) {
    const amt = BigInt(amount);
    const current = this.budgets.get(buyerId) ?? 0n;
    if (current < amt) throw new InsufficientBudgetError(current, amt);
    this.budgets.set(buyerId, current - amt);
    this.auditEvents.push({
      aggregateId: buyerId, event: 'BUDGET_DEBITED', actor: buyerId,
      sourceMode: 'MANUAL', metadata: { purchaseId, baseUnits: amount },
    });
  }

  restore(buyerId, amount, purchaseId) {
    const current = this.budgets.get(buyerId) ?? 0n;
    this.budgets.set(buyerId, current + BigInt(amount));
    this.auditEvents.push({
      aggregateId: buyerId, event: 'BUDGET_CREDIT_RESTORED', actor: buyerId,
      sourceMode: 'TESTNET', metadata: { purchaseId },
    });
  }

  getBalance(buyerId) { return this.budgets.get(buyerId) ?? 0n; }

  // ---- settlement helpers ---------------------------------------------------
  insertSettlement(settlement) {
    const key = `${settlement.network}:${settlement.providerReference}`;
    if (this.settlements.has(key)) return { inserted: false }; // ON CONFLICT DO NOTHING
    this.settlements.set(key, settlement);
    return { inserted: true };
  }

  countSettlements(network, providerReference) {
    return this.settlements.has(`${network}:${providerReference}`) ? 1 : 0;
  }

  // ---- x402 flow: issueRequirement -----------------------------------------
  // Validates: Requirement 5.3
  issueRequirement({ reservationId, buyerId, idempotencyKey, requestHash, terms }) {
    const ikey = `${buyerId}:${idempotencyKey}`;
    const existing = this.idempotency.get(ikey);
    if (existing) {
      if (existing.requestHash !== requestHash) return { status: 409, error: 'key reused with different request' };
      if (existing.purchaseStatus === 'CONFIRMED') return { status: 202, alreadyConfirmed: true };
    }
    // In real service: X402Port.issueRequirement — fails for UnsupportedStellarX402Adapter
    // In model: always returns a requirement
    const fiveMin = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const expiresAt = terms.expiresAt < fiveMin ? terms.expiresAt : fiveMin;
    return {
      status: 402,
      requirement: { ...terms, expiresAt },
      sourceMode: 'TESTNET',
    };
  }

  // ---- x402 flow: executePurchase -------------------------------------------
  // Validates: Requirements 5.4, 5.6
  executePurchase({
    buyerId, idempotencyKey, requestHash, terms, reservationId, taskId,
    x402Result, // simulated adapter result: 'CONFIRMED' | 'FAILED' | 'UNKNOWN'
    providerReference,
  }) {
    const ikey = `${buyerId}:${idempotencyKey}`;
    const existing = this.idempotency.get(ikey);
    if (existing) {
      if (existing.requestHash !== requestHash) return { status: 409, error: 'key reused' };
      if (existing.purchaseStatus === 'CONFIRMED') return { status: 202, alreadyConfirmed: true };
    }

    // Expiry check
    if (terms.expiresAt < new Date().toISOString()) {
      return { status: 402, error: 'requirement_expired' };
    }

    const purchaseId = randomUUID();

    // TX1: debit budget + create purchase (atomic)
    try {
      this.debit(buyerId, terms.amountBaseUnits, purchaseId);
    } catch (err) {
      if (err instanceof InsufficientBudgetError) return { status: 402, error: 'insufficient_budget' };
      throw err;
    }

    this.purchases.set(purchaseId, {
      id: purchaseId, reservationId, buyerId, idempotencyKey, requestHash,
      amountBaseUnits: BigInt(terms.amountBaseUnits),
      network: terms.network, assetId: terms.assetId,
      assetDecimals: terms.assetDecimals, recipient: terms.recipient,
      sourceMode: 'TESTNET', status: 'CREATED',
      debitedBaseUnits: BigInt(terms.amountBaseUnits),
      taskId,
    });

    // Mark VERIFYING
    this.purchases.get(purchaseId).status = 'VERIFYING';

    // Record idempotency key
    this.idempotency.set(ikey, { requestHash, purchaseStatus: 'VERIFYING', purchaseId });

    // Simulate X402Port.verifyAndSettle result
    if (x402Result === 'CONFIRMED') {
      const ref = providerReference ?? purchaseId;
      this.insertSettlement({
        purchaseId, providerReference: ref,
        network: terms.network, recipient: terms.recipient,
        observedBaseUnits: BigInt(terms.amountBaseUnits),
        status: 'CONFIRMED', confirmedAt: new Date(),
      });
      const purchase = this.purchases.get(purchaseId);
      purchase.status = 'CONFIRMED';
      this.idempotency.get(ikey).purchaseStatus = 'CONFIRMED';

      // Activate task if PAYMENT_PENDING
      if (taskId && this.taskStatuses.get(taskId) === 'PAYMENT_PENDING') {
        this.taskStatuses.set(taskId, 'IN_PROGRESS');
      }
      this.auditEvents.push(
        { aggregateId: purchaseId, event: 'PURCHASE_CONFIRMED', actor: buyerId, sourceMode: 'TESTNET', metadata: { purchaseId, providerReference: ref } },
        { aggregateId: purchaseId, event: 'SETTLEMENT_CREATED', actor: buyerId, sourceMode: 'TESTNET', metadata: { purchaseId, providerReference: ref } },
      );
      return { status: 202, purchase };
    }

    if (x402Result === 'UNKNOWN') {
      this.purchases.get(purchaseId).status = 'UNKNOWN';
      this.jobs.push({ kind: 'RECONCILE_PURCHASE', purchaseId, providerReference: providerReference ?? null, status: 'READY' });
      this.auditEvents.push({ aggregateId: purchaseId, event: 'PURCHASE_UNKNOWN', actor: buyerId, sourceMode: 'TESTNET', metadata: {} });
      return { status: 202, pending: true };
    }

    // FAILED
    this.purchases.get(purchaseId).status = 'FAILED';
    this.restore(buyerId, terms.amountBaseUnits, purchaseId);
    this.auditEvents.push({ aggregateId: purchaseId, event: 'PURCHASE_FAILED', actor: buyerId, sourceMode: 'TESTNET', metadata: {} });
    return { status: 402, reason: 'payment_failed' };
  }

  // ---- helpers ---------------------------------------------------------------
  auditEventsFor(aggregateId) { return this.auditEvents.filter(e => e.aggregateId === aggregateId); }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTerms(overrides = {}) {
  return {
    amountBaseUnits: '1000000',
    network: 'testnet',
    assetId: 'USDC:issuerXXX',
    assetDecimals: 7,
    recipient: 'GDEMO...',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function requestHash(body) {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

// ---------------------------------------------------------------------------
// Test 1: Full happy-path x402 flow
// Validates: Requirements 5.3, 5.4, 5.6
// ---------------------------------------------------------------------------

test('full x402 flow: issue → CONFIRMED → settlement created, task IN_PROGRESS, budget debited', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const taskId = randomUUID();
  const reservationId = randomUUID();
  const terms = makeTerms();
  const ikey = randomUUID();
  const hash = requestHash({ reservationId, ikey });
  const providerReference = randomUUID();

  // Seed budget
  model.credit(buyerId, terms.amountBaseUnits);
  const balanceBefore = model.getBalance(buyerId);

  // Seed task in PAYMENT_PENDING
  model.taskStatuses.set(taskId, 'PAYMENT_PENDING');

  // Issue 402 requirement — Validates: Requirement 5.3
  const req = model.issueRequirement({ reservationId, buyerId, idempotencyKey: ikey, requestHash: hash, terms });
  assert.equal(req.status, 402, 'issueRequirement must return 402 status');
  assert.ok(req.requirement, 'requirement must be present');
  assert.ok(req.requirement.expiresAt <= new Date(Date.now() + 5 * 60 * 1000 + 100).toISOString(),
    'expiresAt must be clamped to 5 minutes from now');

  // Execute purchase — Validates: Requirements 5.4, 5.6
  const result = model.executePurchase({
    buyerId, idempotencyKey: ikey, requestHash: hash, terms,
    reservationId, taskId, x402Result: 'CONFIRMED', providerReference,
  });

  assert.equal(result.status, 202, 'executePurchase CONFIRMED must return 202');
  assert.ok(result.purchase, 'purchase must be returned');

  // Budget debited by exact amount
  const balanceAfter = model.getBalance(buyerId);
  assert.equal(balanceBefore - balanceAfter, BigInt(terms.amountBaseUnits),
    'Budget must be debited by exact purchase amount');
  assert.equal(balanceAfter, 0n, 'Balance must be zero after full debit');

  // Settlement written once
  assert.equal(model.countSettlements(terms.network, providerReference), 1,
    'Settlement must be written exactly once');

  // Task activated
  assert.equal(model.taskStatuses.get(taskId), 'IN_PROGRESS',
    'Task must transition to IN_PROGRESS after purchase CONFIRMED');

  // Purchase status
  const purchase = model.purchases.values().next().value;
  assert.equal(purchase.status, 'CONFIRMED');

  // Audit events
  const events = model.auditEventsFor(purchase.id).map(e => e.event);
  assert.ok(events.includes('PURCHASE_CONFIRMED'), 'PURCHASE_CONFIRMED audit event');
  assert.ok(events.includes('SETTLEMENT_CREATED'), 'SETTLEMENT_CREATED audit event');
});

// ---------------------------------------------------------------------------
// Test 2: Duplicate settlement replay — count stays 1
// Validates: Requirement 5.7
// ---------------------------------------------------------------------------

test('duplicate settlement replay: same providerReference → settlement count = 1, purchase stays CONFIRMED', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms();
  const providerReference = randomUUID();

  model.credit(buyerId, terms.amountBaseUnits);

  // First execution — CONFIRMED
  const r1 = model.executePurchase({
    buyerId, idempotencyKey: randomUUID(), requestHash: 'hash1', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED', providerReference,
  });
  assert.equal(r1.status, 202);
  assert.equal(model.countSettlements(terms.network, providerReference), 1);

  // Simulate replay: insert same settlement again → ON CONFLICT DO NOTHING
  const { inserted } = model.insertSettlement({
    purchaseId: randomUUID(), providerReference,
    network: terms.network, recipient: terms.recipient,
    observedBaseUnits: BigInt(terms.amountBaseUnits),
    status: 'CONFIRMED', confirmedAt: new Date(),
  });
  assert.equal(inserted, false, 'Duplicate settlement insert must be a no-op');
  assert.equal(model.countSettlements(terms.network, providerReference), 1,
    'Settlement count must remain 1 after replay');
});

// ---------------------------------------------------------------------------
// Test 3: Idempotency — CONFIRMED purchase with same key returns 202, no new debit
// Validates: Requirement 5.8
// ---------------------------------------------------------------------------

test('idempotency: CONFIRMED purchase retried with same key → 202 alreadyConfirmed, no new debit', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms();
  const ikey = randomUUID();
  const hash = requestHash({ ikey });

  model.credit(buyerId, String(BigInt(terms.amountBaseUnits) * 10n));

  // First call — CONFIRMED
  model.executePurchase({
    buyerId, idempotencyKey: ikey, requestHash: hash, terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: randomUUID(),
  });

  const balanceAfterFirst = model.getBalance(buyerId);
  const debitEventsBefore = model.auditEvents.filter(e => e.event === 'BUDGET_DEBITED').length;

  // Retry with same key + same hash
  const retry = model.executePurchase({
    buyerId, idempotencyKey: ikey, requestHash: hash, terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: randomUUID(),
  });

  assert.equal(retry.status, 202, 'Retry must return 202');
  assert.equal(retry.alreadyConfirmed, true, 'alreadyConfirmed flag must be set');

  // Balance unchanged — no second debit
  assert.equal(model.getBalance(buyerId), balanceAfterFirst, 'Balance must not change on retry');

  const debitEventsAfter = model.auditEvents.filter(e => e.event === 'BUDGET_DEBITED').length;
  assert.equal(debitEventsAfter, debitEventsBefore, 'No new BUDGET_DEBITED event on retry');
});

// ---------------------------------------------------------------------------
// Test 4: Same idempotency key + different request hash → 409
// Validates: Requirement 5.8
// ---------------------------------------------------------------------------

test('same idempotency key with different request hash → 409', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms();
  const ikey = randomUUID();

  model.credit(buyerId, String(BigInt(terms.amountBaseUnits) * 10n));

  // First call
  model.executePurchase({
    buyerId, idempotencyKey: ikey, requestHash: 'hash-A', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: randomUUID(),
  });

  // Retry with same key but different hash
  const r = model.executePurchase({
    buyerId, idempotencyKey: ikey, requestHash: 'hash-B', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: randomUUID(),
  });

  assert.equal(r.status, 409, 'Conflicting idempotency key must return 409');
});

// ---------------------------------------------------------------------------
// Test 5: FAILED purchase restores budget
// ---------------------------------------------------------------------------

test('FAILED purchase restores budget to pre-debit balance', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms();
  const initialBalance = BigInt(terms.amountBaseUnits) * 5n;

  model.credit(buyerId, String(initialBalance));

  const r = model.executePurchase({
    buyerId, idempotencyKey: randomUUID(), requestHash: 'h', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'FAILED',
    providerReference: null,
  });

  assert.equal(r.status, 402, 'FAILED result must return 402');
  assert.equal(model.getBalance(buyerId), initialBalance,
    'Budget must be restored to pre-debit balance on failure');

  const restoreEvent = model.auditEvents.find(e => e.event === 'BUDGET_CREDIT_RESTORED');
  assert.ok(restoreEvent, 'BUDGET_CREDIT_RESTORED audit event must be written');
});

// ---------------------------------------------------------------------------
// Test 6: UNKNOWN result — purchase in UNKNOWN, job queued
// ---------------------------------------------------------------------------

test('UNKNOWN result: purchase stays UNKNOWN, RECONCILE_PURCHASE job queued', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms();
  const providerReference = randomUUID();

  model.credit(buyerId, terms.amountBaseUnits);

  const r = model.executePurchase({
    buyerId, idempotencyKey: randomUUID(), requestHash: 'h', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'UNKNOWN', providerReference,
  });

  assert.equal(r.status, 202, 'UNKNOWN result must return 202');
  assert.equal(r.pending, true, 'pending flag must be set');

  // Purchase is UNKNOWN
  const purchase = [...model.purchases.values()][0];
  assert.equal(purchase.status, 'UNKNOWN');

  // Job queued
  assert.equal(model.jobs.length, 1, 'Exactly one reconciliation job must be queued');
  assert.equal(model.jobs[0].kind, 'RECONCILE_PURCHASE');
  assert.equal(model.jobs[0].providerReference, providerReference);

  // Budget still debited (not yet restored — that happens in reconciliation)
  assert.equal(model.getBalance(buyerId), 0n, 'Budget debited while pending reconciliation');
});

// ---------------------------------------------------------------------------
// Test 7: Insufficient budget returns 402
// ---------------------------------------------------------------------------

test('purchase with insufficient budget returns 402, budget unchanged', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms({ amountBaseUnits: '1000000' });

  // Credit less than the purchase amount
  model.credit(buyerId, '500000');
  const balanceBefore = model.getBalance(buyerId);

  const r = model.executePurchase({
    buyerId, idempotencyKey: randomUUID(), requestHash: 'h', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: null,
  });

  assert.equal(r.status, 402);
  assert.equal(r.error, 'insufficient_budget');
  assert.equal(model.getBalance(buyerId), balanceBefore,
    'Budget must be unchanged after failed debit attempt');
  assert.equal(model.purchases.size, 0, 'No purchase row created on insufficient budget');
});

// ---------------------------------------------------------------------------
// Test 8: Expired requirement returns 402
// ---------------------------------------------------------------------------

test('expired payment requirement returns 402 without debiting budget', () => {
  const model = new X402FlowModel();
  const buyerId = randomUUID();
  const terms = makeTerms({ expiresAt: new Date(Date.now() - 1000).toISOString() });

  model.credit(buyerId, terms.amountBaseUnits);
  const balanceBefore = model.getBalance(buyerId);

  const r = model.executePurchase({
    buyerId, idempotencyKey: randomUUID(), requestHash: 'h', terms,
    reservationId: randomUUID(), taskId: null, x402Result: 'CONFIRMED',
    providerReference: null,
  });

  assert.equal(r.status, 402);
  assert.equal(r.error, 'requirement_expired');
  assert.equal(model.getBalance(buyerId), balanceBefore, 'Budget unchanged on expired requirement');
});

// ---------------------------------------------------------------------------
// Test 9: Task is NOT activated when result is not CONFIRMED
// ---------------------------------------------------------------------------

test('task stays PAYMENT_PENDING when purchase result is FAILED or UNKNOWN', () => {
  for (const x402Result of ['FAILED', 'UNKNOWN']) {
    const model = new X402FlowModel();
    const buyerId = randomUUID();
    const taskId = randomUUID();
    const terms = makeTerms();

    model.credit(buyerId, String(BigInt(terms.amountBaseUnits) * 2n));
    model.taskStatuses.set(taskId, 'PAYMENT_PENDING');

    model.executePurchase({
      buyerId, idempotencyKey: randomUUID(), requestHash: 'h', terms,
      reservationId: randomUUID(), taskId, x402Result,
      providerReference: randomUUID(),
    });

    assert.equal(model.taskStatuses.get(taskId), 'PAYMENT_PENDING',
      `Task must stay PAYMENT_PENDING when result is ${x402Result}`);
  }
});
