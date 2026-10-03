/**
 * Unit tests for DolphinDevice
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createMockLogger } from '../mocks/index.js';
import { DolphinDevice, resolveCleaningMode } from '../../src/devices/dolphinDevice.js';

describe('DolphinDevice', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should expose identity and catalog features', () => {
      const device = new DolphinDevice(
        { serialNumber: 'E3086OFG2M', name: 'Dolphin M400', deviceType: 62, pollingInterval: 60 },
        new EventEmitter() as never,
        mockLogger,
      );

      expect(device.serialNumber).toBe('E3086OFG2M');
      expect(device.name).toBe('Dolphin M400');
      expect(typeof device.features.hasTemperatureSensor).toBe('boolean');
      expect(device.getState()).toMatchObject({ connected: false, isCleaning: false });
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

  describe('state notifications', () => {
    const createApi = () =>
      Object.assign(new EventEmitter(), {
        getThingShadow: vi.fn(),
        getLastShadowReceivedAt: vi.fn().mockReturnValue(0),
      });
    const shadow = { version: 5, state: { reported: { systemState: { pwsState: 'cleaning' } } } };

    it('should not notify again for a shadow version it already applied', async () => {
      const api = createApi();
      api.getThingShadow.mockResolvedValue(shadow);
      const device = new DolphinDevice(
        { serialNumber: 'E3086OFG2M', name: 'Pool', deviceType: 62, pollingInterval: 60 },
        api as never,
        mockLogger,
      );
      const onStateChange = vi.fn();
      device.on('stateChange', onStateChange);

      await device.refreshState();
      await device.refreshState();

      expect(onStateChange).toHaveBeenCalledTimes(1);
    });

    it('should hand listeners a snapshot rather than its live state', async () => {
      const api = createApi();
      api.getThingShadow.mockResolvedValue(shadow);
      const device = new DolphinDevice(
        { serialNumber: 'E3086OFG2M', name: 'Pool', deviceType: 62, pollingInterval: 60 },
        api as never,
        mockLogger,
      );
      device.on('stateChange', (state) => {
        state.isCleaning = false;
      });

      await device.refreshState();

      expect(device.getState().isCleaning).toBe(true);
    });
  });

  describe('commands', () => {
    const createApi = () =>
      Object.assign(new EventEmitter(), {
        getThingShadow: vi.fn().mockResolvedValue(undefined),
        getLastShadowReceivedAt: vi.fn().mockReturnValue(0),
        setCleaningMode: vi.fn().mockResolvedValue(true),
        startRobot: vi.fn().mockResolvedValue(true),
        stopRobot: vi.fn().mockResolvedValue(true),
      });
    let api: ReturnType<typeof createApi>;
    let device: DolphinDevice;

    beforeEach(() => {
      vi.useFakeTimers();
      api = createApi();
      device = new DolphinDevice(
        { serialNumber: 'E3086OFG2M', name: 'Pool', deviceType: 62, pollingInterval: 60 },
        api as never,
        mockLogger,
      );
    });

    afterEach(() => {
      device.stop();
      vi.useRealTimers();
    });

    it('should set the mode, then start', async () => {
      await expect(device.startCleaning('floor')).resolves.toBe(true);

      expect(api.setCleaningMode).toHaveBeenCalledWith('E3086OFG2M', 'floor');
      expect(api.startRobot).toHaveBeenCalledWith('E3086OFG2M');
      expect(device.getState()).toMatchObject({ isCleaning: true, cleaningMode: 'floor' });
    });

    it('should translate the legacy "regular" mode to "all"', async () => {
      await device.startCleaning('regular');

      expect(api.setCleaningMode).toHaveBeenCalledWith('E3086OFG2M', 'all');
    });

    it('should skip the mode request when the robot already has that mode queued', async () => {
      api.getThingShadow.mockResolvedValue({
        version: 1,
        state: { reported: { nextCycleInfo: { cleaningMode: { mode: 'floor' } } } },
      });
      await device.refreshState();

      await device.startCleaning('floor');

      expect(api.setCleaningMode).not.toHaveBeenCalled();
      expect(api.startRobot).toHaveBeenCalled();
    });

    it('should not repeat the mode request on the next start', async () => {
      await device.startCleaning('wall');
      await device.startCleaning('wall');

      expect(api.setCleaningMode).toHaveBeenCalledTimes(1);
    });

    it('should still start when the mode cannot be set', async () => {
      api.setCleaningMode.mockResolvedValue(false);

      await expect(device.startCleaning('floor')).resolves.toBe(true);

      expect(api.startRobot).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not set cleaning mode floor'));
    });

    it('should start without a mode request for an unknown or prototype mode name', async () => {
      await device.startCleaning('toString');

      expect(api.setCleaningMode).not.toHaveBeenCalled();
      expect(api.startRobot).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Unknown cleaning mode "toString"'));
    });

    it('should leave the state alone when the cloud refuses the start', async () => {
      api.startRobot.mockResolvedValue(false);

      await expect(device.startCleaning('all')).resolves.toBe(false);

      expect(device.getState().isCleaning).toBe(false);
    });

    it('should refresh once after a burst of commands', async () => {
      await device.startCleaning('all');
      await device.stopCleaning();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(api.getThingShadow).toHaveBeenCalledTimes(1);
    });

    it('should cancel a pending refresh when stopped', async () => {
      await device.stopCleaning();
      device.stop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(api.getThingShadow).not.toHaveBeenCalled();
    });

    it('should reject an unknown mode in setCleaningMode', async () => {
      await expect(device.setCleaningMode('turbo')).resolves.toBe(false);
      await expect(device.setCleaningMode('cove')).resolves.toBe(true);

      expect(api.setCleaningMode).toHaveBeenCalledTimes(1);
      expect(device.getState().cleaningMode).toBe('cove');
    });
  });
});

describe('resolveCleaningMode', () => {
  it.each([
    ['all', 'all'],
    ['regular', 'all'],
    ['Fast', 'short'],
    ['tictac', 'tictac'],
    ['turbo', undefined],
    ['constructor', undefined],
  ])('should resolve %s to %s', (input, expected) => {
    expect(resolveCleaningMode(input)).toBe(expected);
  });
});
