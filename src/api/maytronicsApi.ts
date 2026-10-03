/**
 * Maytronics MyDolphin Plus API Client
 *
 * High-level API for robot control and state management.
 * Authentication is handled by AuthenticationManager.
 */
import { EventEmitter } from 'events';
import type { Logger } from 'homebridge';
import { MQTTClient } from './mqttClient.js';
import { AuthenticationManager } from './auth/authenticationManager.js';
import type { AuthConfig, LoginResult as AuthLoginResult } from './auth/types.js';
import type { RawShadowState } from '../parsers/types.js';
import { ApiError, ErrorCode, PluginError, getErrorMessage } from '../utils/errors.js';

/**
 * Shadow failures that resolve on their own and do not warrant an error log
 */
const TRANSIENT_SHADOW_ERRORS: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.MQTT_SHADOW_RATE_LIMITED,
  ErrorCode.MQTT_NOT_CONNECTED,
]);

/**
 * Robot information from API
 */
export interface RobotInfo {
  serialNumber: string;
  name: string;
  model: string;
  deviceType: number;
  warrantyDays?: number;
  features: string[];
}

/**
 * Login result exposed to callers (connection details stay internal)
 */
export type LoginResult = Omit<AuthLoginResult, 'awsCredentials' | 'iotEndpoint'>;

interface RobotDetailsData {
  SERNUM?: string;
  MyRobotName?: string;
  PARTDES?: string;
  warranty_days?: number;
}

interface RobotFeaturesData {
  features?: { description: string }[];
}

/**
 * Maytronics API Client
 *
 * Provides high-level methods for robot control and state management.
 * Emits `shadowUpdate` whenever a shadow document arrives over MQTT, so callers
 * can react to pushed state instead of polling for it.
 */
export class MaytronicsAPI extends EventEmitter {
  private readonly log: Logger;
  private readonly authManager: AuthenticationManager;
  private mqttClient: MQTTClient | undefined;
  private pendingMqttConnect?: Promise<void>;
  private hasLoggedMqttConnection = false;

  constructor(
    email: string | undefined,
    password: string | undefined,
    log: Logger,
    iotRegion: string | undefined,
    refreshToken: string | undefined,
  ) {
    super();
    this.log = log;

    const authConfig: AuthConfig = {
      email,
      password,
      refreshToken,
      iotRegion,
    };

    this.authManager = new AuthenticationManager(authConfig, log);
  }

  /**
   * Complete authentication flow
   */
  async login(): Promise<LoginResult> {
    const { cognitoToken, mobToken, serialNumber, robotName, deviceType } = await this.authManager.login();

    // Initialize MQTT client after authentication
    await this.connectMQTT();

    return { cognitoToken, mobToken, serialNumber, robotName, deviceType };
  }

  /**
   * Open the MQTT connection. Concurrent callers share one attempt, so two
   * clients never connect with the same client ID (AWS IoT would drop one).
   */
  private connectMQTT(): Promise<void> {
    this.pendingMqttConnect ??= this.initializeMQTTClient().finally(() => {
      this.pendingMqttConnect = undefined;
    });
    return this.pendingMqttConnect;
  }

  /**
   * Initialize MQTT client and connect to AWS IoT Core
   */
  private async initializeMQTTClient(): Promise<void> {
    const credentialManager = this.authManager.getCredentialManager();
    const serialNumber = credentialManager.getSerialNumber();
    if (!serialNumber) {
      throw new ApiError(ErrorCode.API_REQUEST_FAILED, 'Serial number not available');
    }

    // Disconnect existing client if any
    if (this.mqttClient) {
      this.mqttClient.disconnect();
    }

    this.mqttClient = new MQTTClient(
      {
        serialNumber,
        region: this.authManager.getIoTRegion(),
        iotEndpoint: this.authManager.getIoTEndpoint(),
        getCredentials: () => credentialManager.getAWSCredentials(),
      },
      this.log,
    );

    // Set up event handlers. Re-emitting keeps listeners attached across
    // reconnects, which recreate the underlying MQTT client.
    this.mqttClient.on('shadowUpdate', (shadow: RawShadowState) => {
      this.log.debug('Shadow update received:', JSON.stringify(shadow).substring(0, 200));
      this.emit('shadowUpdate', shadow);
    });

    // MQTTClient already logs errors; the listener keeps EventEmitter from throwing
    this.mqttClient.on('error', () => undefined);

    // Connect to MQTT
    await this.mqttClient.connect();

    // Only log connection message once
    if (!this.hasLoggedMqttConnection) {
      this.hasLoggedMqttConnection = true;
      this.log.info(`MQTT connected for robot ${serialNumber}`);
    }
  }

  /**
   * Ensure MQTT client is connected
   */
  private async ensureConnectedMQTT(): Promise<void> {
    await this.authManager.ensureValidCredentials();

    if (!this.mqttClient || !this.mqttClient.isConnected()) {
      this.log.debug('MQTT client not connected, reconnecting...');
      await this.connectMQTT();
    }
  }

  /**
   * Close the MQTT connection (Homebridge shutdown)
   */
  disconnect(): void {
    this.mqttClient?.disconnect();
    this.mqttClient = undefined;
  }

  /**
   * Get robot Thing Shadow state from AWS IoT via MQTT
   */
  async getThingShadow(serialNumber: string): Promise<RawShadowState | undefined> {
    try {
      await this.ensureConnectedMQTT();

      this.log.debug(`Getting Thing Shadow for: ${serialNumber} via MQTT`);
      const shadow = await this.mqttClient!.getShadow();

      this.log.debug('Thing Shadow received:', JSON.stringify(shadow).substring(0, 200) + '...');
      return shadow;
    } catch (error) {
      // Throttling and reconnects are transient: the MQTT client already reports
      // sustained throttling, and the next poll picks the state back up
      if (error instanceof PluginError && TRANSIENT_SHADOW_ERRORS.has(error.code)) {
        this.log.debug('Thing Shadow request could not complete, keeping last known state:', getErrorMessage(error));
      } else {
        this.log.error('Failed to get Thing Shadow:', getErrorMessage(error));
      }
      return undefined;
    }
  }

  /**
   * Timestamp of the last shadow document received over MQTT (0 if none yet)
   */
  getLastShadowReceivedAt(): number {
    return this.mqttClient?.getLastShadowReceivedAt() ?? 0;
  }

  /**
   * Send a shadow command with standard error handling
   */
  private async sendShadowCommand(
    desired: Record<string, unknown>,
    description: string,
  ): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      const success = await this.mqttClient!.updateShadow(desired);
      if (success) {
        this.log.debug(description);
      }
      return success;
    } catch (error) {
      this.log.error(`Failed: ${description}:`, getErrorMessage(error));
      return false;
    }
  }

  /**
   * Send command to start the robot via shadow update
   */
  async startRobot(serialNumber: string): Promise<boolean> {
    return this.sendShadowCommand(
      { systemState: { pwsState: 'on' } },
      `Start command sent for ${serialNumber}`,
    );
  }

  /**
   * Send command to stop the robot via shadow update
   */
  async stopRobot(serialNumber: string): Promise<boolean> {
    return this.sendShadowCommand(
      { systemState: { pwsState: 'off' } },
      `Stop command sent for ${serialNumber}`,
    );
  }

  /**
   * Send command to set cleaning mode via shadow update
   */
  async setCleaningMode(serialNumber: string, mode: string): Promise<boolean> {
    return this.sendShadowCommand(
      { cleaningMode: { mode } },
      `Set cleaning mode to ${mode} for ${serialNumber}`,
    );
  }

  /**
   * Get robot information from REST API
   */
  async getRobotInfo(serialNumber: string): Promise<RobotInfo | undefined> {
    try {
      await this.authManager.ensureValidCredentials();

      const httpClient = this.authManager.getHttpClient();
      const credentials = this.authManager.getCredentialManager();
      const cognitoToken = credentials.getCognitoToken();

      const response = await httpClient.post<RobotDetailsData>(
        '/mobapi/serial-numbers/getRobotDetailsByRobotSN/',
        { SERNUM: serialNumber },
        { bearerToken: cognitoToken },
      );

      const data = response.Data;
      if (response.Status !== '1' || !data) {
        return undefined;
      }

      // Get device features
      let features: string[] = [];
      try {
        const featuresResponse = await httpClient.get<RobotFeaturesData>(
          '/mobapi/serial-numbers/getSernFeatures/',
          {
            params: {
              device_type: credentials.getDeviceType()?.toString() || '62',
              Sernum: serialNumber,
            },
            bearerToken: cognitoToken,
          },
        );

        if (featuresResponse.Status === '1' && featuresResponse.Data?.features) {
          features = featuresResponse.Data.features.map((f) => f.description);
        }
      } catch {
        // Features endpoint is optional
        this.log.debug('Could not fetch robot features');
      }

      return {
        serialNumber: data.SERNUM || serialNumber,
        name: data.MyRobotName || credentials.getRobotName() || 'Dolphin Robot',
        model: data.PARTDES || 'Unknown Model',
        deviceType: credentials.getDeviceType() || 62,
        warrantyDays: data.warranty_days,
        features,
      };
    } catch (error) {
      this.log.error('Failed to get robot info:', getErrorMessage(error));
      return undefined;
    }
  }

  /**
   * Get user's robots (from authentication)
   */
  async getRobots(): Promise<RobotInfo[]> {
    const serialNumber = this.authManager.getCredentialManager().getSerialNumber();
    if (!serialNumber) {
      return [];
    }

    // A failed details lookup must not hide the robot: an empty list would make
    // the platform unregister its accessory and wipe the user's HomeKit setup
    const credentials = this.authManager.getCredentialManager();
    const robotInfo = await this.getRobotInfo(serialNumber);
    return [robotInfo ?? {
      serialNumber,
      name: credentials.getRobotName() || 'Dolphin Robot',
      model: 'Unknown Model',
      deviceType: credentials.getDeviceType() || 62,
      features: [],
    }];
  }
}
