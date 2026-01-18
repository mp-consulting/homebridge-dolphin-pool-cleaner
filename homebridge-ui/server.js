/**
 * Homebridge UI Custom Server
 *
 * Provides authentication wizard for MyDolphin Plus account.
 * Supports OTP/MFA verification flow.
 *
 * Note: This file uses dynamic import() because @homebridge/plugin-ui-utils
 * is CommonJS but this project uses "type": "module".
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');
const { execSync } = require('child_process');

const COGNITO_REGION = 'us-west-2';
const COGNITO_CLIENT_ID = '4ed12eq01o6n0tl5f0sqmkq2na';
const MAYTRONICS_BASE_URL = 'https://apps.maytronics.com';
const APP_KEY = '346BDE92-53D1-4829-8A2E-B496014B586C';

class DolphinUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // Store pending auth sessions
    this.pendingSessions = new Map();

    // Register request handlers
    this.onRequest('/authenticate', this.handleAuthenticate.bind(this));
    this.onRequest('/verify-otp', this.handleVerifyOtp.bind(this));
    this.onRequest('/get-robots', this.handleGetRobots.bind(this));
    this.onRequest('/test-connection', this.handleTestConnection.bind(this));

    this.ready();
  }

  /**
   * Step 1: Initiate CUSTOM_AUTH flow with Cognito
   * Only email is required - OTP will be sent to user
   */
  async handleAuthenticate(payload) {
    const { email } = payload;

    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    try {
      // Step 1: Initiate CUSTOM_AUTH with AWS Cognito (triggers OTP)
      const cognitoResult = await this.authenticateWithCognito(email);

      // Check if OTP/MFA is required
      if (cognitoResult.requiresOtp) {
        // Store session for OTP verification
        this.pendingSessions.set(email, {
          session: cognitoResult.session,
          challengeName: cognitoResult.challengeName,
        });

        return {
          success: false,
          requiresOtp: true,
          challengeName: cognitoResult.challengeName,
          message: cognitoResult.message || 'Please enter the verification code sent to your email',
        };
      }

      if (!cognitoResult.success) {
        return cognitoResult;
      }

      // Step 2: Authenticate with MyDolphin backend
      const myDolphinResult = await this.authenticateWithMyDolphin(cognitoResult.idToken);

      if (!myDolphinResult.success) {
        return myDolphinResult;
      }

      return {
        success: true,
        serialNumber: myDolphinResult.serialNumber,
        robotName: myDolphinResult.robotName,
        deviceType: myDolphinResult.deviceType,
      };
    } catch (error) {
      console.error('Authentication error:', error);
      return {
        success: false,
        error: error.message || 'Authentication failed',
      };
    }
  }

  /**
   * Step 2: Verify OTP code for MFA
   */
  async handleVerifyOtp(payload) {
    const { email, otpCode } = payload;

    if (!email || !otpCode) {
      return { success: false, error: 'Email and OTP code are required' };
    }

    const session = this.pendingSessions.get(email);
    if (!session) {
      return { success: false, error: 'No pending authentication. Please try again.' };
    }

    try {
      // Respond to Cognito auth challenge
      const cognitoResult = await this.respondToAuthChallenge(
        email,
        otpCode,
        session.session,
        session.challengeName,
      );

      if (!cognitoResult.success) {
        return cognitoResult;
      }

      // Clear pending session
      this.pendingSessions.delete(email);

      // Step 2: Authenticate with MyDolphin backend
      const myDolphinResult = await this.authenticateWithMyDolphin(cognitoResult.idToken);

      if (!myDolphinResult.success) {
        return myDolphinResult;
      }

      return {
        success: true,
        serialNumber: myDolphinResult.serialNumber,
        robotName: myDolphinResult.robotName,
        deviceType: myDolphinResult.deviceType,
        robotImageUrl: myDolphinResult.robotImageUrl,
        // Return tokens for storage - needed for plugin authentication
        idToken: cognitoResult.idToken,
        accessToken: cognitoResult.accessToken,
        refreshToken: cognitoResult.refreshToken,
      };
    } catch (error) {
      console.error('OTP verification error:', error);
      return {
        success: false,
        error: error.message || 'OTP verification failed',
      };
    }
  }

  /**
   * Authenticate with AWS Cognito using CUSTOM_AUTH flow
   * This flow always requires OTP verification
   */
  async authenticateWithCognito(email) {
    try {
      // CUSTOM_AUTH flow - Step 1: Initiate auth (triggers OTP to be sent)
      const payload = JSON.stringify({
        AuthFlow: 'CUSTOM_AUTH',
        ClientId: COGNITO_CLIENT_ID,
        AuthParameters: {
          USERNAME: email,
        },
      });

      const result = execSync(
        `curl -s -X POST \
          "https://cognito-idp.${COGNITO_REGION}.amazonaws.com/" \
          -H "Content-Type: application/x-amz-json-1.1" \
          -H "X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth" \
          -d '${payload.replace(/'/g, "'\\''")}'`,
        { encoding: 'utf-8', timeout: 30000 },
      );

      const response = JSON.parse(result);

      // Check for errors
      if (response.__type) {
        if (response.__type.includes('NotAuthorizedException')) {
          return { success: false, error: 'Invalid email or password' };
        }
        if (response.__type.includes('UserNotFoundException')) {
          return { success: false, error: 'User not found. Please check your email address.' };
        }
        if (response.__type.includes('UserNotConfirmedException')) {
          return { success: false, error: 'Please confirm your email address first' };
        }
        return { success: false, error: response.message || 'Cognito authentication failed' };
      }

      // CUSTOM_AUTH always returns a challenge
      if (response.ChallengeName) {
        return {
          success: false,
          requiresOtp: true,
          challengeName: response.ChallengeName,
          session: response.Session,
          message: this.getChallengeMessage(response.ChallengeName),
        };
      }

      // Rare: Success without challenge (shouldn't happen with CUSTOM_AUTH)
      if (response.AuthenticationResult?.IdToken) {
        return {
          success: true,
          idToken: response.AuthenticationResult.IdToken,
          accessToken: response.AuthenticationResult.AccessToken,
          refreshToken: response.AuthenticationResult.RefreshToken,
        };
      }

      return { success: false, error: 'Unexpected authentication response' };
    } catch (error) {
      console.error('Cognito error:', error);
      return { success: false, error: 'Failed to connect to authentication service' };
    }
  }

  /**
   * Respond to Cognito auth challenge (OTP verification)
   */
  async respondToAuthChallenge(email, code, session, challengeName) {
    try {
      const challengeResponses = {
        USERNAME: email,
      };

      // Handle different challenge types
      if (challengeName === 'SMS_MFA') {
        challengeResponses.SMS_MFA_CODE = code;
      } else if (challengeName === 'SOFTWARE_TOKEN_MFA') {
        challengeResponses.SOFTWARE_TOKEN_MFA_CODE = code;
      } else if (challengeName === 'CUSTOM_CHALLENGE') {
        challengeResponses.ANSWER = code;
      } else {
        // Default - most common for email OTP
        challengeResponses.SMS_MFA_CODE = code;
      }

      const payload = JSON.stringify({
        ChallengeName: challengeName,
        ClientId: COGNITO_CLIENT_ID,
        Session: session,
        ChallengeResponses: challengeResponses,
      });

      const result = execSync(
        `curl -s -X POST \
          "https://cognito-idp.${COGNITO_REGION}.amazonaws.com/" \
          -H "Content-Type: application/x-amz-json-1.1" \
          -H "X-Amz-Target: AWSCognitoIdentityProviderService.RespondToAuthChallenge" \
          -d '${payload.replace(/'/g, "'\\''")}'`,
        { encoding: 'utf-8', timeout: 30000 },
      );

      const response = JSON.parse(result);

      // Check for errors
      if (response.__type) {
        if (response.__type.includes('CodeMismatchException')) {
          return { success: false, error: 'Invalid verification code' };
        }
        if (response.__type.includes('ExpiredCodeException')) {
          return { success: false, error: 'Verification code has expired. Please try again.' };
        }
        if (response.__type.includes('NotAuthorizedException')) {
          return { success: false, error: 'Session expired. Please start over.' };
        }
        return { success: false, error: response.message || 'Verification failed' };
      }

      // Check for another challenge (rare)
      if (response.ChallengeName) {
        return {
          success: false,
          requiresOtp: true,
          challengeName: response.ChallengeName,
          session: response.Session,
          message: this.getChallengeMessage(response.ChallengeName),
        };
      }

      // Success
      if (!response.AuthenticationResult?.IdToken) {
        return { success: false, error: 'No authentication token received' };
      }

      return {
        success: true,
        idToken: response.AuthenticationResult.IdToken,
        accessToken: response.AuthenticationResult.AccessToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
      };
    } catch (error) {
      console.error('Challenge response error:', error);
      return { success: false, error: 'Failed to verify code' };
    }
  }

  /**
   * Get user-friendly message for challenge type
   */
  getChallengeMessage(challengeName) {
    const messages = {
      SMS_MFA: 'Please enter the verification code sent to your phone',
      SOFTWARE_TOKEN_MFA: 'Please enter the code from your authenticator app',
      CUSTOM_CHALLENGE: 'Please enter the verification code sent to your email',
      MFA_SETUP: 'MFA setup required. Please complete setup in the MyDolphin app first.',
    };
    return messages[challengeName] || 'Please enter the verification code';
  }

  /**
   * Authenticate with MyDolphin backend
   */
  async authenticateWithMyDolphin(idToken) {
    try {
      const result = execSync(
        `curl -s -X POST \
          "${MAYTRONICS_BASE_URL}/mobapi/user/authenticate-user/" \
          -H "Authorization: Bearer ${idToken}" \
          -H "AppKey: ${APP_KEY}" \
          -H "Content-Type: application/x-www-form-urlencoded"`,
        { encoding: 'utf-8', timeout: 30000 },
      );

      const response = JSON.parse(result);

      if (response.Status !== '1') {
        return { success: false, error: response.Alert || 'MyDolphin authentication failed' };
      }

      const serialNumber = response.Data.Sernum;
      const robotName = response.Data.MyRobotName || 'Dolphin Robot';
      const deviceType = parseInt(response.Data.connectVia, 10) || 62;

      // Fetch robot details including image URL
      let robotImageUrl = null;
      try {
        const robotDetails = await this.getRobotDetails(serialNumber, idToken);
        if (robotDetails.success && robotDetails.imageUrl) {
          robotImageUrl = robotDetails.imageUrl;
        }
      } catch (err) {
        console.log('Could not fetch robot image URL:', err.message);
      }

      return {
        success: true,
        serialNumber,
        robotName,
        deviceType,
        mobToken: response.Data.mob_token,
        robotImageUrl,
      };
    } catch (error) {
      console.error('MyDolphin error:', error);
      return { success: false, error: 'Failed to connect to MyDolphin service' };
    }
  }

  /**
   * Get robot details including product image URL
   * Endpoint: /mobapi/serial-numbers/getRobotDetailsByRobotSN/
   */
  async getRobotDetails(serialNumber, idToken) {
    try {
      const result = execSync(
        `curl -s -X POST \
          "${MAYTRONICS_BASE_URL}/mobapi/serial-numbers/getRobotDetailsByRobotSN/" \
          -H "Authorization: Bearer ${idToken}" \
          -H "AppKey: ${APP_KEY}" \
          -H "Content-Type: application/x-www-form-urlencoded" \
          -d "SERNUM=${serialNumber}"`,
        { encoding: 'utf-8', timeout: 30000 },
      );

      const response = JSON.parse(result);

      if (response.Status !== '1') {
        return { success: false, error: response.Alert || 'Failed to get robot details' };
      }

      return {
        success: true,
        imageUrl: response.Data.originalUrlImage || response.Data.Originalmg,
        partName: response.Data.PARTNAME,
        partDescription: response.Data.PARTDES,
        robotFamily: response.Data.RobotFamily,
        robotName: response.Data.MyRobotName,
        warrantyDays: response.Data.warranty_days,
        registrationDate: response.Data.RegDate,
        truncatedSerial: response.Data.eSERNUM,
      };
    } catch (error) {
      console.error('Robot details error:', error);
      return { success: false, error: 'Failed to get robot details' };
    }
  }

  /**
   * Get robot list for authenticated user
   */
  async handleGetRobots(payload) {
    const { email, password } = payload;

    // First authenticate
    const authResult = await this.handleAuthenticate({ email, password });

    if (!authResult.success) {
      return authResult;
    }

    // Return robot info
    return {
      success: true,
      robots: [
        {
          serialNumber: authResult.serialNumber,
          name: authResult.robotName,
          deviceType: authResult.deviceType,
        },
      ],
    };
  }

  /**
   * Test connection to MyDolphin service
   */
  async handleTestConnection(payload) {
    const { email, password } = payload;

    const result = await this.handleAuthenticate({ email, password });

    if (result.success) {
      return {
        success: true,
        message: `Connected! Found robot: ${result.robotName} (S/N: ${result.serialNumber})`,
      };
    }

    return result;
  }
}

// Start server
(() => new DolphinUiServer())();
