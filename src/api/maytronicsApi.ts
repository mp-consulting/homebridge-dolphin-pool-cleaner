/**
 * Maytronics MyDolphin Plus API Client
 *
 * Handles authentication flow:
 * 1. AWS Cognito authentication (user/password)
 * 2. MyDolphin backend authentication (gets robot info)
 * 3. AWS IoT temporary credentials (for Thing Shadow access)
 */
import axios, { type AxiosInstance } from 'axios';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { IoTClient, DescribeEndpointCommand } from '@aws-sdk/client-iot';
import { MQTTClient } from './mqttClient.js';
import {
  MAYTRONICS_API,
  COGNITO,
  IOT_ENDPOINTS,
  DEFAULT_IOT_REGION,
  CREDENTIAL_REFRESH_BUFFER_MS,
} from '../config/constants.js';
import type { Logger } from 'homebridge';

export interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export interface RobotInfo {
  serialNumber: string;
  name: string;
  model: string;
  deviceType: number;
  warrantyDays?: number;
  features: string[];
}

export interface ThingShadowCommand {
  state: {
    desired: Record<string, unknown>;
  };
}

export class MaytronicsAPI {
  private readonly email: string | undefined;
  private readonly password: string | undefined;
  private readonly log: Logger;
  private readonly httpClient: AxiosInstance;
  private cognitoJWT: string | undefined;
  private mobToken: string | undefined;
  private awsCredentials: AWSCredentials | undefined;
  private mqttClient: MQTTClient | undefined;
  private userSerialNumber: string | undefined;
  private userRobotName: string | undefined;
  private userDeviceType: number | undefined;
  private iotRegion: string;
  private iotEndpoint: string;
  private readonly refreshToken: string | undefined;
  private hasLoggedMqttConnection = false;

  constructor(
    email: string | undefined,
    password: string | undefined,
    log: Logger,
    iotRegion: string | undefined,
    refreshToken: string | undefined,
  ) {
    this.email = email;
    this.password = password;
    this.log = log;
    this.iotRegion = iotRegion || DEFAULT_IOT_REGION;
    this.iotEndpoint =
      IOT_ENDPOINTS[this.iotRegion] || IOT_ENDPOINTS['eu-west-1'];
    this.refreshToken = refreshToken;
    this.httpClient = axios.create({
      baseURL: MAYTRONICS_API.BASE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        AppKey: MAYTRONICS_API.APP_KEY,
        Accept: '*/*',
        'User-Agent': MAYTRONICS_API.USER_AGENT,
      },
    });
  }
  /**
   * Complete authentication flow
   */
  async login() {
    try {
      this.log.debug('Starting authentication flow...');
      // Step 1: Authenticate with AWS Cognito
      await this.authenticateWithCognito();
      // Step 2: Authenticate with MyDolphin backend
      await this.authenticateWithMyDolphin();
      // Step 3: Get AWS IoT credentials
      await this.getAWSCredentials();
      // Step 4: Initialize MQTT client and connect
      await this.initializeMQTTClient();
      this.log.info('Successfully authenticated with MyDolphin Plus');
      return {
        cognitoToken: this.cognitoJWT,
        mobToken: this.mobToken,
        serialNumber: this.userSerialNumber,
        robotName: this.userRobotName || 'Dolphin Robot',
        deviceType: this.userDeviceType || 62,
      };
    } catch (error) {
      this.log.error(
        'Login failed:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
  /**
   * Step 1: Authenticate with AWS Cognito
   * Supports refresh token (preferred) or user/password auth
   */
  async authenticateWithCognito() {
    const cognitoClient = new CognitoIdentityProviderClient({
      region: COGNITO.REGION,
    });
    try {
      let idToken;
      if (this.refreshToken) {
        // Use refresh token (preferred method)
        this.log.debug('Authenticating with refresh token...');
        const command = new InitiateAuthCommand({
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          ClientId: COGNITO.CLIENT_ID,
          AuthParameters: {
            REFRESH_TOKEN: this.refreshToken,
          },
        });
        const response = await cognitoClient.send(command);
        idToken = response.AuthenticationResult?.IdToken;
      } else if (this.email && this.password) {
        // Fall back to user/password auth
        this.log.debug('Authenticating with email/password...');
        const command = new InitiateAuthCommand({
          AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
          ClientId: COGNITO.CLIENT_ID,
          AuthParameters: {
            USERNAME: this.email,
            PASSWORD: this.password,
          },
        });
        const response = await cognitoClient.send(command);
        idToken = response.AuthenticationResult?.IdToken;
      } else {
        throw new Error(
          'No authentication credentials available (need refreshToken or email/password)',
        );
      }
      if (!idToken) {
        throw new Error('No ID token received from Cognito');
      }
      this.cognitoJWT = idToken;
      this.log.debug('Cognito authentication successful');
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'NotAuthorizedException') {
          if (this.refreshToken) {
            throw new Error(
              'Refresh token expired. Please re-authenticate through the plugin settings.',
            );
          }
          throw new Error('Invalid email or password');
        }
        if (error.name === 'UserNotFoundException') {
          throw new Error('User not found. Please check your email address.');
        }
      }
      this.log.error('Cognito authentication failed:', error);
      throw new Error('Failed to authenticate with AWS Cognito');
    }
  }
  /**
   * Step 2: Authenticate with MyDolphin backend using Cognito JWT
   */
  async authenticateWithMyDolphin() {
    try {
      const response = await this.httpClient.post(
        '/mobapi/user/authenticate-user/',
        null,
        {
          headers: {
            Authorization: `Bearer ${this.cognitoJWT}`,
          },
        },
      );
      if (response.data.Status !== '1') {
        throw new Error(
          'Authentication failed: ' + (response.data.Alert || 'Unknown error'),
        );
      }
      const data = response.data.Data;
      this.mobToken = data.mob_token;
      this.userSerialNumber = data.Sernum;
      this.userRobotName = data.MyRobotName;
      this.userDeviceType = parseInt(data.connectVia, 10) || 62;
      this.log.debug('MyDolphin backend authentication successful');
      this.log.debug(
        `Robot serial: ${this.userSerialNumber}, Name: ${this.userRobotName}`,
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error;
        this.log.error(
          'MyDolphin API error:',
          axiosError.response?.data || axiosError.message,
        );
      }
      throw new Error('Failed to authenticate with MyDolphin backend');
    }
  }
  /**
   * Step 3: Get temporary AWS credentials for IoT access
   */
  async getAWSCredentials() {
    try {
      // Pass serial number and device type to get proper IoT credentials
      const response = await this.httpClient.get('/mt-sso/aws/getToken/', {
        params: {
          sernum: this.userSerialNumber,
          device_type: this.userDeviceType?.toString(),
        },
        headers: {
          Authorization: `Bearer ${this.cognitoJWT}`,
        },
      });
      this.log.debug(
        'AWS credentials response:',
        JSON.stringify(response.data).substring(0, 500),
      );
      if (response.data.Status !== '1') {
        throw new Error(
          'Failed to get AWS credentials: ' +
            (response.data.Alert || 'Unknown error'),
        );
      }
      const data = response.data.Data;
      this.awsCredentials = {
        accessKeyId: data.AccessKeyId,
        secretAccessKey: data.SecretAccessKey,
        sessionToken: data.Token,
        expiration: new Date(data.TokenExpiration),
      };
      this.log.debug(
        `AWS credentials obtained, expire at: ${this.awsCredentials.expiration.toISOString()}`,
      );
      // Discover the IoT endpoint dynamically using DescribeEndpoint API
      await this.discoverIoTEndpoint();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error;
        this.log.error(
          'AWS credentials error:',
          axiosError.response?.data || axiosError.message,
        );
      }
      throw new Error('Failed to get AWS IoT credentials');
    }
  }
  /**
   * Discover the IoT endpoint using AWS IoT DescribeEndpoint API
   */
  async discoverIoTEndpoint() {
    if (!this.awsCredentials) {
      throw new Error('AWS credentials not available for endpoint discovery');
    }
    try {
      const iotClient = new IoTClient({
        region: this.iotRegion,
        credentials: {
          accessKeyId: this.awsCredentials.accessKeyId,
          secretAccessKey: this.awsCredentials.secretAccessKey,
          sessionToken: this.awsCredentials.sessionToken,
        },
      });
      const command = new DescribeEndpointCommand({
        endpointType: 'iot:Data-ATS',
      });
      const response = await iotClient.send(command);
      if (response.endpointAddress) {
        this.iotEndpoint = response.endpointAddress;
        this.log.debug(`Discovered IoT endpoint: ${this.iotEndpoint}`);
      } else {
        this.log.warn('Could not discover IoT endpoint, using default');
      }
    } catch (error) {
      const err = error as Error;
      this.log.debug(
        `Failed to discover IoT endpoint: ${err.message}. Using default.`,
      );
      // Keep using the configured/default endpoint
    }
  }
  /**
   * Step 4: Initialize MQTT client and connect to AWS IoT Core
   * Uses MQTT over WebSocket, same as the iOS app
   */
  async initializeMQTTClient() {
    if (!this.awsCredentials || !this.userSerialNumber) {
      throw new Error('AWS credentials or serial number not available');
    }
    // Disconnect existing client if any
    if (this.mqttClient) {
      this.mqttClient.disconnect();
    }
    this.mqttClient = new MQTTClient(
      {
        serialNumber: this.userSerialNumber,
        region: this.iotRegion,
        iotEndpoint: this.iotEndpoint,
        credentials: this.awsCredentials,
      },
      this.log,
    );
    // Set up event handlers
    this.mqttClient.on('shadowUpdate', (shadow) => {
      this.log.debug(
        'Shadow update received:',
        JSON.stringify(shadow).substring(0, 200),
      );
    });
    this.mqttClient.on('error', (error) => {
      this.log.error('MQTT error:', error.message);
    });
    // Connect to MQTT
    await this.mqttClient.connect();
    // Only log connection message once
    if (!this.hasLoggedMqttConnection) {
      this.hasLoggedMqttConnection = true;
      this.log.info(`MQTT connected for robot ${this.userSerialNumber}`);
    }
  }
  /**
   * Check if credentials need refresh
   */
  needsRefresh() {
    if (!this.awsCredentials) {
      return true;
    }
    const refreshTime = new Date(Date.now() + CREDENTIAL_REFRESH_BUFFER_MS);
    return this.awsCredentials.expiration < refreshTime;
  }
  /**
   * Ensure credentials are valid (refresh if needed)
   */
  async ensureValidCredentials() {
    if (this.needsRefresh()) {
      this.log.debug('Credentials expired or expiring soon, refreshing...');
      await this.login();
    }
  }
  /**
   * Get robot Thing Shadow state from AWS IoT via MQTT
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getThingShadow(serialNumber: string): Promise<any | undefined> {
    await this.ensureValidCredentials();
    if (!this.mqttClient || !this.mqttClient.isConnected()) {
      this.log.debug('MQTT client not connected, reconnecting...');
      await this.initializeMQTTClient();
    }
    try {
      this.log.debug(`Getting Thing Shadow for: ${serialNumber} via MQTT`);
      const shadow = await this.mqttClient!.getShadow();
      if (!shadow) {
        this.log.debug('Thing Shadow response is empty');
        return undefined;
      }
      this.log.debug(
        'Thing Shadow received:',
        JSON.stringify(shadow).substring(0, 200) + '...',
      );
      return shadow;
    } catch (error) {
      const err = error as Error;
      this.log.error(
        'Failed to get Thing Shadow:',
        err.message || String(error),
      );
      return undefined;
    }
  }
  /**
   * Update robot Thing Shadow state via MQTT
   */
  async updateThingShadow(serialNumber: string, command: ThingShadowCommand): Promise<boolean> {
    await this.ensureValidCredentials();
    if (!this.mqttClient || !this.mqttClient.isConnected()) {
      this.log.debug('MQTT client not connected, reconnecting...');
      await this.initializeMQTTClient();
    }
    try {
      const desired = command.state.desired;
      const success = await this.mqttClient!.updateShadow(desired);
      if (success) {
        this.log.debug(`Thing Shadow updated for ${serialNumber}`);
      }
      return success;
    } catch (error) {
      this.log.error(
        'Failed to update Thing Shadow:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
  /**
   * Send command to start the robot
   */
  async startRobot(serialNumber: string, cleaningMode?: number): Promise<boolean> {
    const command: ThingShadowCommand = {
      state: {
        desired: {
          command: 'start_up_dolphin',
          opcode: '06',
          destination: 'FFF8',
        },
      },
    };
    if (cleaningMode !== undefined) {
      // Also set cleaning mode if provided
      command.state.desired.cleaning_mode = cleaningMode;
    }
    return this.updateThingShadow(serialNumber, command);
  }
  /**
   * Send command to stop the robot
   */
  async stopRobot(serialNumber: string): Promise<boolean> {
    const command: ThingShadowCommand = {
      state: {
        desired: {
          command: 'shutdown_dolphin',
          opcode: '05',
          destination: 'FFF8',
        },
      },
    };
    return this.updateThingShadow(serialNumber, command);
  }
  /**
   * Send command to set cleaning mode
   */
  async setCleaningMode(serialNumber: string, mode: number): Promise<boolean> {
    const command: ThingShadowCommand = {
      state: {
        desired: {
          command: 'set_cleaning_mode',
          opcode: '03',
          destination: 'FFE9',
          data: mode.toString(16).padStart(2, '0'),
        },
      },
    };
    return this.updateThingShadow(serialNumber, command);
  }
  /**
   * Send command to put robot in pickup mode
   */
  async pickupRobot(serialNumber: string): Promise<boolean> {
    const command: ThingShadowCommand = {
      state: {
        desired: {
          command: 'start_pickup_mode',
          opcode: '03',
          destination: 'FFE9',
          data: '09', // pickup mode value
        },
      },
    };
    return this.updateThingShadow(serialNumber, command);
  }
  /**
   * Get robot information from REST API
   */
  async getRobotInfo(serialNumber: string): Promise<RobotInfo | undefined> {
    try {
      await this.ensureValidCredentials();
      const response = await this.httpClient.post(
        '/mobapi/serial-numbers/getRobotDetailsByRobotSN/',
        `SERNUM=${serialNumber}`,
        {
          headers: {
            Authorization: `Bearer ${this.cognitoJWT}`,
          },
        },
      );
      if (response.data.Status !== '1') {
        return undefined;
      }
      const data = response.data.Data;
      // Get device features
      let features: string[] = [];
      try {
        const featuresResponse = await this.httpClient.get(
          '/mobapi/serial-numbers/getSernFeatures/',
          {
            params: {
              device_type: this.userDeviceType?.toString() || '62',
              Sernum: serialNumber,
            },
            headers: {
              Authorization: `Bearer ${this.cognitoJWT}`,
            },
          },
        );
        if (
          featuresResponse.data.Status === '1' &&
          featuresResponse.data.Data?.features
        ) {
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
        name: data.MyRobotName || this.userRobotName || 'Dolphin Robot',
        model: data.PARTDES || 'Unknown Model',
        deviceType: this.userDeviceType || 62,
        warrantyDays: data.warranty_days,
        features,
      };
    } catch (error) {
      this.log.error(
        'Failed to get robot info:',
        error instanceof Error ? error.message : String(error),
      );
      return undefined;
    }
  }
  /**
   * Get user's robots (from authentication)
   */
  async getRobots() {
    if (!this.userSerialNumber) {
      return [];
    }
    const robotInfo = await this.getRobotInfo(this.userSerialNumber);
    return robotInfo ? [robotInfo] : [];
  }
  /**
   * Get current serial number
   */
  getSerialNumber() {
    return this.userSerialNumber;
  }
  /**
   * Get current robot name
   */
  getRobotName() {
    return this.userRobotName;
  }
}
//# sourceMappingURL=maytronicsApi.js.map
