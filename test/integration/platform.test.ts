/**
 * Integration tests for DolphinPoolCleanerPlatform
 *
 * The cloud client is replaced by a fake; devices and accessories are real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  createMockLogger,
  createMockAPI,
  createMockPlatformAccessory,
  MockCharacteristics,
} from '../mocks/index.js';
import { MaytronicsAPI } from '../../src/api/maytronicsApi.js';
import { AuthError, ErrorCode } from '../../src/utils/errors.js';
import { DolphinPoolCleanerPlatform } from '../../src/platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from '../../src/config/constants.js';

vi.mock('../../src/api/maytronicsApi.js', () => ({
  MaytronicsAPI: vi.fn(),
}));

const ROBOT = {
  serialNumber: 'E3086OFG2M',
  name: 'Pool Bot',
  model: 'Dolphin M400',
  deviceType: 62,
  features: [],
};

/** Fake cloud client with the surface the platform and devices use */
const createCloud = () =>
  Object.assign(new EventEmitter(), {
    login: vi.fn().mockResolvedValue({ serialNumber: ROBOT.serialNumber, robotName: ROBOT.name }),
    getRobots: vi.fn().mockResolvedValue([ROBOT]),
    getThingShadow: vi.fn().mockResolvedValue(undefined),
    getLastShadowReceivedAt: vi.fn().mockReturnValue(0),
    disconnect: vi.fn(),
  });

describe('DolphinPoolCleanerPlatform', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let homebridge: ReturnType<typeof createMockAPI>;
  let clouds: ReturnType<typeof createCloud>[];
  let nextCloud: () => ReturnType<typeof createCloud>;

  const validConfig = {
    platform: 'DolphinPoolCleaner',
    name: 'Test Platform',
    refreshToken: 'refresh-token',
    pollingInterval: 60,
  };

  /** Fire a Homebridge lifecycle event the platform subscribed to */
  const fire = (event: string) => {
    const handler = vi.mocked(homebridge.on).mock.calls.find(([name]) => name === event)?.[1] as (() => void) | undefined;
    handler?.();
  };

  const launch = async (config: Record<string, unknown> = validConfig, cached: unknown[] = []) => {
    const platform = new DolphinPoolCleanerPlatform(mockLogger, config as never, homebridge);
    cached.forEach((accessory) => platform.configureAccessory(accessory as never));
    fire('didFinishLaunching');
    await vi.advanceTimersByTimeAsync(0);
    return platform;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockLogger = createMockLogger();
    homebridge = createMockAPI();
    Object.assign(homebridge.hap, {
      Characteristic: { ...MockCharacteristics, ConfiguredName: { name: 'ConfiguredName' } },
      Service: { ...homebridge.hap.Service, Valve: { name: 'Valve' } },
    });
    clouds = [];
    nextCloud = createCloud;
    // A regular function, so the platform can call it with `new`
    // eslint-disable-next-line prefer-arrow-callback
    vi.mocked(MaytronicsAPI).mockReset().mockImplementation(function () {
      const cloud = nextCloud();
      clouds.push(cloud);
      return cloud as never;
    });
  });

  afterEach(() => {
    fire('shutdown');
    vi.useRealTimers();
  });

  describe('configuration', () => {
    it('should refuse to start without a refresh token or email and password', async () => {
      await launch({ platform: 'DolphinPoolCleaner', email: 'owner@example.com' });

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('refreshToken or email/password'));
      expect(MaytronicsAPI).not.toHaveBeenCalled();
    });

    it('should accept email and password without a refresh token', async () => {
      await launch({ platform: 'DolphinPoolCleaner', email: 'owner@example.com', password: 'secret' });

      expect(MaytronicsAPI).toHaveBeenCalledWith('owner@example.com', 'secret', mockLogger, undefined, undefined);
    });

    it('should clamp the polling interval to the minimum', async () => {
      await launch({ ...validConfig, pollingInterval: 5 });

      expect(mockLogger.debug).toHaveBeenCalledWith('Starting polling for Pool Bot every 30s');
    });
  });

  describe('discovery', () => {
    it('should register a newly discovered robot and start its device', async () => {
      await launch();

      expect(homebridge.registerPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, [
        expect.objectContaining({ displayName: 'Pool Bot' }),
      ]);
      expect(clouds[0].getThingShadow).toHaveBeenCalledWith('E3086OFG2M');
    });

    it('should restore a cached accessory instead of registering it again', async () => {
      const cached = createMockPlatformAccessory('Pool Bot', 'generated-uuid-E3086OFG2M');

      await launch(validConfig, [cached]);

      expect(homebridge.registerPlatformAccessories).not.toHaveBeenCalled();
      expect(homebridge.updatePlatformAccessories).toHaveBeenCalledWith([cached]);
    });

    it('should apply the display name configured for the robot', async () => {
      await launch({ ...validConfig, devices: [{ serialNumber: 'E3086OFG2M', name: 'Backyard Pool' }] });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Device created: Backyard Pool'));
    });

    it('should remove cached accessories for robots that are gone', async () => {
      const stale = createMockPlatformAccessory('Old Robot', 'generated-uuid-OLD');

      await launch(validConfig, [stale]);

      expect(homebridge.unregisterPlatformAccessories).toHaveBeenCalledWith(PLUGIN_NAME, PLATFORM_NAME, [stale]);
    });
  });

  describe('retries', () => {
    it('should retry discovery with backoff when the cloud is unreachable', async () => {
      nextCloud = () => {
        const cloud = createCloud();
        if (clouds.length === 0) {
          cloud.login.mockRejectedValue(new AuthError(ErrorCode.AUTH_COGNITO_FAILED, 'network down'));
        }
        return cloud;
      };
      const cached = createMockPlatformAccessory('Pool Bot', 'generated-uuid-E3086OFG2M');

      await launch(validConfig, [cached]);
      expect(homebridge.unregisterPlatformAccessories).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(clouds).toHaveLength(2);
      expect(clouds[0].disconnect).toHaveBeenCalled();
      expect(homebridge.updatePlatformAccessories).toHaveBeenCalledWith([cached]);
    });

    it('should back off exponentially', async () => {
      nextCloud = () => {
        const cloud = createCloud();
        cloud.login.mockRejectedValue(new Error('network down'));
        return cloud;
      };

      await launch();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(clouds).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(59_000);
      expect(clouds).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(clouds).toHaveLength(3);
    });

    it('should not retry when the credentials are rejected', async () => {
      nextCloud = () => {
        const cloud = createCloud();
        cloud.login.mockRejectedValue(new AuthError(ErrorCode.AUTH_TOKEN_EXPIRED, 'expired'));
        return cloud;
      };

      await launch();
      await vi.advanceTimersByTimeAsync(15 * 60_000);

      expect(clouds).toHaveLength(1);
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Not retrying'));
    });
  });

  describe('shutdown', () => {
    it('should stop polling and close the cloud connection', async () => {
      await launch();
      const cloud = clouds[0];

      fire('shutdown');
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(cloud.disconnect).toHaveBeenCalled();
      expect(cloud.listenerCount('shadowUpdate')).toBe(0);
      expect(cloud.getThingShadow).toHaveBeenCalledTimes(1); // only the initial fetch
    });

    it('should cancel a pending discovery retry', async () => {
      nextCloud = () => {
        const cloud = createCloud();
        cloud.login.mockRejectedValue(new Error('network down'));
        return cloud;
      };

      await launch();
      fire('shutdown');
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(clouds).toHaveLength(1);
    });
  });
});
