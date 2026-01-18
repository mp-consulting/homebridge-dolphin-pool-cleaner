/**
 * Dolphin Pool Cleaner Platform
 *
 * Homebridge dynamic platform plugin for Maytronics Dolphin pool robots.
 */
import type {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import {
  PLUGIN_NAME,
  PLATFORM_NAME,
  DEFAULT_POLLING_INTERVAL,
  MIN_POLLING_INTERVAL,
} from './config/constants.js';
import { MaytronicsAPI } from './api/maytronicsApi.js';
import { DolphinDevice } from './devices/dolphinDevice.js';
import { DolphinAccessory } from './accessories/dolphinAccessory.js';

export interface DeviceConfig {
  serialNumber?: string;
  name?: string;
  enableTemperature?: boolean;
  enableFilterStatus?: boolean;
  cleaningMode?: string;
}

export interface DolphinPlatformConfig extends PlatformConfig {
  email?: string;
  password?: string;
  refreshToken?: string;
  iotRegion?: string;
  pollingInterval?: number;
  devices?: DeviceConfig[];
}

export class DolphinPoolCleanerPlatform implements DynamicPlatformPlugin {
  public readonly log: Logger;
  public readonly homebridgeApi: API;
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  // Track restored cached accessories
  private readonly accessories: Map<string, PlatformAccessory> = new Map();
  // Active accessory handlers
  private readonly accessoryHandlers: Map<string, DolphinAccessory> = new Map();
  // API client
  private api: MaytronicsAPI | undefined;
  // Devices
  private readonly devices: Map<string, DolphinDevice> = new Map();
  // Config
  private readonly config: DolphinPlatformConfig;

  constructor(log: Logger, config: PlatformConfig, homebridgeApi: API) {
    this.log = log;
    this.homebridgeApi = homebridgeApi;
    this.Service = homebridgeApi.hap.Service;
    this.Characteristic = homebridgeApi.hap.Characteristic;
    this.config = config;
    this.log.debug('Initializing platform:', this.config.name || PLATFORM_NAME);
    // Validate config - need either refreshToken or email/password
    if (
      !this.config.refreshToken &&
      (!this.config.email || !this.config.password)
    ) {
      this.log.error(
        'Missing required configuration: refreshToken or email/password',
      );
      return;
    }
    // Wait for Homebridge to finish launching
    this.homebridgeApi.on('didFinishLaunching', () => {
      this.log.debug('Homebridge finished launching');
      this.discoverDevices();
    });
  }
  /**
   * Called when homebridge restores cached accessories from disk at startup.
   */
  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }
  /**
   * Discover and register devices
   */
  async discoverDevices() {
    try {
      this.log.info('Discovering Dolphin pool robots...');
      // Initialize API client with refresh token or email/password
      this.api = new MaytronicsAPI(
        this.config.email,
        this.config.password,
        this.log,
        this.config.iotRegion,
        this.config.refreshToken,
      );
      // Login and get robot info
      const authResult = await this.api.login();
      this.log.info(
        `Found robot: ${authResult.robotName} (S/N: ${authResult.serialNumber})`,
      );
      // Get detailed robot info
      const robots = await this.api.getRobots();
      // Calculate polling interval
      const pollingInterval = Math.max(
        this.config.pollingInterval || DEFAULT_POLLING_INTERVAL,
        MIN_POLLING_INTERVAL,
      );
      // Process each robot
      for (const robotInfo of robots) {
        const serialNumber = robotInfo.serialNumber;
        // Check for device-specific config
        const deviceConfig = this.config.devices?.find(
          (d) => d.serialNumber === serialNumber,
        );
        // Create device instance
        const device = new DolphinDevice(
          {
            serialNumber,
            name: deviceConfig?.name || robotInfo.name,
            deviceType: robotInfo.deviceType,
            pollingInterval,
          },
          this.api,
          this.log,
        );
        this.devices.set(serialNumber, device);
        // Generate unique ID
        const uuid = this.homebridgeApi.hap.uuid.generate(serialNumber);
        this.log.debug(`Generated UUID for ${serialNumber}: ${uuid}`);
        this.log.debug(
          `Cached accessories: ${Array.from(this.accessories.keys()).join(', ') || 'none'}`,
        );
        // Check if accessory already exists
        const existingAccessory = this.accessories.get(uuid);
        if (existingAccessory) {
          // Accessory already exists - update it
          this.log.info(
            'Restoring existing accessory:',
            existingAccessory.displayName,
          );
          // Update accessory context
          existingAccessory.context.device = robotInfo;
          existingAccessory.context.deviceConfig = deviceConfig;
          // Create accessory handler
          const handler = new DolphinAccessory(
            this,
            existingAccessory,
            device,
            deviceConfig,
          );
          this.accessoryHandlers.set(serialNumber, handler);
          // Update accessory
          this.homebridgeApi.updatePlatformAccessories([existingAccessory]);
        } else {
          // Create new accessory
          this.log.info('Adding new accessory:', robotInfo.name);
          const accessory = new this.homebridgeApi.platformAccessory(
            robotInfo.name,
            uuid,
          );
          // Store device info in context
          accessory.context.device = robotInfo;
          accessory.context.deviceConfig = deviceConfig;
          // Create accessory handler
          const handler = new DolphinAccessory(
            this,
            accessory,
            device,
            deviceConfig,
          );
          this.accessoryHandlers.set(serialNumber, handler);
          // Register accessory - store in map first to avoid duplicate registration
          this.accessories.set(uuid, accessory);
          try {
            this.homebridgeApi.registerPlatformAccessories(
              PLUGIN_NAME,
              PLATFORM_NAME,
              [accessory],
            );
          } catch (regError) {
            // This can happen if an old cached accessory exists with a different UUID
            // The accessory should still work, just log the warning
            this.log.warn(
              'Accessory registration warning:',
              regError instanceof Error ? regError.message : String(regError),
            );
          }
        }
        // Start device polling
        await device.start();
      }
      // Remove stale accessories
      const activeUUIDs = new Set(
        robots.map((r) => this.homebridgeApi.hap.uuid.generate(r.serialNumber)),
      );
      for (const [uuid, accessory] of this.accessories) {
        if (!activeUUIDs.has(uuid)) {
          this.log.info('Removing stale accessory:', accessory.displayName);
          this.homebridgeApi.unregisterPlatformAccessories(
            PLUGIN_NAME,
            PLATFORM_NAME,
            [accessory],
          );
          this.accessories.delete(uuid);
        }
      }
      this.log.info(`Discovered ${robots.length} robot(s)`);
    } catch (error) {
      this.log.error(
        'Failed to discover devices:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
//# sourceMappingURL=platform.js.map
