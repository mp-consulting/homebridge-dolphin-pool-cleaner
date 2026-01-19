/**
 * Authentication Manager
 *
 * Orchestrates the multi-step authentication flow:
 * 1. AWS Cognito authentication (user/password or refresh token)
 * 2. MyDolphin backend authentication
 * 3. AWS IoT temporary credentials acquisition
 */
import axios, { type AxiosInstance } from 'axios';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { IoTClient, DescribeEndpointCommand } from '@aws-sdk/client-iot';
import type { Logger } from 'homebridge';
import {
  MAYTRONICS_API,
  COGNITO,
  IOT_ENDPOINTS,
  DEFAULT_IOT_REGION,
  API_TIMEOUT_MS,
  DEBUG_LOG_PREVIEW_LENGTH,
} from '../../config/constants.js';
import { AuthError, ErrorCode } from '../../utils/errors.js';
import { CredentialManager } from './credentialManager.js';
import type { AuthConfig, AWSIoTCredentials, LoginResult } from './types.js';

/**
 * Manages the complete authentication flow for MyDolphin Plus
 */
export class AuthenticationManager {
  private readonly log: Logger;
  private readonly httpClient: AxiosInstance;
  private readonly credentials: CredentialManager;
  private readonly config: AuthConfig;
  private iotRegion: string;
  private iotEndpoint: string;

  constructor(config: AuthConfig, log: Logger) {
    this.log = log;
    this.config = config;
    this.credentials = new CredentialManager();
    this.iotRegion = config.iotRegion || DEFAULT_IOT_REGION;
    this.iotEndpoint = IOT_ENDPOINTS[this.iotRegion] || IOT_ENDPOINTS['eu-west-1'];

    this.httpClient = axios.create({
      baseURL: MAYTRONICS_API.BASE_URL,
      timeout: API_TIMEOUT_MS,
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
  async login(): Promise<LoginResult> {
    try {
      this.log.debug('Starting authentication flow...');

      // Step 1: Authenticate with AWS Cognito
      await this.authenticateWithCognito();

      // Step 2: Authenticate with MyDolphin backend
      await this.authenticateWithMyDolphin();

      // Step 3: Get AWS IoT credentials
      await this.getAWSCredentials();

      this.log.info('Successfully authenticated with MyDolphin Plus');

      const awsCredentials = this.credentials.getAWSCredentials();
      if (!awsCredentials) {
        throw new AuthError(
          ErrorCode.AUTH_AWS_CREDENTIALS_FAILED,
          'AWS credentials not available after authentication',
        );
      }

      return {
        cognitoToken: this.credentials.getCognitoToken()!,
        mobToken: this.credentials.getMobToken()!,
        serialNumber: this.credentials.getSerialNumber()!,
        robotName: this.credentials.getRobotName() || 'Dolphin Robot',
        deviceType: this.credentials.getDeviceType() || 62,
        awsCredentials,
        iotEndpoint: this.iotEndpoint,
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
   */
  private async authenticateWithCognito(): Promise<void> {
    const cognitoClient = new CognitoIdentityProviderClient({
      region: COGNITO.REGION,
    });

    try {
      let idToken: string | undefined;

      if (this.config.refreshToken) {
        // Use refresh token (preferred method)
        this.log.debug('Authenticating with refresh token...');
        const command = new InitiateAuthCommand({
          AuthFlow: AuthFlowType.REFRESH_TOKEN_AUTH,
          ClientId: COGNITO.CLIENT_ID,
          AuthParameters: {
            REFRESH_TOKEN: this.config.refreshToken,
          },
        });

        const response = await cognitoClient.send(command);
        idToken = response.AuthenticationResult?.IdToken;
      } else if (this.config.email && this.config.password) {
        // Fall back to user/password auth
        this.log.debug('Authenticating with email/password...');
        const command = new InitiateAuthCommand({
          AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
          ClientId: COGNITO.CLIENT_ID,
          AuthParameters: {
            USERNAME: this.config.email,
            PASSWORD: this.config.password,
          },
        });

        const response = await cognitoClient.send(command);
        idToken = response.AuthenticationResult?.IdToken;
      } else {
        throw new AuthError(
          ErrorCode.AUTH_INVALID_CREDENTIALS,
          'No authentication credentials available (need refreshToken or email/password)',
        );
      }

      if (!idToken) {
        throw new AuthError(
          ErrorCode.AUTH_COGNITO_FAILED,
          'No ID token received from Cognito',
        );
      }

      this.credentials.setCognitoToken(idToken);
      this.log.debug('Cognito authentication successful');
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'NotAuthorizedException') {
          if (this.config.refreshToken) {
            throw new AuthError(
              ErrorCode.AUTH_TOKEN_EXPIRED,
              'Refresh token expired. Please re-authenticate through the plugin settings.',
              { cause: error },
            );
          }
          throw new AuthError(
            ErrorCode.AUTH_INVALID_CREDENTIALS,
            'Invalid email or password',
            { cause: error },
          );
        }
        if (error.name === 'UserNotFoundException') {
          throw new AuthError(
            ErrorCode.AUTH_INVALID_CREDENTIALS,
            'User not found. Please check your email address.',
            { cause: error },
          );
        }
      }

      this.log.error('Cognito authentication failed:', error);
      throw new AuthError(
        ErrorCode.AUTH_COGNITO_FAILED,
        'Failed to authenticate with AWS Cognito',
        { cause: error },
      );
    }
  }

  /**
   * Step 2: Authenticate with MyDolphin backend using Cognito JWT
   */
  private async authenticateWithMyDolphin(): Promise<void> {
    try {
      const response = await this.httpClient.post(
        '/mobapi/user/authenticate-user/',
        null,
        {
          headers: {
            Authorization: `Bearer ${this.credentials.getCognitoToken()}`,
          },
        },
      );

      if (response.data.Status !== '1') {
        throw new AuthError(
          ErrorCode.AUTH_MYDOLPHIN_FAILED,
          'Authentication failed: ' + (response.data.Alert || 'Unknown error'),
        );
      }

      const data = response.data.Data;
      this.credentials.setMyDolphinAuth({
        mobToken: data.mob_token,
        serialNumber: data.Sernum,
        robotName: data.MyRobotName,
        deviceType: parseInt(data.connectVia, 10) || 62,
      });

      this.log.debug('MyDolphin backend authentication successful');
      this.log.debug(
        `Robot serial: ${this.credentials.getSerialNumber()}, Name: ${this.credentials.getRobotName()}`,
      );
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.log.error(
          'MyDolphin API error:',
          error.response?.data || error.message,
        );
      }

      throw new AuthError(
        ErrorCode.AUTH_MYDOLPHIN_FAILED,
        'Failed to authenticate with MyDolphin backend',
        { cause: error },
      );
    }
  }

  /**
   * Step 3: Get temporary AWS credentials for IoT access
   */
  private async getAWSCredentials(): Promise<void> {
    try {
      const response = await this.httpClient.get('/mt-sso/aws/getToken/', {
        params: {
          sernum: this.credentials.getSerialNumber(),
          device_type: this.credentials.getDeviceType()?.toString(),
        },
        headers: {
          Authorization: `Bearer ${this.credentials.getCognitoToken()}`,
        },
      });

      this.log.debug(
        'AWS credentials response:',
        JSON.stringify(response.data).substring(0, DEBUG_LOG_PREVIEW_LENGTH),
      );

      if (response.data.Status !== '1') {
        throw new AuthError(
          ErrorCode.AUTH_AWS_CREDENTIALS_FAILED,
          'Failed to get AWS credentials: ' +
            (response.data.Alert || 'Unknown error'),
        );
      }

      const data = response.data.Data;
      const awsCredentials: AWSIoTCredentials = {
        accessKeyId: data.AccessKeyId,
        secretAccessKey: data.SecretAccessKey,
        sessionToken: data.Token,
        expiration: new Date(data.TokenExpiration),
      };

      this.credentials.setAWSCredentials(awsCredentials);

      this.log.debug(
        `AWS credentials obtained, expire at: ${awsCredentials.expiration.toISOString()}`,
      );

      // Discover the IoT endpoint dynamically
      await this.discoverIoTEndpoint(awsCredentials);
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        this.log.error(
          'AWS credentials error:',
          error.response?.data || error.message,
        );
      }

      throw new AuthError(
        ErrorCode.AUTH_AWS_CREDENTIALS_FAILED,
        'Failed to get AWS IoT credentials',
        { cause: error },
      );
    }
  }

  /**
   * Discover the IoT endpoint using AWS IoT DescribeEndpoint API
   */
  private async discoverIoTEndpoint(credentials: AWSIoTCredentials): Promise<void> {
    try {
      const iotClient = new IoTClient({
        region: this.iotRegion,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
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
   * Ensure credentials are valid, refresh if needed
   */
  async ensureValidCredentials(): Promise<void> {
    if (this.credentials.needsRefresh()) {
      this.log.debug('Credentials expired or expiring soon, refreshing...');
      await this.login();
    }
  }

  /**
   * Check if credentials need refresh
   */
  needsRefresh(): boolean {
    return this.credentials.needsRefresh();
  }

  /**
   * Get credential manager
   */
  getCredentialManager(): CredentialManager {
    return this.credentials;
  }

  /**
   * Get IoT region
   */
  getIoTRegion(): string {
    return this.iotRegion;
  }

  /**
   * Get IoT endpoint
   */
  getIoTEndpoint(): string {
    return this.iotEndpoint;
  }

  /**
   * Get HTTP client for additional API calls
   */
  getHttpClient(): AxiosInstance {
    return this.httpClient;
  }
}
