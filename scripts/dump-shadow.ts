#!/usr/bin/env npx ts-node
/**
 * Shadow Data Dump Script
 *
 * Retrieves and explains all data from the robot's AWS IoT Thing Shadow.
 * Run with: npx ts-node test/scripts/dump-shadow.ts
 */

import { MaytronicsAPI } from '../src/api/maytronicsApi.js';

// Simple console logger that matches Homebridge Logger interface
const logger = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.log('[WARN]', ...args),
  error: (...args: unknown[]) => console.log('[ERROR]', ...args),
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args),
  log: (...args: unknown[]) => console.log('[LOG]', ...args),
  success: (...args: unknown[]) => console.log('[SUCCESS]', ...args),
} as any;

// Load config
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '../hbConfig/config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

const platformConfig = config.platforms.find((p: any) => p.platform === 'DolphinPoolCleaner');

if (!platformConfig) {
  console.error('DolphinPoolCleaner platform not found in config');
  process.exit(1);
}

/**
 * Field explanations for the shadow data
 */
const FIELD_EXPLANATIONS: Record<string, string> = {
  // Top-level
  'state': 'Container for reported and desired states',
  'state.reported': 'Current state reported by the device',
  'state.desired': 'Desired state set by the cloud/app',
  'metadata': 'Timestamps for when each field was last updated',
  'version': 'Shadow document version (increments on each update)',
  'timestamp': 'Unix timestamp of when shadow was last updated',

  // LastReceiveData
  'LastReceiveData': 'Information about the last data received from robot',
  'LastReceiveData.dynamicTopics': 'MQTT topics the robot publishes to',
  'LastReceiveData.robotSerial': 'Full robot serial number',
  'LastReceiveData.timestamp': 'When data was last received',

  // Connection
  'isConnected': 'Robot connection status',
  'isConnected.connected': 'true if robot is currently connected to cloud',

  // System State
  'systemState': 'Power supply unit (PWS) system state',
  'systemState.pwsState': '"on" = PWS is powered on, "off" = PWS is off',
  'systemState.timeZone': 'Timezone offset in hours',
  'systemState.timeZoneId': 'IANA timezone identifier (e.g., "Europe/Paris")',

  // Robot State (may not always be present)
  'robotState': 'Robot operational state (not always present in shadow)',
  'robotState.prState': 'Power relay state',
  'robotState.pwsState': 'Robot activity: "idle", "cleaning", etc.',
  'robotState.isOn': 'true if robot motor is running',

  // Cycle Info
  'cycleInfo': 'Current/last cleaning cycle information',
  'cycleInfo.cleaningMode': 'Active cleaning mode settings',
  'cycleInfo.cleaningMode.cycleTime': 'Cycle duration in minutes',
  'cycleInfo.cleaningMode.mode': 'Cleaning mode: "all", "floor", "waterline", etc.',
  'cycleInfo.cycleStartTime': 'Unix timestamp when cycle started (local time)',
  'cycleInfo.cycleStartTimeUTC': 'Unix timestamp when cycle started (UTC)',
  'cycleInfo.cycleState': 'Cycle state: "idle", "cleaning", etc. (if present)',
  'cycleInfo.cycleTimeRemaining': 'Time remaining in current cycle',

  // Filter
  'filterBagIndication': 'Filter bag/cartridge status',
  'filterBagIndication.filterState': '"clean" or "dirty"/"full"',
  'filterBagIndication.filterLevel': 'Filter fullness level (0 = clean)',
  'filterIndicator': 'Alternative name for filter status',

  // Errors
  'robotError': 'Robot error information',
  'robotError.errorCode': 'Error code (0 = no error)',
  'robotError.errorDescription': 'Human-readable error description',
  'pwsError': 'Power supply unit error information',
  'pwsError.errorCode': 'PWS error code (0 = no error)',
  'pwsError.errorDescription': 'PWS error description',
  'faultCodes': 'Alternative error format',
  'faultCodes.faultCode': 'Fault code number',
  'faultCodes.faultDescription': 'Fault description',

  // Navigation
  'navMode': 'Navigation mode: "normal", "smart", etc.',

  // Cleaning Modes Available
  'cleaningModes': 'Available cleaning modes and their settings',
  'cleaningModes.all': 'All surfaces mode (floor + walls + waterline)',
  'cleaningModes.floor': 'Floor only mode',
  'cleaningModes.waterline': 'Waterline only mode',

  // Scheduling
  'weeklySettings': 'Weekly schedule configuration',
  'weeklySettings.enabled': 'Whether weekly schedule is active',
  'weeklySettings.schedules': 'Array of scheduled cleaning times',
  'weeklyTimer': 'Alternative weekly timer format',
  'weeklyTimer.enabled': 'Whether timer is enabled',
  'weeklyTimer.time': 'Scheduled start time',
  'weeklyTimer.weekdays': 'Which days are enabled',

  // Delay
  'delay': 'Delayed start settings',
  'delay.enabled': 'Whether delayed start is active',
  'delay.delayTime': 'Delay time in minutes',
  'delayedOperation': 'Alternative delayed operation format',

  // Versions
  'versions': 'Firmware versions',
  'versions.pwsVersion': 'Power supply firmware version',
  'versions.robotVersion': 'Robot firmware version',

  // Features
  'featureEn': 'Enabled features on this robot',
  'featureEn.led': 'Whether LED lights are available',
  'featureEn.waterTemperature': 'Whether temperature sensor is available',

  // WiFi
  'wifi': 'WiFi connection information',
  'wifi.ssid': 'Connected WiFi network name',
  'wifi.rssi': 'WiFi signal strength (dBm, more negative = weaker)',

  // Temperature
  'inwatTemperature': 'Water temperature reading',
  'inwatTemperature.temperature': 'Temperature value',
  'inwatTemperature.unit': 'Temperature unit (C or F)',

  // LED
  'led': 'LED light settings',
  'led.ledEnable': 'Whether LED is turned on',
  'led.ledIntensity': 'LED brightness (0-100)',
  'led.ledMode': 'LED mode: "solid", "pulsing", etc.',

  // Other
  'dynamicTopics': 'MQTT topics (duplicate of LastReceiveData)',
  'robotSerial': 'Robot serial number (duplicate)',
  'nextCycleInfo': 'Information about next scheduled cycle',
  'debug': 'Debug information (usually empty)',
};

/**
 * Recursively print and explain shadow data
 */
function explainData(data: any, prefix = '', depth = 0): void {
  const indent = '  '.repeat(depth);

  if (data === null || data === undefined) {
    console.log(`${indent}${prefix}: null/undefined`);
    return;
  }

  if (typeof data !== 'object') {
    const explanation = FIELD_EXPLANATIONS[prefix] || '';
    const explainStr = explanation ? ` → ${explanation}` : '';
    console.log(`${indent}${prefix}: ${JSON.stringify(data)}${explainStr}`);
    return;
  }

  if (Array.isArray(data)) {
    const explanation = FIELD_EXPLANATIONS[prefix] || '';
    const explainStr = explanation ? ` → ${explanation}` : '';
    console.log(`${indent}${prefix}: [${data.length} items]${explainStr}`);
    data.forEach((item, i) => {
      explainData(item, `[${i}]`, depth + 1);
    });
    return;
  }

  const explanation = FIELD_EXPLANATIONS[prefix] || '';
  const explainStr = explanation ? ` → ${explanation}` : '';
  console.log(`${indent}${prefix}:${explainStr}`);

  for (const [key, value] of Object.entries(data)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    explainData(value, fullPath, depth + 1);
  }
}

/**
 * Analyze cleaning state from shadow data
 */
function analyzeCleaningState(reported: any): void {
  console.log('\n' + '='.repeat(60));
  console.log('CLEANING STATE ANALYSIS');
  console.log('='.repeat(60));

  // Check cycleStartTime
  if (reported.cycleInfo) {
    const cycleStartTimeUTC = reported.cycleInfo.cycleStartTimeUTC;
    const cycleStartTime = reported.cycleInfo.cycleStartTime;
    const cycleTime = reported.cycleInfo.cleaningMode?.cycleTime || 120;

    const startTime = cycleStartTimeUTC || cycleStartTime;
    if (startTime) {
      const now = Math.floor(Date.now() / 1000);
      const elapsedMinutes = (now - startTime) / 60;
      const startDate = new Date(startTime * 1000);

      console.log(`\nCycle Start Time (UTC): ${startDate.toISOString()}`);
      console.log(`Cycle Duration: ${cycleTime} minutes`);
      console.log(`Elapsed Time: ${elapsedMinutes.toFixed(1)} minutes`);

      if (elapsedMinutes >= 0 && elapsedMinutes < cycleTime) {
        const remaining = cycleTime - elapsedMinutes;
        console.log(`\n✅ ROBOT IS CLEANING`);
        console.log(`   Time Remaining: ${remaining.toFixed(0)} minutes`);
      } else {
        console.log(`\n⏹️ ROBOT IS NOT CLEANING (cycle finished or not started)`);
      }
    } else {
      console.log('\nNo cycleStartTime found - robot has not cleaned recently');
    }
  }

  // Check robotState if present
  if (reported.robotState) {
    console.log(`\nRobot State:`);
    console.log(`  isOn: ${reported.robotState.isOn}`);
    console.log(`  pwsState: ${reported.robotState.pwsState}`);
  }

  // Check system state
  if (reported.systemState) {
    console.log(`\nSystem State:`);
    console.log(`  pwsState: ${reported.systemState.pwsState} (power supply)`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('='.repeat(60));
  console.log('DOLPHIN ROBOT SHADOW DATA DUMP');
  console.log('='.repeat(60));
  console.log(`Config: ${configPath}`);
  console.log(`Region: ${platformConfig.iotRegion || 'eu-west-1'}`);
  console.log('');

  try {
    // Initialize API
    const api = new MaytronicsAPI(
      platformConfig.email,
      platformConfig.password,
      logger,
      platformConfig.iotRegion,
      platformConfig.refreshToken,
    );

    // Login
    console.log('Authenticating...');
    const authResult = await api.login();
    console.log(`Logged in as: ${authResult.robotName} (S/N: ${authResult.serialNumber})`);

    // Get robots
    const robots = await api.getRobots();
    console.log(`Found ${robots.length} robot(s)\n`);

    // Get shadow for each robot
    for (const robot of robots) {
      console.log('='.repeat(60));
      console.log(`ROBOT: ${robot.name}`);
      console.log(`Serial: ${robot.serialNumber}`);
      console.log(`Device Type: ${robot.deviceType}`);
      console.log('='.repeat(60));

      // Get shadow
      console.log('\nFetching Thing Shadow...');
      const shadow = await api.getThingShadow(robot.serialNumber);

      if (!shadow) {
        console.log('❌ Failed to retrieve shadow');
        continue;
      }

      console.log('\n' + '-'.repeat(60));
      console.log('RAW SHADOW DATA (with explanations):');
      console.log('-'.repeat(60));

      // Explain the reported state
      if (shadow.state?.reported) {
        explainData(shadow.state.reported, 'reported', 0);
      }

      // Analyze cleaning state
      if (shadow.state?.reported) {
        analyzeCleaningState(shadow.state.reported);
      }

      // Print raw JSON for reference
      console.log('\n' + '-'.repeat(60));
      console.log('FULL RAW JSON:');
      console.log('-'.repeat(60));
      console.log(JSON.stringify(shadow, null, 2));
    }

    // Disconnect
    api.disconnect();
    console.log('\n✅ Done');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
