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
import type { Logger } from 'homebridge';
import type { AWSIoTCredentials } from './auth/types.js';
import type { RawShadowState } from '../parsers/types.js';
import { buildCommand } from '../protocol/commandBuilder.js';
import {
  SERIAL_NUMBER_LENGTH,
  SHADOW_TIMEOUT_MS,
  MQTT_RECONNECT_PERIOD_MS,
  MQTT_CONNECT_TIMEOUT_MS,
  MQTT_KEEPALIVE_SECONDS,
  AWS_SIGNATURE_EXPIRY_SECONDS,
  DEBUG_LOG_PREVIEW_LENGTH,
} from '../config/constants.js';
import { MQTTError, ErrorCode } from '../utils/errors.js';

export interface MQTTClientConfig {
  serialNumber: string;
  region: string;
  iotEndpoint: string;
  credentials: AWSIoTCredentials;
}

/**
 * MQTT Client for AWS IoT Core communication
 */
export class MQTTClient extends EventEmitter {
  private readonly log: Logger;
  private client: mqtt.MqttClient | undefined;
  private readonly serialNumber: string;
  private readonly truncatedSerial: string;
  private readonly region: string;
  private readonly iotEndpoint: string;
  private credentials: AWSIoTCredentials;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private currentShadow: RawShadowState | null = null;

  constructor(config: MQTTClientConfig, log: Logger) {
    super();
    this.log = log;
    this.serialNumber = config.serialNumber;
    this.truncatedSerial = config.serialNumber.substring(0, SERIAL_NUMBER_LENGTH);
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
        this.log.debug(`Connecting to AWS IoT MQTT: wss://${this.iotEndpoint}/mqtt`);

        // Use a client ID format that matches what the IAM policy expects
        const clientId = `${this.truncatedSerial}_App_Token`;
        this.log.debug(`MQTT client ID: ${clientId} (truncated from ${this.serialNumber})`);

        this.client = mqtt.connect(signedUrl, {
          clientId,
          clean: true,
          reconnectPeriod: MQTT_RECONNECT_PERIOD_MS,
          connectTimeout: MQTT_CONNECT_TIMEOUT_MS,
          keepalive: MQTT_KEEPALIVE_SECONDS,
          protocol: 'wss',
          protocolVersion: 4,
          rejectUnauthorized: true,
        });

        this.client.on('connect', async () => {
          this.connected = true;
          this.reconnectAttempts = 0;
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
            reject(new MQTTError(ErrorCode.MQTT_CONNECTION_FAILED, error.message, { cause: error }));
          }
        });

        this.client.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
        });

        this.client.on('offline', () => {
          this.connected = false;
        });

        this.client.on('reconnect', () => {
          this.reconnectAttempts++;
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
   */
  private getSignedWebSocketUrl(): string {
    const host = this.iotEndpoint;
    const service = 'iotdevicegateway';
    const method = 'GET';
    const path = '/mqtt';
    const algorithm = 'AWS4-HMAC-SHA256';

    const now = new Date();
    const amzDate = this.formatAmzDate(now);
    const dateStamp = amzDate.substring(0, 8);
    const credentialScope = `${dateStamp}/${this.region}/${service}/aws4_request`;

    // Build canonical query string (sorted alphabetically, URL-encoded)
    const queryParamsForSigning = [
      ['X-Amz-Algorithm', algorithm],
      ['X-Amz-Credential', `${this.credentials.accessKeyId}/${credentialScope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', AWS_SIGNATURE_EXPIRY_SECONDS],
      ['X-Amz-SignedHeaders', 'host'],
    ];

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

    const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [algorithm, amzDate, credentialScope, hashedCanonicalRequest].join('\n');

    // Calculate signature
    const kDate = createHmac('sha256', `AWS4${this.credentials.secretAccessKey}`)
      .update(dateStamp)
      .digest();
    const kRegion = createHmac('sha256', kDate).update(this.region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    // Build final URL with signature and security token
    let finalUrl = `wss://${host}${path}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;

    if (this.credentials.sessionToken) {
      finalUrl += `&X-Amz-Security-Token=${this.uriEncode(this.credentials.sessionToken)}`;
    }

    this.log.debug('Signed WebSocket URL generated');
    return finalUrl;
  }

  /**
   * Format date for AWS SigV4
   */
  private formatAmzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '').substring(0, 15) + 'Z';
  }

  /**
   * URI encode per AWS SigV4 spec (RFC 3986)
   */
  private uriEncode(str: string): string {
    return encodeURIComponent(str).replace(
      /[!'()*]/g,
      (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
    );
  }

  /**
   * Subscribe to relevant MQTT topics
   */
  private async subscribeToTopics(): Promise<void> {
    if (!this.client) {
      return;
    }

    const topics = [
      `$aws/things/${this.truncatedSerial}/shadow/update/accepted`,
      `$aws/things/${this.truncatedSerial}/shadow/update/rejected`,
      `$aws/things/${this.truncatedSerial}/shadow/get/accepted`,
      `$aws/things/${this.truncatedSerial}/shadow/get/rejected`,
      `Maytronics/${this.truncatedSerial}/main`,
    ];

    const subscribePromises = topics.map((topic) => {
      return new Promise<void>((resolve) => {
        this.client!.subscribe(topic, { qos: 1 }, (err: Error | null) => {
          if (err) {
            this.log.warn(`Failed to subscribe to ${topic}:`, err.message);
          }
          resolve();
        });
      });
    });

    await Promise.all(subscribePromises);
  }

  /**
   * Handle incoming MQTT messages
   */
  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString());
      this.log.debug(`MQTT message on ${topic}:`, JSON.stringify(message).substring(0, DEBUG_LOG_PREVIEW_LENGTH));

      if (topic.includes('/shadow/get/accepted') || topic.includes('/shadow/update/accepted')) {
        this.currentShadow = message as RawShadowState;
        this.emit('shadowUpdate', this.currentShadow);
      } else if (topic.includes('/shadow/get/rejected') || topic.includes('/shadow/update/rejected')) {
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
   * Ensure client is connected, throw if not
   */
  private ensureConnected(): void {
    if (!this.connected || !this.client) {
      throw new MQTTError(ErrorCode.MQTT_NOT_CONNECTED, 'MQTT client not connected');
    }
  }

  /**
   * Request current shadow state
   */
  async getShadow(): Promise<RawShadowState> {
    this.ensureConnected();

    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.removeAllListeners('shadowUpdate');
          this.removeAllListeners('shadowRejected');
          reject(new MQTTError(ErrorCode.MQTT_SHADOW_TIMEOUT, 'Shadow request timeout'));
        }
      }, SHADOW_TIMEOUT_MS);

      this.once('shadowUpdate', (shadow: RawShadowState) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowRejected');
          resolve(shadow);
        }
      });

      this.once('shadowRejected', (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowUpdate');
          reject(new MQTTError(
            ErrorCode.MQTT_SHADOW_REJECTED,
            `Shadow request rejected: ${JSON.stringify(error)}`,
          ));
        }
      });

      const topic = `$aws/things/${this.truncatedSerial}/shadow/get`;
      this.client!.publish(topic, '', { qos: 1 });
      this.log.debug(`Requested shadow on ${topic}`);
    });
  }

  /**
   * Update shadow with desired state
   */
  async updateShadow(desired: Record<string, unknown>): Promise<boolean> {
    this.ensureConnected();

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
      }, SHADOW_TIMEOUT_MS);

      this.once('shadowUpdate', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowRejected');
          resolve(true);
        }
      });

      this.once('shadowRejected', (error: unknown) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.removeAllListeners('shadowUpdate');
          this.log.error('Shadow update rejected:', error);
          resolve(false);
        }
      });

      const payload = JSON.stringify({ state: { desired } });
      const topic = `$aws/things/${this.truncatedSerial}/shadow/update`;
      this.client!.publish(topic, payload, { qos: 1 });
      this.log.debug(`Published shadow update on ${topic}:`, payload.substring(0, DEBUG_LOG_PREVIEW_LENGTH));
    });
  }

  /**
   * Send command via dynamic channel (Maytronics/{serial}/main)
   */
  async sendDynamicCommand(command: Record<string, unknown>): Promise<boolean> {
    this.ensureConnected();

    const payload = JSON.stringify(command);
    const topic = `Maytronics/${this.truncatedSerial}/main`;

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
   * Send a named command via the dynamic channel using the BLE protocol format
   */
  async sendCommand(commandName: string, data?: string): Promise<boolean> {
    this.ensureConnected();

    const builtCommand = buildCommand(commandName, data);
    if (!builtCommand) {
      this.log.error(`Failed to build command: ${commandName}`);
      return false;
    }

    const topic = `Maytronics/${this.truncatedSerial}/main`;
    this.log.info(`Sending command ${commandName} to ${topic} (${builtCommand.buffer.length} bytes)`);
    this.log.debug(`Command hex: ${builtCommand.hex}`);

    return new Promise<boolean>((resolve) => {
      this.client!.publish(topic, builtCommand.buffer, { qos: 1 }, (err?: Error) => {
        if (err) {
          this.log.error(`Failed to send command ${commandName}:`, err.message);
          resolve(false);
        } else {
          this.log.info(`Command ${commandName} sent successfully`);
          resolve(true);
        }
      });
    });
  }

  /**
   * Update credentials (for refresh)
   */
  updateCredentials(credentials: AWSIoTCredentials): void {
    this.credentials = credentials;
    if (this.connected) {
      this.disconnect();
      this.connect().catch((err) => {
        this.log.error('Failed to reconnect with new credentials:', err.message);
      });
    }
  }

  /**
   * Disconnect from MQTT broker
   */
  disconnect(): void {
    if (this.client) {
      this.client.end(true);
      this.client = undefined;
    }
    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get current shadow
   */
  getCurrentShadow(): RawShadowState | null {
    return this.currentShadow;
  }
}
