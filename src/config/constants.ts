/**
 * MyDolphin Plus Homebridge Plugin Constants
 */
export const PLUGIN_NAME = '@mp-consulting/homebridge-dolphin-pool-cleaner';
export const PLATFORM_NAME = 'DolphinPoolCleaner';
// Maytronics API Configuration
export const MAYTRONICS_API = {
  BASE_URL: 'https://apps.maytronics.com',
  APP_KEY: '346BDE92-53D1-4829-8A2E-B496014B586C',
  USER_AGENT: 'MyDolphin Plus/346 CFNetwork/3860.300.31 Darwin/25.2.0',
};
// AWS Cognito Configuration
export const COGNITO = {
  USER_POOL_ID: 'us-west-2_PKsEdCoP5',
  CLIENT_ID: '4ed12eq01o6n0tl5f0sqmkq2na',
  REGION: 'us-west-2',
};
// AWS IoT Configuration - endpoints by region (from iOS app Configuration.plist)
// Production uses eu-west-1, regardless of user location
export const IOT_ENDPOINTS: Record<string, string> = {
  'eu-west-1': 'a12rqfdx55bdbv-ats.iot.eu-west-1.amazonaws.com', // Production
  'eu-central-1': 'a2tgkimxdrkpxm-ats.iot.eu-central-1.amazonaws.com', // Test
  'us-east-2': 'awqf0dif0s78s-ats.iot.us-east-2.amazonaws.com', // Development
};
// Default IoT endpoint (production) - eu-west-1 per iOS app config
export const DEFAULT_IOT_ENDPOINT = IOT_ENDPOINTS['eu-west-1'];
export const DEFAULT_IOT_REGION = 'eu-west-1';
// Cleaning modes with their duration in minutes
// The 'apiMode' field is the string value expected by the shadow update API
export const CLEANING_MODES: Record<string, { name: string; duration: number; apiMode: string }> = {
  all: { name: 'All Surfaces', duration: 120, apiMode: 'all' },
  short: { name: 'Fast Mode', duration: 60, apiMode: 'short' },
  floor: { name: 'Floor Only', duration: 120, apiMode: 'floor' },
  wall: { name: 'Walls Only', duration: 120, apiMode: 'wall' },
  water: { name: 'Waterline', duration: 120, apiMode: 'water' },
  ultra: { name: 'Ultra Clean', duration: 120, apiMode: 'ultra' },
  cove: { name: 'Cove', duration: 120, apiMode: 'cove' },
  spot: { name: 'Spot Clean', duration: 120, apiMode: 'spot' },
  tictac: { name: 'TicTac', duration: 600, apiMode: 'tictac' },
  pickup: { name: 'Pickup', duration: 5, apiMode: 'pickup' },
  custom: { name: 'Custom', duration: 120, apiMode: 'custom' },
  stairs: { name: 'Stairs', duration: 120, apiMode: 'stairs' },
};
// Robot states
export const ROBOT_STATES = {
  OFF: 0x00,
  INIT: 0x01,
  SCANNING: 0x02,
  CLEANING: 0x03,
  FAULT: 0x04,
  PROGRAMMING: 0x05,
  END_OF_CYCLE: 0x06,
  PICKUP: 0x07,
  REMOTE_CONTROL: 0x08,
  CLEANING_PAUSE: 0x0b,
};
// Power supply states
export const PWS_STATES = {
  OFF: 0x00,
  HOLD_DELAY: 0x01,
  HOLD_WEEKLY: 0x02,
  PROGRAMMING: 0x03,
  ERROR: 0x04,
  CLEANING: 0x05,
  IDLE: 0x06,
};
// Polling intervals
export const DEFAULT_POLLING_INTERVAL = 60; // seconds
export const MIN_POLLING_INTERVAL = 30; // seconds

// Timeout values
export const SHADOW_TIMEOUT_MS = 10000; // 10 seconds for shadow operations
export const API_TIMEOUT_MS = 15000; // 15 seconds for API calls

// Serial number
export const SERIAL_NUMBER_LENGTH = 8; // Truncated serial for AWS IoT

// Credential refresh timing
export const CREDENTIAL_REFRESH_BUFFER_MS = 60 * 60 * 1000; // 1 hour before expiry

// MQTT connection settings
export const MQTT_RECONNECT_PERIOD_MS = 5000;
export const MQTT_CONNECT_TIMEOUT_MS = 30000;
export const MQTT_KEEPALIVE_SECONDS = 30;

// Time conversion constants
export const MILLISECONDS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const DEFAULT_CYCLE_TIME_MINUTES = 120;

// State refresh delay after commands
export const STATE_REFRESH_DELAY_MS = 3000;

// Timestamp validation
export const MIN_VALID_UNIX_TIMESTAMP = 1000000000; // Sept 2001

// Error codes
export const ERROR_CODE_NOT_APPLICABLE = 65535;
export const ERROR_CODE_NO_ERROR = 255;

// Filter status
export const FILTER_NEEDS_CLEANING_THRESHOLD = 80; // percent

// AWS Signature
export const AWS_SIGNATURE_EXPIRY_SECONDS = '86400'; // 1 day

// Debug log preview lengths
export const DEBUG_LOG_PREVIEW_LENGTH = 200;
