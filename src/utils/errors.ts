/**
 * Custom Error Classes
 *
 * Provides structured error handling with error codes and context
 * for better debugging and user-facing messages.
 */

/**
 * Error codes for categorizing errors
 */
export enum ErrorCode {
  // Authentication errors (1xx)
  AUTH_COGNITO_FAILED = 'AUTH_COGNITO_FAILED',
  AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
  AUTH_MYDOLPHIN_FAILED = 'AUTH_MYDOLPHIN_FAILED',
  AUTH_AWS_CREDENTIALS_FAILED = 'AUTH_AWS_CREDENTIALS_FAILED',

  // MQTT errors (2xx)
  MQTT_CONNECTION_FAILED = 'MQTT_CONNECTION_FAILED',
  MQTT_SUBSCRIPTION_FAILED = 'MQTT_SUBSCRIPTION_FAILED',
  MQTT_PUBLISH_FAILED = 'MQTT_PUBLISH_FAILED',
  MQTT_SHADOW_TIMEOUT = 'MQTT_SHADOW_TIMEOUT',
  MQTT_SHADOW_REJECTED = 'MQTT_SHADOW_REJECTED',
  MQTT_NOT_CONNECTED = 'MQTT_NOT_CONNECTED',

  // Robot control errors (3xx)
  ROBOT_START_FAILED = 'ROBOT_START_FAILED',
  ROBOT_STOP_FAILED = 'ROBOT_STOP_FAILED',
  ROBOT_MODE_SET_FAILED = 'ROBOT_MODE_SET_FAILED',
  ROBOT_PICKUP_FAILED = 'ROBOT_PICKUP_FAILED',
  ROBOT_SHADOW_FETCH_FAILED = 'ROBOT_SHADOW_FETCH_FAILED',

  // API errors (4xx)
  API_REQUEST_FAILED = 'API_REQUEST_FAILED',
  API_INVALID_RESPONSE = 'API_INVALID_RESPONSE',
  API_ROBOT_INFO_FAILED = 'API_ROBOT_INFO_FAILED',

  // Protocol errors (5xx)
  PROTOCOL_INVALID_COMMAND = 'PROTOCOL_INVALID_COMMAND',
  PROTOCOL_BUILD_FAILED = 'PROTOCOL_BUILD_FAILED',

  // General errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Base error class with code and context
 */
export class PluginError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;
  readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error | unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
    this.context = options?.context;

    if (options?.cause instanceof Error) {
      this.cause = options.cause;
    } else if (options?.cause) {
      this.cause = new Error(String(options.cause));
    }

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Format error for logging
   */
  toString(): string {
    let result = `[${this.code}] ${this.message}`;
    if (this.context && Object.keys(this.context).length > 0) {
      result += ` (${JSON.stringify(this.context)})`;
    }
    if (this.cause) {
      result += ` - Caused by: ${this.cause.message}`;
    }
    return result;
  }

  /**
   * Get a user-friendly message
   */
  toUserMessage(): string {
    return this.message;
  }
}

/**
 * Authentication-specific error
 */
export class AuthError extends PluginError {
  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error | unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super(code, message, options);
    this.name = 'AuthError';
  }
}

/**
 * MQTT-specific error
 */
export class MQTTError extends PluginError {
  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error | unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super(code, message, options);
    this.name = 'MQTTError';
  }
}

/**
 * API-specific error
 */
export class ApiError extends PluginError {
  readonly statusCode?: number;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error | unknown;
      context?: Record<string, unknown>;
      statusCode?: number;
    },
  ) {
    super(code, message, options);
    this.name = 'ApiError';
    this.statusCode = options?.statusCode;
  }
}

/**
 * Helper to extract error message from unknown error type
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
