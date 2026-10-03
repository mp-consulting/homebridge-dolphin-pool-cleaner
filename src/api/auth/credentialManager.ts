/**
 * Credential Manager
 *
 * Manages authentication credentials, including storage, refresh, and expiration tracking.
 */
import { CREDENTIAL_REFRESH_BUFFER_MS } from '../../config/constants.js';
import type { AWSIoTCredentials, MyDolphinAuthResult } from './types.js';

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
}
