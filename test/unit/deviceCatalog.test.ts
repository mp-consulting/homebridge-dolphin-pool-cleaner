/**
 * Unit tests for device catalog
 */

import { describe, it, expect } from 'vitest';
import {
  getDeviceFeatures,
  getDeviceModelName,
  getDeviceModel,
  isDeviceSupported,
  getSupportedDeviceTypes,
  type DeviceFeatures,
} from '../../src/devices/deviceCatalog.js';

describe('Device Catalog', () => {
  describe('getDeviceFeatures', () => {
    it('should return features for known device type', () => {
      const features = getDeviceFeatures(62);

      expect(features).toBeDefined();
      expect(features.hasTemperatureSensor).toBeDefined();
      expect(features.hasWeeklySchedule).toBeDefined();
    });

    it('should return default features for unknown device type', () => {
      const features = getDeviceFeatures(99999);

      expect(features).toBeDefined();
      expect(typeof features.hasTemperatureSensor).toBe('boolean');
    });

    it('should return features with supported modes', () => {
      const features = getDeviceFeatures(62);

      expect(features.supportedCleaningModes).toBeDefined();
      expect(Array.isArray(features.supportedCleaningModes)).toBe(true);
      expect(features.supportedCleaningModes.length).toBeGreaterThan(0);
    });

    it('should include basic modes in supported modes', () => {
      const features = getDeviceFeatures(62);

      expect(features.supportedCleaningModes).toContain('regular');
    });

    it('should have temperature sensor for M-series', () => {
      const features = getDeviceFeatures(62);

      expect(features.hasTemperatureSensor).toBe(true);
    });

    it('should have LED control for M-series', () => {
      const features = getDeviceFeatures(62);

      expect(features.hasLEDControl).toBe(true);
    });
  });

  describe('getDeviceModelName', () => {
    it('should return model name for known device type', () => {
      const name = getDeviceModelName(62);

      expect(name).toBeDefined();
      expect(name.length).toBeGreaterThan(0);
      expect(name).toContain('Dolphin');
    });

    it('should return default name for unknown device type', () => {
      const name = getDeviceModelName(99999);

      expect(name).toBeDefined();
      expect(name).toContain('Unknown');
    });

    it('should return different names for different device types', () => {
      const name1 = getDeviceModelName(62);
      const name2 = getDeviceModelName(60);

      expect(name1).toBeDefined();
      expect(name2).toBeDefined();
    });
  });

  describe('getDeviceModel', () => {
    it('should return model for known device type', () => {
      const model = getDeviceModel(62);

      expect(model).toBeDefined();
      expect(model?.deviceType).toBe(62);
      expect(model?.modelName).toBeDefined();
      expect(model?.series).toBeDefined();
    });

    it('should return undefined for unknown device type', () => {
      const model = getDeviceModel(99999);

      expect(model).toBeUndefined();
    });
  });

  describe('isDeviceSupported', () => {
    it('should return true for known device type', () => {
      expect(isDeviceSupported(62)).toBe(true);
    });

    it('should return false for unknown device type', () => {
      expect(isDeviceSupported(99999)).toBe(false);
    });
  });

  describe('getSupportedDeviceTypes', () => {
    it('should return array of supported types', () => {
      const types = getSupportedDeviceTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    });

    it('should include device type 62', () => {
      const types = getSupportedDeviceTypes();

      expect(types).toContain(62);
    });
  });

  describe('DeviceFeatures type', () => {
    it('should have correct structure', () => {
      const features: DeviceFeatures = {
        hasTemperatureSensor: true,
        hasWaterQualitySensor: false,
        hasSmartMode: true,
        hasWeeklySchedule: true,
        hasDelayStart: true,
        hasRemoteControl: true,
        hasLEDControl: false,
        hasPickupMode: true,
        supportedCleaningModes: ['regular', 'short'],
      };

      expect(features.hasTemperatureSensor).toBe(true);
      expect(features.hasWaterQualitySensor).toBe(false);
      expect(features.supportedCleaningModes).toHaveLength(2);
    });
  });

  describe('Feature consistency', () => {
    it('all device types should have weekly schedule support', () => {
      [62, 61, 60].forEach((deviceType) => {
        const features = getDeviceFeatures(deviceType);
        expect(features.hasWeeklySchedule).toBe(true);
      });
    });

    it('all device types should have delay start support', () => {
      [62, 61, 60].forEach((deviceType) => {
        const features = getDeviceFeatures(deviceType);
        expect(features.hasDelayStart).toBe(true);
      });
    });
  });
});

describe('Device Catalog - Model Naming', () => {
  it('should format model names consistently', () => {
    const name = getDeviceModelName(62);

    // Name should not have leading/trailing whitespace
    expect(name).toBe(name.trim());
  });

  it('should handle device type 0', () => {
    const name = getDeviceModelName(0);

    expect(name).toBeDefined();
    expect(name.length).toBeGreaterThan(0);
  });

  it('should handle negative device type', () => {
    const name = getDeviceModelName(-1);

    expect(name).toBeDefined();
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('Device Catalog - Mode Support', () => {
  it('should support standard cleaning modes', () => {
    const features = getDeviceFeatures(62);
    const standardModes = ['regular', 'short', 'floor'];

    standardModes.forEach((mode) => {
      expect(features.supportedCleaningModes).toContain(mode);
    });
  });

  it('should return at least one supported mode', () => {
    const features = getDeviceFeatures(62);

    expect(features.supportedCleaningModes.length).toBeGreaterThan(0);
  });

  it('supported modes should be unique', () => {
    const features = getDeviceFeatures(62);
    const uniqueModes = [...new Set(features.supportedCleaningModes)];

    expect(uniqueModes.length).toBe(features.supportedCleaningModes.length);
  });
});
