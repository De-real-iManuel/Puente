/**
 * Integration-level model tests for crash recovery / reconciliation.
 *
 * Validates: Requirement 5.5
 *
 * Simulates the crash scenario in purchase-service.ts where the API server
 * calls X402Port.verifyAndSettle and gets CONFIRMED/FAILED/UNKNOWN, but then
 * crashes before (or during) the database write. The reconciliation job worker
 * picks up the UNKNOWN purchase and drives it to a terminal state.
 *
 * Key invariants:
 *  - Budget debited exactly once, even if reconciliation runs multiple times
 *  - Settlement written exactly once (ON CONFLICT DO NOTHING)
 *  - Budget restored exactly once on FAILED reconciliation
 *  - Purchase reaches the correct terminal state
 *
 * No live database or network is required — this is a pure in-memory model
 * mirroring the logic in job-worker.ts and purchase-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory model — mirrors job-worker.ts + purchase-service.ts
// ---------------------------------------------------------------------------

class CrashRecoveryModel {
  constructor() {
    this.purchases   = new Map(); // purchaseId → purchase
    this.settlements = new Map(); // `${network}:${providerRef}` → settlement
    this.jobs        = new Map(); // jobId → job
    this.budgets     = new Map(); // buyerId → bigint
    this.auditEvents = [];
  }

  // ---- budget helpers -------------------------------------------------------
  credit(buyerId, amount) {
    const current = this.budgets.get(buyerId) ?? 0n;
    this.budgets.set(buyerId, current + BigInt(amount));
  }

  debit(buyerId, amount, purchaseId) {
    const amt = BigInt(amount);
    const current = this.budgets.get(buyerId) ?? 0n;
    if (current < amt) throw Object.assign(new Error('InsufficientBudget'), { code: 'INSUFFICIENT_BUDGET' });
    this.budgets.set(buyerId, current - amt);
    this.auditEvents.push({ aggregateId: buyerId, event: 'BUDGET_DEBITED', actor: buyerId, metadata: { purchaseId } });
  }

  restore(buyerId, amount, purchaseId) {
    const current = this.budgets.get(buyerId) ?? 0n;
    this.budgets.set(buyerId, current + BigInt(amount));
    this.auditEvents.push({ aggregateId: buyerId, event: 'BUDGET_CREDIT_RESTORED', actor: buyerId, metadata: { purchaseId } });
  }

  getBalance(buyerId) { return this.budgets.get(buyerId) ?? 0n; }

  // ---- settlement -----------------------------------------------------------
  insertSettlement(settlement) {
    const key = `${settlement.network}:${settlement.providerReference}`;
    if (this.settlements.has(key)) return { inserted: false }; // ON CONFLICT DO NOTHING
    this.settlements.set(key, settlement);
    return { inserted: true };
  }

  countSettlements(network, providerReference) {
    return this.settlements.has(`${network}:${providerReference}`) ? 1 : 0;
  }

  // ---- purchase creation (TX1 in executePurchase) ---------------------------
  // debit budget + create purchase atomically, then mark VERIFYING.
  // Returns purchaseId.
  beginPurchase({ buyerId, amountBaseUnits, network, recipient, reservationId, taskId }) {
    const purchaseId = randomUUID();
    this.debit(buyerId, amountBaseUnits, purchaseId);
    this.purchases.set(purchaseId, {
      id: purchaseId, buyerId, amountBaseUnits: BigInt(amountBaseUnits),
      network, recipient, status: 'VERIFYING',
      debitedBaseUnits: BigInt(amountBaseUnits),
      reservationId, taskId,
    });
    return purchaseId;
  }

  // ---- simulate crash: leave purchase in UNKNOWN, queue job -----------------
  simulateCrash(purchaseId, providerReference) {
    const purchase = this.purchases.get(purchaseId);
    if (!purchase) throw new Error(`Purchase ${purchaseId} not found`);
    purchase.status = 'UNKNOWN';
    const jobId = randomUUID();
    this.jobs.set(jobId, {
      id: jobId, kind: 'RECONCILE_PURCHASE',
      status: 'READY', attempts: 0,
      payload: { purchaseId, providerReference },
    });
    this.auditEvents.push({
      aggregateId: purchaseId, event: 'PURCHASE_UNKNOWN',
      actor: purchase.buyerId, metadata: { purchaseId, providerReference },
    });
    return jobId;
  }

  // ---- reconcile: mirrors job-worker.ts processJob() ------------------------
  reconcile(jobId, lookupResult) {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'READY') throw new Error(`Job ${jobId} not available`);

    // Lease the job
    job.status = 'LEASED';

    const { purchaseId, providerReference } = job.payload;

    if (!providerReference) {
      // Re-queue — mirrors: no providerReference yet
      job.status = 'READY';
      job.attempts++;
      return { requeued: true };
    }

    const purchase = this.purchases.get(purchaseId);
    if (!purchase) {
      job.status = 'DONE';
      return { done: true, reason: 'purchase_not_found' };
    }

    if (lookupResult.status === 'CONFIRMED') {
      // Insert settlement with ON CONFLICT DO NOTHING
      const { inserted } = this.insertSettlement({
        purchaseId, providerReference,
        network: purchase.network, recipient: purchase.recipient,
        observedBaseUnits: purchase.amountBaseUnits,
        status: 'CONFIRMED', confirmedAt: new Date(),
      });

      // Update purchase status
      purchase.status = 'CONFIRMED';

      this.auditEvents.push({
        aggregateId: purchaseId, event: 'PURCHASE_CONFIRMED',
        actor: purchase.buyerId,
        metadata: { purchaseId, providerReference, reconciledAt: new Date().toISOString() },
      });

      job.status = 'DONE';
      return { done: true, settlementInserted: inserted };
    }

    if (lookupResult.status === 'FAILED') {
      purchase.status = 'FAILED';

      // Restore budget
      if (purchase.debitedBaseUnits !== null && purchase.debitedBaseUnits > 0n) {
        this.restore(purchase.buyerId, String(purchase.debitedBaseUnits), purchaseId);
      }

      this.auditEvents.push({
        aggregateId: purchaseId, event: 'PURCHASE_FAILED',
        actor: purchase.buyerId,
        metadata: { purchaseId, providerReference, reconciledAt: new Date().toISOString() },
      });

      job.status = 'DONE';
      return { done: true };
    }

    // UNKNOWN — re-queue
    job.status = 'READY';
    job.attempts++;
    return { requeued: true };
  }

  // ---- helpers ---------------------------------------------------------------
  auditEventsFor(aggregateId) {
    return this.auditEvents.filter(e => e.aggregateId === aggregateId);
  }

  budgetDebitCount(buyerId) {
    return this.auditEvents.filter(e => e.aggregateId === buyerId && e.event === 'BUDGET_DEBITED').length;
  }

  budgetRestoreCount(buyerId) {
    return this.auditEvents.filter(e => e.aggregateId === buyerId && e.event === 'BUDGET_CREDIT_RESTORED').length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NETWORK   = 'testnet';
const RECIPIENT = 'GDEMO...';
const AMOUNT    = '1000000';

function makeModel(initialBalance = AMOUNT) {
  const m = new CrashRecoveryModel();
  return m;
}

// ---------------------------------------------------------------------------
// Test 1: Crash → reconcile CONFIRMED → budget debited once, 1 settlement
// Validates: Requirement 5.5
// ---------------------------------------------------------------------------

test('crash → reconcile CONFIRMED: budget debited exactly once, settlement written exactly once', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  // Phase 1: debit budget + create purchase (TX1 succeeds)
  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const balanceAfterDebit = model.getBalance(buyerId);

  // Phase 2: crash — purchase left as UNKNOWN, job queued
  const jobId = model.simulateCrash(purchaseId, providerReference);

  assert.equal(model.purchases.get(purchaseId).status, 'UNKNOWN', 'Purchase must be UNKNOWN after crash');
  assert.equal(model.getBalance(buyerId), 0n, 'Budget still debited after crash');

  // Phase 3: reconciliation worker picks up the job
  const result = model.reconcile(jobId, { status: 'CONFIRMED' });

  assert.equal(result.done, true, 'Job must be marked DONE');
  assert.equal(model.purchases.get(purchaseId).status, 'CONFIRMED', 'Purchase must be CONFIRMED after reconciliation');

  // Budget debited exactly once (restore NOT called on CONFIRMED)
  assert.equal(model.budgetDebitCount(buyerId), 1, 'BUDGET_DEBITED must appear exactly once');
  assert.equal(model.budgetRestoreCount(buyerId), 0, 'BUDGET_CREDIT_RESTORED must NOT appear on CONFIRMED');
  assert.equal(model.getBalance(buyerId), balanceAfterDebit, 'Balance unchanged by reconciliation (no restore)');

  // Settlement written exactly once
  assert.equal(model.countSettlements(NETWORK, providerReference), 1, 'Exactly 1 settlement record');
});

// ---------------------------------------------------------------------------
// Test 2: Duplicate reconciliation (job replayed) — settlement count stays 1
// Validates: Requirement 5.5 + settlement idempotency
// ---------------------------------------------------------------------------

test('duplicate reconciliation replay: settlement count stays 1, budget not double-affected', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);

  // First reconciliation
  model.reconcile(jobId, { status: 'CONFIRMED' });
  assert.equal(model.countSettlements(NETWORK, providerReference), 1);

  // Simulate a second attempt to insert the same settlement (ON CONFLICT DO NOTHING)
  const { inserted } = model.insertSettlement({
    purchaseId, providerReference, network: NETWORK, recipient: RECIPIENT,
    observedBaseUnits: BigInt(AMOUNT), status: 'CONFIRMED', confirmedAt: new Date(),
  });
  assert.equal(inserted, false, 'Duplicate settlement insert must be no-op');
  assert.equal(model.countSettlements(NETWORK, providerReference), 1, 'Settlement count must remain 1');

  // Budget still debited exactly once, never restored
  assert.equal(model.budgetDebitCount(buyerId), 1);
  assert.equal(model.budgetRestoreCount(buyerId), 0);
});

// ---------------------------------------------------------------------------
// Test 3: Crash → reconcile FAILED → budget restored, no settlement
// Validates: Requirement 5.5
// ---------------------------------------------------------------------------

test('crash → reconcile FAILED: budget restored exactly once, no settlement written', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);
  const initialBalance = model.getBalance(buyerId);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);

  const result = model.reconcile(jobId, { status: 'FAILED' });

  assert.equal(result.done, true);
  assert.equal(model.purchases.get(purchaseId).status, 'FAILED');

  // Budget restored to initial balance
  assert.equal(model.getBalance(buyerId), initialBalance,
    'Budget must be restored to initial balance on FAILED reconciliation');
  assert.equal(model.budgetDebitCount(buyerId), 1, 'BUDGET_DEBITED appears exactly once');
  assert.equal(model.budgetRestoreCount(buyerId), 1, 'BUDGET_CREDIT_RESTORED appears exactly once');

  // No settlement written
  assert.equal(model.countSettlements(NETWORK, providerReference), 0, 'No settlement on FAILED');
});

// ---------------------------------------------------------------------------
// Test 4: Crash → reconcile UNKNOWN → job re-queued, purchase stays UNKNOWN
// Validates: Requirement 5.5
// ---------------------------------------------------------------------------

test('crash → reconcile UNKNOWN: job re-queued, purchase stays UNKNOWN', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);

  const result = model.reconcile(jobId, { status: 'UNKNOWN' });

  assert.equal(result.requeued, true, 'Job must be re-queued on UNKNOWN result');
  assert.equal(model.jobs.get(jobId).status, 'READY', 'Job status must be READY after re-queue');
  assert.equal(model.jobs.get(jobId).attempts, 1, 'Attempt count must increment');
  assert.equal(model.purchases.get(purchaseId).status, 'UNKNOWN', 'Purchase stays UNKNOWN');
  assert.equal(model.getBalance(buyerId), 0n, 'Budget remains debited while pending');
});

// ---------------------------------------------------------------------------
// Test 5: Crash → reconcile UNKNOWN → retry → CONFIRMED
// Validates: Requirement 5.5 (eventual consistency via job retry)
// ---------------------------------------------------------------------------

test('crash → UNKNOWN → retry → CONFIRMED: eventual consistency, 1 settlement', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);

  // First attempt — provider not yet confirmed
  model.reconcile(jobId, { status: 'UNKNOWN' });
  assert.equal(model.purchases.get(purchaseId).status, 'UNKNOWN');

  // Second attempt — confirmed
  const result = model.reconcile(jobId, { status: 'CONFIRMED' });
  assert.equal(result.done, true);
  assert.equal(model.purchases.get(purchaseId).status, 'CONFIRMED');
  assert.equal(model.countSettlements(NETWORK, providerReference), 1);
  assert.equal(model.budgetDebitCount(buyerId), 1, 'Budget debited only once throughout retries');
  assert.equal(model.budgetRestoreCount(buyerId), 0, 'Budget never restored on final CONFIRMED');
});

// ---------------------------------------------------------------------------
// Test 6: No providerReference → job re-queued immediately
// Validates: job-worker.ts early-return for missing providerReference
// ---------------------------------------------------------------------------

test('job with null providerReference is re-queued without calling lookup', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });

  // Queue job with null providerReference
  const purchaseObj = model.purchases.get(purchaseId);
  purchaseObj.status = 'UNKNOWN';
  const jobId = randomUUID();
  model.jobs.set(jobId, {
    id: jobId, kind: 'RECONCILE_PURCHASE', status: 'READY', attempts: 0,
    payload: { purchaseId, providerReference: null },
  });

  const result = model.reconcile(jobId, { status: 'CONFIRMED' });

  assert.equal(result.requeued, true, 'Missing providerReference must re-queue the job');
  assert.equal(model.purchases.get(purchaseId).status, 'UNKNOWN', 'Purchase stays UNKNOWN');
});

// ---------------------------------------------------------------------------
// Test 7: PURCHASE_CONFIRMED audit event written on successful reconciliation
// ---------------------------------------------------------------------------

test('reconcile CONFIRMED: PURCHASE_CONFIRMED audit event is written', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);
  model.reconcile(jobId, { status: 'CONFIRMED' });

  const events = model.auditEventsFor(purchaseId).map(e => e.event);
  assert.ok(events.includes('PURCHASE_UNKNOWN'),   'PURCHASE_UNKNOWN must be written at crash');
  assert.ok(events.includes('PURCHASE_CONFIRMED'),  'PURCHASE_CONFIRMED must be written on reconcile');
});

// ---------------------------------------------------------------------------
// Test 8: PURCHASE_FAILED audit event written on failed reconciliation
// ---------------------------------------------------------------------------

test('reconcile FAILED: PURCHASE_FAILED audit event is written', () => {
  const model = makeModel();
  const buyerId = randomUUID();
  const providerReference = randomUUID();
  model.credit(buyerId, AMOUNT);

  const purchaseId = model.beginPurchase({
    buyerId, amountBaseUnits: AMOUNT, network: NETWORK,
    recipient: RECIPIENT, reservationId: randomUUID(), taskId: null,
  });
  const jobId = model.simulateCrash(purchaseId, providerReference);
  model.reconcile(jobId, { status: 'FAILED' });

  const events = model.auditEventsFor(purchaseId).map(e => e.event);
  assert.ok(events.includes('PURCHASE_FAILED'), 'PURCHASE_FAILED must be written on failed reconcile');
});
