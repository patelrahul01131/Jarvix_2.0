// src/agent-core/runtime/Orchestrator.js
const { Transaction } = require("../domain/Models");

class Orchestrator {
  constructor(options = {}) {
    this.txRepo = options.transactionRepository;
    this.eventRepo = options.eventRepository;
    this.di = options.diContainer;

    // Allowed state machine transitions
    this.allowedTransitions = {
      CREATED: ["PLANNING", "FAILED", "CANCELLED"],
      PLANNING: ["WAITING_PERMISSION", "RUNNING", "FAILED", "CANCELLED"],
      WAITING_PERMISSION: ["RUNNING", "FAILED", "CANCELLED"],
      RUNNING: ["WAITING_REVIEW", "FAILED", "CANCELLED"],
      WAITING_REVIEW: ["COMMITTING", "FAILED", "CANCELLED", "ROLLED_BACK"],
      COMMITTING: ["COMMITTED", "FAILED", "ROLLED_BACK"],
      COMMITTED: [],
      FAILED: [],
      ROLLED_BACK: [],
      CANCELLED: []
    };
  }

  async createTransaction(transactionId, scopes = [], metadata = {}) {
    const tx = new Transaction({
      id: transactionId,
      state: "CREATED",
      createdTime: Date.now(),
      updatedTime: Date.now(),
      workerId: null,
      permissionScopes: scopes,
      resourceCost: 0,
      metadata
    });
    this.txRepo.save(tx);

    this.emitEvent(transactionId, "transaction.created", 1, { id: transactionId, state: "CREATED" });
    return tx;
  }

  async transitionTo(transactionId, newState) {
    const tx = this.txRepo.get(transactionId);
    if (!tx) {
      throw new Error(`TRANSACTION_NOT_FOUND: Transaction '${transactionId}' does not exist.`);
    }

    const currentTransitions = this.allowedTransitions[tx.state] || [];
    if (!currentTransitions.includes(newState)) {
      throw new Error(`INVALID_STATE_TRANSITION: Cannot transition transaction '${transactionId}' from state '${tx.state}' to '${newState}'.`);
    }

    const updatedTx = new Transaction({
      id: tx.id,
      state: newState,
      createdTime: tx.createdTime,
      updatedTime: Date.now(),
      workerId: tx.workerId,
      permissionScopes: tx.permissionScopes,
      resourceCost: tx.resourceCost,
      metadata: tx.metadata
    });
    this.txRepo.save(updatedTx);

    this.emitEvent(transactionId, `transaction.state_changed`, 1, {
      id: transactionId,
      oldState: tx.state,
      newState
    });

    return updatedTx;
  }

  emitEvent(transactionId, eventName, schemaVersion, payload) {
    const event = {
      transactionSequenceId: 1, // simplified sequence tracing
      transactionId,
      eventName,
      schemaVersion,
      payload,
      timestamp: Date.now()
    };
    this.eventRepo.append(event);

    // Conceptually stream event to Event Broker
    try {
      const { eventBus } = require("../../core/event_bus");
      eventBus.emit("event", event);
    } catch (e) {}
  }
}

module.exports = Orchestrator;
