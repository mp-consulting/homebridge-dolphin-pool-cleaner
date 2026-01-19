/**
 * Maytronics MyDolphin Plus API Client
 *
 * High-level API for robot control and state management.
 * Authentication is handled by AuthenticationManager.
 */
import type { Logger } from 'homebridge';
import { MQTTClient } from './mqttClient.js';
import { AuthenticationManager } from './auth/authenticationManager.js';
import type { AWSIoTCredentials, AuthConfig } from './auth/types.js';
import type { RawShadowState } from '../parsers/types.js';
import { ApiError, ErrorCode, getErrorMessage } from '../utils/errors.js';

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
 * Thing Shadow command structure
 */
export interface ThingShadowCommand {
  state: {
    desired: Record<string, unknown>;
  };
}

/**
 * Login result
 */
export interface LoginResult {
  cognitoToken: string;
  mobToken: string;
  serialNumber: string;
  robotName: string;
  deviceType: number;
}

// Re-export for backward compatibility
export type { AWSIoTCredentials as AWSCredentials };

/**
 * Maytronics API Client
 *
 * Provides high-level methods for robot control and state management.
 */
export class MaytronicsAPI {
  private readonly log: Logger;
  private readonly authManager: AuthenticationManager;
  private mqttClient: MQTTClient | undefined;
  private hasLoggedMqttConnection = false;

  constructor(
    email: string | undefined,
    password: string | undefined,
    log: Logger,
    iotRegion: string | undefined,
    refreshToken: string | undefined,
  ) {
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
    const result = await this.authManager.login();

    // Initialize MQTT client after authentication
    await this.initializeMQTTClient(result.awsCredentials, result.iotEndpoint);

    return {
      cognitoToken: result.cognitoToken,
      mobToken: result.mobToken,
      serialNumber: result.serialNumber,
      robotName: result.robotName,
      deviceType: result.deviceType,
    };
  }

  /**
   * Initialize MQTT client and connect to AWS IoT Core
   */
  private async initializeMQTTClient(
    credentials: AWSIoTCredentials,
    iotEndpoint: string,
  ): Promise<void> {
    const serialNumber = this.authManager.getCredentialManager().getSerialNumber();
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
        iotEndpoint,
        credentials,
      },
      this.log,
    );

    // Set up event handlers
    this.mqttClient.on('shadowUpdate', (shadow: RawShadowState) => {
      this.log.debug('Shadow update received:', JSON.stringify(shadow).substring(0, 200));
    });

    this.mqttClient.on('error', (error: Error) => {
      this.log.error('MQTT error:', error.message);
    });

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
      const credentials = this.authManager.getCredentialManager().getAWSCredentials();
      if (!credentials) {
        throw new ApiError(ErrorCode.AUTH_AWS_CREDENTIALS_FAILED, 'AWS credentials not available');
      }
      await this.initializeMQTTClient(credentials, this.authManager.getIoTEndpoint());
    }
  }

  /**
   * Check if credentials need refresh
   */
  needsRefresh(): boolean {
    return this.authManager.needsRefresh();
  }

  /**
   * Ensure credentials are valid (refresh if needed)
   */
  async ensureValidCredentials(): Promise<void> {
    await this.authManager.ensureValidCredentials();
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
      this.log.error('Failed to get Thing Shadow:', getErrorMessage(error));
      return undefined;
    }
  }

  /**
   * Update robot Thing Shadow state via MQTT
   */
  async updateThingShadow(serialNumber: string, command: ThingShadowCommand): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      const desired = command.state.desired;
      const success = await this.mqttClient!.updateShadow(desired);

      if (success) {
        this.log.debug(`Thing Shadow updated for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error('Failed to update Thing Shadow:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Send command to start the robot via shadow update
   */
  async startRobot(serialNumber: string, cleaningMode?: string): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      // If cleaning mode is specified, set it first
      if (cleaningMode) {
        await this.setCleaningMode(serialNumber, cleaningMode);
      }

      // Send start command via shadow update
      const success = await this.mqttClient!.updateShadow({
        systemState: { pwsState: 'on' },
      });

      if (success) {
        this.log.debug(`Start command sent for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error('Failed to send start command:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Send command to stop the robot via shadow update
   */
  async stopRobot(serialNumber: string): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      const success = await this.mqttClient!.updateShadow({
        systemState: { pwsState: 'off' },
      });

      if (success) {
        this.log.debug(`Stop command sent for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error('Failed to send stop command:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Send command to set cleaning mode via shadow update
   */
  async setCleaningMode(serialNumber: string, mode: string): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      const success = await this.mqttClient!.updateShadow({
        cleaningMode: { mode },
      });

      if (success) {
        this.log.debug(`Set cleaning mode to ${mode} for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error('Failed to set cleaning mode:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Send command to put robot in pickup mode via shadow update
   */
  async pickupRobot(serialNumber: string): Promise<boolean> {
    try {
      await this.ensureConnectedMQTT();

      const success = await this.mqttClient!.updateShadow({
        cleaningMode: { mode: 'pickup' },
      });

      if (success) {
        this.log.debug(`Pickup command sent for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error('Failed to send pickup command:', getErrorMessage(error));
      return false;
    }
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

      const response = await httpClient.post(
        '/mobapi/serial-numbers/getRobotDetailsByRobotSN/',
        `SERNUM=${serialNumber}`,
        {
          headers: { Authorization: `Bearer ${cognitoToken}` },
        },
      );

      if (response.data.Status !== '1') {
        return undefined;
      }

      const data = response.data.Data;

      // Get device features
      let features: string[] = [];
      try {
        const featuresResponse = await httpClient.get(
          '/mobapi/serial-numbers/getSernFeatures/',
          {
            params: {
              device_type: credentials.getDeviceType()?.toString() || '62',
              Sernum: serialNumber,
            },
            headers: { Authorization: `Bearer ${cognitoToken}` },
          },
        );

        if (featuresResponse.data.Status === '1' && featuresResponse.data.Data?.features) {
          features = featuresResponse.data.Data.features.map(
            (f: { description: string }) => f.description,
          );
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

    const robotInfo = await this.getRobotInfo(serialNumber);
    return robotInfo ? [robotInfo] : [];
  }

  /**
   * Get current serial number
   */
  getSerialNumber(): string | undefined {
    return this.authManager.getCredentialManager().getSerialNumber();
  }

  /**
   * Get current robot name
   */
  getRobotName(): string | undefined {
    return this.authManager.getCredentialManager().getRobotName();
  }
}
