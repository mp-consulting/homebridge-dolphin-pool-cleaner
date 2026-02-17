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
import { MaytronicsAPI, type RobotInfo } from './api/maytronicsApi.js';
import { DolphinDevice } from './devices/dolphinDevice.js';
import { DolphinAccessory } from './accessories/dolphinAccessory.js';
import { getErrorMessage } from './utils/errors.js';

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

      const robots = await this.initializeApi();
      const pollingInterval = Math.max(
        this.config.pollingInterval || DEFAULT_POLLING_INTERVAL,
        MIN_POLLING_INTERVAL,
      );

      for (const robotInfo of robots) {
        await this.registerRobot(robotInfo, pollingInterval);
      }

      this.removeStaleAccessories(robots);
      this.log.info(`Discovered ${robots.length} robot(s)`);
    } catch (error) {
      this.log.error('Failed to discover devices:', getErrorMessage(error));
    }
  }

  /**
   * Initialize API client and return robot list
   */
  private async initializeApi(): Promise<RobotInfo[]> {
    this.api = new MaytronicsAPI(
      this.config.email,
      this.config.password,
      this.log,
      this.config.iotRegion,
      this.config.refreshToken,
    );

    const authResult = await this.api.login();
    this.log.info(
      `Found robot: ${authResult.robotName} (S/N: ${authResult.serialNumber})`,
    );

    return this.api.getRobots();
  }

  /**
   * Register or restore a single robot as a HomeKit accessory
   */
  private async registerRobot(robotInfo: RobotInfo, pollingInterval: number): Promise<void> {
    const serialNumber = robotInfo.serialNumber;
    const deviceConfig = this.config.devices?.find(
      (d) => d.serialNumber === serialNumber,
    );

    const device = new DolphinDevice(
      {
        serialNumber,
        name: deviceConfig?.name || robotInfo.name,
        deviceType: robotInfo.deviceType,
        pollingInterval,
      },
      this.api!,
      this.log,
    );
    this.devices.set(serialNumber, device);

    const uuid = this.homebridgeApi.hap.uuid.generate(serialNumber);
    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory:', existingAccessory.displayName);
      existingAccessory.context.device = robotInfo;
      existingAccessory.context.deviceConfig = deviceConfig;
      const handler = new DolphinAccessory(this, existingAccessory, device, deviceConfig);
      this.accessoryHandlers.set(serialNumber, handler);
      this.homebridgeApi.updatePlatformAccessories([existingAccessory]);
    } else {
      this.log.info('Adding new accessory:', robotInfo.name);
      const accessory = new this.homebridgeApi.platformAccessory(robotInfo.name, uuid);
      accessory.context.device = robotInfo;
      accessory.context.deviceConfig = deviceConfig;
      const handler = new DolphinAccessory(this, accessory, device, deviceConfig);
      this.accessoryHandlers.set(serialNumber, handler);
      this.accessories.set(uuid, accessory);
      try {
        this.homebridgeApi.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      } catch (regError) {
        this.log.warn('Accessory registration warning:', getErrorMessage(regError));
      }
    }

    await device.start();
  }

  /**
   * Remove cached accessories that no longer correspond to discovered robots
   */
  private removeStaleAccessories(robots: RobotInfo[]): void {
    const activeUUIDs = new Set(
      robots.map((r) => this.homebridgeApi.hap.uuid.generate(r.serialNumber)),
    );

    for (const [uuid, accessory] of this.accessories) {
      if (!activeUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        this.homebridgeApi.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }
}
