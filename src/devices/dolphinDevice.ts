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
  PWS_STATES,
  CLEANING_MODES,
} from '../config/constants.js';
import type { MaytronicsAPI } from '../api/maytronicsApi.js';
import type { Logger } from 'homebridge';

export interface RobotState {
  connected: boolean;
  muState: number;
  pwsState: number;
  isCleaning: boolean;
  cleaningMode: string;
  cycleTime: number;
  cycleTimeRemaining: number;
  filterStatus: string;
  temperature?: number;
  isSmartMode?: boolean;
  cycleStartTime?: Date;
  faultCode?: number;
  faultDescription?: string;
  ledEnabled?: boolean;
  ledIntensity?: number;
  weeklyEnabled?: boolean;
  delayEnabled?: boolean;
  delayTime?: number;
}

export interface DeviceConfig {
  serialNumber: string;
  name: string;
  deviceType: number;
  pollingInterval: number;
}

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
  private state: RobotState;
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
    // Initialize state
    this.state = {
      connected: false,
      muState: ROBOT_STATES.OFF,
      pwsState: PWS_STATES.OFF,
      isCleaning: false,
      cleaningMode: 'regular',
      cycleTime: 120,
      cycleTimeRemaining: 0,
      filterStatus: 'ok',
    };
    this.log.info(
      `Device created: ${this.name} (${this.modelName}) - S/N: ${this.serialNumber}`,
    );
  }
  /**
   * Start device polling
   */
  async start() {
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
  stop() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    this.log.debug(`Stopped polling for ${this.name}`);
  }
  /**
   * Get current device state
   */
  getState(): RobotState {
    return { ...this.state };
  }
  /**
   * Refresh state from AWS IoT Thing Shadow
   */
  async refreshState() {
    try {
      const shadow = await this.api.getThingShadow(this.serialNumber);
      if (shadow) {
        this.parseShadowState(shadow);
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
   * Parse Thing Shadow state into RobotState
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseShadowState(shadow: any): void {
    // Check if shadow has been updated
    if (
      shadow.version !== undefined &&
      shadow.version === this.lastShadowVersion
    ) {
      return; // No changes
    }
    this.lastShadowVersion = shadow.version;
    const reported = shadow.state?.reported;
    if (!reported) {
      return;
    }
    // Parse new IoT Shadow format (AWS IoT Core)
    this.parseNewShadowFormat(reported);
    // Parse legacy BLE format for backward compatibility
    this.parseLegacyShadowFormat(reported);
    this.log.debug(
      `State updated for ${this.name}: cleaning=${this.state.isCleaning}, mode=${this.state.cleaningMode}`,
    );
  }
  /**
   * Parse new AWS IoT Shadow format
   * Used by WiFi-connected robots through Maytronics cloud
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseNewShadowFormat(reported: any): void {
    // Log raw reported keys for debugging
    this.log.debug(`Shadow reported keys: ${Object.keys(reported).join(', ')}`);
    // Parse connection status
    if (reported.isConnected) {
      this.state.connected = reported.isConnected.connected === true;
      this.log.debug(`isConnected: ${this.state.connected}`);
    }
    // Parse system state (power supply state)
    // systemState.pwsState: "on" means power supply is on, "off" means off
    // systemState.robotState: "scanning", "cleaning", "finished", etc.
    if (reported.systemState) {
      const sysPwsState = reported.systemState.pwsState?.toLowerCase();
      this.log.debug(`System pwsState: ${sysPwsState}`);
      // Check for robotState inside systemState (actual API structure)
      const sysRobotState = reported.systemState.robotState;
      if (sysRobotState) {
        const robotStateStr = sysRobotState.toLowerCase();
        this.log.debug(`System robotState: ${robotStateStr}`);
        // Determine if cleaning from robotState string
        const cleaningStates = ['scanning', 'cleaning', 'running', 'active'];
        if (cleaningStates.includes(robotStateStr)) {
          this.state.isCleaning = true;
          this.log.debug(`Robot IS CLEANING (robotState: ${robotStateStr})`);
        } else if (
          robotStateStr === 'finished' ||
          robotStateStr === 'idle' ||
          robotStateStr === 'off'
        ) {
          this.state.isCleaning = false;
        }
      }
      // Check isBusy flag
      const isBusy = reported.systemState.isBusy;
      if (isBusy !== undefined) {
        this.log.debug(`System isBusy: ${isBusy}`);
      }
    }
    // Parse robot state (alternative format - separate object)
    // robotState.isOn: true when robot is actively cleaning
    // robotState.pwsState: "idle", "cleaning", etc.
    if (reported.robotState) {
      const robotIsOn = reported.robotState.isOn === true;
      const robotPwsState = reported.robotState.pwsState?.toLowerCase();
      this.log.debug(`Robot isOn: ${robotIsOn}, pwsState: ${robotPwsState}`);
      // Determine cleaning state from robotState.isOn OR robotState.pwsState
      if (robotPwsState === 'cleaning' || robotPwsState === 'running') {
        this.state.isCleaning = true;
      } else {
        this.state.isCleaning = robotIsOn;
      }
      // Map pwsState string to numeric value for compatibility
      const pwsStateMap: Record<string, number> = {
        off: PWS_STATES.OFF,
        idle: PWS_STATES.IDLE,
        programming: PWS_STATES.PROGRAMMING,
        cleaning: PWS_STATES.CLEANING,
        error: PWS_STATES.ERROR,
      };
      if (robotPwsState && robotPwsState in pwsStateMap) {
        this.state.pwsState = pwsStateMap[robotPwsState];
      }
    }
    // Parse cycle info
    if (reported.cycleInfo) {
      this.log.debug(
        `cycleInfo keys: ${Object.keys(reported.cycleInfo).join(', ')}`,
      );
      this.log.debug(`cycleInfo raw: ${JSON.stringify(reported.cycleInfo)}`);
      // Check for cycleStartTime - if present and recent, robot is cleaning
      // cycleStartTime is a Unix timestamp (seconds) of when cleaning started
      const cycleStartTime = reported.cycleInfo.cycleStartTime;
      const cycleStartTimeUTC = reported.cycleInfo.cycleStartTimeUTC;
      if (cycleStartTime || cycleStartTimeUTC) {
        const startTime = cycleStartTimeUTC || cycleStartTime;
        const now = Math.floor(Date.now() / 1000);
        const cycleTime = reported.cycleInfo.cleaningMode?.cycleTime || 120; // minutes
        const elapsedMinutes = (now - (startTime || 0)) / 60;
        this.log.debug(
          `Cycle started at: ${startTime}, elapsed: ${elapsedMinutes.toFixed(1)} min, cycle time: ${cycleTime} min`,
        );
        // Robot is cleaning if elapsed time is less than cycle time
        if (elapsedMinutes >= 0 && elapsedMinutes < cycleTime) {
          this.state.isCleaning = true;
          this.state.cycleStartTime = new Date((startTime || 0) * 1000);
          this.state.cycleTimeRemaining = Math.max(
            0,
            cycleTime - elapsedMinutes,
          );
          this.log.debug(
            `Robot IS CLEANING - ${this.state.cycleTimeRemaining.toFixed(0)} min remaining`,
          );
        } else {
          this.log.debug('Cycle appears finished (elapsed > cycleTime)');
        }
      }
      // Determine if cleaning from cycle state (if available)
      const cycleState = reported.cycleInfo.cycleState?.toLowerCase();
      this.log.debug(`Cycle state: ${cycleState}`);
      if (cycleState && cycleState !== 'idle') {
        this.state.isCleaning = ['cleaning', 'running', 'active'].includes(
          cycleState,
        );
      }
      // Parse cleaning mode
      if (reported.cycleInfo.cleaningMode) {
        const modeStr = reported.cycleInfo.cleaningMode.mode?.toLowerCase();
        if (modeStr) {
          // Map mode string to our cleaning mode names
          const modeMap: Record<string, string> = {
            standard: 'regular',
            regular: 'regular',
            fast: 'short',
            short: 'short',
            floor: 'floor',
            floor_only: 'floor',
            wall: 'wall',
            walls: 'wall',
            waterline: 'water',
            water: 'water',
            ultra: 'ultra',
            ultra_clean: 'ultra',
            all: 'regular', // "all" means all surfaces = regular mode
          };
          this.state.cleaningMode = modeMap[modeStr] || modeStr;
        }
        // Parse cycle time
        if (reported.cycleInfo.cleaningMode.cycleTime) {
          this.state.cycleTime = reported.cycleInfo.cleaningMode.cycleTime;
        }
      }
      // Parse cycle time remaining (alternative format)
      if (reported.cycleInfo.cycleTimeRemaining) {
        const remaining = reported.cycleInfo.cycleTimeRemaining;
        this.state.cycleTimeRemaining =
          (remaining.hours || 0) * 60 + (remaining.minutes || 0);
      }
    }
    // Parse water temperature
    if (reported.inwatTemperature) {
      const temp = reported.inwatTemperature.temperature;
      const unit = reported.inwatTemperature.unit || 'C';
      this.log.debug(`Water temperature: ${temp}°${unit}`);
      if (this.features.hasTemperatureSensor) {
        this.state.temperature = temp;
      }
    }
    // Parse filter status - check multiple possible field names and formats
    const filterBagData = reported.filterBagIndication;
    const filterIndicatorData = reported.filterIndicator;
    if (filterBagData || filterIndicatorData) {
      // filterBagIndication format: { state: number (0-100), resetFBI: boolean }
      // filterIndicator format: { filterState: string, filterLevel: number }
      const filterData = filterBagData || filterIndicatorData;
      // Check for numeric state (0-100 percentage)
      const numericState = filterData?.state;
      const filterState = filterData?.filterState;
      const filterLevel = filterData?.filterLevel;
      this.log.debug(
        `Filter data: state=${numericState}, filterState=${filterState}, filterLevel=${filterLevel}`,
      );
      if (numericState !== undefined) {
        // Numeric state: 0-100 where higher means filter is fuller
        // Consider > 80% as needs cleaning
        this.state.filterStatus = numericState > 80 ? 'needs_cleaning' : 'ok';
        this.log.debug(
          `Filter status from numeric state (${numericState}%): ${this.state.filterStatus}`,
        );
      } else if (filterState) {
        const stateStr = filterState.toLowerCase();
        if (stateStr === 'clean' || stateStr === 'ok') {
          this.state.filterStatus = 'ok';
        } else if (
          stateStr === 'dirty' ||
          stateStr === 'needs_cleaning' ||
          stateStr === 'full'
        ) {
          this.state.filterStatus = 'needs_cleaning';
        }
      } else if (filterLevel !== undefined) {
        // filterLevel: 0 = clean, higher = needs cleaning
        this.state.filterStatus = filterLevel > 0 ? 'needs_cleaning' : 'ok';
      }
    }
    // Parse fault codes from multiple possible sources
    // robotError format: { errorCode: number, pcbHours, pcbMin, turnOnCount, faultValue1 }
    // pwsError format: { errorCode: number, ... } (255 = no error)
    // faultCodes format: { faultCode: number, faultDescription: string }
    const robotError = reported.robotError;
    const pwsError = reported.pwsError;
    const faultCodes = reported.faultCodes;
    // Check robotError first (most specific)
    if (robotError) {
      const errorCode = robotError.errorCode;
      this.log.debug(`Robot error code: ${errorCode}`);
      // Error codes 0 and 255 typically mean "no error"
      if (errorCode !== undefined && errorCode > 0 && errorCode < 255) {
        this.state.faultCode = errorCode;
        this.state.faultDescription = this.getFaultDescription(errorCode);
        this.log.warn(
          `Robot has error: ${this.state.faultDescription} (code ${errorCode})`,
        );
      }
    }
    // Check pwsError (power supply errors)
    if (pwsError) {
      const errorCode = pwsError.errorCode;
      this.log.debug(`PWS error code: ${errorCode}`);
      // 255 and 65535 typically mean "no error" or "not applicable"
      if (errorCode !== undefined && errorCode > 0 && errorCode < 255) {
        this.state.faultCode = errorCode;
        this.state.faultDescription = this.getFaultDescription(errorCode);
        this.log.warn(
          `PWS has error: ${this.state.faultDescription} (code ${errorCode})`,
        );
      }
    }
    // Legacy faultCodes format
    if (faultCodes) {
      const faultCode = faultCodes.faultCode;
      const faultDesc = faultCodes.faultDescription;
      this.log.debug(
        `Fault code: ${faultCode}, description: ${faultDesc || 'none'}`,
      );
      if (faultCode && faultCode > 0 && faultCode < 255) {
        this.state.faultCode = faultCode;
        this.state.faultDescription =
          faultDesc || this.getFaultDescription(faultCode);
      }
    }
    // Clear fault if no errors found
    if (!this.state.faultCode) {
      this.state.faultCode = undefined;
      this.state.faultDescription = undefined;
    }
    // Parse LED state (if available)
    if (reported.led) {
      this.log.debug(
        `LED enabled: ${reported.led.ledEnable}, intensity: ${reported.led.ledIntensity}`,
      );
      this.state.ledEnabled = reported.led.ledEnable;
      this.state.ledIntensity = reported.led.ledIntensity;
    }
    // Parse weekly timer
    if (reported.weeklyTimer) {
      this.state.weeklyEnabled = reported.weeklyTimer.enabled;
      this.log.debug(`Weekly timer enabled: ${reported.weeklyTimer.enabled}`);
    }
    // Parse delayed operation
    if (reported.delayedOperation) {
      this.state.delayEnabled = reported.delayedOperation.enabled;
      if (reported.delayedOperation.time) {
        this.state.delayTime =
          (reported.delayedOperation.time.hours || 0) * 60 +
          (reported.delayedOperation.time.minutes || 0);
      }
      this.log.debug(
        `Delayed operation enabled: ${reported.delayedOperation.enabled}`,
      );
    }
  }
  /**
   * Parse legacy BLE Shadow format
   * Used by older BLE-connected robots
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseLegacyShadowFormat(reported: any): void {
    // Parse MU state (robot motor unit state)
    if (reported.mu_state !== undefined) {
      this.state.muState = reported.mu_state;
      this.state.isCleaning = this.isCleaningState(reported.mu_state);
    }
    // Parse SM state (power supply / state machine)
    if (reported.sm_state !== undefined) {
      this.state.pwsState = reported.sm_state;
    }
    // Parse cleaning mode
    if (reported.cleaning_mode !== undefined) {
      this.state.cleaningMode = this.parseCleaningMode(reported.cleaning_mode);
    }
    // Parse filter status
    if (reported.filter_state !== undefined) {
      this.state.filterStatus =
        reported.filter_state > 0 ? 'needs_cleaning' : 'ok';
    }
    // Parse temperature (if available)
    if (
      reported.temperature !== undefined &&
      this.features.hasTemperatureSensor
    ) {
      // Temperature is typically in tenths of degrees Celsius
      this.state.temperature = reported.temperature / 10;
    }
    // Parse smart mode
    if (reported.is_smart !== undefined) {
      this.state.isSmartMode = reported.is_smart;
    }
    // Parse cycle info (contains timing information)
    if (reported.cycle_info) {
      this.parseCycleInfo(reported.cycle_info);
    }
    // Parse faults (legacy format is hex string)
    if (typeof reported.faults === 'string') {
      this.parseFaults(reported.faults);
    }
  }
  /**
   * Check if the MU state indicates cleaning
   */
  isCleaningState(muState: number): boolean {
    const cleaningStates = [
      ROBOT_STATES.SCANNING,
      ROBOT_STATES.CLEANING,
      ROBOT_STATES.CLEANING_PAUSE,
    ];
    return cleaningStates.includes(muState);
  }
  /**
   * Parse cleaning mode number to string
   */
  parseCleaningMode(mode: number): string {
    const modeNames = Object.keys(CLEANING_MODES);
    for (const name of modeNames) {
      if (CLEANING_MODES[name].value === mode) {
        return name;
      }
    }
    return 'regular';
  }
  /**
   * Parse cycle info hex string
   */
  parseCycleInfo(cycleInfo: string): void {
    try {
      // Cycle info is hex encoded with timing information
      // Format varies by device, basic parsing:
      if (cycleInfo.length >= 4) {
        // First 2 bytes often contain elapsed/remaining time
        const elapsed = parseInt(cycleInfo.substring(0, 4), 16);
        if (!isNaN(elapsed)) {
          // Convert to minutes (implementation-specific)
          const elapsedMinutes = elapsed;
          const totalMinutes = this.state.cycleTime || 120;
          this.state.cycleTimeRemaining = Math.max(
            0,
            totalMinutes - elapsedMinutes,
          );
        }
      }
    } catch (error) {
      this.log.debug('Failed to parse cycle info:', error);
    }
  }
  /**
   * Parse faults hex string
   */
  parseFaults(faults: string): void {
    try {
      // Faults are hex encoded
      // Non-zero indicates an active fault
      const faultValue = parseInt(faults.substring(0, 2), 16);
      if (faultValue > 0) {
        this.state.faultCode = faultValue;
        this.state.faultDescription = this.getFaultDescription(faultValue);
      } else {
        this.state.faultCode = undefined;
        this.state.faultDescription = undefined;
      }
    } catch {
      // Ignore parsing errors
    }
  }
  /**
   * Get fault description from code
   */
  getFaultDescription(code: number): string {
    const faultDescriptions: Record<number, string> = {
      0x01: 'Motor fault',
      0x02: 'Robot out of water',
      0x03: 'Communication error',
      0x04: 'Filter blocked',
      0x05: 'Impeller blocked',
      0x06: 'Overheating',
    };
    return faultDescriptions[code] || `Unknown fault (${code})`;
  }
  /**
   * Start cleaning cycle
   */
  async startCleaning(mode?: string): Promise<boolean> {
    let modeValue;
    if (mode && mode in CLEANING_MODES) {
      modeValue = CLEANING_MODES[mode].value;
    }
    const success = await this.api.startRobot(this.serialNumber, modeValue);
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
    const modeValue = CLEANING_MODES[mode].value;
    const success = await this.api.setCleaningMode(
      this.serialNumber,
      modeValue,
    );
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
//# sourceMappingURL=dolphinDevice.js.map
