/**
 * Integration-level model tests for the Nigerian Funding Corridor.
 *
 * Validates: Requirement 6.1
 *
 * Tests the full create → confirm → release → asset-confirmed state machine,
 * budget credit, and audit trail in a pure in-memory model that mirrors the
 * service-layer logic in funding-service.ts and budget-service.ts.
 *
 * No live database or network is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// In-memory model — mirrors funding-service.ts + budget-service.ts
// ---------------------------------------------------------------------------

const MONEY_RE = /^(0|[1-9]\d*)$/;
function assertMoneyString(value, field) {
  if (typeof value !== 'string' || !MONEY_RE.test(value)) {
    const err = new Error(`Invalid money string for ${field}: "${value}"`);
    err.field = field;
    err.name = 'MoneyValidationError';
    throw err;
  }
}

class InMemoryFundingStore {
  constructor() {
    this.orders      = new Map(); // id → order
    this.budgets     = new Map(); // buyerId → bigint
    this.auditEvents = [];        // { aggregateId, event, actor, sourceMode, metadata }
  }

  // ---- budget-service.credit ------------------------------------------------
  credit(buyerId, baseUnits, fundingOrderId) {
    const amount = BigInt(baseUnits);
    const current = this.budgets.get(buyerId) ?? 0n;
    this.budgets.set(buyerId, current + amount);
    this.auditEvents.push({
      aggregateId: buyerId,
      event: 'BUDGET_CREDITED',
      actor: buyerId,
      sourceMode: 'MANUAL',
      metadata: { fundingOrderId, direction: 'credit', baseUnits },
    });
  }

  getBalance(buyerId) {
    return this.budgets.get(buyerId) ?? 0n;
  }

  // ---- funding-service.createFundingOrder ------------------------------------
  createFundingOrder(buyerId, ngnMinorUnits, expectedAssetBaseUnits) {
    assertMoneyString(ngnMinorUnits, 'ngnMinorUnits');
    assertMoneyString(expectedAssetBaseUnits, 'expectedAssetBaseUnits');

    const now = new Date();
    const order = {
      id: randomUUID(),
      buyerId,
      ngnMinorUnits: BigInt(ngnMinorUnits),
      expectedAssetUnits: BigInt(expectedAssetBaseUnits),
      rate: '1',
      feeMinorUnits: 0n,
      mode: 'MANUAL',
      status: 'INSTRUCTIONS_ISSUED',
      providerReference: randomUUID(),
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      sourceMode: 'MANUAL',
      bankAccountName: 'Puente Demo Operator',
      accountNumber: '0123456789',
      bankName: 'First Bank Nigeria',
      createdAt: now,
    };
    this.orders.set(order.id, order);
    this.auditEvents.push({
      aggregateId: order.id,
      event: 'FUNDING_ORDER_CREATED',
      actor: buyerId,
      sourceMode: 'MANUAL',
      metadata: { ngnMinorUnits, expectedAssetBaseUnits },
    });
    return order;
  }

  // ---- funding-service.confirmFundingOrder ------------------------------------
  confirmFundingOrder(id, operatorId, ngnReceiptReference) {
    const order = this.orders.get(id);
    if (!order) throw Object.assign(new Error('Not found'), { status: 404 });
    if (order.status !== 'INSTRUCTIONS_ISSUED') {
      throw Object.assign(
        new Error(`Cannot transition from ${order.status}`),
        { status: 409, currentState: order.status },
      );
    }
    order.status = 'FIAT_CONFIRMED';
    order.ngnReceiptReference = ngnReceiptReference;
    this.auditEvents.push({
      aggregateId: id,
      event: 'FUNDING_ORDER_FIAT_CONFIRMED',
      actor: operatorId,
      sourceMode: order.sourceMode,
      metadata: { ngnReceiptReference, operatorId },
    });
    return { ...order };
  }

  // ---- funding-service.releaseFundingOrder ------------------------------------
  // ManualFundingAdapter.checkWalletBalance always returns confirmed: true
  releaseFundingOrder(id, operatorId, releaseReference) {
    const order = this.orders.get(id);
    if (!order) throw Object.assign(new Error('Not found'), { status: 404 });
    if (order.status !== 'FIAT_CONFIRMED') {
      throw Object.assign(
        new Error(`Cannot transition from ${order.status}`),
        { status: 409, currentState: order.status },
      );
    }
    // ManualFundingAdapter.checkWalletBalance → confirmed: true — always passes
    order.status = 'RELEASE_PENDING';
    order.releaseReference = releaseReference;
    this.auditEvents.push({
      aggregateId: id,
      event: 'FUNDING_ORDER_RELEASE_PENDING',
      actor: operatorId,
      sourceMode: order.sourceMode,
      metadata: { releaseReference, operatorId },
    });
    return { ...order };
  }

  // ---- funding-service.assetConfirmedFundingOrder ----------------------------
  assetConfirmedFundingOrder(id, operatorId, stellarTxReference, confirmedBaseUnits) {
    assertMoneyString(confirmedBaseUnits, 'confirmedBaseUnits');
    const order = this.orders.get(id);
    if (!order) throw Object.assign(new Error('Not found'), { status: 404 });
    if (order.status !== 'RELEASE_PENDING') {
      throw Object.assign(
        new Error(`Cannot transition from ${order.status}`),
        { status: 409, currentState: order.status },
      );
    }
    order.status = 'ASSET_CONFIRMED';
    order.stellarTxReference = stellarTxReference;
    order.sourceMode = 'TESTNET';
    this.auditEvents.push({
      aggregateId: id,
      event: 'FUNDING_ORDER_ASSET_CONFIRMED',
      actor: operatorId,
      sourceMode: 'TESTNET',
      metadata: { stellarTxReference, confirmedBaseUnits, operatorId, sourceMode: 'TESTNET' },
    });
    // credit buyer budget (inside same tx in the real service)
    this.credit(order.buyerId, confirmedBaseUnits, id);
    return { ...order };
  }

  // ---- helpers ---------------------------------------------------------------
  auditEventsFor(aggregateId) {
    return this.auditEvents.filter(e => e.aggregateId === aggregateId);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStore() { return new InMemoryFundingStore(); }
const BUYER_ID       = randomUUID();
const OPERATOR_ID    = 'operator:test';
const NGN            = '5000000';     // 50,000 NGN in kobo
const ASSET          = '1000000';     // 1 USDC in microUSDC
const RECEIPT_REF    = 'RECEIPT-001';
const RELEASE_REF    = 'RELEASE-001';
const STELLAR_TX_REF = 'TX-HASH-001';

// ---------------------------------------------------------------------------
// Happy-path test: full four-step corridor
// Validates: Requirement 6.1
// ---------------------------------------------------------------------------

test('full corridor: INSTRUCTIONS_ISSUED → FIAT_CONFIRMED → RELEASE_PENDING → ASSET_CONFIRMED', () => {
  const store = makeStore();
  const balanceBefore = store.getBalance(BUYER_ID);

  // Step 1 — create
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  assert.equal(order.status, 'INSTRUCTIONS_ISSUED', 'Step 1: initial status');
  assert.equal(order.buyerId, BUYER_ID);
  assert.equal(order.sourceMode, 'MANUAL');

  // Step 2 — operator confirms fiat received
  const confirmed = store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  assert.equal(confirmed.status, 'FIAT_CONFIRMED', 'Step 2: after confirm');
  assert.equal(confirmed.ngnReceiptReference, RECEIPT_REF);

  // Step 3 — operator releases (wallet balance check passes automatically)
  const released = store.releaseFundingOrder(order.id, OPERATOR_ID, RELEASE_REF);
  assert.equal(released.status, 'RELEASE_PENDING', 'Step 3: after release');
  assert.equal(released.releaseReference, RELEASE_REF);

  // Step 4 — operator confirms on-chain asset
  const settled = store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET);
  assert.equal(settled.status, 'ASSET_CONFIRMED', 'Step 4: after asset-confirmed');
  assert.equal(settled.sourceMode, 'TESTNET', 'Final sourceMode must be TESTNET');
  assert.equal(settled.stellarTxReference, STELLAR_TX_REF);

  // Budget increased by exact confirmed amount
  const balanceAfter = store.getBalance(BUYER_ID);
  assert.equal(
    balanceAfter - balanceBefore,
    BigInt(ASSET),
    'Balance must increase by exactly the confirmed asset amount',
  );
});

// ---------------------------------------------------------------------------
// Audit trail — exactly four order events plus one BUDGET_CREDITED event
// Validates: Requirement 6.1
// ---------------------------------------------------------------------------

test('all five audit events are written for a complete corridor (4 order + 1 budget credit)', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  store.releaseFundingOrder(order.id, OPERATOR_ID, RELEASE_REF);
  store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET);

  // Order-scoped audit events
  const orderEvents = store.auditEventsFor(order.id).map(e => e.event);
  const expectedOrderEvents = [
    'FUNDING_ORDER_CREATED',
    'FUNDING_ORDER_FIAT_CONFIRMED',
    'FUNDING_ORDER_RELEASE_PENDING',
    'FUNDING_ORDER_ASSET_CONFIRMED',
  ];
  for (const name of expectedOrderEvents) {
    assert.ok(orderEvents.includes(name), `Audit event "${name}" must be present`);
  }
  assert.equal(orderEvents.length, 4, 'Exactly 4 order-scoped audit events');

  // Budget audit event (aggregateId = buyerId)
  const budgetEvents = store.auditEventsFor(BUYER_ID).map(e => e.event);
  assert.ok(budgetEvents.includes('BUDGET_CREDITED'), 'BUDGET_CREDITED event must be written');
});

// ---------------------------------------------------------------------------
// ASSET_CONFIRMED audit event uses sourceMode TESTNET
// ---------------------------------------------------------------------------

test('ASSET_CONFIRMED audit event has sourceMode TESTNET', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  store.releaseFundingOrder(order.id, OPERATOR_ID, RELEASE_REF);
  store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET);

  const assetEvent = store.auditEvents.find(
    e => e.aggregateId === order.id && e.event === 'FUNDING_ORDER_ASSET_CONFIRMED',
  );
  assert.ok(assetEvent, 'ASSET_CONFIRMED event must exist');
  assert.equal(assetEvent.sourceMode, 'TESTNET');
});

// ---------------------------------------------------------------------------
// Out-of-order transitions are rejected (409)
// ---------------------------------------------------------------------------

test('confirm from FIAT_CONFIRMED returns 409', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  assert.throws(
    () => store.confirmFundingOrder(order.id, OPERATOR_ID, 'RECEIPT-002'),
    err => err.status === 409 && err.currentState === 'FIAT_CONFIRMED',
    'Double-confirm must throw 409',
  );
});

test('release from INSTRUCTIONS_ISSUED returns 409', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  assert.throws(
    () => store.releaseFundingOrder(order.id, OPERATOR_ID, RELEASE_REF),
    err => err.status === 409 && err.currentState === 'INSTRUCTIONS_ISSUED',
    'Release from wrong state must throw 409',
  );
});

test('asset-confirmed from FIAT_CONFIRMED returns 409', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  assert.throws(
    () => store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET),
    err => err.status === 409 && err.currentState === 'FIAT_CONFIRMED',
    'asset-confirmed from FIAT_CONFIRMED must throw 409',
  );
});

// ---------------------------------------------------------------------------
// Unknown order ID returns 404
// ---------------------------------------------------------------------------

test('operations on unknown order ID return 404', () => {
  const store = makeStore();
  const unknownId = randomUUID();
  for (const fn of [
    () => store.confirmFundingOrder(unknownId, OPERATOR_ID, RECEIPT_REF),
    () => store.releaseFundingOrder(unknownId, OPERATOR_ID, RELEASE_REF),
    () => store.assetConfirmedFundingOrder(unknownId, OPERATOR_ID, STELLAR_TX_REF, ASSET),
  ]) {
    assert.throws(fn, err => err.status === 404, 'Unknown order must return 404');
  }
});

// ---------------------------------------------------------------------------
// Budget is NOT double-credited on duplicate asset-confirmed calls
// (terminal state guard prevents the second call)
// ---------------------------------------------------------------------------

test('duplicate asset-confirmed is rejected; budget credited exactly once', () => {
  const store = makeStore();
  const order = store.createFundingOrder(BUYER_ID, NGN, ASSET);
  store.confirmFundingOrder(order.id, OPERATOR_ID, RECEIPT_REF);
  store.releaseFundingOrder(order.id, OPERATOR_ID, RELEASE_REF);
  store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET);

  // Attempt duplicate — must throw 409 (order is now ASSET_CONFIRMED, a terminal state)
  assert.throws(
    () => store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, STELLAR_TX_REF, ASSET),
    err => err.status === 409,
    'Second asset-confirmed must throw 409',
  );

  // Balance credited exactly once
  assert.equal(store.getBalance(BUYER_ID), BigInt(ASSET), 'Budget must be credited exactly once');

  // BUDGET_CREDITED emitted exactly once
  const creditEvents = store.auditEvents.filter(e => e.event === 'BUDGET_CREDITED');
  assert.equal(creditEvents.length, 1, 'BUDGET_CREDITED must appear exactly once');
});

// ---------------------------------------------------------------------------
// Different amounts: budget incremented by the exact confirmed amount
// ---------------------------------------------------------------------------

test('budget incremented by the precise confirmedBaseUnits value', () => {
  const amounts = ['1', '100', '999999', '1000000000'];
  for (const amount of amounts) {
    const store = makeStore();
    const buyerId = randomUUID();
    const order = store.createFundingOrder(buyerId, '1000', amount);
    store.confirmFundingOrder(order.id, OPERATOR_ID, 'R');
    store.releaseFundingOrder(order.id, OPERATOR_ID, 'L');
    store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, 'TX', amount);
    assert.equal(store.getBalance(buyerId), BigInt(amount),
      `Balance must equal confirmed amount ${amount}`);
  }
});

// ---------------------------------------------------------------------------
// Multiple buyers accumulate independent budgets
// ---------------------------------------------------------------------------

test('multiple buyers accumulate independent budgets after corridor completion', () => {
  const store = makeStore();
  const buyer1 = randomUUID();
  const buyer2 = randomUUID();
  const amount1 = '500000';
  const amount2 = '750000';

  for (const [buyerId, amount] of [[buyer1, amount1], [buyer2, amount2]]) {
    const order = store.createFundingOrder(buyerId, '1000', amount);
    store.confirmFundingOrder(order.id, OPERATOR_ID, `R-${buyerId}`);
    store.releaseFundingOrder(order.id, OPERATOR_ID, `L-${buyerId}`);
    store.assetConfirmedFundingOrder(order.id, OPERATOR_ID, `TX-${buyerId}`, amount);
  }

  assert.equal(store.getBalance(buyer1), BigInt(amount1), 'buyer1 balance');
  assert.equal(store.getBalance(buyer2), BigInt(amount2), 'buyer2 balance');
});
