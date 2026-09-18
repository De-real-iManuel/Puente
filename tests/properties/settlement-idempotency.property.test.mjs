/**
 * Property-based tests for settlement idempotency and purchase idempotency key.
 *
 * Validates: Requirements 5.7, 5.8, 5.9
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';

// ---- In-memory Settlement model ----
// Mirrors the DB constraint: UNIQUE (network, provider_reference)

class InMemorySettlements {
  constructor() {
    this._store = new Map(); // key: `${network}:${providerReference}` → settlement
    this._purchases = new Map(); // purchaseId → purchase
  }

  // Insert with ON CONFLICT DO NOTHING — mirrors DB behavior
  insertSettlement(settlement) {
    const key = `${settlement.network}:${settlement.providerReference}`;
    if (this._store.has(key)) {
      return { inserted: false }; // conflict — no-op
    }
    this._store.set(key, settlement);
    return { inserted: true };
  }

  countSettlements(network, providerReference) {
    const key = `${network}:${providerReference}`;
    return this._store.has(key) ? 1 : 0;
  }

  insertPurchase(purchase) {
    this._purchases.set(purchase.id, { ...purchase });
  }

  confirmPurchase(purchaseId) {
    const p = this._purchases.get(purchaseId);
    if (p) p.status = 'CONFIRMED';
  }

  getPurchaseStatus(purchaseId) {
    return this._purchases.get(purchaseId)?.status;
  }
}

// ---- In-memory Idempotency model ----

class IdempotencyStore {
  constructor() {
    this._store = new Map(); // key → { hash, status, purchaseId }
  }

  check(buyerId, idempotencyKey, requestHash) {
    const key = `${buyerId}:${idempotencyKey}`;
    const existing = this._store.get(key);
    if (!existing) return { exists: false };
    if (existing.hash !== requestHash) {
      return { exists: true, conflict: true, status: 409 };
    }
    if (existing.status === 'CONFIRMED') {
      return { exists: true, conflict: false, alreadyConfirmed: true, status: 202 };
    }
    return { exists: true, conflict: false, status: 'pending' };
  }

  record(buyerId, idempotencyKey, requestHash, purchaseId) {
    const key = `${buyerId}:${idempotencyKey}`;
    this._store.set(key, { hash: requestHash, status: 'CREATED', purchaseId });
  }

  confirm(buyerId, idempotencyKey) {
    const key = `${buyerId}:${idempotencyKey}`;
    const entry = this._store.get(key);
    if (entry) entry.status = 'CONFIRMED';
  }
}

// ---- Property 7: Settlement idempotency ----
// Validates: Requirements 5.7, 5.8

test('Property 7: replaying same provider event N times → Settlement count = 1', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.uuid(),
      fc.integer({ min: 1, max: 20 }),
      (network, providerReference, replayCount) => {
        const settlements = new InMemorySettlements();
        const purchaseId = crypto.randomUUID();
        settlements.insertPurchase({ id: purchaseId, status: 'VERIFYING' });

        // Replay the same event N times
        for (let i = 0; i < replayCount; i++) {
          const result = settlements.insertSettlement({
            purchaseId,
            network,
            providerReference,
            observedBaseUnits: '1000',
            status: 'CONFIRMED',
          });
          // First insert succeeds, rest are no-ops
          if (i === 0) {
            assert.equal(result.inserted, true);
            settlements.confirmPurchase(purchaseId);
          } else {
            assert.equal(result.inserted, false, `Replay ${i} must not insert duplicate`);
          }
        }

        const count = settlements.countSettlements(network, providerReference);
        assert.equal(count, 1, 'Settlement count must be exactly 1 regardless of replay count');
        assert.equal(settlements.getPurchaseStatus(purchaseId), 'CONFIRMED', 'Purchase stays CONFIRMED');
      }
    ),
    { numRuns: 200 }
  );
});

test('Property 7: CONFIRMED purchase cannot be downgraded by duplicate events', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.uuid(),
      fc.constantFrom('CONFIRMED', 'FAILED', 'UNKNOWN'),
      fc.integer({ min: 1, max: 10 }),
      (network, providerReference, newStatus, replayCount) => {
        const settlements = new InMemorySettlements();
        const purchaseId = crypto.randomUUID();
        settlements.insertPurchase({ id: purchaseId, status: 'VERIFYING' });

        // First confirm
        settlements.insertSettlement({ purchaseId, network, providerReference, observedBaseUnits: '1000', status: 'CONFIRMED' });
        settlements.confirmPurchase(purchaseId);

        // Replay with any status — purchase stays CONFIRMED
        for (let i = 0; i < replayCount; i++) {
          settlements.insertSettlement({ purchaseId, network, providerReference, observedBaseUnits: '1000', status: newStatus });
        }

        assert.equal(settlements.getPurchaseStatus(purchaseId), 'CONFIRMED', 'Once CONFIRMED, always CONFIRMED');
      }
    ),
    { numRuns: 200 }
  );
});

test('Property 7: different (network, providerReference) pairs each get their own settlement', () => {
  fc.assert(
    fc.property(
      fc.string({ minLength: 1 }),
      fc.uuid(),
      fc.string({ minLength: 1 }),
      fc.uuid(),
      (network1, ref1, network2, ref2) => {
        fc.pre(`${network1}:${ref1}` !== `${network2}:${ref2}`);
        const settlements = new InMemorySettlements();
        settlements.insertSettlement({ purchaseId: 'p1', network: network1, providerReference: ref1, observedBaseUnits: '1000', status: 'CONFIRMED' });
        settlements.insertSettlement({ purchaseId: 'p2', network: network2, providerReference: ref2, observedBaseUnits: '2000', status: 'CONFIRMED' });

        assert.equal(settlements.countSettlements(network1, ref1), 1);
        assert.equal(settlements.countSettlements(network2, ref2), 1);
      }
    ),
    { numRuns: 100 }
  );
});

// ---- Property 8: Purchase Idempotency_Key ----
// Validates: Requirements 5.8, 5.9

test('Property 8: same key + same hash + CONFIRMED → 202 alreadyConfirmed', () => {
  fc.assert(
    fc.property(
      fc.uuid(),    // buyerId
      fc.string({ minLength: 1, maxLength: 200 }), // idempotencyKey
      fc.string({ minLength: 1 }), // requestHash
      (buyerId, idempotencyKey, requestHash) => {
        const store = new IdempotencyStore();
        const purchaseId = crypto.randomUUID();

        // Record and confirm a purchase
        store.record(buyerId, idempotencyKey, requestHash, purchaseId);
        store.confirm(buyerId, idempotencyKey);

        // Retry with same key + same hash
        const result = store.check(buyerId, idempotencyKey, requestHash);
        assert.equal(result.alreadyConfirmed, true, 'Should be recognized as already confirmed');
        assert.equal(result.status, 202);
      }
    ),
    { numRuns: 200 }
  );
});

test('Property 8: same key + different hash → 409 conflict', () => {
  fc.assert(
    fc.property(
      fc.uuid(),    // buyerId
      fc.string({ minLength: 1, maxLength: 200 }), // idempotencyKey
      fc.string({ minLength: 1 }), // originalHash
      fc.string({ minLength: 1 }), // differentHash
      (buyerId, idempotencyKey, originalHash, differentHash) => {
        fc.pre(originalHash !== differentHash);
        const store = new IdempotencyStore();
        const purchaseId = crypto.randomUUID();

        store.record(buyerId, idempotencyKey, originalHash, purchaseId);

        // Try with different hash
        const result = store.check(buyerId, idempotencyKey, differentHash);
        assert.equal(result.conflict, true, 'Different hash should trigger conflict');
        assert.equal(result.status, 409);
      }
    ),
    { numRuns: 200 }
  );
});

test('Property 8: different buyers can use the same idempotency key', () => {
  fc.assert(
    fc.property(
      fc.uuid(),    // buyer1
      fc.uuid(),    // buyer2
      fc.string({ minLength: 1 }), // same key
      fc.string({ minLength: 1 }), // same hash
      (buyer1, buyer2, key, hash) => {
        fc.pre(buyer1 !== buyer2);
        const store = new IdempotencyStore();

        store.record(buyer1, key, hash, 'p1');
        store.confirm(buyer1, key);

        // buyer2 with same key should be independent
        const result = store.check(buyer2, key, hash);
        assert.equal(result.exists, false, 'Different buyer — no conflict');
      }
    ),
    { numRuns: 100 }
  );
});
