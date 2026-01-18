/**
 * Mock MQTT client for testing
 */

import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Create a mock MQTT client
 */
export function createMockMqttClient() {
  const emitter = new EventEmitter();
  let connected = false;

  const client = {
    connected: false,

    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.on(event, handler);
      return client;
    }),

    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.once(event, handler);
      return client;
    }),

    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.off(event, handler);
      return client;
    }),

    removeListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      emitter.removeListener(event, handler);
      return client;
    }),

    removeAllListeners: vi.fn((event?: string) => {
      if (event) {
        emitter.removeAllListeners(event);
      } else {
        emitter.removeAllListeners();
      }
      return client;
    }),

    subscribe: vi.fn((topic: string | string[], _opts?: unknown, callback?: (err?: Error) => void) => {
      if (callback) {
        setTimeout(() => callback(), 0);
      }
      return client;
    }),

    unsubscribe: vi.fn((topic: string | string[], callback?: (err?: Error) => void) => {
      if (callback) {
        setTimeout(() => callback(), 0);
      }
      return client;
    }),

    publish: vi.fn((topic: string, message: string | Buffer, _opts?: unknown, callback?: (err?: Error) => void) => {
      if (callback) {
        setTimeout(() => callback(), 0);
      }
      return client;
    }),

    end: vi.fn((force?: boolean, _opts?: unknown, callback?: () => void) => {
      connected = false;
      client.connected = false;
      if (callback) {
        setTimeout(callback, 0);
      }
      return client;
    }),

    reconnect: vi.fn(() => {
      return client;
    }),

    // Test helpers
    _emit: (event: string, ...args: unknown[]) => {
      emitter.emit(event, ...args);
    },

    _simulateConnect: () => {
      connected = true;
      client.connected = true;
      emitter.emit('connect');
    },

    _simulateDisconnect: () => {
      connected = false;
      client.connected = false;
      emitter.emit('close');
    },

    _simulateError: (error: Error) => {
      emitter.emit('error', error);
    },

    _simulateMessage: (topic: string, payload: Buffer | string) => {
      const buffer = typeof payload === 'string' ? Buffer.from(payload) : payload;
      emitter.emit('message', topic, buffer);
    },

    _isConnected: () => connected,
  };

  return client;
}

/**
 * Mock mqtt module
 */
export const mockMqttModule = {
  connect: vi.fn(() => createMockMqttClient()),
};
