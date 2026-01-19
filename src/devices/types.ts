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

// Export RobotState as alias for backward compatibility
export type { ParsedRobotState as RobotState } from '../parsers/types.js';
