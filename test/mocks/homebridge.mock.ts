/**
 * Mock Homebridge API and related types for testing
 */

import { vi } from 'vitest';
import type {
  API,
  Logger,
  PlatformAccessory,
  Service,
  Characteristic,
  CharacteristicValue,
  WithUUID,
} from 'homebridge';

/**
 * Create a mock logger
 */
export function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    success: vi.fn(),
  } as unknown as Logger;
}

/**
 * Create a mock characteristic
 */
export function createMockCharacteristic(name: string): Characteristic {
  let value: CharacteristicValue = null;
  const listeners: Map<string, ((...args: unknown[]) => void)[]> = new Map();

  const characteristic = {
    displayName: name,
    UUID: `mock-uuid-${name}`,
    value,
    props: {},

    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
      return characteristic;
    }),

    onGet: vi.fn((handler: () => CharacteristicValue | Promise<CharacteristicValue>) => {
      characteristic.on('get', handler);
      return characteristic;
    }),

    onSet: vi.fn((handler: (value: CharacteristicValue) => void | Promise<void>) => {
      characteristic.on('set', handler);
      return characteristic;
    }),

    setValue: vi.fn((newValue: CharacteristicValue) => {
      value = newValue;
      characteristic.value = newValue;
      return characteristic;
    }),

    updateValue: vi.fn((newValue: CharacteristicValue) => {
      value = newValue;
      characteristic.value = newValue;
      return characteristic;
    }),

    getValue: vi.fn(() => value),

    setProps: vi.fn((props: Record<string, unknown>) => {
      Object.assign(characteristic.props, props);
      return characteristic;
    }),

    // Helper for tests to trigger events
    _emit: (event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event) || [];
      handlers.forEach(handler => handler(...args));
    },
  };

  return characteristic as unknown as Characteristic;
}

/**
 * Create a mock service
 */
export function createMockService(name: string, subtype?: string): Service {
  const characteristics: Map<string, Characteristic> = new Map();

  const service = {
    displayName: name,
    UUID: `mock-service-uuid-${name}`,
    subtype,
    characteristics: [],

    getCharacteristic: vi.fn((characteristic: WithUUID<new () => Characteristic> | string) => {
      const charName = typeof characteristic === 'string'
        ? characteristic
        : (characteristic as unknown as { name: string }).name || 'Unknown';

      if (!characteristics.has(charName)) {
        characteristics.set(charName, createMockCharacteristic(charName));
      }
      return characteristics.get(charName)!;
    }),

    setCharacteristic: vi.fn((characteristic: WithUUID<new () => Characteristic> | string, value: CharacteristicValue) => {
      const char = service.getCharacteristic(characteristic);
      char.updateValue(value);
      return service;
    }),

    updateCharacteristic: vi.fn((characteristic: WithUUID<new () => Characteristic> | string, value: CharacteristicValue) => {
      const char = service.getCharacteristic(characteristic);
      char.updateValue(value);
      return service;
    }),

    addCharacteristic: vi.fn((characteristic: WithUUID<new () => Characteristic>) => {
      return service.getCharacteristic(characteristic);
    }),

    addOptionalCharacteristic: vi.fn(),

    setHiddenService: vi.fn(() => service),
    addLinkedService: vi.fn(() => service),
    removeLinkedService: vi.fn(() => service),
  };

  return service as unknown as Service;
}

/**
 * Create a mock platform accessory
 */
export function createMockPlatformAccessory(displayName: string, uuid: string): PlatformAccessory {
  const services: Map<string, Service> = new Map();
  const context: Record<string, unknown> = {};

  const accessory = {
    displayName,
    UUID: uuid,
    context,
    category: 1,
    services: [],

    getService: vi.fn((serviceType: WithUUID<typeof Service> | string) => {
      const serviceName = typeof serviceType === 'string'
        ? serviceType
        : (serviceType as unknown as { name: string }).name || 'Unknown';
      return services.get(serviceName);
    }),

    getServiceById: vi.fn((serviceType: WithUUID<typeof Service>, subtype: string) => {
      const serviceName = typeof serviceType === 'string'
        ? serviceType
        : (serviceType as unknown as { name: string }).name || 'Unknown';
      return services.get(`${serviceName}-${subtype}`);
    }),

    addService: vi.fn((serviceType: WithUUID<typeof Service> | Service, name?: string, subtype?: string) => {
      const serviceName = typeof serviceType === 'string'
        ? serviceType
        : (serviceType as unknown as { name: string }).name || name || 'Unknown';
      const key = subtype ? `${serviceName}-${subtype}` : serviceName;
      const service = createMockService(serviceName, subtype);
      services.set(key, service);
      services.set(serviceName, service); // Also store by name for getService
      return service;
    }),

    removeService: vi.fn((service: Service) => {
      services.forEach((s, key) => {
        if (s === service) {
          services.delete(key);
        }
      });
    }),

    on: vi.fn(),
    emit: vi.fn(),
  };

  // Add AccessoryInformation service by default
  const infoService = createMockService('AccessoryInformation');
  services.set('AccessoryInformation', infoService);

  return accessory as unknown as PlatformAccessory;
}

/**
 * Create mock Homebridge Characteristic classes
 */
export const MockCharacteristics = {
  On: { name: 'On', UUID: '00000025-0000-1000-8000-0026BB765291' },
  Name: { name: 'Name', UUID: '00000023-0000-1000-8000-0026BB765291' },
  CurrentTemperature: { name: 'CurrentTemperature', UUID: '00000011-0000-1000-8000-0026BB765291' },
  FilterChangeIndication: { name: 'FilterChangeIndication', UUID: '000000AC-0000-1000-8000-0026BB765291' },
  FilterLifeLevel: { name: 'FilterLifeLevel', UUID: '000000AB-0000-1000-8000-0026BB765291' },
  Manufacturer: { name: 'Manufacturer', UUID: '00000020-0000-1000-8000-0026BB765291' },
  Model: { name: 'Model', UUID: '00000021-0000-1000-8000-0026BB765291' },
  SerialNumber: { name: 'SerialNumber', UUID: '00000030-0000-1000-8000-0026BB765291' },
  FirmwareRevision: { name: 'FirmwareRevision', UUID: '00000052-0000-1000-8000-0026BB765291' },
  StatusFault: { name: 'StatusFault', UUID: '00000077-0000-1000-8000-0026BB765291' },
};

/**
 * Create mock Homebridge Service classes
 */
export const MockServices = {
  AccessoryInformation: { name: 'AccessoryInformation', UUID: '0000003E-0000-1000-8000-0026BB765291' },
  Switch: { name: 'Switch', UUID: '00000049-0000-1000-8000-0026BB765291' },
  TemperatureSensor: { name: 'TemperatureSensor', UUID: '0000008A-0000-1000-8000-0026BB765291' },
  FilterMaintenance: { name: 'FilterMaintenance', UUID: '000000BA-0000-1000-8000-0026BB765291' },
};

/**
 * Create a mock Homebridge API
 */
export function createMockAPI(): API {
  const accessories: PlatformAccessory[] = [];

  const api = {
    hap: {
      Service: MockServices,
      Characteristic: MockCharacteristics,
      uuid: {
        generate: vi.fn((input: string) => `generated-uuid-${input}`),
      },
    },

    platformAccessory: vi.fn((displayName: string, uuid: string) => {
      return createMockPlatformAccessory(displayName, uuid);
    }),

    registerPlatformAccessories: vi.fn((_pluginName: string, _platformName: string, newAccessories: PlatformAccessory[]) => {
      accessories.push(...newAccessories);
    }),

    unregisterPlatformAccessories: vi.fn((_pluginName: string, _platformName: string, removedAccessories: PlatformAccessory[]) => {
      removedAccessories.forEach(acc => {
        const index = accessories.indexOf(acc);
        if (index !== -1) {
          accessories.splice(index, 1);
        }
      });
    }),

    updatePlatformAccessories: vi.fn(),

    on: vi.fn(),
    emit: vi.fn(),

    // Helper for tests
    _getAccessories: () => accessories,
  };

  return api as unknown as API;
}
