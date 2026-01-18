/**
 * Dolphin Pool Cleaner Accessory
 *
 * Exposes a Dolphin robot to HomeKit as a switch/valve with optional sensors.
 */
import type { PlatformAccessory, Service, CharacteristicValue } from 'homebridge';
import type { DolphinPoolCleanerPlatform } from '../platform.js';
import type { DolphinDevice, RobotState } from '../devices/dolphinDevice.js';

export interface DeviceConfig {
  serialNumber?: string;
  name?: string;
  enableTemperature?: boolean;
  enableFilterStatus?: boolean;
  cleaningMode?: string;
}

export class DolphinAccessory {
  private readonly platform: DolphinPoolCleanerPlatform;
  private readonly accessory: PlatformAccessory;
  private readonly device: DolphinDevice;
  private readonly deviceConfig: DeviceConfig | undefined;
  private readonly switchService: Service;
  private readonly temperatureService?: Service;
  private readonly filterService?: Service;
  private isUpdating = false;

  constructor(
    platform: DolphinPoolCleanerPlatform,
    accessory: PlatformAccessory,
    device: DolphinDevice,
    deviceConfig: DeviceConfig | undefined,
  ) {
    this.platform = platform;
    this.accessory = accessory;
    this.device = device;
    this.deviceConfig = deviceConfig;
    // Set accessory information
    const infoService = this.accessory.getService(
      this.platform.Service.AccessoryInformation,
    );
    if (infoService) {
      infoService
        .setCharacteristic(
          this.platform.Characteristic.Manufacturer,
          'Maytronics',
        )
        .setCharacteristic(
          this.platform.Characteristic.Model,
          this.device.modelName,
        )
        .setCharacteristic(
          this.platform.Characteristic.SerialNumber,
          this.device.serialNumber,
        )
        .setCharacteristic(
          this.platform.Characteristic.FirmwareRevision,
          '1.0.0',
        );
    }
    // Remove old Valve service if it exists (migration from previous version)
    const existingValveService = this.accessory.getService(
      this.platform.Service.Valve,
    );
    if (existingValveService) {
      this.accessory.removeService(existingValveService);
    }
    // Create Switch service for robot on/off control
    this.switchService =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(
        this.platform.Service.Switch,
        this.device.name,
        'robot-switch',
      );
    this.switchService.setCharacteristic(
      this.platform.Characteristic.Name,
      this.device.name,
    );
    // Set ConfiguredName for better HomeKit display
    this.switchService.setCharacteristic(
      this.platform.Characteristic.ConfiguredName,
      this.device.name,
    );
    // Set up switch handlers
    this.switchService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
    // Create temperature sensor if device supports it and enabled
    if (
      this.device.features.hasTemperatureSensor &&
      this.deviceConfig?.enableTemperature !== false
    ) {
      this.temperatureService =
        this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(
          this.platform.Service.TemperatureSensor,
          `${this.device.name} Water Temperature`,
          'water-temperature',
        );
      this.temperatureService.setCharacteristic(
        this.platform.Characteristic.Name,
        `${this.device.name} Water Temperature`,
      );
      this.temperatureService.setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        `${this.device.name} Water Temperature`,
      );
      this.temperatureService
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getTemperature.bind(this));
    } else {
      // Remove temperature service if it exists but is disabled
      const existingTempService = this.accessory.getService(
        this.platform.Service.TemperatureSensor,
      );
      if (existingTempService) {
        this.accessory.removeService(existingTempService);
      }
    }
    // Create filter maintenance service if enabled
    if (this.deviceConfig?.enableFilterStatus !== false) {
      this.filterService =
        this.accessory.getService(this.platform.Service.FilterMaintenance) ||
        this.accessory.addService(
          this.platform.Service.FilterMaintenance,
          `${this.device.name} Filter`,
          'filter-maintenance',
        );
      this.filterService.setCharacteristic(
        this.platform.Characteristic.Name,
        `${this.device.name} Filter`,
      );
      this.filterService.setCharacteristic(
        this.platform.Characteristic.ConfiguredName,
        `${this.device.name} Filter`,
      );
      this.filterService
        .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
        .onGet(this.getFilterStatus.bind(this));
    } else {
      // Remove filter service if it exists but is disabled
      const existingFilterService = this.accessory.getService(
        this.platform.Service.FilterMaintenance,
      );
      if (existingFilterService) {
        this.accessory.removeService(existingFilterService);
      }
    }
    // Subscribe to device state changes
    this.device.on('stateChange', this.handleStateChange.bind(this));
    this.device.on('disconnect', this.handleDisconnect.bind(this));
    this.platform.log.debug(`Accessory initialized: ${this.device.name}`);
  }
  /**
   * Handle device state changes
   */
  handleStateChange(state: RobotState): void {
    if (this.isUpdating) {
      return;
    }
    this.platform.log.debug(
      `State change received: isCleaning=${state.isCleaning}, mode=${state.cleaningMode}, temp=${state.temperature}`,
    );
    // Update switch state
    this.switchService.updateCharacteristic(
      this.platform.Characteristic.On,
      state.isCleaning,
    );
    // Update temperature if available
    if (this.temperatureService && state.temperature !== undefined) {
      this.temperatureService.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        state.temperature,
      );
    }
    // Update filter status
    if (this.filterService) {
      this.filterService.updateCharacteristic(
        this.platform.Characteristic.FilterChangeIndication,
        state.filterStatus === 'needs_cleaning'
          ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.platform.Characteristic.FilterChangeIndication.FILTER_OK,
      );
    }
  }
  /**
   * Handle device disconnect
   */
  handleDisconnect() {
    this.platform.log.warn(`Device disconnected: ${this.device.name}`);
  }
  /**
   * Get switch On state (is robot cleaning)
   */
  async getOn() {
    const state = this.device.getState();
    this.platform.log.debug(`Get On: ${state.isCleaning}`);
    return state.isCleaning;
  }
  /**
   * Set switch On state (start/stop cleaning)
   */
  async setOn(value: CharacteristicValue): Promise<void> {
    const targetOn = value as boolean;
    const state = this.device.getState();
    this.platform.log.debug(
      `Set On: ${targetOn} (current: ${state.isCleaning})`,
    );
    if (targetOn === state.isCleaning) {
      return;
    }
    this.isUpdating = true;
    try {
      if (targetOn) {
        // Start cleaning with configured or default mode
        const mode = this.deviceConfig?.cleaningMode || 'regular';
        await this.device.startCleaning(mode);
      } else {
        // Stop cleaning
        await this.device.stopCleaning();
      }
    } catch (error) {
      this.platform.log.error(
        `Failed to ${targetOn ? 'start' : 'stop'} cleaning:`,
        error,
      );
      // Don't re-throw - just log the error and let HomeKit retry
    } finally {
      this.isUpdating = false;
    }
  }
  /**
   * Get water temperature
   */
  async getTemperature() {
    const state = this.device.getState();
    const temp = state.temperature ?? 20; // Default to 20°C if not available
    this.platform.log.debug(`Get Temperature: ${temp}°C`);
    return temp;
  }
  /**
   * Get filter status
   */
  async getFilterStatus() {
    const state = this.device.getState();
    const needsCleaning = state.filterStatus === 'needs_cleaning';
    this.platform.log.debug(
      `Get Filter Status: ${needsCleaning ? 'needs cleaning' : 'ok'}`,
    );
    return needsCleaning
      ? this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER
      : this.platform.Characteristic.FilterChangeIndication.FILTER_OK;
  }
}
//# sourceMappingURL=dolphinAccessory.js.map
