/**
 * Fault Code Parser
 *
 * Parses and validates fault codes from shadow state.
 */
import type { FaultInfo, RobotErrorData, SystemStateData } from './types.js';
import { ERROR_CODE_NOT_APPLICABLE, ERROR_CODE_NO_ERROR } from '../config/constants.js';

/**
 * Fault code descriptions
 */
const FAULT_DESCRIPTIONS: Record<number, string> = {
  0x01: 'Motor fault',
  0x02: 'Robot out of water',
  0x03: 'Communication error',
  0x04: 'Filter blocked',
  0x05: 'Impeller blocked',
  0x06: 'Overheating',
};

/**
 * Error codes that indicate "no error"
 */
const NO_ERROR_CODES = [0, ERROR_CODE_NO_ERROR, ERROR_CODE_NOT_APPLICABLE];

/**
 * Get fault description from code
 *
 * @param code - Fault code
 * @returns Human-readable fault description
 */
export function getFaultDescription(code: number): string {
  return FAULT_DESCRIPTIONS[code] || `Unknown fault (${code})`;
}

/**
 * Check if an error code represents an actual error
 *
 * @param errorCode - Error code to check
 * @returns true if it's a real error (not 0, 255, or 65535)
 */
export function isRealErrorCode(errorCode: number | undefined): boolean {
  if (errorCode === undefined) {
    return false;
  }
  return !NO_ERROR_CODES.includes(errorCode);
}

/**
 * Check if an error is from the current session
 *
 * Compares the error's turnOnCount with the current session's turnOnCount.
 * If the error's count is less than current, it's from a previous session.
 *
 * @param errorTurnOnCount - Turn on count from the error data
 * @param currentTurnOnCount - Current session's turn on count
 * @returns true if the error is from the current session
 */
export function isCurrentSessionError(
  errorTurnOnCount: number | undefined,
  currentTurnOnCount: number | undefined,
): boolean {
  // If we can't determine session, assume it's current
  if (currentTurnOnCount === undefined || errorTurnOnCount === undefined) {
    return true;
  }

  // ERROR_CODE_NOT_APPLICABLE means "not applicable", treat as current
  if (errorTurnOnCount === ERROR_CODE_NOT_APPLICABLE) {
    return true;
  }

  return errorTurnOnCount >= currentTurnOnCount;
}

/**
 * Parse robot error from shadow data
 *
 * @param robotError - Robot error data from shadow
 * @param currentTurnOnCount - Current session's turn on count
 * @param isPwsError - Whether this is marked as PWS error state
 * @returns Fault info or undefined if no active error
 */
export function parseRobotError(
  robotError: RobotErrorData | undefined,
  currentTurnOnCount: number | undefined,
  isPwsError: boolean = false,
): FaultInfo | undefined {
  if (!robotError) {
    return undefined;
  }

  const errorCode = robotError.errorCode;
  if (!isRealErrorCode(errorCode)) {
    return undefined;
  }

  const errorTurnOnCount = robotError.turnOnCount;
  const isCurrentSession = isCurrentSessionError(errorTurnOnCount, currentTurnOnCount);

  // Error is active if it's from current session or PWS is in error state
  const isActive = isCurrentSession || isPwsError;

  if (!isActive) {
    return undefined;
  }

  return {
    code: errorCode!,
    description: getFaultDescription(errorCode!),
    isActive: true,
    turnOnCount: errorTurnOnCount,
  };
}

/**
 * Parse PWS (power supply) error from shadow data
 *
 * @param pwsError - PWS error data from shadow
 * @param currentTurnOnCount - Current session's turn on count
 * @returns Fault info or undefined if no active error
 */
export function parsePwsError(
  pwsError: RobotErrorData | undefined,
  currentTurnOnCount: number | undefined,
): FaultInfo | undefined {
  if (!pwsError) {
    return undefined;
  }

  const errorCode = pwsError.errorCode;
  if (!isRealErrorCode(errorCode)) {
    return undefined;
  }

  const errorTurnOnCount = pwsError.turnOnCount;
  const isCurrentSession = isCurrentSessionError(errorTurnOnCount, currentTurnOnCount);

  if (!isCurrentSession) {
    return undefined;
  }

  return {
    code: errorCode!,
    description: getFaultDescription(errorCode!),
    isActive: true,
    turnOnCount: errorTurnOnCount,
  };
}

/**
 * Parse legacy fault codes (faultCodes object format)
 *
 * @param faultCode - Fault code number
 * @param faultDescription - Optional fault description from shadow
 * @returns Fault info or undefined if no error
 */
export function parseLegacyFaultCodes(
  faultCode: number | undefined,
  faultDescription?: string,
): FaultInfo | undefined {
  if (!isRealErrorCode(faultCode)) {
    return undefined;
  }

  return {
    code: faultCode!,
    description: faultDescription || getFaultDescription(faultCode!),
    isActive: true,
  };
}

/**
 * Parse fault from hex string (legacy BLE format)
 *
 * @param faults - Hex string containing fault data
 * @returns Fault info or undefined if no error
 */
export function parseFaultsHexString(faults: string | undefined): FaultInfo | undefined {
  if (!faults || typeof faults !== 'string') {
    return undefined;
  }

  try {
    const faultValue = parseInt(faults.substring(0, 2), 16);
    if (faultValue > 0) {
      return {
        code: faultValue,
        description: getFaultDescription(faultValue),
        isActive: true,
      };
    }
  } catch {
    // Ignore parsing errors
  }

  return undefined;
}

/**
 * Parse all fault sources from shadow state
 *
 * Checks multiple fault sources in priority order:
 * 1. robotError (most specific)
 * 2. pwsError (power supply errors)
 * 3. faultCodes (legacy format)
 *
 * @param robotError - Robot error data
 * @param pwsError - PWS error data
 * @param faultCodes - Legacy fault codes
 * @param systemState - System state for turn on count
 * @returns Active fault info or undefined if no active error
 */
export function parseAllFaults(
  robotError: RobotErrorData | undefined,
  pwsError: RobotErrorData | undefined,
  faultCodes: { faultCode?: number; faultDescription?: string } | undefined,
  systemState: SystemStateData | undefined,
): FaultInfo | undefined {
  const currentTurnOnCount = systemState?.rTurnOnCount;
  const isPwsError = systemState?.pwsState === 'error';

  // Check robotError first (most specific)
  const robotFault = parseRobotError(robotError, currentTurnOnCount, isPwsError);
  if (robotFault) {
    return robotFault;
  }

  // Check pwsError (power supply errors)
  const pwsFault = parsePwsError(pwsError, currentTurnOnCount);
  if (pwsFault) {
    return pwsFault;
  }

  // Check legacy faultCodes format
  if (faultCodes) {
    return parseLegacyFaultCodes(faultCodes.faultCode, faultCodes.faultDescription);
  }

  return undefined;
}
