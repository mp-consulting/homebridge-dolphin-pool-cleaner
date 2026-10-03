/**
 * Unit tests for MaytronicsAPI, exercising the real authentication flow
 * against mocked Cognito, MyDolphin REST and MQTT endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as mqtt from 'mqtt';
import { createMockLogger } from '../mocks/index.js';
import { createMockMqttClient } from '../mocks/mqtt.mock.js';
import { MaytronicsAPI } from '../../src/api/maytronicsApi.js';
import { AuthError, ErrorCode } from '../../src/utils/errors.js';

const cognitoSend = vi.fn();

// Regular functions, so the code under test can call them with `new`
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  // eslint-disable-next-line prefer-arrow-callback
  CognitoIdentityProviderClient: vi.fn(function () {
    return { send: cognitoSend };
  }),
  InitiateAuthCommand: vi.fn(function (this: { input: unknown }, input: unknown) {
    this.input = input;
  }),
  AuthFlowType: {
    REFRESH_TOKEN_AUTH: 'REFRESH_TOKEN_AUTH',
    USER_PASSWORD_AUTH: 'USER_PASSWORD_AUTH',
  },
}));

vi.mock('mqtt', () => ({
  connect: vi.fn(),
}));

type Route = { status?: number; body: unknown };

describe('MaytronicsAPI', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let routes: Record<string, Route>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let brokers: ReturnType<typeof createMockMqttClient>[];

  const shadow = { version: 3, state: { reported: { systemState: { pwsState: 'idle' } } } };

  /** A broker that connects right away and answers shadow requests */
  const createBroker = () => {
    const broker = createMockMqttClient();
    broker.publish.mockImplementation(((topic: string, payload: string) => {
      const { clientToken } = JSON.parse(payload);
      const reply = topic.endsWith('/get') ? 'get/accepted' : 'update/accepted';
      queueMicrotask(() =>
        broker._simulateMessage(`$aws/things/E3086OFG/shadow/${reply}`, JSON.stringify({ ...shadow, clientToken })),
      );
      return broker;
    }) as never);
    setTimeout(() => broker._simulateConnect(), 0);
    brokers.push(broker);
    return broker as unknown as mqtt.MqttClient;
  };

  const createApi = (refreshToken?: string) =>
    new MaytronicsAPI('owner@example.com', 'secret', mockLogger, 'eu-west-1', refreshToken);

  beforeEach(() => {
    mockLogger = createMockLogger();
    brokers = [];
    cognitoSend.mockReset().mockResolvedValue({ AuthenticationResult: { IdToken: 'id-token' } });
    vi.mocked(mqtt.connect).mockReset().mockImplementation(createBroker);

    routes = {
      '/mobapi/user/authenticate-user/': {
        body: { Status: '1', Data: { mob_token: 'mob', Sernum: 'E3086OFG2M', MyRobotName: 'Pool Bot', connectVia: '62' } },
      },
      '/mt-sso/aws/getToken/': {
        body: {
          Status: '1',
          Data: { AccessKeyId: 'AKIA', SecretAccessKey: 'secret', Token: 'session', TokenExpiration: '2099-01-01T00:00:00Z' },
        },
      },
      '/mobapi/serial-numbers/getRobotDetailsByRobotSN/': {
        body: { Status: '1', Data: { SERNUM: 'E3086OFG2M', MyRobotName: 'Pool Bot', PARTDES: 'Dolphin M400' } },
      },
      '/mobapi/serial-numbers/getSernFeatures/': {
        body: { Status: '1', Data: { features: [{ description: 'Temperature' }] } },
      },
    };
    fetchMock = vi.fn(async (url: URL) => {
      const route = routes[url.pathname];
      return route
        ? new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
        : new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const requestTo = (path: string) => fetchMock.mock.calls.find(([url]) => (url as URL).pathname === path)!;

  describe('login', () => {
    it('should authenticate, fetch IoT credentials and connect MQTT', async () => {
      const api = createApi();

      await expect(api.login()).resolves.toEqual({
        cognitoToken: 'id-token',
        mobToken: 'mob',
        serialNumber: 'E3086OFG2M',
        robotName: 'Pool Bot',
        deviceType: 62,
      });

      const [url, init] = requestTo('/mt-sso/aws/getToken/');
      expect((url as URL).searchParams.get('sernum')).toBe('E3086OFG2M');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer id-token', AppKey: expect.any(String) });
      expect(mqtt.connect).toHaveBeenCalledTimes(1);
      api.disconnect();
    });

    it('should prefer the refresh token over the password', async () => {
      await createApi('refresh-token').login();

      expect(cognitoSend.mock.calls[0][0].input).toMatchObject({
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: 'refresh-token' },
      });
    });

    it('should report bad credentials as such', async () => {
      cognitoSend.mockRejectedValue(Object.assign(new Error('Incorrect username or password.'), { name: 'NotAuthorizedException' }));

      const error = await createApi().login().catch((e) => e);

      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe(ErrorCode.AUTH_INVALID_CREDENTIALS);
    });

    it('should report an expired refresh token', async () => {
      cognitoSend.mockRejectedValue(Object.assign(new Error('Refresh Token has expired'), { name: 'NotAuthorizedException' }));

      await expect(createApi('old-token').login()).rejects.toMatchObject({ code: ErrorCode.AUTH_TOKEN_EXPIRED });
    });

    it('should fail when the MyDolphin backend refuses the user', async () => {
      routes['/mobapi/user/authenticate-user/'] = { body: { Status: '0', Alert: 'Account locked' } };

      await expect(createApi().login()).rejects.toMatchObject({ code: ErrorCode.AUTH_MYDOLPHIN_FAILED });
    });

    it('should fail on an HTTP error from the backend', async () => {
      routes['/mt-sso/aws/getToken/'] = { status: 503, body: {} };

      await expect(createApi().login()).rejects.toMatchObject({ code: ErrorCode.AUTH_AWS_CREDENTIALS_FAILED });
    });
  });

  describe('concurrency', () => {
    it('should share one login and one MQTT connection between concurrent requests', async () => {
      const api = createApi();

      const results = await Promise.all([api.getThingShadow('E3086OFG2M'), api.getThingShadow('E3086OFG2M')]);

      expect(results[0]).toMatchObject({ version: 3 });
      expect(results[1]).toMatchObject({ version: 3 });
      expect(cognitoSend).toHaveBeenCalledTimes(1);
      expect(mqtt.connect).toHaveBeenCalledTimes(1);
      api.disconnect();
    });

    it('should reconnect MQTT without logging in again while credentials are valid', async () => {
      const api = createApi();
      await api.login();

      brokers[0]._simulateDisconnect();
      await api.getThingShadow('E3086OFG2M');

      expect(cognitoSend).toHaveBeenCalledTimes(1);
      expect(mqtt.connect).toHaveBeenCalledTimes(2);
      api.disconnect();
    });
  });

  describe('robots', () => {
    it('should describe the robot from the backend', async () => {
      const api = createApi();
      await api.login();

      await expect(api.getRobots()).resolves.toEqual([{
        serialNumber: 'E3086OFG2M',
        name: 'Pool Bot',
        model: 'Dolphin M400',
        deviceType: 62,
        warrantyDays: undefined,
        features: ['Temperature'],
      }]);
      const [, init] = requestTo('/mobapi/serial-numbers/getRobotDetailsByRobotSN/');
      expect(init.body).toBe('SERNUM=E3086OFG2M');
      api.disconnect();
    });

    it('should still list the robot when its details cannot be fetched', async () => {
      const api = createApi();
      await api.login();
      routes['/mobapi/serial-numbers/getRobotDetailsByRobotSN/'] = { status: 500, body: {} };

      // An empty list would make the platform unregister the accessory
      await expect(api.getRobots()).resolves.toEqual([
        expect.objectContaining({ serialNumber: 'E3086OFG2M', name: 'Pool Bot', deviceType: 62 }),
      ]);
      api.disconnect();
    });

    it('should return no robots before login', async () => {
      await expect(createApi().getRobots()).resolves.toEqual([]);
    });
  });

  describe('commands', () => {
    it('should send start and stop as shadow updates', async () => {
      const api = createApi();
      await api.login();

      await expect(api.startRobot('E3086OFG2M')).resolves.toBe(true);
      await expect(api.stopRobot('E3086OFG2M')).resolves.toBe(true);

      const payloads = brokers[0].publish.mock.calls.map(([, payload]) => JSON.parse(payload as string).state.desired);
      expect(payloads).toEqual([{ systemState: { pwsState: 'on' } }, { systemState: { pwsState: 'off' } }]);
      api.disconnect();
    });

    it('should return false instead of throwing when the cloud is unreachable', async () => {
      cognitoSend.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

      await expect(createApi().setCleaningMode('E3086OFG2M', 'floor')).resolves.toBe(false);
    });
  });
});
