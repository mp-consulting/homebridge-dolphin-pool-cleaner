/**
 * Protocol Types
 *
 * Type definitions for BLE protocol and command building.
 */

/**
 * BLE message pattern configuration
 */
export interface MessagePattern {
  sop_preamble: {
    constant: string;
    start: number;
    end: number;
  };
  src: {
    constant: string;
    start: number;
    end: number;
  };
  destination: {
    start: number;
    end: number;
  };
  opcode: {
    start: number;
    end: number;
  };
  data_length: {
    start: number;
    end: number;
  };
  checksum: {
    constant: string;
    length: number;
  };
}

/**
 * Data field mapping for command responses
 */
export interface DataFieldMap {
  [fieldName: string]: {
    data_type: string;
    start: number;
    end: number;
    flip_bytes?: boolean;
    field_properties?: {
      flip_array?: boolean;
      fault_block_size?: number;
    };
  };
}

/**
 * Command data configuration
 */
export interface CommandData {
  request_length: number;
  response_length: number;
  map?: DataFieldMap;
}

/**
 * BLE command definition
 */
export interface CommandDefinition {
  init: number;
  ondemand: boolean;
  opcode: string;
  destination: string;
  shadow_dest?: string;
  big_indian?: boolean;
  pkfNeeded: boolean;
  need_to_collect_data?: boolean;
  data: CommandData;
}

/**
 * BLE commands configuration
 */
export interface BLECommandsConfig {
  musn: string;
  sm_destination: string;
  message_pattern: MessagePattern;
  commands: Record<string, CommandDefinition>;
  acknowledge: Record<string, Record<string, string>>;
  robot_properties: {
    cleaning_modes: Record<string, number>;
  };
  topics: {
    subscribe_topics: string[];
    get_data_topics: string[];
    subscribe_dynamic_topic: string[];
    send_channels: {
      dynamic_channel: string;
      regular_channel: string;
      update_channel: string;
    };
  };
}

/**
 * Built command result
 */
export interface BuiltCommand {
  hex: string;
  buffer: Buffer;
  commandName: string;
}
