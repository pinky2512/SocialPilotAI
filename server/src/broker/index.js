// Message broker abstraction.
//
// Agent communication contract (CLAUDE.md): agents talk to each other ONLY via
// the message broker, never by calling each other's internals directly.
//
// DEV IMPLEMENTATION: an in-process pub/sub bus (EventEmitter). The interface —
// publish(topic, message) / subscribe(topic, handler) — is intentionally the
// minimal surface RabbitMQ/Kafka also provide, so this is the single module to
// swap for a real broker in production without touching any agent code.

import { EventEmitter } from 'node:events';
import { logAction } from '../trust/audit.js';

class Broker {
  constructor() {
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(100);
  }

  /**
   * Publish a message to a topic. Fan-out to all subscribers.
   * @param {string} topic  e.g. 'contentApproval', 'newLeadData'
   * @param {object} message
   */
  publish(topic, message = {}) {
    this.bus.emit(topic, message);
  }

  /**
   * Subscribe a handler to a topic. Handlers may be async; errors are isolated
   * so one failing subscriber never breaks fan-out to the others.
   * @param {string} topic
   * @param {(message: object) => any} handler
   * @returns {() => void} unsubscribe
   */
  subscribe(topic, handler) {
    const wrapped = async (message) => {
      try {
        await handler(message);
      } catch (err) {
        // Governance observability: a broker-level failure is a meaningful,
        // auditable event even though no human triggered it.
        logAction({
          userId: null,
          action: 'broker.handler_error',
          details: { topic, error: String(err?.message || err) },
        });
      }
    };
    this.bus.on(topic, wrapped);
    return () => this.bus.off(topic, wrapped);
  }
}

// Single shared broker instance for the process.
export const broker = new Broker();
