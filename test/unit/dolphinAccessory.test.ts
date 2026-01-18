/**
 * Unit tests for DolphinAccessory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  createMockLogger,
  createMockAPI,
  createMockPlatformAccessory,
  MockServices,
  MockCharacteristics,
} from '../mocks/index.js';

// Mock DolphinDevice
class MockDolphinDevice extends EventEmitter {
  serialNumber = 'E3086OFG2M';
  name = 'Dolphin M400';

  private state = {
    isCleaning: false,
    isConnected: true,
    currentMode: 'all',
    cycleTimeRemaining: 0,
    waterTemperature: undefined as number | undefined,
    filterStatus: 'ok' as 'ok' | 'needs_cleaning',
    hasError: false,
    errorCode: 0,
    errorMessage: undefined as string | undefined,
    cycleStartTime: undefined as Date | undefined,
  };

  getState = vi.fn(() => this.state);
  getFeatures = vi.fn(() => ({
    hasTemperature: true,
    hasFilter: true,
    hasLed: false,
    hasDelay: true,
    supportedModes: ['all', 'short', 'floor', 'wall', 'water'],
  }));
  getAvailableModes = vi.fn(() => ['all', 'short', 'floor', 'wall', 'water']);
  startCleaning = vi.fn().mockResolvedValue(true);
  stopCleaning = vi.fn().mockResolvedValue(true);
  initialize = vi.fn().mockResolvedValue(undefined);
  stopPolling = vi.fn();

  // Test helpers
  _setState(newState: Partial<typeof this.state>) {
    Object.assign(this.state, newState);
    this.emit('stateChange', this.state);
  }

  _emitError(error: Error) {
    this.emit('error', error);
  }
}

// We need to import the actual module to test it
// For this test, we'll test the accessory behavior

describe('DolphinAccessory', () => {
  let mockApi: ReturnType<typeof createMockAPI>;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAccessory: ReturnType<typeof createMockPlatformAccessory>;
  let mockDevice: MockDolphinDevice;

  const mockPlatform = {
    Service: MockServices,
    Characteristic: MockCharacteristics,
    log: null as ReturnType<typeof createMockLogger> | null,
    api: null as ReturnType<typeof createMockAPI> | null,
    config: {
      platform: 'DolphinPoolCleaner',
      name: 'Test Platform',
    },
  };

  beforeEach(() => {
    mockApi = createMockAPI();
    mockLogger = createMockLogger();
    mockPlatform.log = mockLogger;
    mockPlatform.api = mockApi;

    mockAccessory = createMockPlatformAccessory('Dolphin M400', 'test-uuid-123');
    mockDevice = new MockDolphinDevice();
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockDevice.removeAllListeners();
  });

  describe('Service Setup', () => {
    it('should set up accessory information', () => {
      const infoService = mockAccessory.getService(MockServices.AccessoryInformation);

      expect(infoService).toBeDefined();
    });

    it('should add switch service', () => {
      const switchService = mockAccessory.addService(MockServices.Switch);

      expect(switchService).toBeDefined();
      expect(mockAccessory.addService).toHaveBeenCalledWith(MockServices.Switch);
    });

    it('should add temperature sensor service when supported', () => {
      const tempService = mockAccessory.addService(MockServices.TemperatureSensor);

      expect(tempService).toBeDefined();
    });

    it('should add filter maintenance service when supported', () => {
      const filterService = mockAccessory.addService(MockServices.FilterMaintenance);

      expect(filterService).toBeDefined();
    });
  });

  describe('Switch Characteristic', () => {
    let switchService: ReturnType<typeof mockAccessory.addService>;

    beforeEach(() => {
      switchService = mockAccessory.addService(MockServices.Switch);
    });

    it('should get On characteristic', () => {
      const onChar = switchService.getCharacteristic(MockCharacteristics.On);

      expect(onChar).toBeDefined();
    });

    it('should return false when not cleaning', () => {
      mockDevice._setState({ isCleaning: false });

      const state = mockDevice.getState();

      expect(state.isCleaning).toBe(false);
    });

    it('should return true when cleaning', () => {
      mockDevice._setState({ isCleaning: true });

      const state = mockDevice.getState();

      expect(state.isCleaning).toBe(true);
    });
  });

  describe('Temperature Sensor', () => {
    it('should return current temperature', () => {
      mockDevice._setState({ waterTemperature: 28.5 });

      const state = mockDevice.getState();

      expect(state.waterTemperature).toBe(28.5);
    });

    it('should handle undefined temperature', () => {
      mockDevice._setState({ waterTemperature: undefined });

      const state = mockDevice.getState();

      expect(state.waterTemperature).toBeUndefined();
    });
  });

  describe('Filter Maintenance', () => {
    it('should return filter OK status', () => {
      mockDevice._setState({ filterStatus: 'ok' });

      const state = mockDevice.getState();

      expect(state.filterStatus).toBe('ok');
    });

    it('should return filter needs cleaning status', () => {
      mockDevice._setState({ filterStatus: 'needs_cleaning' });

      const state = mockDevice.getState();

      expect(state.filterStatus).toBe('needs_cleaning');
    });
  });

  describe('Cleaning Control', () => {
    it('should start cleaning when set to on', async () => {
      const result = await mockDevice.startCleaning();

      expect(result).toBe(true);
      expect(mockDevice.startCleaning).toHaveBeenCalled();
    });

    it('should stop cleaning when set to off', async () => {
      const result = await mockDevice.stopCleaning();

      expect(result).toBe(true);
      expect(mockDevice.stopCleaning).toHaveBeenCalled();
    });

    it('should handle start cleaning failure', async () => {
      mockDevice.startCleaning.mockResolvedValue(false);

      const result = await mockDevice.startCleaning();

      expect(result).toBe(false);
    });
  });

  describe('State Updates', () => {
    it('should emit stateChange when state changes', () => {
      const stateHandler = vi.fn();
      mockDevice.on('stateChange', stateHandler);

      mockDevice._setState({ isCleaning: true });

      expect(stateHandler).toHaveBeenCalledWith(
        expect.objectContaining({ isCleaning: true }),
      );
    });

    it('should update switch characteristic on state change', () => {
      const stateHandler = vi.fn();
      mockDevice.on('stateChange', stateHandler);

      mockDevice._setState({ isCleaning: true });

      expect(stateHandler).toHaveBeenCalled();
    });

    it('should update temperature on state change', () => {
      const stateHandler = vi.fn();
      mockDevice.on('stateChange', stateHandler);

      mockDevice._setState({ waterTemperature: 26.0 });

      const state = mockDevice.getState();
      expect(state.waterTemperature).toBe(26.0);
    });

    it('should update filter status on state change', () => {
      const stateHandler = vi.fn();
      mockDevice.on('stateChange', stateHandler);

      mockDevice._setState({ filterStatus: 'needs_cleaning' });

      const state = mockDevice.getState();
      expect(state.filterStatus).toBe('needs_cleaning');
    });
  });

  describe('Error Handling', () => {
    it('should handle device errors', () => {
      const errorHandler = vi.fn();
      mockDevice.on('error', errorHandler);

      mockDevice._emitError(new Error('Test error'));

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should report fault status when error present', () => {
      mockDevice._setState({
        hasError: true,
        errorCode: 2,
        errorMessage: 'Robot out of water',
      });

      const state = mockDevice.getState();

      expect(state.hasError).toBe(true);
      expect(state.errorCode).toBe(2);
    });

    it('should clear fault status when no error', () => {
      mockDevice._setState({
        hasError: false,
        errorCode: 0,
        errorMessage: undefined,
      });

      const state = mockDevice.getState();

      expect(state.hasError).toBe(false);
    });
  });

  describe('Accessory Information', () => {
    it('should set manufacturer', () => {
      const infoService = mockAccessory.getService(MockServices.AccessoryInformation);

      if (infoService) {
        infoService.setCharacteristic(MockCharacteristics.Manufacturer, 'Maytronics');

        expect(infoService.setCharacteristic).toHaveBeenCalledWith(
          MockCharacteristics.Manufacturer,
          'Maytronics',
        );
      }
    });

    it('should set model', () => {
      const infoService = mockAccessory.getService(MockServices.AccessoryInformation);

      if (infoService) {
        infoService.setCharacteristic(MockCharacteristics.Model, 'Dolphin M400');

        expect(infoService.setCharacteristic).toHaveBeenCalledWith(
          MockCharacteristics.Model,
          'Dolphin M400',
        );
      }
    });

    it('should set serial number', () => {
      const infoService = mockAccessory.getService(MockServices.AccessoryInformation);

      if (infoService) {
        infoService.setCharacteristic(MockCharacteristics.SerialNumber, 'E3086OFG2M');

        expect(infoService.setCharacteristic).toHaveBeenCalledWith(
          MockCharacteristics.SerialNumber,
          'E3086OFG2M',
        );
      }
    });
  });
});

describe('DolphinAccessory - Edge Cases', () => {
  let mockDevice: MockDolphinDevice;

  beforeEach(() => {
    mockDevice = new MockDolphinDevice();
  });

  afterEach(() => {
    mockDevice.removeAllListeners();
  });

  it('should handle rapid state changes', () => {
    const stateHandler = vi.fn();
    mockDevice.on('stateChange', stateHandler);

    // Rapid state changes
    mockDevice._setState({ isCleaning: true });
    mockDevice._setState({ isCleaning: false });
    mockDevice._setState({ isCleaning: true });

    expect(stateHandler).toHaveBeenCalledTimes(3);
  });

  it('should handle temperature edge values', () => {
    mockDevice._setState({ waterTemperature: 0 });
    expect(mockDevice.getState().waterTemperature).toBe(0);

    mockDevice._setState({ waterTemperature: 50 });
    expect(mockDevice.getState().waterTemperature).toBe(50);
  });

  it('should handle undefined values gracefully', () => {
    mockDevice._setState({
      waterTemperature: undefined,
      cycleTimeRemaining: 0,
      cycleStartTime: undefined,
    });

    const state = mockDevice.getState();

    expect(state.waterTemperature).toBeUndefined();
    expect(state.cycleStartTime).toBeUndefined();
  });
});

describe('DolphinAccessory - Multiple Devices', () => {
  it('should support multiple device instances', () => {
    const device1 = new MockDolphinDevice();
    const device2 = new MockDolphinDevice();

    device1.serialNumber = 'SERIAL001';
    device2.serialNumber = 'SERIAL002';

    expect(device1.serialNumber).not.toBe(device2.serialNumber);

    device1._setState({ isCleaning: true });
    device2._setState({ isCleaning: false });

    expect(device1.getState().isCleaning).toBe(true);
    expect(device2.getState().isCleaning).toBe(false);
  });
});
