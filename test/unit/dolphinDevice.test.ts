/**
 * Unit tests for DolphinDevice
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
