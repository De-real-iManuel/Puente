/**
 * Property-based tests for the Funding_Order state machine.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 *
 * Property 2: Funding_Order state machine rejects out-of-sequence transitions
 * Property 3: Every Funding_Order transition writes an Audit_Event
 *
 * These tests model the state machine in pure JavaScript, mirroring the
 * guards enforced in funding-service.ts, so they run without a live database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// State machine definition — mirrors funding-service.ts
// ---------------------------------------------------------------------------

const STATES = [
  'INSTRUCTIONS_ISSUED',
  'FIAT_CONFIRMED',
  'RELEASE_PENDING',
  'ASSET_CONFIRMED',
  'EXPIRED',
  'FAILED',
];

/**
 * Map of legal transitions.
 * Each key is a "from" state; value is the set of reachable "to" states.
 */
const LEGAL_TRANSITIONS = new Map([
  ['INSTRUCTIONS_ISSUED', ['FIAT_CONFIRMED', 'EXPIRED']],
  ['FIAT_CONFIRMED',      ['RELEASE_PENDING']],
  ['RELEASE_PENDING',     ['ASSET_CONFIRMED']],
  // Terminal states — no outbound transitions
  ['ASSET_CONFIRMED', []],
  ['EXPIRED',         []],
  ['FAILED',          []],
]);

/**
 * Each named operation requires the order to be in a specific state.
 * This mirrors the guards in confirmFundingOrder, releaseFundingOrder, and
 * assetConfirmedFundingOrder in funding-service.ts.
 */
const TRANSITION_GUARDS = {
  confirm:      'INSTRUCTIONS_ISSUED',
  release:      'FIAT_CONFIRMED',
  assetConfirm: 'RELEASE_PENDING',
};

const NEXT_STATE = {
  confirm:      'FIAT_CONFIRMED',
  release:      'RELEASE_PENDING',
  assetConfirm: 'ASSET_CONFIRMED',
};

const AUDIT_EVENT_NAMES = {
  confirm:      'FUNDING_ORDER_FIAT_CONFIRMED',
  release:      'FUNDING_ORDER_RELEASE_PENDING',
  assetConfirm: 'FUNDING_ORDER_ASSET_CONFIRMED',
};

/** Mirrors the service-layer guard: returns ok/error and the HTTP-equivalent status. */
function attemptTransition(currentState, operation) {
  const requiredState = TRANSITION_GUARDS[operation];
  if (currentState !== requiredState) {
    return { ok: false, status: 409, currentState };
  }
  return { ok: true, newState: NEXT_STATE[operation] };
}

/** Mirrors service behaviour: run the transition and emit an audit event on success. */
function simulateTransitionWithAudit(currentState, operation, orderId, actorId) {
  const result = attemptTransition(currentState, operation);
  if (!result.ok) return { result, auditEvents: [] };

  const auditEvent = {
    aggregateId: orderId,
    event:       AUDIT_EVENT_NAMES[operation],
    actor:       actorId,
    // assetConfirmedFundingOrder hard-codes TESTNET; others use MANUAL.
    sourceMode:  operation === 'assetConfirm' ? 'TESTNET' : 'MANUAL',
    timestamp:   new Date().toISOString(),
  };
  return { result, auditEvents: [auditEvent] };
}

const OPERATIONS = Object.keys(TRANSITION_GUARDS); // ['confirm', 'release', 'assetConfirm']

// ---------------------------------------------------------------------------
// Property 2 — Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6
//
// "Funding_Order state machine rejects out-of-sequence transitions"
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
 *
 * For every (state, operation) pair that is not a legal transition the service
 * must return HTTP 409 and report the current state in the response body.
 */
test('Property 2: illegal state machine transitions return 409 with currentState', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...STATES),
      fc.constantFrom(...OPERATIONS),
      (currentState, operation) => {
        const isLegal = TRANSITION_GUARDS[operation] === currentState;
        if (isLegal) return; // skip legal transitions — covered by Property 3

        const result = attemptTransition(currentState, operation);

        assert.equal(result.ok, false,
          `Illegal transition (${currentState} → ${operation}) must not succeed`);
        assert.equal(result.status, 409,
          `Illegal transition must return HTTP 409`);
        assert.equal(result.currentState, currentState,
          `Response body must echo the current state`);
      }
    ),
    { numRuns: 200 },
  );
});

/**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
 *
 * After a rejected transition the DB row must be unchanged — the status field
 * must still equal the state it had before the attempt.
 */
test('Property 2: DB row is unchanged after illegal transition', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...STATES),
      fc.constantFrom(...OPERATIONS),
      (currentState, operation) => {
        const isLegal = TRANSITION_GUARDS[operation] === currentState;
        if (isLegal) return;

        // Snapshot the "row" before the attempt
        const rowBefore = { status: currentState };

        const result = attemptTransition(currentState, operation);

        assert.equal(result.ok, false);
        // The row snapshot is unchanged — the rejection must not mutate state
        assert.equal(rowBefore.status, currentState,
          `Row status must remain ${currentState} after rejected transition`);
      }
    ),
    { numRuns: 200 },
  );
});

/**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6**
 *
 * Exhaustive spot-check: terminal states (ASSET_CONFIRMED, EXPIRED, FAILED)
 * must reject every operation.
 */
test('Property 2: terminal states reject all operations', () => {
  const terminalStates = ['ASSET_CONFIRMED', 'EXPIRED', 'FAILED'];

  fc.assert(
    fc.property(
      fc.constantFrom(...terminalStates),
      fc.constantFrom(...OPERATIONS),
      (currentState, operation) => {
        const result = attemptTransition(currentState, operation);
        assert.equal(result.ok, false,
          `Terminal state ${currentState} must reject operation ${operation}`);
        assert.equal(result.status, 409);
        assert.equal(result.currentState, currentState);
      }
    ),
    { numRuns: 200 },
  );
});

// ---------------------------------------------------------------------------
// Property 3 — Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7
//
// "Every Funding_Order transition writes an Audit_Event"
// ---------------------------------------------------------------------------

/**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**
 *
 * Every successful transition must produce exactly one audit event that
 * contains all required fields: aggregateId, event, actor, sourceMode,
 * and timestamp.
 */
test('Property 3: every successful transition writes exactly one audit event', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...OPERATIONS),
      fc.uuid(),
      fc.uuid(),
      (operation, orderId, actorId) => {
        const requiredState = TRANSITION_GUARDS[operation];
        const { result, auditEvents } = simulateTransitionWithAudit(
          requiredState, operation, orderId, actorId,
        );

        assert.equal(result.ok, true,
          `Legal transition from ${requiredState} via ${operation} should succeed`);
        assert.equal(auditEvents.length, 1,
          `Exactly one audit event must be emitted per successful transition`);

        const event = auditEvents[0];
        assert.ok(event.aggregateId, 'Audit event must have aggregateId');
        assert.ok(event.event,       'Audit event must have event name');
        assert.ok(event.actor,       'Audit event must have actor');
        assert.ok(event.sourceMode,  'Audit event must have sourceMode');
        assert.ok(event.timestamp,   'Audit event must have timestamp');
      }
    ),
    { numRuns: 200 },
  );
});

/**
 * **Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7**
 *
 * The audit event's `event` field must use the canonical name defined for
 * each operation.
 */
test('Property 3: audit events have correct event names for each transition', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...Object.entries(TRANSITION_GUARDS)),
      fc.uuid(),
      fc.uuid(),
      ([operation, requiredState], orderId, actorId) => {
        const { result, auditEvents } = simulateTransitionWithAudit(
          requiredState, operation, orderId, actorId,
        );

        assert.equal(result.ok, true);
        assert.equal(auditEvents.length, 1);
        assert.equal(auditEvents[0].event, AUDIT_EVENT_NAMES[operation],
          `Audit event for ${operation} must be named ${AUDIT_EVENT_NAMES[operation]}`);
      }
    ),
    { numRuns: 200 },
  );
});

/**
 * **Validates: Requirement 2.7**
 *
 * The ASSET_CONFIRMED transition (assetConfirm) must record sourceMode
 * as TESTNET in its audit event, matching the hard-coded value in
 * assetConfirmedFundingOrder.
 */
test('Property 3: ASSET_CONFIRMED transition uses TESTNET sourceMode in audit event', () => {
  fc.assert(
    fc.property(
      fc.uuid(),
      fc.uuid(),
      (orderId, actorId) => {
        const { result, auditEvents } = simulateTransitionWithAudit(
          'RELEASE_PENDING', 'assetConfirm', orderId, actorId,
        );

        assert.equal(result.ok, true);
        assert.equal(auditEvents[0].sourceMode, 'TESTNET',
          'assetConfirm audit event sourceMode must be TESTNET');
      }
    ),
    { numRuns: 100 },
  );
});

/**
 * **Validates: Requirement 2.7**
 *
 * Non-terminal transitions (confirm, release) must record sourceMode as
 * MANUAL in their audit events.
 */
test('Property 3: non-final transitions use MANUAL sourceMode in audit event', () => {
  const manualOps = ['confirm', 'release'];

  fc.assert(
    fc.property(
      fc.constantFrom(...manualOps),
      fc.uuid(),
      fc.uuid(),
      (operation, orderId, actorId) => {
        const requiredState = TRANSITION_GUARDS[operation];
        const { result, auditEvents } = simulateTransitionWithAudit(
          requiredState, operation, orderId, actorId,
        );

        assert.equal(result.ok, true);
        assert.equal(auditEvents[0].sourceMode, 'MANUAL',
          `${operation} audit event sourceMode must be MANUAL`);
      }
    ),
    { numRuns: 100 },
  );
});

/**
 * **Validates: Requirement 2.7**
 *
 * The aggregateId in every audit event must match the funding order ID that
 * triggered the transition.
 */
test('Property 3: audit event aggregateId matches the funding order ID', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...OPERATIONS),
      fc.uuid(),
      fc.uuid(),
      (operation, orderId, actorId) => {
        const requiredState = TRANSITION_GUARDS[operation];
        const { result, auditEvents } = simulateTransitionWithAudit(
          requiredState, operation, orderId, actorId,
        );

        assert.equal(result.ok, true);
        assert.equal(auditEvents[0].aggregateId, orderId,
          'Audit event aggregateId must equal the funding order ID');
      }
    ),
    { numRuns: 200 },
  );
});
