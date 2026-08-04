/**
 * Unit tests for MQTTClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('MQTTClient - shadow rate limiting', () => {
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

  const truncatedSerial = 'E3086OFG';
  const throttled = { code: 429, message: 'TOO_MANY_REQUESTS' };
  const shadow = { state: { reported: {} }, version: 7 };

  /**
   * Put the client in a connected state with a fake broker that answers each
   * publish through the handler given by `respond`
   */
  const connect = (
    client: any,
    respond: (attempt: number, clientToken: string | undefined) => { topic: string; payload: unknown },
  ) => {
    let attempt = 0;
    const publish = vi.fn((topic: string, payload: string | Buffer) => {
      attempt++;
      const body = payload.toString();
      const clientToken = body ? JSON.parse(body).clientToken : undefined;
      const reply = respond(attempt, clientToken);
      queueMicrotask(() => client.handleMessage(reply.topic, Buffer.from(JSON.stringify(reply.payload))));
      return undefined;
    });

    client.client = { publish };
    client.connected = true;
    return publish;
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should retry a throttled shadow request instead of failing', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    const publish = connect(client, (attempt, clientToken) =>
      attempt === 1
        ? {
          topic: `$aws/things/${truncatedSerial}/shadow/get/rejected`,
          payload: { ...throttled, clientToken },
        }
        : {
          topic: `$aws/things/${truncatedSerial}/shadow/get/accepted`,
          payload: { ...shadow, clientToken },
        },
    );

    const result = client.getShadow();
    await vi.advanceTimersByTimeAsync(10000);

    await expect(result).resolves.toMatchObject({ version: 7 });
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should not warn about throttling that is resolved by a retry', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, (attempt, clientToken) =>
      attempt === 1
        ? {
          topic: `$aws/things/${truncatedSerial}/shadow/get/rejected`,
          payload: { ...throttled, clientToken },
        }
        : {
          topic: `$aws/things/${truncatedSerial}/shadow/get/accepted`,
          payload: { ...shadow, clientToken },
        },
    );

    const result = client.getShadow();
    await vi.advanceTimersByTimeAsync(10000);
    await result;

    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('should warn once when every attempt is throttled', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    const publish = connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/rejected`,
      payload: { ...throttled, clientToken },
    }));

    const rejected = expect(client.getShadow()).rejects.toThrow('Shadow request rejected');
    await vi.advanceTimersByTimeAsync(60000);

    await rejected;
    expect(publish).toHaveBeenCalledTimes(3);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0][0]).toContain('throttled by AWS IoT');
  });

  it('should still warn about non-throttling rejections', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/rejected`,
      payload: { code: 403, message: 'Forbidden', clientToken },
    }));

    const rejected = expect(client.getShadow()).rejects.toThrow('Shadow request rejected');
    await vi.advanceTimersByTimeAsync(10000);

    await rejected;
    expect(mockLogger.warn).toHaveBeenCalledWith('Shadow operation rejected:', expect.objectContaining({ code: 403 }));
  });

  it('should share a single request between concurrent getShadow calls', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    const publish = connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/accepted`,
      payload: { ...shadow, clientToken },
    }));

    const results = Promise.all([client.getShadow(), client.getShadow()]);
    await vi.advanceTimersByTimeAsync(10000);

    const [first, second] = await results;
    expect(first).toBe(second);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('should retry a throttled command fewer times than a poll', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    const publish = connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/update/rejected`,
      payload: { ...throttled, clientToken },
    }));

    const result = client.updateShadow({ systemState: { pwsState: 'on' } });
    await vi.advanceTimersByTimeAsync(60000);

    // Commands are awaited by HomeKit, so they give up after 2 attempts
    await expect(result).resolves.toBe(false);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('should not treat a robot-initiated shadow push as acceptance of a command', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/update/rejected`,
      payload: { code: 400, message: 'Invalid state', clientToken },
    }));

    const result = client.updateShadow({ systemState: { pwsState: 'on' } });
    // The robot reports its own state meanwhile: broadcast, no clientToken
    (client as any).handleMessage(
      `$aws/things/${truncatedSerial}/shadow/update/accepted`,
      Buffer.from(JSON.stringify(shadow)),
    );
    await vi.advanceTimersByTimeAsync(10000);

    await expect(result).resolves.toBe(false);
  });

  it('should let an untagged shadow push answer a pending get', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, () => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/accepted`,
      payload: shadow, // broker that does not echo the token
    }));

    const result = client.getShadow();
    await vi.advanceTimersByTimeAsync(10000);

    await expect(result).resolves.toMatchObject({ version: 7 });
  });

  it('should ignore an untagged rejection', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, () => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/rejected`,
      payload: { code: 403, message: 'Forbidden' }, // cannot be attributed to a request
    }));

    const timedOut = expect(client.getShadow()).rejects.toThrow('Shadow operation timeout');
    await vi.advanceTimersByTimeAsync(15000);

    await timedOut;
  });

  it('should fail in-flight requests when the connection drops', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, () => ({ topic: 'never/answered', payload: {} }));
    (client as any).client.end = vi.fn();

    const dropped = expect(client.getShadow()).rejects.toThrow('MQTT disconnected');
    await vi.advanceTimersByTimeAsync(0);
    client.disconnect();

    await dropped;
  });

  it('should ignore a rejection carrying another client token', async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    const client = new MQTTClient(mockConfig, mockLogger);

    connect(client, (_attempt, clientToken) => ({
      topic: `$aws/things/${truncatedSerial}/shadow/get/accepted`,
      payload: { ...shadow, clientToken },
    }));

    const result = client.getShadow();
    // A rejection meant for the phone app must not fail our pending request
    (client as any).handleMessage(
      `$aws/things/${truncatedSerial}/shadow/update/rejected`,
      Buffer.from(JSON.stringify({ ...throttled, clientToken: 'someone-else-1' })),
    );
    await vi.advanceTimersByTimeAsync(10000);

    await expect(result).resolves.toMatchObject({ version: 7 });
  });
});
