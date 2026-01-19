/**
 * Parser Types
 *
 * Type definitions for shadow state parsing.
 */

/**
 * Filter status values
 */
export type FilterStatus = 'ok' | 'needs_cleaning' | 'unknown';

/**
 * Fault information
 */
export interface FaultInfo {
  code: number;
  description: string;
  isActive: boolean;
  turnOnCount?: number;
}

/**
 * Cycle time remaining
 */
export interface CycleTimeRemaining {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

/**
 * Cleaning mode info from shadow
 */
export interface CleaningModeInfo {
  mode: string;
  cycleTime: number;
}

/**
 * System state from shadow (new format)
 */
export interface SystemStateData {
  pwsState?: string;
  robotState?: string;
  isBusy?: boolean;
  rTurnOnCount?: number;
}

/**
 * Robot state from shadow (alternative format)
 */
export interface RobotStateData {
  isOn?: boolean;
  pwsState?: string;
}

/**
 * Cycle info from shadow
 */
export interface CycleInfoData {
  cycleStartTime?: number;
  cycleStartTimeUTC?: number;
  cycleState?: string;
  cleaningMode?: {
    mode?: string;
    cycleTime?: number;
  };
  cycleTimeRemaining?: {
    hours?: number;
    minutes?: number;
  };
}

/**
 * Connection status from shadow
 */
export interface ConnectionData {
  connected?: boolean;
}

/**
 * Water temperature from shadow
 */
export interface TemperatureData {
  temperature?: number;
  unit?: string;
}

/**
 * Filter data from shadow (multiple formats)
 */
export interface FilterData {
  state?: number;
  filterState?: string;
  filterLevel?: number;
  resetFBI?: boolean;
}

/**
 * Robot error from shadow
 */
export interface RobotErrorData {
  errorCode?: number;
  turnOnCount?: number;
  pcbHours?: number;
  pcbMin?: number;
  faultValue1?: number;
}

/**
 * LED state from shadow
 */
export interface LEDData {
  ledEnable?: boolean;
  ledIntensity?: number;
}

/**
 * Weekly timer from shadow
 */
export interface WeeklyTimerData {
  enabled?: boolean;
}

/**
 * Delayed operation from shadow
 */
export interface DelayedOperationData {
  enabled?: boolean;
  time?: {
    hours?: number;
    minutes?: number;
  };
}

/**
 * Raw shadow state reported section (new format)
 */
export interface RawShadowReported {
  isConnected?: ConnectionData;
  systemState?: SystemStateData;
  robotState?: RobotStateData;
  cycleInfo?: CycleInfoData;
  inwatTemperature?: TemperatureData;
  filterBagIndication?: FilterData;
  filterIndicator?: FilterData;
  robotError?: RobotErrorData;
  pwsError?: RobotErrorData;
  faultCodes?: {
    faultCode?: number;
    faultDescription?: string;
  };
  led?: LEDData;
  weeklyTimer?: WeeklyTimerData;
  delayedOperation?: DelayedOperationData;
  // Legacy BLE format fields
  mu_state?: number;
  sm_state?: number;
  cleaning_mode?: number | string;
  filter_state?: number;
  temperature?: number;
  is_smart?: boolean;
  cycle_info?: string;
  faults?: string;
}

/**
 * Raw shadow state from AWS IoT
 */
export interface RawShadowState {
  version?: number;
  state?: {
    reported?: RawShadowReported;
    desired?: Record<string, unknown>;
  };
}

/**
 * Parsed robot state (output of parsers)
 */
export interface ParsedRobotState {
  connected: boolean;
  muState: number;
  pwsState: number;
  isCleaning: boolean;
  cleaningMode: string;
  cycleTime: number;
  cycleTimeRemaining: number;
  filterStatus: FilterStatus;
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

/**
 * State update result with change detection
 */
export interface StateUpdateResult {
  state: Partial<ParsedRobotState>;
  hasChanges: boolean;
}
