/**
 * Authentication Types
 *
 * Type definitions for authentication flow and credential management.
 */

/**
 * AWS Cognito credentials
 */
export interface CognitoCredentials {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

/**
 * AWS IoT temporary credentials (from STS)
 */
export interface AWSIoTCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

/**
 * MyDolphin backend authentication result
 */
export interface MyDolphinAuthResult {
  mobToken: string;
  serialNumber: string;
  robotName: string;
  deviceType: number;
}

/**
 * Complete authentication state
 */
export interface AuthState {
  cognitoToken?: string;
  mobToken?: string;
  awsCredentials?: AWSIoTCredentials;
  serialNumber?: string;
  robotName?: string;
  deviceType?: number;
  isAuthenticated: boolean;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  email?: string;
  password?: string;
  refreshToken?: string;
  iotRegion?: string;
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
  awsCredentials: AWSIoTCredentials;
  iotEndpoint: string;
}
