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
  parseCleaningMode,
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
  private refreshTimer?: ReturnType<typeof setTimeout>;
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
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
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
    this.applyShadow(shadow);
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
        this.applyShadow(shadow);
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
   * Apply a shadow document and notify listeners when something changed
   */
  private applyShadow(shadow: RawShadowState): void {
    const wasConnected = this.state.connected;
    const changed = this.processShadowState(shadow);
    this.state.connected = true;
    if (changed || !wasConnected) {
      this.emitStateChange();
    }
  }

  /**
   * Notify listeners with a snapshot, so they cannot mutate the device state
   */
  private emitStateChange(): void {
    this.emit('stateChange', this.getState());
  }

  /**
   * Re-read the shadow shortly after a command, once the robot has reacted.
   * A newer command replaces a pending refresh instead of stacking another one.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = unrefTimer(setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refreshState();
    }, STATE_REFRESH_DELAY_MS));
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
    const resolvedMode = mode === undefined ? undefined : resolveCleaningMode(mode);
    if (mode !== undefined && !resolvedMode) {
      this.log.warn(`Unknown cleaning mode "${mode}", starting ${this.name} with its current mode`);
    }

    // Only send the mode when the robot is not already set to it: every shadow
    // request counts against the shared AWS IoT rate limit and delays the start
    if (resolvedMode && this.state.nextCycleMode !== resolvedMode) {
      const modeSet = await this.api.setCleaningMode(this.serialNumber, CLEANING_MODES[resolvedMode].apiMode);
      if (modeSet) {
        this.state.nextCycleMode = resolvedMode;
      } else {
        this.log.warn(`Could not set cleaning mode ${resolvedMode} for ${this.name}, starting with its current mode`);
      }
    }

    const success = await this.api.startRobot(this.serialNumber);

    if (success) {
      this.log.info(
        `Started cleaning for ${this.name}${resolvedMode ? ` (mode: ${resolvedMode})` : ''}`,
      );

      // Optimistically update state
      this.state.isCleaning = true;
      this.state.muState = ROBOT_STATES.INIT;
      if (resolvedMode) {
        this.state.cleaningMode = resolvedMode;
      }
      this.emitStateChange();
      this.scheduleRefresh();
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
      this.emitStateChange();
      this.scheduleRefresh();
    }

    return success;
  }

  /**
   * Set cleaning mode
   */
  async setCleaningMode(mode: string): Promise<boolean> {
    const resolvedMode = resolveCleaningMode(mode);
    if (!resolvedMode) {
      this.log.warn(`Unknown cleaning mode: ${mode}`);
      return false;
    }

    const success = await this.api.setCleaningMode(this.serialNumber, CLEANING_MODES[resolvedMode].apiMode);

    if (success) {
      this.log.info(`Set cleaning mode to ${resolvedMode} for ${this.name}`);
      this.state.cleaningMode = resolvedMode;
      this.state.nextCycleMode = resolvedMode;
      this.emitStateChange();
    }

    return success;
  }
}

/**
 * Map a configured mode (including legacy aliases such as "regular") to a
 * CLEANING_MODES key, or undefined when it is not a known mode
 */
export function resolveCleaningMode(mode: string): string | undefined {
  const normalized = parseCleaningMode(mode);
  return Object.hasOwn(CLEANING_MODES, normalized) ? normalized : undefined;
}
