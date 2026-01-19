/**
 * BLE Command Builder
 *
 * Builds BLE-style commands for communication with Dolphin robots
 * via the MQTT dynamic channel.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { BLECommandsConfig, BuiltCommand, CommandDefinition, MessagePattern } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load BLE command definitions
let bleCommandsConfig: BLECommandsConfig;

/**
 * Load BLE commands configuration lazily
 */
function getConfig(): BLECommandsConfig {
  if (!bleCommandsConfig) {
    bleCommandsConfig = JSON.parse(
      readFileSync(join(__dirname, 'ble_commands_iot.json'), 'utf-8'),
    );
  }
  return bleCommandsConfig;
}

/**
 * Get the message pattern from configuration
 */
export function getMessagePattern(): MessagePattern {
  return getConfig().message_pattern;
}

/**
 * Get a command definition by name
 */
export function getCommandDefinition(commandName: string): CommandDefinition | undefined {
  return getConfig().commands[commandName];
}

/**
 * Get all available command names
 */
export function getAvailableCommands(): string[] {
  return Object.keys(getConfig().commands);
}

/**
 * Calculate checksum for BLE command (2 bytes)
 *
 * The checksum is a 16-bit sum of all bytes, returned as little-endian hex.
 *
 * @param message - Hex string to calculate checksum for
 * @returns 4-character hex string (2 bytes, little-endian)
 */
export function calculateChecksum(message: string): string {
  let checksum = 0;

  // Sum all bytes
  for (let i = 0; i < message.length; i += 2) {
    checksum += parseInt(message.substring(i, i + 2), 16);
  }

  // Keep only lower 16 bits
  checksum = checksum & 0xffff;

  // Return as 2-byte little-endian hex
  const lowByte = (checksum & 0xff).toString(16).padStart(2, '0');
  const highByte = ((checksum >> 8) & 0xff).toString(16).padStart(2, '0');

  return lowByte + highByte;
}

/**
 * Build a BLE-style command message
 *
 * Format: preamble(ab) + src(03) + destination + opcode + data_length + data + checksum
 *
 * @param commandName - Name of the command from the commands configuration
 * @param data - Optional hex data string to include in the command
 * @returns Built command object or undefined if command not found
 */
export function buildCommand(commandName: string, data?: string): BuiltCommand | undefined {
  const cmdDef = getCommandDefinition(commandName);
  if (!cmdDef) {
    return undefined;
  }

  const pattern = getMessagePattern();
  let message = '';

  // Preamble (start of packet)
  message += pattern.sop_preamble.constant;

  // Source
  message += pattern.src.constant;

  // Destination (2 bytes)
  message += cmdDef.destination.toLowerCase();

  // Opcode
  message += cmdDef.opcode;

  // Data length (2 bytes, little-endian)
  const dataLength = data ? Math.floor(data.length / 2) : 0;
  message += dataLength.toString(16).padStart(4, '0');

  // Data payload
  if (data) {
    message += data;
  }

  // Checksum (calculated over the entire message)
  message += calculateChecksum(message);

  return {
    hex: message,
    buffer: Buffer.from(message, 'hex'),
    commandName,
  };
}

/**
 * Get cleaning mode duration from configuration
 */
export function getCleaningModeDuration(mode: string): number | undefined {
  const config = getConfig();
  return config.robot_properties.cleaning_modes[mode];
}

/**
 * Get all cleaning modes with durations
 */
export function getCleaningModes(): Record<string, number> {
  return { ...getConfig().robot_properties.cleaning_modes };
}

/**
 * Validate a command name exists in the configuration
 */
export function isValidCommand(commandName: string): boolean {
  return commandName in getConfig().commands;
}
