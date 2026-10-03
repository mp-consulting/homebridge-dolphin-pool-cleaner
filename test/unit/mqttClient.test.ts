/**
 * Unit tests for MQTTClient
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as mqtt from 'mqtt';
import { createMockLogger } from '../mocks/index.js';
import { createMockMqttClient } from '../mocks/mqtt.mock.js';

vi.mock('mqtt', () => ({
  connect: vi.fn(),
}));

const TEST_CREDENTIALS = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  sessionToken: 'mock-session-token',
  expiration: new Date('2099-01-01T00:00:00Z'),
};

describe('MQTTClient', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  const mockConfig = {
    serialNumber: 'E3086OFG2M',
    getCredentials: () => TEST_CREDENTIALS,
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

describe('MQTTClient - shadow rate limiting', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  const mockConfig = {
    serialNumber: 'E3086OFG2M',
    getCredentials: () => TEST_CREDENTIALS,
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

describe('MQTTClient - connection', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let broker: ReturnType<typeof createMockMqttClient>;
  let credentials: typeof TEST_CREDENTIALS | undefined;

  const createClient = async () => {
    const { MQTTClient } = await import('../../src/api/mqttClient.js');
    return new MQTTClient({
      serialNumber: 'E3086OFG2M',
      region: 'eu-west-1',
      iotEndpoint: 'mock-iot-endpoint.iot.eu-west-1.amazonaws.com',
      getCredentials: () => credentials,
    }, mockLogger);
  };

  /** Options passed to mqtt.connect on the last call */
  const connectOptions = () => vi.mocked(mqtt.connect).mock.lastCall![1] as unknown as {
    transformWsUrl: (url: string) => string;
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    credentials = { ...TEST_CREDENTIALS };
    broker = createMockMqttClient();
    vi.mocked(mqtt.connect).mockReset().mockReturnValue(broker as unknown as mqtt.MqttClient);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve once connected and subscribed to the shadow topics', async () => {
    const client = await createClient();

    const connecting = client.connect();
    broker._simulateConnect();
    await vi.advanceTimersByTimeAsync(0);

    await expect(connecting).resolves.toBeUndefined();
    expect(client.isConnected()).toBe(true);
    expect(broker.subscribe).toHaveBeenCalledTimes(5);
  });

  it('should reject when the broker never answers instead of hanging', async () => {
    const client = await createClient();

    const connecting = expect(client.connect()).rejects.toThrow('Timed out connecting to AWS IoT');
    await vi.advanceTimersByTimeAsync(30_000);

    await connecting;
    expect(broker.end).toHaveBeenCalled();
  });

  it('should reject a pending connection when disconnected', async () => {
    const client = await createClient();

    const connecting = expect(client.connect()).rejects.toThrow('before the connection completed');
    client.disconnect();

    await connecting;
  });

  it('should share one connection attempt between concurrent callers', async () => {
    const client = await createClient();

    const first = client.connect();
    const second = client.connect();
    broker._simulateConnect();
    await vi.advanceTimersByTimeAsync(0);

    await Promise.all([first, second]);
    expect(mqtt.connect).toHaveBeenCalledTimes(1);
  });

  it('should sign every connection attempt with the current credentials', async () => {
    const client = await createClient();
    void client.connect().catch(() => undefined);
    const { transformWsUrl } = connectOptions();

    const firstUrl = transformWsUrl('wss://unsigned/mqtt');
    credentials = { ...TEST_CREDENTIALS, accessKeyId: 'AKIAREFRESHED', sessionToken: 'new token/+=' };
    const reconnectUrl = transformWsUrl('wss://unsigned/mqtt');

    expect(firstUrl).toContain('X-Amz-Credential=AKIAIOSFODNN7EXAMPLE');
    expect(reconnectUrl).toContain('X-Amz-Credential=AKIAREFRESHED');
    expect(reconnectUrl).toContain('X-Amz-Security-Token=new%20token%2F%2B%3D');
    expect(reconnectUrl).toMatch(/X-Amz-Signature=[0-9a-f]{64}/);
    client.disconnect();
  });

  it('should not throw from the reconnect timer when credentials are missing', async () => {
    const client = await createClient();
    void client.connect().catch(() => undefined);
    const { transformWsUrl } = connectOptions();

    credentials = undefined;

    expect(transformWsUrl('wss://unsigned/mqtt')).toBe('wss://unsigned/mqtt');
    expect(mockLogger.error).toHaveBeenCalledWith('Could not sign the AWS IoT WebSocket URL:', expect.any(String));
    client.disconnect();
  });

  it('should only count shadows carrying reported state as fresh', async () => {
    const client = await createClient();
    const handleMessage = (topic: string, payload: unknown) =>
      (client as any).handleMessage(topic, Buffer.from(JSON.stringify(payload)));

    // Echo of a desired-only update (ours or the phone app's)
    handleMessage('$aws/things/E3086OFG/shadow/update/accepted', { state: { desired: { a: 1 } }, version: 3 });
    expect(client.getLastShadowReceivedAt()).toBe(0);

    handleMessage('$aws/things/E3086OFG/shadow/update/accepted', { state: { reported: { a: 1 } }, version: 4 });
    expect(client.getLastShadowReceivedAt()).toBeGreaterThan(0);
  });
});
