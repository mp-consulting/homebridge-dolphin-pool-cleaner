/**
 * Homebridge Dolphin Pool Cleaner Plugin
 *
 * Control your Maytronics Dolphin pool cleaning robot through HomeKit.
 */
import type { API } from 'homebridge';
import { PLUGIN_NAME, PLATFORM_NAME } from './config/constants.js';
import { DolphinPoolCleanerPlatform } from './platform.js';

/**
 * Register the platform with Homebridge
 */
export default (api: API): void => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, DolphinPoolCleanerPlatform);
};
