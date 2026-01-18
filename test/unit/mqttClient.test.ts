/**
 * Unit tests for MQTTClient
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockLogger } from '../mocks/index.js';

describe('MQTTClient', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  const mockConfig = {
    serialNumber: 'E3086OFG2M',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'mock-session-token',
    },
    iotEndpoint: 'mock-iot-endpoint.iot.eu-west-1.amazonaws.com',
    region: 'eu-west-1',
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be importable', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');
      expect(MQTTClient).toBeDefined();
    });

    it('should create instance with config object', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(client).toBeDefined();
    });
  });

  describe('methods', () => {
    it('should have connect method', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.connect).toBe('function');
    });

    it('should have disconnect method', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.disconnect).toBe('function');
    });

    it('should have getShadow method', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.getShadow).toBe('function');
    });

    it('should have updateShadow method', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.updateShadow).toBe('function');
    });

    it('should have sendDynamicCommand method', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.sendDynamicCommand).toBe('function');
    });
  });

  describe('event emitter', () => {
    it('should support event listeners', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      expect(typeof client.on).toBe('function');
      expect(typeof client.emit).toBe('function');
      expect(typeof client.removeListener).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should throw when getShadow called while not connected', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      await expect(client.getShadow()).rejects.toThrow('MQTT client not connected');
    });

    it('should throw when updateShadow called while not connected', async () => {
      const { MQTTClient } = await import('../../src/api/mqttClient.js');

      const client = new MQTTClient(mockConfig, mockLogger);

      await expect(client.updateShadow({ test: true })).rejects.toThrow('MQTT client not connected');
    });
  });
});

describe('MQTTClient - SigV4 Signing', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  const mockConfig = {
    serialNumber: 'E3086OFG2M',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      sessionToken: 'mock-session-token',
    },
    iotEndpoint: 'mock-iot-endpoint.iot.eu-west-1.amazonaws.com',
    region: 'eu-west-1',
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('should create client without throwing (URL generation)', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');

    expect(() => {
      new MQTTClient(mockConfig, mockLogger);
    }).not.toThrow();
  });
});
