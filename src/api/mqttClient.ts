/**
 * MQTT Client for AWS IoT Core
 *
 * This client uses MQTT over WebSocket to communicate with AWS IoT Core,
 * mirroring the communication pattern used by the iOS MyDolphin Plus app.
 *
 * The iOS app uses these MQTT topics:
 * - Subscribe: $aws/things/{serial}/shadow/update/accepted
 * - Subscribe: $aws/things/{serial}/shadow/update/rejected
 * - Subscribe: $aws/things/{serial}/shadow/get/accepted
 * - Subscribe: $aws/things/{serial}/shadow/get/rejected
 * - Subscribe: Maytronics/{serial}/main (dynamic channel)
 * - Publish: $aws/things/{serial}/shadow/get (to request shadow)
 * - Publish: $aws/things/{serial}/shadow/update (to send commands)
 * - Publish: Maytronics/{serial}/main (dynamic commands)
 */
import { EventEmitter } from 'events';
import * as mqtt from 'mqtt';
import { createHmac, createHash } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { Logger } from 'homebridge';
import type { AWSCredentials } from './maytronicsApi.js';

// Load BLE command mappings
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const bleCommandsIot = JSON.parse(
  readFileSync(join(__dirname, '../protocol/ble_commands_iot.json'), 'utf-8'),
);

export interface MQTTClientConfig {
  serialNumber: string;
  region: string;
  iotEndpoint: string;
  credentials: AWSCredentials;
}

export class MQTTClient extends EventEmitter {
  private readonly log: Logger;
  private client: mqtt.MqttClient | undefined;
  private readonly serialNumber: string;
  private readonly region: string;
  private readonly iotEndpoint: string;
  private credentials: AWSCredentials;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private currentShadow: any;

  constructor(config: MQTTClientConfig, log: Logger) {
    super();
    this.log = log;
    this.serialNumber = config.serialNumber;
    this.region = config.region;
    this.iotEndpoint = config.iotEndpoint;
    this.credentials = config.credentials;
  }
  /**
   * Connect to AWS IoT Core via MQTT over WebSocket
   */
  async connect(): Promise<void> {
    if (this.connected) {
      this.log.debug('MQTT client already connected');
      return;
    }
    return new Promise<void>((resolve, reject) => {
      try {
        const signedUrl = this.getSignedWebSocketUrl();
        this.log.debug(
          `Connecting to AWS IoT MQTT: wss://${this.iotEndpoint}/mqtt`,
        );
        // Use a client ID format that matches what the IAM policy expects
        // Based on the federated user ARN (E3086OFG_App_Token), the serial is truncated to 8 chars
        const truncatedSerial = this.serialNumber.substring(0, 8);
        const clientId = `${truncatedSerial}_App_Token`;
        this.log.debug(
          `MQTT client ID: ${clientId} (truncated from ${this.serialNumber})`,
        );
        this.client = mqtt.connect(signedUrl, {
          clientId: clientId,
          clean: true,
          reconnectPeriod: 5000,
          connectTimeout: 30000,
          keepalive: 30, // Send ping every 30 seconds
          protocol: 'wss',
          protocolVersion: 4,
          rejectUnauthorized: true,
        });
        this.client.on('connect', async () => {
          this.log.info(`MQTT connected for robot ${this.serialNumber}`);
          this.connected = true;
          this.reconnectAttempts = 0;
          // Subscribe to topics and wait for completion
          await this.subscribeToTopics();
          this.emit('connected');
          resolve();
        });
        this.client.on('message', (topic: string, payload: Buffer) => {
          this.handleMessage(topic, payload);
        });
        this.client.on('error', (error: Error) => {
          this.log.error('MQTT error:', error.message);
          this.emit('error', error);
          if (!this.connected) {
            reject(error);
          }
        });
        this.client.on('close', () => {
          this.log.debug('MQTT connection closed');
          this.connected = false;
          this.emit('disconnected');
        });
        this.client.on('offline', () => {
          this.log.debug('MQTT client offline');
          this.connected = false;
        });
        this.client.on('reconnect', () => {
          this.reconnectAttempts++;
          this.log.debug(
            `MQTT reconnecting (attempt ${this.reconnectAttempts})`,
          );
          if (this.reconnectAttempts > this.maxReconnectAttempts) {
            this.log.error('Max reconnection attempts reached');
            this.disconnect();
          }
        });
      } catch (error) {
        this.log.error('Failed to create MQTT connection:', error);
        reject(error);
      }
    });
  }
  /**
   * Generate AWS Signature V4 signed WebSocket URL
   * Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
   */
  getSignedWebSocketUrl() {
    const host = this.iotEndpoint;
    const service = 'iotdevicegateway';
    const method = 'GET';
    const path = '/mqtt';
    const algorithm = 'AWS4-HMAC-SHA256';
    const now = new Date();
    const amzDate = this.getAmzDate(now);
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;
    // Build canonical query string (sorted alphabetically, URL-encoded)
    // IMPORTANT: Security token is NOT included in signature calculation
    const queryParamsForSigning = [
      ['X-Amz-Algorithm', algorithm],
      [
        'X-Amz-Credential',
        `${this.credentials.accessKeyId}/${credentialScope}`,
      ],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', '86400'],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    // Sort and encode for canonical query string
    queryParamsForSigning.sort((a, b) => a[0].localeCompare(b[0]));
    const canonicalQuerystring = queryParamsForSigning
      .map(([k, v]) => `${this.uriEncode(k)}=${this.uriEncode(v)}`)
      .join('&');
    const canonicalHeaders = `host:${host}\n`;
    const signedHeaders = 'host';
    const payloadHash = createHash('sha256').update('').digest('hex');
    const canonicalRequest = [
      method,
      path,
      canonicalQuerystring,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    this.log.debug('Canonical request:', canonicalRequest);
    // Create string to sign
    const hashedCanonicalRequest = createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');
    // Calculate signature
    const kDate = createHmac(
      'sha256',
      `AWS4${this.credentials.secretAccessKey}`,
    )
      .update(dateStamp)
      .digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService)
      .update('aws4_request')
      .digest();
    const signature = createHmac('sha256', kSigning)
      .update(stringToSign)
      .digest('hex');
    // Build final URL with signature and security token
    let finalUrl = `wss://${host}${path}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;
    // Add security token AFTER signature (it's not part of the signed content)
    if (this.credentials.sessionToken) {
      finalUrl += `&X-Amz-Security-Token=${this.uriEncode(this.credentials.sessionToken)}`;
    }
    this.log.debug('Signed WebSocket URL generated');
    return finalUrl;
  }
  /**
   * Format date for AWS SigV4
   */
  getAmzDate(date: Date): string {
    return (
      date
        .toISOString()
        .replace(/[:-]|\.\d{3}/g, '')
        .substring(0, 15) + 'Z'
    );
  }
  /**
   * URI encode per AWS SigV4 spec (RFC 3986)
   */
  uriEncode(str: string): string {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  }
  /**
   * Subscribe to relevant MQTT topics
   * Returns a promise that resolves when all subscriptions are complete
   */
  async subscribeToTopics() {
    if (!this.client) {
      return;
    }
    // The serial number for topics is truncated to 8 chars (based on IAM policy)
    // E3086OFG2M -> E3086OFG (matches federated user pattern)
    const truncatedSerial = this.serialNumber.substring(0, 8);
    const topics = [
      // Shadow topics - use truncated serial as Thing name
      `$aws/things/${truncatedSerial}/shadow/update/accepted`,
      `$aws/things/${truncatedSerial}/shadow/update/rejected`,
      `$aws/things/${truncatedSerial}/shadow/get/accepted`,
      `$aws/things/${truncatedSerial}/shadow/get/rejected`,
      // Dynamic channel from Maytronics
      `Maytronics/${truncatedSerial}/main`,
    ];
    this.log.debug(
      `Subscribing to ${topics.length} topics for serial: ${truncatedSerial} (full: ${this.serialNumber})`,
    );
    // Subscribe to all topics
    const subscribePromises = topics.map((topic) => {
      return new Promise<void>((resolve) => {
        this.client!.subscribe(topic, { qos: 1 }, (err: Error | null) => {
          if (err) {
            this.log.warn(`Failed to subscribe to ${topic}:`, err.message);
          } else {
            this.log.debug(`Subscribed to ${topic}`);
          }
          resolve(); // Resolve even on error to not block
        });
      });
    });
    await Promise.all(subscribePromises);
    this.log.debug('Topic subscription complete');
  }
  /**
   * Handle incoming MQTT messages
   */
  handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString());
      this.log.debug(
        `MQTT message on ${topic}:`,
        JSON.stringify(message).substring(0, 200),
      );
      if (
        topic.includes('/shadow/get/accepted') ||
        topic.includes('/shadow/update/accepted')
      ) {
        this.currentShadow = message;
        this.emit('shadowUpdate', this.currentShadow);
      } else if (
        topic.includes('/shadow/get/rejected') ||
        topic.includes('/shadow/update/rejected')
      ) {
        this.log.warn('Shadow operation rejected:', message);
        this.emit('shadowRejected', message);
      } else if (topic.includes('Maytronics/') && topic.includes('/main')) {
        this.emit('dynamicMessage', message);
      }
    } catch (error) {
      this.log.debug('Failed to parse MQTT message:', error);
    }
  }
  /**
   * Request current shadow state
   */
  async getShadow() {
    if (!this.connected || !this.client) {
      throw new Error('MQTT client not connected');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.removeAllListeners('shadowUpdate');
          this.removeAllListeners('shadowRejected');
          reject(new Error('Shadow request timeout'));
        }
      }, 10000);
      this.once('shadowUpdate', (shadow) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowRejected');
          resolve(shadow);
        }
      });
      this.once('shadowRejected', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowUpdate');
          reject(
            new Error(`Shadow request rejected: ${JSON.stringify(error)}`),
          );
        }
      });
      // Request shadow - use truncated serial (8 chars) as Thing name
      const truncatedSerial = this.serialNumber.substring(0, 8);
      const topic = `$aws/things/${truncatedSerial}/shadow/get`;
      this.client!.publish(topic, '', { qos: 1 });
      this.log.debug(`Requested shadow on ${topic}`);
    });
  }
  /**
   * Update shadow with desired state
   */
  async updateShadow(desired: Record<string, unknown>): Promise<boolean> {
    if (!this.connected || !this.client) {
      throw new Error('MQTT client not connected');
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.removeAllListeners('shadowUpdate');
          this.removeAllListeners('shadowRejected');
          this.log.error('Shadow update timeout');
          resolve(false);
        }
      }, 10000);
      this.once('shadowUpdate', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowRejected');
          resolve(true);
        }
      });
      this.once('shadowRejected', (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowUpdate');
          this.log.error('Shadow update rejected:', error);
          resolve(false);
        }
      });
      const payload = JSON.stringify({
        state: { desired },
      });
      // Use truncated serial (8 chars) as Thing name
      const truncatedSerial = this.serialNumber.substring(0, 8);
      const topic = `$aws/things/${truncatedSerial}/shadow/update`;
      this.client!.publish(topic, payload, { qos: 1 });
      this.log.debug(
        `Published shadow update on ${topic}:`,
        payload.substring(0, 200),
      );
    });
  }
  /**
   * Send command via dynamic channel (Maytronics/{serial}/main)
   */
  async sendDynamicCommand(command: Record<string, unknown>): Promise<boolean> {
    if (!this.connected || !this.client) {
      throw new Error('MQTT client not connected');
    }
    const payload = JSON.stringify(command);
    // Use truncated serial (8 chars)
    const truncatedSerial = this.serialNumber.substring(0, 8);
    const topic = `Maytronics/${truncatedSerial}/main`;
    return new Promise<boolean>((resolve) => {
      this.client!.publish(topic, payload, { qos: 1 }, (err?: Error) => {
        if (err) {
          this.log.error('Failed to send dynamic command:', err.message);
          resolve(false);
        } else {
          this.log.debug(`Sent dynamic command on ${topic}:`, payload);
          resolve(true);
        }
      });
    });
  }
  /**
   * Build a BLE-style command message
   * Format: preamble(ab) + src(03) + destination + opcode + data_length + data + checksum
   */
  buildCommand(commandName: string, data?: string): string | undefined {
    const cmdDef = bleCommandsIot.commands[commandName];
    if (!cmdDef) {
      this.log.warn(`Unknown command: ${commandName}`);
      return undefined;
    }
    const pattern = bleCommandsIot.message_pattern;
    let message = '';
    // Preamble
    message += pattern.sop_preamble.constant;
    // Source
    message += pattern.src.constant;
    // Destination (2 bytes)
    message += cmdDef.destination.toLowerCase();
    // Opcode
    message += cmdDef.opcode;
    // Data length (2 bytes, little endian)
    const dataLength = data ? Math.floor(data.length / 2) : 0;
    message += dataLength.toString(16).padStart(4, '0');
    // Data
    if (data) {
      message += data;
    }
    // Checksum (calculated over the entire message)
    message += this.calculateChecksum(message);
    return message;
  }
  /**
   * Calculate checksum for BLE command
   */
  calculateChecksum(message: string): string {
    // Simple XOR checksum over all bytes
    let checksum = 0;
    for (let i = 0; i < message.length; i += 2) {
      checksum ^= parseInt(message.substring(i, i + 2), 16);
    }
    return checksum.toString(16).padStart(2, '0');
  }
  /**
   * Update credentials (for refresh)
   */
  updateCredentials(credentials: AWSCredentials): void {
    this.credentials = credentials;
    // Reconnect with new credentials if connected
    if (this.connected) {
      this.disconnect();
      this.connect().catch((err) => {
        this.log.error(
          'Failed to reconnect with new credentials:',
          err.message,
        );
      });
    }
  }
  /**
   * Disconnect from MQTT broker
   */
  disconnect() {
    if (this.client) {
      this.client.end(true);
      this.client = undefined;
    }
    this.connected = false;
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.connected;
  }
  /**
   * Get current shadow
   */
  getCurrentShadow() {
    return this.currentShadow;
  }
}
//# sourceMappingURL=mqttClient.js.map
