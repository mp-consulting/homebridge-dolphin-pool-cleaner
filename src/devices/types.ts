/**
 * Device Types
 *
 * Type definitions for device-related structures.
 * Re-exports common types from parsers for convenience.
 */

// Re-export parser types that are commonly used with devices
export type {
  ParsedRobotState,
  FilterStatus,
  FaultInfo,
  RawShadowState,
} from '../parsers/types.js';

// Note: RobotState is exported from dolphinDevice.ts for backward compatibility
