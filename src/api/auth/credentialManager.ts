/**
 * Credential Manager
 *
 * Manages authentication credentials, including storage, refresh, and expiration tracking.
 */
import { CREDENTIAL_REFRESH_BUFFER_MS } from '../../config/constants.js';
import type { AWSIoTCredentials, AuthState, MyDolphinAuthResult } from './types.js';

/**
 * Manages authentication credentials lifecycle
 */
export class CredentialManager {
  private cognitoToken?: string;
  private mobToken?: string;
  private awsCredentials?: AWSIoTCredentials;
  private serialNumber?: string;
  private robotName?: string;
  private deviceType?: number;

  /**
   * Set Cognito JWT token
   */
  setCognitoToken(token: string): void {
    this.cognitoToken = token;
  }

  /**
   * Get Cognito JWT token
   */
  getCognitoToken(): string | undefined {
    return this.cognitoToken;
  }

  /**
   * Set MyDolphin authentication result
   */
  setMyDolphinAuth(auth: MyDolphinAuthResult): void {
    this.mobToken = auth.mobToken;
    this.serialNumber = auth.serialNumber;
    this.robotName = auth.robotName;
    this.deviceType = auth.deviceType;
  }

  /**
   * Get mob token
   */
  getMobToken(): string | undefined {
    return this.mobToken;
  }

  /**
   * Set AWS IoT credentials
   */
  setAWSCredentials(credentials: AWSIoTCredentials): void {
    this.awsCredentials = credentials;
  }

  /**
   * Get AWS IoT credentials
   */
  getAWSCredentials(): AWSIoTCredentials | undefined {
    return this.awsCredentials;
  }

  /**
   * Get serial number
   */
  getSerialNumber(): string | undefined {
    return this.serialNumber;
  }

  /**
   * Get robot name
   */
  getRobotName(): string | undefined {
    return this.robotName;
  }

  /**
   * Get device type
   */
  getDeviceType(): number | undefined {
    return this.deviceType;
  }

  /**
   * Check if AWS credentials are expired or expiring soon
   */
  needsRefresh(): boolean {
    if (!this.awsCredentials) {
      return true;
    }

    const refreshTime = new Date(Date.now() + CREDENTIAL_REFRESH_BUFFER_MS);
    return this.awsCredentials.expiration < refreshTime;
  }

  /**
   * Check if we have valid AWS credentials (not expired)
   */
  hasValidCredentials(): boolean {
    if (!this.awsCredentials) {
      return false;
    }

    return this.awsCredentials.expiration > new Date();
  }

  /**
   * Check if fully authenticated
   */
  isAuthenticated(): boolean {
    return !!(
      this.cognitoToken &&
      this.mobToken &&
      this.awsCredentials &&
      this.serialNumber &&
      this.hasValidCredentials()
    );
  }

  /**
   * Get current authentication state
   */
  getState(): AuthState {
    return {
      cognitoToken: this.cognitoToken,
      mobToken: this.mobToken,
      awsCredentials: this.awsCredentials,
      serialNumber: this.serialNumber,
      robotName: this.robotName,
      deviceType: this.deviceType,
      isAuthenticated: this.isAuthenticated(),
    };
  }

  /**
   * Clear all credentials
   */
  clear(): void {
    this.cognitoToken = undefined;
    this.mobToken = undefined;
    this.awsCredentials = undefined;
    this.serialNumber = undefined;
    this.robotName = undefined;
    this.deviceType = undefined;
  }

  /**
   * Get time until credentials expire
   */
  getTimeUntilExpiration(): number {
    if (!this.awsCredentials) {
      return 0;
    }

    return Math.max(0, this.awsCredentials.expiration.getTime() - Date.now());
  }

  /**
   * Get credentials expiration date
   */
  getExpirationDate(): Date | undefined {
    return this.awsCredentials?.expiration;
  }
}
