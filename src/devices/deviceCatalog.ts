/**
 * Dolphin Robot Device Catalog
 *
 * Defines supported robot models and their features
 */

export interface DeviceFeatures {
  hasTemperatureSensor: boolean;
  hasWaterQualitySensor: boolean;
  hasSmartMode: boolean;
  hasWeeklySchedule: boolean;
  hasDelayStart: boolean;
  hasRemoteControl: boolean;
  hasLEDControl: boolean;
  hasPickupMode: boolean;
  supportedCleaningModes: string[];
}

export interface DeviceModel {
  deviceType: number;
  modelName: string;
  series: string;
  features: DeviceFeatures;
}

// Base features for IoT-enabled models
const BASE_IOT_FEATURES: DeviceFeatures = {
  hasTemperatureSensor: false,
  hasWaterQualitySensor: false,
  hasSmartMode: true,
  hasWeeklySchedule: true,
  hasDelayStart: true,
  hasRemoteControl: true,
  hasLEDControl: false,
  hasPickupMode: true,
  supportedCleaningModes: [
    'regular',
    'floor',
    'wall',
    'water',
    'ultra',
    'short',
  ],
};
// M400/M600 series features
// Note: Temperature sensor varies by model/region - not all M400/M600 have it
const M_SERIES_FEATURES: DeviceFeatures = {
  ...BASE_IOT_FEATURES,
  hasTemperatureSensor: false,
  hasLEDControl: true,
  supportedCleaningModes: [
    'regular',
    'floor',
    'wall',
    'water',
    'ultra',
    'short',
    'cove',
    'spot',
  ],
};
// Liberty series features
// Note: Temperature sensor varies by model/region
const LIBERTY_FEATURES: DeviceFeatures = {
  ...BASE_IOT_FEATURES,
  hasTemperatureSensor: false,
  hasWaterQualitySensor: false,
  hasLEDControl: true,
  supportedCleaningModes: ['regular', 'floor', 'wall', 'ultra', 'short'],
};
// Device catalog - maps device types to models
export const DEVICE_CATALOG: Record<number, DeviceModel> = {
  // M400 series
  62: {
    deviceType: 62,
    modelName: 'Dolphin M400/M600',
    series: 'M-Series',
    features: M_SERIES_FEATURES,
  },
  // Liberty series
  65: {
    deviceType: 65,
    modelName: 'Dolphin Liberty',
    series: 'Liberty',
    features: LIBERTY_FEATURES,
  },
  // Other IoT-enabled models
  60: {
    deviceType: 60,
    modelName: 'Dolphin S Series',
    series: 'S-Series',
    features: BASE_IOT_FEATURES,
  },
  61: {
    deviceType: 61,
    modelName: 'Dolphin E Series',
    series: 'E-Series',
    features: BASE_IOT_FEATURES,
  },
};
/**
 * Get device model info by device type
 */
export function getDeviceModel(deviceType: number): DeviceModel | undefined {
  return DEVICE_CATALOG[deviceType];
}
/**
 * Get device features by device type
 */
export function getDeviceFeatures(deviceType: number): DeviceFeatures {
  const model = DEVICE_CATALOG[deviceType];
  return model?.features || BASE_IOT_FEATURES;
}
/**
 * Check if a device type is supported
 */
export function isDeviceSupported(deviceType: number): boolean {
  return deviceType in DEVICE_CATALOG;
}
/**
 * Get device model name by device type
 */
export function getDeviceModelName(deviceType: number): string {
  const model = DEVICE_CATALOG[deviceType];
  return model?.modelName || `Unknown Dolphin (Type ${deviceType})`;
}
/**
 * Get all supported device types
 */
export function getSupportedDeviceTypes(): number[] {
  return Object.keys(DEVICE_CATALOG).map((k) => parseInt(k, 10));
}
//# sourceMappingURL=deviceCatalog.js.map
