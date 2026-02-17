/**
 * Dolphin Pool Cleaner Accessory
 *
 * Exposes a Dolphin robot to HomeKit as a switch/valve with optional sensors.
 */
import type { PlatformAccessory, Service, CharacteristicValue } from 'homebridge';
import type { DolphinPoolCleanerPlatform, DeviceConfig } from '../platform.js';
import type { DolphinDevice, RobotState } from '../devices/dolphinDevice.js';

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

    this.setupAccessoryInfo();
    this.switchService = this.setupSwitchService();
    this.temperatureService = this.setupTemperatureService();
    this.filterService = this.setupFilterService();

    this.device.on('stateChange', this.handleStateChange.bind(this));
    this.device.on('disconnect', this.handleDisconnect.bind(this));
    this.platform.log.debug(`Accessory initialized: ${this.device.name}`);
  }

  /**
   * Set accessory information and remove legacy services
   */
  private setupAccessoryInfo(): void {
    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation);
    if (infoService) {
      infoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Maytronics')
        .setCharacteristic(this.platform.Characteristic.Model, this.device.modelName)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.serialNumber)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, '1.0.0');
    }

    // Remove old Valve service if it exists (migration from previous version)
    const existingValveService = this.accessory.getService(this.platform.Service.Valve);
    if (existingValveService) {
      this.accessory.removeService(existingValveService);
    }
  }

  /**
   * Create Switch service for robot on/off control
   */
  private setupSwitchService(): Service {
    const service =
      this.accessory.getService(this.platform.Service.Switch) ||
      this.accessory.addService(this.platform.Service.Switch, this.device.name, 'robot-switch');

    service.setCharacteristic(this.platform.Characteristic.Name, this.device.name);
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.device.name);
    service
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));

    return service;
  }

  /**
   * Create temperature sensor if device supports it and enabled, or remove stale service
   */
  private setupTemperatureService(): Service | undefined {
    if (
      this.device.features.hasTemperatureSensor &&
      this.deviceConfig?.enableTemperature !== false
    ) {
      const service =
        this.accessory.getService(this.platform.Service.TemperatureSensor) ||
        this.accessory.addService(
          this.platform.Service.TemperatureSensor,
          `${this.device.name} Water Temperature`,
          'water-temperature',
        );
      service.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Water Temperature`);
      service.setCharacteristic(this.platform.Characteristic.ConfiguredName, `${this.device.name} Water Temperature`);
      service
        .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
        .onGet(this.getTemperature.bind(this));
      return service;
    }

    const existing = this.accessory.getService(this.platform.Service.TemperatureSensor);
    if (existing) {
      this.accessory.removeService(existing);
    }
    return undefined;
  }

  /**
   * Create filter maintenance service if enabled, or remove stale service
   */
  private setupFilterService(): Service | undefined {
    if (this.deviceConfig?.enableFilterStatus !== false) {
      const service =
        this.accessory.getService(this.platform.Service.FilterMaintenance) ||
        this.accessory.addService(
          this.platform.Service.FilterMaintenance,
          `${this.device.name} Filter`,
          'filter-maintenance',
        );
      service.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Filter`);
      service.setCharacteristic(this.platform.Characteristic.ConfiguredName, `${this.device.name} Filter`);
      service
        .getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
        .onGet(this.getFilterStatus.bind(this));
      return service;
    }

    const existing = this.accessory.getService(this.platform.Service.FilterMaintenance);
    if (existing) {
      this.accessory.removeService(existing);
    }
    return undefined;
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
    const targetOn = Boolean(value);
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
        const mode = this.deviceConfig?.cleaningMode || 'all';
        await this.device.startCleaning(mode);
      } else {
        await this.device.stopCleaning();
      }
    } catch (error) {
      this.platform.log.error(
        `Failed to ${targetOn ? 'start' : 'stop'} cleaning:`,
        error,
      );
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
