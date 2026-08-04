/**
 * Dolphin Robot Device
 *
 * Represents a single Dolphin pool cleaning robot and manages
 * its state and communication with the Maytronics API.
 */
import { EventEmitter } from 'events';
import { getDeviceFeatures, getDeviceModelName, type DeviceFeatures } from './deviceCatalog.js';
import {
  ROBOT_STATES,
  CLEANING_MODES,
  MILLISECONDS_PER_SECOND,
  STATE_REFRESH_DELAY_MS,
} from '../config/constants.js';
import {
  parseShadowState,
  getShadowVersion,
  createDefaultState,
  type ParsedRobotState,
  type RawShadowState,
} from '../parsers/index.js';
import { unrefTimer } from '../utils/timers.js';
import type { MaytronicsAPI } from '../api/maytronicsApi.js';
import type { Logger } from 'homebridge';

// Re-export RobotState as ParsedRobotState for backward compatibility
export type RobotState = ParsedRobotState;

/**
 * Device initialization configuration (required fields for runtime)
 */
export interface DeviceInitConfig {
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

  constructor(config: DeviceInitConfig, api: MaytronicsAPI, log: Logger) {
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

    // Shadow documents pushed over MQTT keep the state fresh without polling
    this.api.on('shadowUpdate', this.handlePushedShadow);

    // Initial state fetch
    await this.refreshState();

    // Start polling
    this.pollingTimer = unrefTimer(setInterval(() => {
      void this.poll();
    }, this.pollingInterval * MILLISECONDS_PER_SECOND));
  }

  /**
   * Stop device polling
   */
  stop(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.api.removeListener('shadowUpdate', this.handlePushedShadow);
    this.log.debug(`Stopped polling for ${this.name}`);
  }

  /**
   * Poll the shadow, unless MQTT already pushed a recent one.
   * Skipping redundant requests keeps us under the AWS IoT shadow rate limit.
   */
  private async poll(): Promise<void> {
    const sincePush = Date.now() - this.api.getLastShadowReceivedAt();
    if (sincePush < this.pollingInterval * MILLISECONDS_PER_SECOND) {
      this.log.debug(
        `Skipping poll for ${this.name}: shadow received ${Math.round(sincePush / MILLISECONDS_PER_SECOND)}s ago`,
      );
      return;
    }
    await this.refreshState();
  }

  /**
   * Handle a shadow document pushed over MQTT (robot-initiated update)
   */
  private readonly handlePushedShadow = (shadow: RawShadowState): void => {
    this.state.connected = true;
    if (this.processShadowState(shadow)) {
      this.emit('stateChange', this.state);
    }
  };

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
   * Process Thing Shadow state into RobotState.
   * Returns false when the shadow carries no change.
   */
  private processShadowState(shadow: RawShadowState): boolean {
    // Check if shadow has been updated
    const version = getShadowVersion(shadow);
    if (version !== undefined && version === this.lastShadowVersion) {
      return false; // No changes
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

    return true;
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
      unrefTimer(setTimeout(() => void this.refreshState(), STATE_REFRESH_DELAY_MS));
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
      unrefTimer(setTimeout(() => void this.refreshState(), STATE_REFRESH_DELAY_MS));
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
      unrefTimer(setTimeout(() => void this.refreshState(), STATE_REFRESH_DELAY_MS));
    }

    return success;
  }
}
