#!/usr/bin/env node
/**
 * Shadow Data Dump Script
 *
 * Retrieves and explains all data from the robot's AWS IoT Thing Shadow.
 * Run with: node test/scripts/dump-shadow.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the compiled API
const { MaytronicsAPI } = await import('../dist/api/maytronicsApi.js');

// Simple console logger
const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.log('[WARN]', ...args),
  error: (...args) => console.log('[ERROR]', ...args),
  debug: () => {}, // Suppress debug logs for cleaner output
  log: (...args) => console.log('[LOG]', ...args),
  success: (...args) => console.log('[SUCCESS]', ...args),
};

// Load config
const configPath = join(__dirname, '../test/hbConfig/config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

const platformConfig = config.platforms.find((p) => p.platform === 'DolphinPoolCleaner');

if (!platformConfig) {
  console.error('DolphinPoolCleaner platform not found in config');
  process.exit(1);
}

/**
 * Field explanations for the shadow data
 */
const FIELD_EXPLANATIONS = {
  // Top-level
  'state': 'Container for reported and desired states',
  'reported': 'Current state reported by the device',
  'desired': 'Desired state set by the cloud/app',
  'metadata': 'Timestamps for when each field was last updated',
  'version': 'Shadow document version (increments on each update)',
  'timestamp': 'Unix timestamp of when shadow was last updated',

  // LastReceiveData
  'LastReceiveData': 'Information about the last data received from robot',
  'dynamicTopics': 'MQTT topics the robot publishes to',
  'robotSerial': 'Full robot serial number',

  // Connection
  'isConnected': 'Robot connection status',
  'connected': 'true if robot is currently connected to cloud',

  // System State
  'systemState': 'Power supply unit (PWS) system state',
  'pwsState': '"on" = powered on / "cleaning" = actively cleaning / "idle" = standby',
  'timeZone': 'Timezone offset in hours',
  'timeZoneId': 'IANA timezone identifier (e.g., "Europe/Paris")',

  // Robot State
  'robotState': 'Robot operational state',
  'prState': 'Power relay state',
  'isOn': 'true if robot motor is running',

  // Cycle Info
  'cycleInfo': 'Current/last cleaning cycle information',
  'cleaningMode': 'Active cleaning mode settings',
  'cycleTime': 'Cycle duration in minutes',
  'mode': 'Cleaning mode: "all"=full clean, "floor"=floor only, "waterline"=waterline only',
  'cycleStartTime': 'Unix timestamp when cycle started (local time)',
  'cycleStartTimeUTC': 'Unix timestamp when cycle started (UTC)',
  'cycleState': 'Cycle state: "idle", "cleaning", etc.',
  'cycleTimeRemaining': 'Time remaining in current cycle',

  // Filter
  'filterBagIndication': 'Filter bag/cartridge status',
  'filterState': '"clean" = filter OK, "dirty"/"full" = needs cleaning',
  'filterLevel': 'Filter fullness level (0 = clean, higher = fuller)',
  'filterIndicator': 'Alternative name for filter status',

  // Errors
  'robotError': 'Robot error information',
  'errorCode': 'Error code (0 = no error)',
  'errorDescription': 'Human-readable error description',
  'pwsError': 'Power supply unit error information',
  'faultCodes': 'Alternative error format',
  'faultCode': 'Fault code number',
  'faultDescription': 'Fault description',

  // Navigation
  'navMode': 'Navigation mode: "normal" or "smart"',

  // Cleaning Modes Available
  'cleaningModes': 'Available cleaning modes and their settings',
  'all': 'All surfaces mode (floor + walls + waterline)',
  'floor': 'Floor only mode',
  'waterline': 'Waterline only mode',
  'enabled': 'Whether this feature/mode is enabled',

  // Scheduling
  'weeklySettings': 'Weekly schedule configuration',
  'schedules': 'Array of scheduled cleaning times',
  'weeklyTimer': 'Alternative weekly timer format',
  'time': 'Scheduled time',
  'weekdays': 'Which days are enabled',

  // Delay
  'delay': 'Delayed start settings',
  'delayTime': 'Delay time in minutes',
  'delayedOperation': 'Alternative delayed operation format',

  // Versions
  'versions': 'Firmware versions',
  'pwsVersion': 'Power supply firmware version',
  'robotVersion': 'Robot firmware version',

  // Features
  'featureEn': 'Enabled features on this robot model',
  'led': 'Whether LED lights are available',
  'waterTemperature': 'Whether water temperature sensor is available',

  // WiFi
  'wifi': 'WiFi connection information',
  'ssid': 'Connected WiFi network name',
  'rssi': 'WiFi signal strength in dBm (e.g., -50 = good, -80 = weak)',

  // Temperature
  'inwatTemperature': 'Water temperature reading',
  'temperature': 'Temperature value in degrees',
  'unit': 'Temperature unit (C = Celsius, F = Fahrenheit)',

  // LED
  'ledEnable': 'Whether LED is turned on',
  'ledIntensity': 'LED brightness (0-100%)',
  'ledMode': 'LED mode: "solid", "pulsing", etc.',

  // Other
  'nextCycleInfo': 'Information about next scheduled cycle',
  'debug': 'Debug information (usually empty)',
};

/**
 * Get explanation for a field
 */
function getExplanation(key) {
  return FIELD_EXPLANATIONS[key] || '';
}

/**
 * Recursively print and explain shadow data
 */
function explainData(data, prefix = '', depth = 0) {
  const indent = '  '.repeat(depth);
  const key = prefix.split('.').pop() || prefix;

  if (data === null || data === undefined) {
    console.log(`${indent}${key}: null`);
    return;
  }

  if (typeof data !== 'object') {
    const explanation = getExplanation(key);
    const explainStr = explanation ? `  ← ${explanation}` : '';

    // Format timestamps
    let displayValue = data;
    if (key.toLowerCase().includes('timestamp') || key.toLowerCase().includes('time')) {
      if (typeof data === 'number' && data > 1000000000 && data < 2000000000) {
        const date = new Date(data * 1000);
        displayValue = `${data} (${date.toISOString()})`;
      }
    }

    console.log(`${indent}${key}: ${JSON.stringify(displayValue)}${explainStr}`);
    return;
  }

  if (Array.isArray(data)) {
    const explanation = getExplanation(key);
    const explainStr = explanation ? `  ← ${explanation}` : '';
    if (data.length === 0) {
      console.log(`${indent}${key}: []${explainStr}`);
    } else {
      console.log(`${indent}${key}: [${data.length} items]${explainStr}`);
      data.forEach((item, i) => {
        if (typeof item === 'object') {
          console.log(`${indent}  [${i}]:`);
          for (const [k, v] of Object.entries(item)) {
            explainData(v, `${prefix}[${i}].${k}`, depth + 2);
          }
        } else {
          console.log(`${indent}  [${i}]: ${JSON.stringify(item)}`);
        }
      });
    }
    return;
  }

  const explanation = getExplanation(key);
  const explainStr = explanation ? `  ← ${explanation}` : '';
  console.log(`${indent}${key}:${explainStr}`);

  for (const [k, value] of Object.entries(data)) {
    explainData(value, `${prefix}.${k}`, depth + 1);
  }
}

/**
 * Analyze cleaning state from shadow data
 */
function analyzeCleaningState(reported) {
  console.log('\n' + '═'.repeat(60));
  console.log('📊 CLEANING STATE ANALYSIS');
  console.log('═'.repeat(60));

  // Check cycleStartTime
  if (reported.cycleInfo) {
    const cycleStartTimeUTC = reported.cycleInfo.cycleStartTimeUTC;
    const cycleStartTime = reported.cycleInfo.cycleStartTime;
    const cycleTime = reported.cycleInfo.cleaningMode?.cycleTime || 120;
    const mode = reported.cycleInfo.cleaningMode?.mode || 'unknown';

    const startTime = cycleStartTimeUTC || cycleStartTime;
    if (startTime && startTime > 0) {
      const now = Math.floor(Date.now() / 1000);
      const elapsedMinutes = (now - startTime) / 60;
      const startDate = new Date(startTime * 1000);

      console.log(`\n⏱️  Cycle Information:`);
      console.log(`   Started: ${startDate.toLocaleString()}`);
      console.log(`   Mode: ${mode}`);
      console.log(`   Duration: ${cycleTime} minutes`);
      console.log(`   Elapsed: ${elapsedMinutes.toFixed(1)} minutes`);

      if (elapsedMinutes >= 0 && elapsedMinutes < cycleTime) {
        const remaining = cycleTime - elapsedMinutes;
        console.log(`\n   ✅ ROBOT IS CLEANING`);
        console.log(`   ⏳ Time Remaining: ${remaining.toFixed(0)} minutes`);
      } else {
        console.log(`\n   ⏹️  ROBOT IS IDLE (cycle completed ${(elapsedMinutes - cycleTime).toFixed(0)} min ago)`);
      }
    } else {
      console.log('\n   ℹ️  No recent cycle - robot has not cleaned recently');
    }
  }

  // Check system state
  if (reported.systemState) {
    console.log(`\n🔌 System State:`);
    console.log(`   PWS State: ${reported.systemState.pwsState}`);
    console.log(`   Robot State: ${reported.systemState.robotState || 'unknown'}`);
    console.log(`   Robot Type: ${reported.systemState.robotType || 'unknown'}`);
    console.log(`   Is Busy: ${reported.systemState.isBusy ? 'Yes' : 'No'}`);
    console.log(`   Timezone: ${reported.systemState.timeZoneName || reported.systemState.timeZoneId || 'Unknown'}`);
  }

  // Check connection
  if (reported.isConnected) {
    console.log(`\n📡 Connection:`);
    console.log(`   Connected: ${reported.isConnected.connected ? 'Yes ✓' : 'No ✗'}`);
  }

  // Check WiFi - actual structure has netName in wifi, RSSI in debug
  if (reported.wifi || reported.debug) {
    console.log(`\n📶 WiFi:`);
    const netName = reported.wifi?.netName || reported.wifi?.ssid || 'Unknown';
    const rssi = reported.debug?.WIFI_RSSI || reported.wifi?.rssi;
    console.log(`   Network: ${netName}`);
    if (rssi !== undefined) {
      const quality = rssi > -60 ? '(Good)' : rssi > -75 ? '(Fair)' : '(Weak)';
      console.log(`   Signal: ${rssi} dBm ${quality}`);
    }
  }

  // Check filter - actual structure has numeric 'state' (0-100%)
  const filterData = reported.filterBagIndication || reported.filterIndicator;
  if (filterData) {
    console.log(`\n🧹 Filter Status:`);
    if (filterData.state !== undefined) {
      // Numeric state: 0-100 where higher means filter is fuller
      const percent = filterData.state;
      const status = percent > 80 ? 'Needs Cleaning ⚠️' : 'OK ✓';
      console.log(`   Fullness: ${percent}% ${status}`);
    } else if (filterData.filterState !== undefined) {
      console.log(`   State: ${filterData.filterState}`);
    }
    if (filterData.filterLevel !== undefined) {
      console.log(`   Level: ${filterData.filterLevel}`);
    }
    if (filterData.resetFBI !== undefined) {
      console.log(`   Reset Flag: ${filterData.resetFBI}`);
    }
  }

  // Check errors - error codes 0 and 255 mean "no error"
  if (reported.robotError) {
    const code = reported.robotError.errorCode;
    if (code > 0 && code < 255) {
      console.log(`\n⚠️  Robot Error:`);
      console.log(`   Code: ${code}`);
      console.log(`   PCB Hours: ${reported.robotError.pcbHours}`);
      console.log(`   Turn On Count: ${reported.robotError.turnOnCount}`);
    } else {
      console.log(`\n✅ Robot Error: None (code ${code})`);
    }
  }
  if (reported.pwsError) {
    const code = reported.pwsError.errorCode;
    // 255 and 65535 mean "no error" for PWS
    if (code > 0 && code < 255) {
      console.log(`\n⚠️  PWS Error:`);
      console.log(`   Code: ${code}`);
    } else {
      console.log(`✅ PWS Error: None`);
    }
  }

  // Check features - actual structure has different field names
  if (reported.featureEn) {
    console.log(`\n🎛️  Available Features:`);
    console.log(`   Delay Start: ${reported.featureEn.delay ? 'Yes' : 'No'}`);
    console.log(`   Floor Mode: ${reported.featureEn.floor ? 'Yes' : 'No'}`);
    console.log(`   Short Mode: ${reported.featureEn.short ? 'Yes' : 'No'}`);
    console.log(`   Pickup: ${reported.featureEn.pickup ? 'Yes' : 'No'}`);
    console.log(`   FBI LED: ${reported.featureEn.fbiLED ? 'Yes' : 'No'}`);
    if (reported.featureEn.weeklyTimer) {
      console.log(`   Weekly Timer: ${reported.featureEn.weeklyTimer.status ? 'Yes' : 'No'} (${reported.featureEn.weeklyTimer.frequency} days)`);
    }
  }

  // Check available modes - actual structure is { modeName: cycleTimeInMinutes }
  if (reported.cleaningModes) {
    console.log(`\n🧼 Available Cleaning Modes:`);
    for (const [modeName, cycleTime] of Object.entries(reported.cleaningModes)) {
      if (typeof cycleTime === 'number') {
        console.log(`   ${modeName}: ${cycleTime} min`);
      } else if (cycleTime && typeof cycleTime === 'object') {
        console.log(`   ${modeName}: ${cycleTime.cycleTime} min ${cycleTime.enabled ? '✓' : '(disabled)'}`);
      }
    }
  }

  // Check versions
  if (reported.versions) {
    console.log(`\n📦 Firmware Versions:`);
    if (reported.versions.sysVersion) {
      console.log(`   System: ${reported.versions.sysVersion}`);
    }
    if (reported.versions.pwsVersion) {
      const pws = reported.versions.pwsVersion;
      console.log(`   PWS HW: ${pws.pwsHwVersion || pws}, SW: ${pws.pwsSwVersion || 'N/A'}`);
    }
    if (reported.versions.robotVersion) {
      const robot = reported.versions.robotVersion;
      console.log(`   Robot HW: ${robot.muHwVersion || robot}, SW: ${robot.muSwVersion || 'N/A'}`);
    }
  }

  // Check weekly settings
  if (reported.weeklySettings) {
    console.log(`\n📅 Weekly Schedule:`);
    console.log(`   Repeat Mode: ${reported.weeklySettings.isInRepeatMode ? 'Yes' : 'No'}`);
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const enabledDays = days.filter(d => reported.weeklySettings[d]?.isEnabled);
    if (enabledDays.length > 0) {
      console.log(`   Enabled Days: ${enabledDays.join(', ')}`);
    } else {
      console.log(`   Enabled Days: None`);
    }
  }

  // Check delay settings
  if (reported.delay) {
    console.log(`\n⏰ Delay Settings:`);
    console.log(`   Enabled: ${reported.delay.isEnabled ? 'Yes' : 'No'}`);
    if (reported.delay.startTime) {
      console.log(`   Start Time: ${reported.delay.startTime.hours}:${String(reported.delay.startTime.minutes).padStart(2, '0')}`);
    }
  }
}

/**
 * Main function
 */
async function main() {
  console.log('═'.repeat(60));
  console.log('🐬 DOLPHIN ROBOT SHADOW DATA DUMP');
  console.log('═'.repeat(60));
  console.log(`📁 Config: ${configPath}`);
  console.log(`🌍 Region: ${platformConfig.iotRegion || 'eu-west-1'}`);
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
    console.log('🔐 Authenticating...');
    const authResult = await api.login();
    console.log(`✅ Logged in: ${authResult.robotName} (S/N: ${authResult.serialNumber})\n`);

    // Get robots
    const robots = await api.getRobots();
    console.log(`📋 Found ${robots.length} robot(s)\n`);

    // Get shadow for each robot
    for (const robot of robots) {
      console.log('═'.repeat(60));
      console.log(`🤖 ROBOT: ${robot.name}`);
      console.log(`   Serial: ${robot.serialNumber}`);
      console.log(`   Device Type: ${robot.deviceType}`);
      console.log('═'.repeat(60));

      // Get shadow
      console.log('\n📥 Fetching Thing Shadow...');
      const shadow = await api.getThingShadow(robot.serialNumber);

      if (!shadow) {
        console.log('❌ Failed to retrieve shadow');
        continue;
      }

      // Analyze cleaning state first (most important info)
      if (shadow.state?.reported) {
        analyzeCleaningState(shadow.state.reported);
      }

      console.log('\n' + '─'.repeat(60));
      console.log('📋 FULL SHADOW DATA (with explanations):');
      console.log('─'.repeat(60));

      // Explain the reported state
      if (shadow.state?.reported) {
        explainData(shadow.state.reported, 'reported', 0);
      }

      // Print raw JSON for reference
      console.log('\n' + '─'.repeat(60));
      console.log('📄 RAW JSON:');
      console.log('─'.repeat(60));
      console.log(JSON.stringify(shadow, null, 2));
    }

    console.log('\n✅ Done');

    // Give time for MQTT to disconnect cleanly before exiting
    setTimeout(() => process.exit(0), 1000);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
