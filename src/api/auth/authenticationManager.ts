/**
 * Authentication Manager
 *
 * Orchestrates the multi-step authentication flow:
 * 1. AWS Cognito authentication (user/password or refresh token)
 * 2. MyDolphin backend authentication
 * 3. AWS IoT temporary credentials acquisition
 *
 * The IoT endpoint is fixed per region (it belongs to the MyDolphin AWS
 * account), so it comes from IOT_ENDPOINTS rather than a DescribeEndpoint call.
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Logger } from 'homebridge';
import {
  COGNITO,
  IOT_ENDPOINTS,
  DEFAULT_IOT_REGION,
} from '../../config/constants.js';
import { MyDolphinHttpClient } from '../httpClient.js';
import { AuthError, ErrorCode, getErrorMessage } from '../../utils/errors.js';
import { CredentialManager } from './credentialManager.js';
import type { AuthConfig, AWSIoTCredentials, LoginResult } from './types.js';

interface MyDolphinUserData {
  mob_token: string;
  Sernum: string;
  MyRobotName: string;
  connectVia: string;
}

interface AwsTokenData {
  AccessKeyId: string;
  SecretAccessKey: string;
  Token: string;
  TokenExpiration: string;
}

/**
 * Manages the complete authentication flow for MyDolphin Plus
 */
export class AuthenticationManager {
  private readonly log: Logger;
  private readonly httpClient: MyDolphinHttpClient;
  private readonly credentials: CredentialManager;
  private readonly config: AuthConfig;
  private readonly iotRegion: string;
  private readonly iotEndpoint: string;
  private readonly cognitoClient: CognitoIdentityProviderClient;
  private pendingLogin?: Promise<LoginResult>;

  constructor(config: AuthConfig, log: Logger) {
    this.log = log;
    this.config = config;
    this.credentials = new CredentialManager();
    const region = config.iotRegion && Object.hasOwn(IOT_ENDPOINTS, config.iotRegion)
      ? config.iotRegion
      : DEFAULT_IOT_REGION;
    if (config.iotRegion && region !== config.iotRegion) {
      log.warn(`Unknown IoT region "${config.iotRegion}", using ${DEFAULT_IOT_REGION}`);
    }
    // Endpoint and signing region must match, so both come from the same entry
    this.iotRegion = region;
    this.iotEndpoint = IOT_ENDPOINTS[region];

    this.httpClient = new MyDolphinHttpClient();
    this.cognitoClient = new CognitoIdentityProviderClient({ region: COGNITO.REGION });
  }

  /**
   * Complete authentication flow. Concurrent callers share a single login.
   */
  login(): Promise<LoginResult> {
    this.pendingLogin ??= this.performLogin().finally(() => {
      this.pendingLogin = undefined;
    });
    return this.pendingLogin;
  }

  private async performLogin(): Promise<LoginResult> {
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
        getErrorMessage(error),
      );
      throw error;
    }
  }

  /**
   * Step 1: Authenticate with AWS Cognito
   */
  private async authenticateWithCognito(): Promise<void> {
    const cognitoClient = this.cognitoClient;

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

      this.log.error('Cognito authentication failed:', getErrorMessage(error));
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
      const response = await this.httpClient.post<MyDolphinUserData>(
        '/mobapi/user/authenticate-user/',
        undefined,
        { bearerToken: this.credentials.getCognitoToken() },
      );

      const data = response.Data;
      if (response.Status !== '1' || !data) {
        throw new AuthError(
          ErrorCode.AUTH_MYDOLPHIN_FAILED,
          'Authentication failed: ' + (response.Alert || 'Unknown error'),
        );
      }

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

      this.log.error('MyDolphin API error:', getErrorMessage(error));
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
      const response = await this.httpClient.get<AwsTokenData>('/mt-sso/aws/getToken/', {
        params: {
          sernum: this.credentials.getSerialNumber(),
          device_type: this.credentials.getDeviceType()?.toString(),
        },
        bearerToken: this.credentials.getCognitoToken(),
      });

      this.log.debug('AWS credentials response received, status:', response.Status);

      const data = response.Data;
      if (response.Status !== '1' || !data) {
        throw new AuthError(
          ErrorCode.AUTH_AWS_CREDENTIALS_FAILED,
          'Failed to get AWS credentials: ' + (response.Alert || 'Unknown error'),
        );
      }

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
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }

      this.log.error('AWS credentials error:', getErrorMessage(error));
      throw new AuthError(
        ErrorCode.AUTH_AWS_CREDENTIALS_FAILED,
        'Failed to get AWS IoT credentials',
        { cause: error },
      );
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
  getHttpClient(): MyDolphinHttpClient {
    return this.httpClient;
  }
}
