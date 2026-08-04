/**
 * Unit tests for DolphinDevice
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createMockLogger } from '../mocks/index.js';

describe('DolphinDevice', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('module', () => {
    it('should be importable', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');
      expect(DolphinDevice).toBeDefined();
    });
  });

  describe('constructor', () => {
    it('should create device with config', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      // Create a minimal mock API
      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        startCleaning: vi.fn().mockResolvedValue(true),
        stopCleaning: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(device).toBeDefined();
      expect(device.serialNumber).toBe('E3086OFG2M');
      expect(device.name).toBe('Dolphin M400');
    });
  });

  describe('methods', () => {
    it('should have start method', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.start).toBe('function');
    });

    it('should have getState method', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.getState).toBe('function');
    });

    it('should have startCleaning method', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.startCleaning).toBe('function');
    });

    it('should have stopCleaning method', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.stopCleaning).toBe('function');
    });

    it('should have stop method', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.stop).toBe('function');
    });
  });

  describe('event emitter', () => {
    it('should support event listeners', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        startCleaning: vi.fn().mockResolvedValue(true),
        stopCleaning: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      expect(typeof device.on).toBe('function');
      expect(typeof device.emit).toBe('function');
      expect(typeof device.removeAllListeners).toBe('function');
    });
  });

  describe('getState', () => {
    it('should return initial state', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);
      const state = device.getState();

      expect(state).toBeDefined();
      expect(typeof state.isCleaning).toBe('boolean');
      expect(typeof state.connected).toBe('boolean');
    });
  });

  describe('polling', () => {
    const deviceConfig = {
      serialNumber: 'E3086OFG2M',
      name: 'Dolphin M400',
      deviceType: 62,
      pollingInterval: 60,
    };

    const createApi = (lastShadowReceivedAt: number) =>
      Object.assign(new EventEmitter(), {
        getThingShadow: vi.fn().mockResolvedValue(undefined),
        getLastShadowReceivedAt: vi.fn().mockReturnValue(lastShadowReceivedAt),
      });

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should skip polling when a shadow was pushed within the interval', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = createApi(Date.now());
      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      await device.start();
      expect(mockApi.getThingShadow).toHaveBeenCalledTimes(1); // initial fetch

      // The robot keeps pushing its shadow, so a poll would be redundant
      mockApi.getLastShadowReceivedAt.mockImplementation(() => Date.now());
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockApi.getThingShadow).toHaveBeenCalledTimes(1);
      device.stop();
    });

    it('should poll when no shadow was pushed within the interval', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = createApi(0);
      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      await device.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(mockApi.getThingShadow).toHaveBeenCalledTimes(2);
      device.stop();
    });

    it('should update state from a pushed shadow without polling', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = createApi(Date.now());
      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);
      const onStateChange = vi.fn();
      device.on('stateChange', onStateChange);

      await device.start();
      onStateChange.mockClear();

      mockApi.emit('shadowUpdate', {
        version: 42,
        state: { reported: { systemState: { pwsState: 'on', robotState: 'cleaning' } } },
      });

      expect(onStateChange).toHaveBeenCalledTimes(1);
      expect(device.getState().isCleaning).toBe(true);
      device.stop();
    });

    it('should stop listening for pushed shadows once stopped', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = createApi(Date.now());
      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);

      await device.start();
      device.stop();

      expect(mockApi.listenerCount('shadowUpdate')).toBe(0);
    });
  });

  describe('features property', () => {
    it('should return device features', async () => {
      const { DolphinDevice } = await import('../../src/devices/dolphinDevice.js');

      const mockApi = {
        getThingShadow: vi.fn().mockResolvedValue(null),
        sendCommand: vi.fn().mockResolvedValue(true),
      };

      const deviceConfig = {
        serialNumber: 'E3086OFG2M',
        name: 'Dolphin M400',
        deviceType: 62,
        pollingInterval: 60,
      };

      const device = new DolphinDevice(deviceConfig, mockApi as never, mockLogger);
      const features = device.features;

      expect(features).toBeDefined();
      expect(typeof features.hasTemperatureSensor).toBe('boolean');
    });
  });
});
