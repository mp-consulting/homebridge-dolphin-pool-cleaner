/**
 * Shadow State Parser
 *
 * Unified parser for AWS IoT Thing Shadow state.
 * Handles both new IoT format and legacy BLE format.
 */
import {
  PWS_STATES,
  ROBOT_STATES,
  DEFAULT_CYCLE_TIME_MINUTES,
  MIN_VALID_UNIX_TIMESTAMP,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
} from '../config/constants.js';
import { parseAllFaults, parseFaultsHexString } from './faultCodeParser.js';
import { parseLegacyFilterStatus, parseFilterStatus } from './filterStatusParser.js';
import type {
  ParsedRobotState,
  RawShadowReported,
  RawShadowState,
} from './types.js';

/**
 * Cleaning states that indicate the robot is actively cleaning
 */
const CLEANING_ROBOT_STATES = ['scanning', 'cleaning', 'running', 'active'];

/**
 * Finished states that indicate cleaning has stopped
 */
const FINISHED_ROBOT_STATES = ['finished', 'idle', 'off', 'notconnected'];

/**
 * Map API mode strings to internal mode names
 */
const MODE_STRING_MAP: Record<string, string> = {
  standard: 'all',
  regular: 'all',
  all: 'all',
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
};

/**
 * PWS states that indicate NOT cleaning
 */
const IDLE_PWS_STATES = ['off', 'idle', 'holdweekly', 'holddelay', 'programming', 'error'];

/**
 * Map PWS state strings to numeric values
 */
const PWS_STATE_MAP: Record<string, number> = {
  off: PWS_STATES.OFF,
  idle: PWS_STATES.IDLE,
  holdweekly: PWS_STATES.IDLE,
  holddelay: PWS_STATES.IDLE,
  programming: PWS_STATES.PROGRAMMING,
  cleaning: PWS_STATES.CLEANING,
  error: PWS_STATES.ERROR,
};

/**
 * Map numeric cleaning modes to names (legacy format)
 */
const NUMERIC_MODE_MAP: Record<number, string> = {
  0: 'all',
  1: 'short',
  2: 'floor',
  3: 'wall',
  4: 'water',
  5: 'ultra',
  6: 'cove',
  7: 'spot',
  8: 'tictac',
  9: 'pickup',
  10: 'custom',
  11: 'stairs',
};

/**
 * Robot MU states that indicate cleaning
 */
const CLEANING_MU_STATES = [
  ROBOT_STATES.SCANNING,
  ROBOT_STATES.CLEANING,
  ROBOT_STATES.CLEANING_PAUSE,
];

/**
 * Create default robot state
 */
export function createDefaultState(): ParsedRobotState {
  return {
    connected: false,
    muState: ROBOT_STATES.OFF,
    pwsState: PWS_STATES.OFF,
    isCleaning: false,
    cleaningMode: 'all',
    cycleTime: DEFAULT_CYCLE_TIME_MINUTES,
    cycleTimeRemaining: 0,
    filterStatus: 'ok',
  };
}

/**
 * Parse cleaning mode from string or number
 */
export function parseCleaningMode(mode: string | number | undefined): string {
  if (mode === undefined) {
    return 'all';
  }

  if (typeof mode === 'string') {
    const modeStr = mode.toLowerCase();
    return MODE_STRING_MAP[modeStr] || modeStr;
  }

  return NUMERIC_MODE_MAP[mode] || 'all';
}

/**
 * Check if MU state indicates cleaning
 */
export function isCleaningMuState(muState: number): boolean {
  return CLEANING_MU_STATES.includes(muState);
}

/**
 * Parse new AWS IoT Shadow format
 */
function parseNewFormat(reported: RawShadowReported): Partial<ParsedRobotState> {
  const state: Partial<ParsedRobotState> = {};

  // Parse connection status
  if (reported.isConnected) {
    state.connected = reported.isConnected.connected === true;
  }

  // Parse system state
  if (reported.systemState) {
    const sysPwsState = reported.systemState.pwsState?.toLowerCase();

    // Check PWS state first - idle states mean not cleaning
    if (sysPwsState && IDLE_PWS_STATES.includes(sysPwsState)) {
      state.isCleaning = false;
    } else if (sysPwsState === 'cleaning') {
      state.isCleaning = true;
    }

    // Check for robotState inside systemState
    const sysRobotState = reported.systemState.robotState;
    if (sysRobotState) {
      const robotStateStr = sysRobotState.toLowerCase();
      if (CLEANING_ROBOT_STATES.includes(robotStateStr)) {
        state.isCleaning = true;
      } else if (FINISHED_ROBOT_STATES.includes(robotStateStr)) {
        state.isCleaning = false;
      }
    }

    // Map pwsState string to numeric
    if (sysPwsState && sysPwsState in PWS_STATE_MAP) {
      state.pwsState = PWS_STATE_MAP[sysPwsState];
    }
  }

  // Parse robot state (alternative format)
  if (reported.robotState) {
    const robotIsOn = reported.robotState.isOn === true;
    const robotPwsState = reported.robotState.pwsState?.toLowerCase();

    if (robotPwsState === 'cleaning' || robotPwsState === 'running') {
      state.isCleaning = true;
    } else if (state.isCleaning === undefined) {
      state.isCleaning = robotIsOn;
    }

    if (robotPwsState && robotPwsState in PWS_STATE_MAP) {
      state.pwsState = PWS_STATE_MAP[robotPwsState];
    }
  }

  // Parse cycle info
  if (reported.cycleInfo) {
    const cycleStartTime = reported.cycleInfo.cycleStartTimeUTC || reported.cycleInfo.cycleStartTime;
    // Only consider valid timestamps (non-zero, reasonable range)
    if (cycleStartTime && cycleStartTime > MIN_VALID_UNIX_TIMESTAMP) {
      const now = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
      const cycleTime = reported.cycleInfo.cleaningMode?.cycleTime || DEFAULT_CYCLE_TIME_MINUTES;
      const elapsedMinutes = (now - cycleStartTime) / SECONDS_PER_MINUTE;

      // Only mark as cleaning if cycle started recently and is within duration
      if (elapsedMinutes >= 0 && elapsedMinutes < cycleTime) {
        state.isCleaning = true;
        state.cycleStartTime = new Date(cycleStartTime * MILLISECONDS_PER_SECOND);
        state.cycleTimeRemaining = Math.max(0, cycleTime - elapsedMinutes);
      }
    }

    // Check cycle state
    const cycleState = reported.cycleInfo.cycleState?.toLowerCase();
    if (cycleState && cycleState !== 'idle') {
      state.isCleaning = CLEANING_ROBOT_STATES.includes(cycleState);
    }

    // Parse cleaning mode
    if (reported.cycleInfo.cleaningMode) {
      const modeStr = reported.cycleInfo.cleaningMode.mode?.toLowerCase();
      if (modeStr) {
        state.cleaningMode = MODE_STRING_MAP[modeStr] || modeStr;
      }
      if (reported.cycleInfo.cleaningMode.cycleTime) {
        state.cycleTime = reported.cycleInfo.cleaningMode.cycleTime;
      }
    }

    // Parse cycle time remaining (alternative format)
    if (reported.cycleInfo.cycleTimeRemaining) {
      const remaining = reported.cycleInfo.cycleTimeRemaining;
      state.cycleTimeRemaining = (remaining.hours || 0) * SECONDS_PER_MINUTE + (remaining.minutes || 0);
    }
  }

  // Parse water temperature
  if (reported.inwatTemperature?.temperature !== undefined) {
    state.temperature = reported.inwatTemperature.temperature;
  }

  // Parse filter status
  state.filterStatus = parseFilterStatus(
    reported.filterBagIndication,
    reported.filterIndicator,
  );

  // Parse fault codes
  const fault = parseAllFaults(
    reported.robotError,
    reported.pwsError,
    reported.faultCodes,
    reported.systemState,
  );
  if (fault) {
    state.faultCode = fault.code;
    state.faultDescription = fault.description;
  }

  // Parse LED state
  if (reported.led) {
    state.ledEnabled = reported.led.ledEnable;
    state.ledIntensity = reported.led.ledIntensity;
  }

  // Parse weekly timer
  if (reported.weeklyTimer) {
    state.weeklyEnabled = reported.weeklyTimer.enabled;
  }

  // Parse delayed operation
  if (reported.delayedOperation) {
    state.delayEnabled = reported.delayedOperation.enabled;
    if (reported.delayedOperation.time) {
      state.delayTime =
        (reported.delayedOperation.time.hours || 0) * SECONDS_PER_MINUTE +
        (reported.delayedOperation.time.minutes || 0);
    }
  }

  return state;
}

/**
 * Parse legacy BLE Shadow format
 */
function parseLegacyFormat(reported: RawShadowReported): Partial<ParsedRobotState> {
  const state: Partial<ParsedRobotState> = {};

  // Parse MU state (robot motor unit state)
  if (reported.mu_state !== undefined) {
    state.muState = reported.mu_state;
    state.isCleaning = isCleaningMuState(reported.mu_state);
  }

  // Parse SM state (power supply / state machine)
  if (reported.sm_state !== undefined) {
    state.pwsState = reported.sm_state;
  }

  // Parse cleaning mode
  if (reported.cleaning_mode !== undefined) {
    state.cleaningMode = parseCleaningMode(reported.cleaning_mode);
  }

  // Parse filter status
  if (reported.filter_state !== undefined) {
    state.filterStatus = parseLegacyFilterStatus(reported.filter_state);
  }

  // Parse temperature (typically in tenths of degrees Celsius)
  if (reported.temperature !== undefined) {
    state.temperature = reported.temperature / 10;
  }

  // Parse smart mode
  if (reported.is_smart !== undefined) {
    state.isSmartMode = reported.is_smart;
  }

  // Parse cycle info hex string
  if (reported.cycle_info) {
    try {
      if (reported.cycle_info.length >= 4) {
        const elapsed = parseInt(reported.cycle_info.substring(0, 4), 16);
        if (!isNaN(elapsed)) {
          const totalMinutes = state.cycleTime || DEFAULT_CYCLE_TIME_MINUTES;
          state.cycleTimeRemaining = Math.max(0, totalMinutes - elapsed);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Parse faults hex string
  if (typeof reported.faults === 'string') {
    const fault = parseFaultsHexString(reported.faults);
    if (fault) {
      state.faultCode = fault.code;
      state.faultDescription = fault.description;
    }
  }

  return state;
}

/**
 * Merge partial state updates into existing state
 */
function mergeState(
  existing: ParsedRobotState,
  updates: Partial<ParsedRobotState>,
): ParsedRobotState {
  const merged = { ...existing };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * Parse shadow state from AWS IoT Thing Shadow
 *
 * @param shadow - Raw shadow state from AWS IoT
 * @param existingState - Existing state to merge with (optional)
 * @returns Parsed robot state
 */
export function parseShadowState(
  shadow: RawShadowState | unknown,
  existingState?: ParsedRobotState,
): ParsedRobotState {
  const state = existingState ? { ...existingState } : createDefaultState();

  // Type guard for shadow
  if (!shadow || typeof shadow !== 'object') {
    return state;
  }

  const typedShadow = shadow as RawShadowState;
  const reported = typedShadow.state?.reported;

  if (!reported) {
    return state;
  }

  // Parse new IoT Shadow format
  const newFormatState = parseNewFormat(reported);
  const merged = mergeState(state, newFormatState);

  // Parse legacy BLE format for backward compatibility
  const legacyState = parseLegacyFormat(reported);

  return mergeState(merged, legacyState);
}

/**
 * Get shadow version from raw shadow
 */
export function getShadowVersion(shadow: RawShadowState | unknown): number | undefined {
  if (!shadow || typeof shadow !== 'object') {
    return undefined;
  }
  return (shadow as RawShadowState).version;
}
