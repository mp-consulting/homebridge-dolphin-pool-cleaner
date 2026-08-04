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
  SHADOW_RATE_LIMIT_CODE,
  SHADOW_MIN_REQUEST_INTERVAL_MS,
  SHADOW_RETRY_MAX_ATTEMPTS,
  SHADOW_RETRY_BASE_DELAY_MS,
  SHADOW_RETRY_MAX_DELAY_MS,
  SHADOW_RETRY_JITTER_MS,
  SHADOW_THROTTLE_LOG_INTERVAL_MS,
  SHADOW_COMMAND_RETRY_MAX_ATTEMPTS,
  SHADOW_COMMAND_RETRY_BASE_DELAY_MS,
} from '../config/constants.js';
import { MQTTError, ErrorCode } from '../utils/errors.js';
import { unrefTimer } from '../utils/timers.js';

export interface MQTTClientConfig {
  serialNumber: string;
  region: string;
  iotEndpoint: string;
  credentials: AWSIoTCredentials;
}

/**
 * Error payload published by AWS IoT on the shadow `rejected` topics
 */
interface ShadowRejection {
  code?: number;
  message?: string;
}

/**
 * Outcome of a single shadow request
 */
type ShadowResponse =
  | { accepted: true; shadow: RawShadowState }
  | { accepted: false; error: ShadowRejection };

/**
 * A shadow request awaiting its response
 */
interface PendingShadowRequest {
  resolve: (response: ShadowResponse) => void;
  reject: (error: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  // A `get` only asks for the current document, so an untagged shadow push
  // answers it just as well; an update must see its own response
  acceptsUntaggedResponse: boolean;
}

/**
 * How hard to retry a throttled shadow operation
 */
interface ShadowRetryPolicy {
  attempts: number;
  baseDelayMs: number;
}

const POLL_RETRY_POLICY: ShadowRetryPolicy = {
  attempts: SHADOW_RETRY_MAX_ATTEMPTS,
  baseDelayMs: SHADOW_RETRY_BASE_DELAY_MS,
};

const COMMAND_RETRY_POLICY: ShadowRetryPolicy = {
  attempts: SHADOW_COMMAND_RETRY_MAX_ATTEMPTS,
  baseDelayMs: SHADOW_COMMAND_RETRY_BASE_DELAY_MS,
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    unrefTimer(setTimeout(resolve, ms));
  });

/**
 * Whether a shadow rejection is an AWS IoT throttling response
 */
function isRateLimited(rejection: ShadowRejection | undefined): boolean {
  return rejection?.code === SHADOW_RATE_LIMIT_CODE || rejection?.message === 'TOO_MANY_REQUESTS';
}

/**
 * Exponential backoff with jitter, so retries from several clients spread out
 */
function backoffDelay(attempt: number, policy: ShadowRetryPolicy): number {
  const base = Math.min(policy.baseDelayMs * 2 ** (attempt - 1), SHADOW_RETRY_MAX_DELAY_MS);
  return base + Math.floor(Math.random() * SHADOW_RETRY_JITTER_MS);
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
  private lastShadowReceivedAt = 0;
  // Shadow request pacing / throttle bookkeeping
  private readonly pendingRequests = new Map<string, PendingShadowRequest>();
  private requestCounter = 0;
  private requestGate: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  private pendingGet: Promise<RawShadowState> | undefined;
  private throttledRequests = 0;
  private lastThrottleLogAt = 0;

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

    this.log.debug('Canonical request constructed for SigV4 signing');

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

      // AWS IoT echoes the clientToken we sent, which lets concurrent shadow
      // operations tell their own response apart from someone else's
      const clientToken = typeof message?.clientToken === 'string' ? message.clientToken : undefined;

      if (topic.includes('/shadow/get/accepted') || topic.includes('/shadow/update/accepted')) {
        this.currentShadow = message as RawShadowState;
        this.lastShadowReceivedAt = Date.now();
        this.emit('shadowUpdate', this.currentShadow);
        this.settlePendingRequest(clientToken, { accepted: true, shadow: this.currentShadow });
      } else if (topic.includes('/shadow/get/rejected') || topic.includes('/shadow/update/rejected')) {
        this.logShadowRejection(message as ShadowRejection);
        this.emit('shadowRejected', message);
        this.settlePendingRequest(clientToken, { accepted: false, error: message as ShadowRejection });
      } else if (topic.includes('Maytronics/') && topic.includes('/main')) {
        this.emit('dynamicMessage', message);
      }
    } catch (error) {
      this.log.debug('Failed to parse MQTT message:', error);
    }
  }

  /**
   * Log a shadow rejection. Throttling (429) is expected on the shared MyDolphin
   * AWS account and is retried transparently, so it is only counted here and
   * surfaced by reportThrottling() once retries are exhausted.
   */
  private logShadowRejection(rejection: ShadowRejection): void {
    if (isRateLimited(rejection)) {
      this.throttledRequests++;
      this.log.debug('Shadow operation throttled by AWS IoT (429 TOO_MANY_REQUESTS), will retry');
      return;
    }
    this.log.warn('Shadow operation rejected:', rejection);
  }

  /**
   * Surface persistent throttling at most once per SHADOW_THROTTLE_LOG_INTERVAL_MS
   */
  private reportThrottling(operation: string, attempts: number): void {
    const now = Date.now();
    if (now - this.lastThrottleLogAt < SHADOW_THROTTLE_LOG_INTERVAL_MS) {
      this.log.debug(`${operation} gave up after ${attempts} throttled attempts`);
      return;
    }
    this.log.warn(
      `${operation} throttled by AWS IoT after ${attempts} attempts ` +
        `(${this.throttledRequests} throttled request(s) so far). ` +
        'This is a temporary MyDolphin cloud limit; state will refresh on the next poll.',
    );
    this.lastThrottleLogAt = now;
    this.throttledRequests = 0;
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
   * Wait for the response to a single shadow request, correlated by clientToken.
   * Resolves with the accepted shadow or the rejection payload; rejects on timeout.
   */
  private waitForShadowResponse(
    publish: (clientToken: string) => void,
    acceptsUntaggedResponse: boolean,
  ): Promise<ShadowResponse> {
    const clientToken = this.nextClientToken();

    return new Promise<ShadowResponse>((resolve, reject) => {
      const timeout = unrefTimer(setTimeout(() => {
        this.pendingRequests.delete(clientToken);
        reject(new MQTTError(ErrorCode.MQTT_SHADOW_TIMEOUT, 'Shadow operation timeout'));
      }, SHADOW_TIMEOUT_MS));

      this.pendingRequests.set(clientToken, { resolve, reject, timeout, acceptsUntaggedResponse });
      publish(clientToken);
    });
  }

  /**
   * Hand a shadow response to the request that asked for it.
   *
   * AWS IoT echoes our clientToken, so a matching token settles that request and
   * a foreign one (the phone app talking to the same robot) settles nothing.
   * `update/accepted` is also broadcast without a token when the robot reports
   * its own state: that document answers a pending `get`, but must never be read
   * as acceptance of our update, and an untagged rejection is attributed to nobody.
   */
  private settlePendingRequest(clientToken: string | undefined, response: ShadowResponse): void {
    const key = clientToken ?? this.findUntaggedRecipient(response);
    const pending = key === undefined ? undefined : this.pendingRequests.get(key);
    if (key === undefined || !pending) {
      return;
    }

    this.pendingRequests.delete(key);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  /**
   * Token of the request an untagged response may settle, if any
   */
  private findUntaggedRecipient(response: ShadowResponse): string | undefined {
    if (!response.accepted) {
      return undefined;
    }

    for (const [clientToken, pending] of this.pendingRequests) {
      if (pending.acceptsUntaggedResponse) {
        return clientToken;
      }
    }
    return undefined;
  }

  /**
   * Unique token used to match a shadow response to its request
   */
  private nextClientToken(): string {
    this.requestCounter = (this.requestCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `${this.truncatedSerial}-${this.requestCounter}`;
  }

  /**
   * Serialize shadow publishes and keep a minimum gap between them so bursts
   * (e.g. set mode + start + refresh) do not trip the AWS IoT throttle
   */
  private awaitRequestSlot(): Promise<void> {
    const slot = this.requestGate.then(async () => {
      const wait = this.lastRequestAt + SHADOW_MIN_REQUEST_INTERVAL_MS - Date.now();
      if (wait > 0) {
        await delay(wait);
      }
      this.lastRequestAt = Date.now();
    });
    this.requestGate = slot.catch(() => undefined);
    return slot;
  }

  /**
   * Publish a shadow request, retrying with exponential backoff while AWS IoT
   * answers with 429 TOO_MANY_REQUESTS
   */
  private async requestShadow(
    operation: string,
    policy: ShadowRetryPolicy,
    acceptsUntaggedResponse: boolean,
    publish: (clientToken: string) => void,
  ): Promise<ShadowResponse> {
    let lastError: ShadowRejection = { code: SHADOW_RATE_LIMIT_CODE, message: 'TOO_MANY_REQUESTS' };

    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      await this.awaitRequestSlot();
      this.ensureConnected();

      const response = await this.waitForShadowResponse(publish, acceptsUntaggedResponse);
      if (response.accepted || !isRateLimited(response.error)) {
        return response;
      }

      lastError = response.error;
      if (attempt < policy.attempts) {
        const backoff = backoffDelay(attempt, policy);
        this.log.debug(
          `${operation} throttled, retrying in ${backoff}ms (attempt ${attempt}/${policy.attempts})`,
        );
        await delay(backoff);
      }
    }

    this.reportThrottling(operation, policy.attempts);
    return { accepted: false, error: lastError };
  }

  /**
   * Request current shadow state.
   * Concurrent callers share a single in-flight request.
   */
  async getShadow(): Promise<RawShadowState> {
    this.ensureConnected();

    if (this.pendingGet) {
      this.log.debug('Reusing in-flight shadow request');
      return this.pendingGet;
    }

    const topic = `$aws/things/${this.truncatedSerial}/shadow/get`;
    this.pendingGet = this.requestShadow('Shadow request', POLL_RETRY_POLICY, true, (clientToken) => {
      this.client!.publish(topic, JSON.stringify({ clientToken }), { qos: 1 });
      this.log.debug(`Requested shadow on ${topic}`);
    })
      .then((response) => {
        if (response.accepted) {
          return response.shadow;
        }
        throw new MQTTError(
          isRateLimited(response.error) ? ErrorCode.MQTT_SHADOW_RATE_LIMITED : ErrorCode.MQTT_SHADOW_REJECTED,
          `Shadow request rejected: ${JSON.stringify(response.error)}`,
        );
      })
      .finally(() => {
        this.pendingGet = undefined;
      });

    return this.pendingGet;
  }

  /**
   * Update shadow with desired state.
   * Retries are kept short because HomeKit is waiting on the result.
   */
  async updateShadow(desired: Record<string, unknown>): Promise<boolean> {
    this.ensureConnected();

    const topic = `$aws/things/${this.truncatedSerial}/shadow/update`;
    const response = await this.requestShadow('Shadow update', COMMAND_RETRY_POLICY, false, (clientToken) => {
      const payload = JSON.stringify({ state: { desired }, clientToken });
      this.client!.publish(topic, payload, { qos: 1 });
      this.log.debug(`Published shadow update on ${topic}:`, payload.substring(0, DEBUG_LOG_PREVIEW_LENGTH));
    });

    if (!response.accepted && !isRateLimited(response.error)) {
      this.log.error('Shadow update rejected:', response.error);
    }

    return response.accepted;
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

    // In-flight requests can no longer be answered; fail them now instead of
    // waiting for their timeouts
    for (const [clientToken, pending] of this.pendingRequests) {
      this.pendingRequests.delete(clientToken);
      clearTimeout(pending.timeout);
      pending.reject(
        new MQTTError(ErrorCode.MQTT_NOT_CONNECTED, 'MQTT disconnected while waiting for a shadow response'),
      );
    }
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

  /**
   * Timestamp of the last shadow document received (0 if none yet)
   */
  getLastShadowReceivedAt(): number {
    return this.lastShadowReceivedAt;
  }
}
