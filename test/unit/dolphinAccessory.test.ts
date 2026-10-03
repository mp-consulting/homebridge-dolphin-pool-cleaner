/**
 * Unit tests for DolphinAccessory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  createMockLogger,
  createMockPlatformAccessory,
  MockServices,
  MockCharacteristics,
} from '../mocks/index.js';
import { DolphinAccessory } from '../../src/accessories/dolphinAccessory.js';
import type { DeviceConfig } from '../../src/platform.js';
import { createDefaultState } from '../../src/parsers/index.js';

class MockHapStatusError extends Error {
  constructor(readonly hapStatus: number) {
    super(`HAP status ${hapStatus}`);
  }
}

const FilterChangeIndication = { ...MockCharacteristics.FilterChangeIndication, FILTER_OK: 0, CHANGE_FILTER: 1 };

describe('DolphinAccessory', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockAccessory: ReturnType<typeof createMockPlatformAccessory>;

  const createDevice = (overrides: Record<string, unknown> = {}) => {
    const state = { ...createDefaultState(), connected: true, temperature: 24 as number | undefined };
    return Object.assign(new EventEmitter(), {
      serialNumber: 'E3086OFG2M',
      name: 'Dolphin M400',
      modelName: 'Dolphin M400',
      features: { hasTemperatureSensor: true },
      state,
      getState: vi.fn(() => ({ ...state })),
      startCleaning: vi.fn().mockResolvedValue(true),
      stopCleaning: vi.fn().mockResolvedValue(true),
      ...overrides,
    });
  };

  const createAccessory = (device: unknown, deviceConfig?: DeviceConfig) => {
    const platform = {
      // Valve is only looked up to migrate away from it
      Service: { ...MockServices, Valve: { name: 'Valve', UUID: 'mock-service-uuid-Valve' } },
      Characteristic: {
        ...MockCharacteristics,
        FilterChangeIndication,
        ConfiguredName: { name: 'ConfiguredName', UUID: 'mock-uuid-ConfiguredName' },
      },
      homebridgeApi: { hap: { HapStatusError: MockHapStatusError } },
      log: mockLogger,
    };
    return new DolphinAccessory(platform as never, mockAccessory, device as never, deviceConfig);
  };

  const characteristic = (service: { name: string }, char: { name: string }) =>
    mockAccessory.getService(service as never)!.getCharacteristic(char as never);

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockAccessory = createMockPlatformAccessory('Dolphin M400', 'test-uuid-123');
  });

  describe('services', () => {
    it('should expose a switch, a temperature sensor and a filter indicator by default', () => {
      createAccessory(createDevice());

      expect(mockAccessory.getService(MockServices.Switch as never)).toBeDefined();
      expect(mockAccessory.getService(MockServices.TemperatureSensor as never)).toBeDefined();
      expect(mockAccessory.getService(MockServices.FilterMaintenance as never)).toBeDefined();
    });

    it('should remove sensors that were disabled in the config', () => {
      createAccessory(createDevice());
      createAccessory(createDevice(), { enableTemperature: false, enableFilterStatus: false });

      expect(mockAccessory.getService(MockServices.TemperatureSensor as never)).toBeUndefined();
      expect(mockAccessory.getService(MockServices.FilterMaintenance as never)).toBeUndefined();
    });

    it('should skip the temperature sensor on robots without one', () => {
      createAccessory(createDevice({ features: { hasTemperatureSensor: false } }));

      expect(mockAccessory.getService(MockServices.TemperatureSensor as never)).toBeUndefined();
    });
  });

  describe('temperature', () => {
    it('should report the current reading and remember it', async () => {
      const accessory = createAccessory(createDevice());
      accessory.handleStateChange({ ...createDefaultState(), temperature: 26 });

      await expect(accessory.getTemperature()).resolves.toBe(24);
      expect(mockAccessory.context.lastTemperature).toBe(26);
    });

    it('should fall back to the last known reading', async () => {
      mockAccessory.context.lastTemperature = 22.5;
      const device = createDevice();
      device.state.temperature = undefined;

      await expect(createAccessory(device).getTemperature()).resolves.toBe(22.5);
    });

    it('should report an error rather than invent a temperature', async () => {
      const device = createDevice();
      device.state.temperature = undefined;

      await expect(createAccessory(device).getTemperature()).rejects.toMatchObject({ hapStatus: -70402 });
    });
  });

  describe('state changes', () => {
    it('should update the switch and the filter indicator', () => {
      const device = createDevice();
      createAccessory(device);

      device.emit('stateChange', { ...createDefaultState(), isCleaning: true, filterStatus: 'needs_cleaning' });

      expect(characteristic(MockServices.Switch, MockCharacteristics.On).value).toBe(true);
      expect(characteristic(MockServices.FilterMaintenance, FilterChangeIndication).value).toBe(1);
    });

    it('should not flip the switch back during the grace period after a command', async () => {
      const device = createDevice();
      const accessory = createAccessory(device);

      await accessory.setOn(true);
      // A stale shadow arrives before the robot has reported the start
      device.emit('stateChange', { ...createDefaultState(), isCleaning: false });

      expect(characteristic(MockServices.Switch, MockCharacteristics.On).value).toBe(true);
    });

    it('should stop listening to the device once disposed', () => {
      const device = createDevice();
      createAccessory(device).dispose();

      expect(device.listenerCount('stateChange')).toBe(0);
      expect(device.listenerCount('disconnect')).toBe(0);
    });
  });

  describe('commands', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start in the configured mode', async () => {
      const device = createDevice();

      await createAccessory(device, { cleaningMode: 'floor' }).setOn(true);

      expect(device.startCleaning).toHaveBeenCalledWith('floor');
    });

    it('should start in "all" mode when none is configured', async () => {
      const device = createDevice();

      await createAccessory(device).setOn(true);

      expect(device.startCleaning).toHaveBeenCalledWith('all');
    });

    it('should not send a command when the robot is already in the requested state', async () => {
      const device = createDevice();

      await createAccessory(device).setOn(false);

      expect(device.stopCleaning).not.toHaveBeenCalled();
    });

    it('should revert the switch when the cloud does not accept the command', async () => {
      const device = createDevice({ startCleaning: vi.fn().mockResolvedValue(false) });

      await createAccessory(device).setOn(true);

      expect(characteristic(MockServices.Switch, MockCharacteristics.On).value).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('did not accept the start command'));
    });

    it('should revert the switch when the command throws', async () => {
      const device = createDevice({ startCleaning: vi.fn().mockRejectedValue(new Error('boom')) });

      await createAccessory(device).setOn(true);

      expect(characteristic(MockServices.Switch, MockCharacteristics.On).value).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should leave the switch on when the command is accepted', async () => {
      const device = createDevice();

      await createAccessory(device).setOn(true);

      expect(characteristic(MockServices.Switch, MockCharacteristics.On).value).toBe(true);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('filter status', () => {
    it('should map the device filter status to HomeKit', async () => {
      const device = createDevice();
      const accessory = createAccessory(device);

      await expect(accessory.getFilterStatus()).resolves.toBe(0);
      device.state.filterStatus = 'needs_cleaning';
      await expect(accessory.getFilterStatus()).resolves.toBe(1);
    });
  });
});
