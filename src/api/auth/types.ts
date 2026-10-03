/**
 * Authentication Types
 *
 * Type definitions for authentication flow and credential management.
 */

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
