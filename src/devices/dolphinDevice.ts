/**
 * Dolphin Robot Device
 *
 * Represents a single Dolphin pool cleaning robot and manages
 * its state and communication with the Maytronics API.
 */
import { EventEmitter } from 'events';
import { getDeviceFeatures, getDeviceModelName, type DeviceFeatures } from './deviceCatalog.js';
import { ROBOT_STATES, CLEANING_MODES } from '../config/constants.js';
import {
  parseShadowState,
  getShadowVersion,
  createDefaultState,
  type ParsedRobotState,
  type RawShadowState,
} from '../parsers/index.js';
import type { MaytronicsAPI } from '../api/maytronicsApi.js';
import type { Logger } from 'homebridge';

// Re-export RobotState as ParsedRobotState for backward compatibility
export type RobotState = ParsedRobotState;

/**
 * Device configuration
 */
export interface DeviceConfig {
  serialNumber: string;
  name: string;
  deviceType: number;
  pollingInterval: number;
}

/**
 * Dolphin pool cleaning robot device
 */
export class DolphinDevice extends EventEmitter {
  private readonly api: MaytronicsAPI;
  private readonly log: Logger;
  readonly serialNumber: string;
  readonly name: string;
  readonly deviceType: number;
  readonly features: DeviceFeatures;
  readonly modelName: string;
  private readonly pollingInterval: number;
  private pollingTimer?: ReturnType<typeof setInterval>;
  private state: ParsedRobotState;
  private lastShadowVersion?: number;

  constructor(config: DeviceConfig, api: MaytronicsAPI, log: Logger) {
    super();
    this.api = api;
    this.log = log;
    this.serialNumber = config.serialNumber;
    this.name = config.name;
    this.deviceType = config.deviceType;
    this.pollingInterval = config.pollingInterval;
    this.features = getDeviceFeatures(config.deviceType);
    this.modelName = getDeviceModelName(config.deviceType);

    // Initialize state with defaults
    this.state = createDefaultState();

    this.log.info(
      `Device created: ${this.name} (${this.modelName}) - S/N: ${this.serialNumber}`,
    );
  }

  /**
   * Start device polling
   */
  async start(): Promise<void> {
    this.log.debug(
      `Starting polling for ${this.name} every ${this.pollingInterval}s`,
    );

    // Initial state fetch
    await this.refreshState();

    // Start polling
    this.pollingTimer = setInterval(async () => {
      await this.refreshState();
    }, this.pollingInterval * 1000);
  }

  /**
   * Stop device polling
   */
  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.log.debug(`Stopped polling for ${this.name}`);
  }

  /**
   * Get current device state
   */
  getState(): ParsedRobotState {
    return { ...this.state };
  }

  /**
   * Refresh state from AWS IoT Thing Shadow
   */
  async refreshState(): Promise<void> {
    try {
      const shadow = await this.api.getThingShadow(this.serialNumber);
      if (shadow) {
        this.processShadowState(shadow as RawShadowState);
        this.state.connected = true;
        this.emit('stateChange', this.state);
      }
    } catch (error) {
      this.log.debug(`Failed to refresh state for ${this.name}:`, error);
      if (this.state.connected) {
        this.state.connected = false;
        this.emit('disconnect');
      }
    }
  }

  /**
   * Process Thing Shadow state into RobotState
   */
  private processShadowState(shadow: RawShadowState): void {
    // Check if shadow has been updated
    const version = getShadowVersion(shadow);
    if (version !== undefined && version === this.lastShadowVersion) {
      return; // No changes
    }
    this.lastShadowVersion = version;

    // Use the shadow parser to parse the state
    const parsedState = parseShadowState(shadow, this.state);

    // Apply temperature only if device supports it
    if (!this.features.hasTemperatureSensor) {
      parsedState.temperature = undefined;
    }

    // Update state
    this.state = parsedState;

    this.log.debug(
      `State updated for ${this.name}: cleaning=${this.state.isCleaning}, mode=${this.state.cleaningMode}`,
    );
  }

  /**
   * Start cleaning cycle
   */
  async startCleaning(mode?: string): Promise<boolean> {
    let apiMode: string | undefined;
    if (mode && mode in CLEANING_MODES) {
      apiMode = CLEANING_MODES[mode].apiMode;
    }

    const success = await this.api.startRobot(this.serialNumber, apiMode);

    if (success) {
      this.log.info(
        `Started cleaning for ${this.name}${mode ? ` (mode: ${mode})` : ''}`,
      );

      // Optimistically update state
      this.state.isCleaning = true;
      this.state.muState = ROBOT_STATES.INIT;
      if (mode) {
        this.state.cleaningMode = mode;
      }
      this.emit('stateChange', this.state);

      // Refresh state after a short delay
      setTimeout(() => this.refreshState(), 3000);
    }

    return success;
  }

  /**
   * Stop cleaning cycle
   */
  async stopCleaning(): Promise<boolean> {
    const success = await this.api.stopRobot(this.serialNumber);

    if (success) {
      this.log.info(`Stopped cleaning for ${this.name}`);

      // Optimistically update state
      this.state.isCleaning = false;
      this.state.muState = ROBOT_STATES.OFF;
      this.emit('stateChange', this.state);

      // Refresh state after a short delay
      setTimeout(() => this.refreshState(), 3000);
    }

    return success;
  }

  /**
   * Set cleaning mode
   */
  async setCleaningMode(mode: string): Promise<boolean> {
    if (!(mode in CLEANING_MODES)) {
      this.log.warn(`Unknown cleaning mode: ${mode}`);
      return false;
    }

    const apiMode = CLEANING_MODES[mode].apiMode;
    const success = await this.api.setCleaningMode(this.serialNumber, apiMode);

    if (success) {
      this.log.info(`Set cleaning mode to ${mode} for ${this.name}`);
      this.state.cleaningMode = mode;
      this.emit('stateChange', this.state);
    }

    return success;
  }

  /**
   * Initiate pickup mode (robot goes to pickup point)
   */
  async pickup(): Promise<boolean> {
    const success = await this.api.pickupRobot(this.serialNumber);

    if (success) {
      this.log.info(`Initiated pickup for ${this.name}`);
      this.state.muState = ROBOT_STATES.PICKUP;
      this.emit('stateChange', this.state);

      // Refresh state after a short delay
      setTimeout(() => this.refreshState(), 3000);
    }

    return success;
  }
}
