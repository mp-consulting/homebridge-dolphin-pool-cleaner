/**
 * Homebridge UI Custom Server
 *
 * Provides authentication wizard for MyDolphin Plus account.
 * Supports OTP/MFA verification flow.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { HomebridgePluginUiServer } = require('@homebridge/plugin-ui-utils');

// Configuration constants
const COGNITO_REGION = 'us-west-2';
const COGNITO_CLIENT_ID = '4ed12eq01o6n0tl5f0sqmkq2na';
const MAYTRONICS_BASE_URL = 'https://apps.maytronics.com';
const APP_KEY = '346BDE92-53D1-4829-8A2E-B496014B586C';
const REQUEST_TIMEOUT = 30000;
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes - Cognito sessions expire quickly

/**
 * Challenge type messages
 */
const CHALLENGE_MESSAGES = {
  SMS_MFA: 'Please enter the verification code sent to your phone',
  SOFTWARE_TOKEN_MFA: 'Please enter the code from your authenticator app',
  CUSTOM_CHALLENGE: 'Please enter the verification code sent to your email',
  MFA_SETUP: 'MFA setup required. Please complete setup in the MyDolphin app first.',
};

/**
 * HTTP client wrapper using native fetch
 */
class HttpClient {
  /**
   * Make a POST request to Cognito
   */
  static async cognitoRequest(target, payload) {
    const response = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok && response.status >= 500) {
      throw new Error(`Cognito service error: HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Make a request to Maytronics API
   */
  static async maytronicsRequest(endpoint, idToken, body = null) {
    const options = {
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'AppKey': APP_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    };

    if (body) {
      options.body = body;
    }

    const response = await fetch(`${MAYTRONICS_BASE_URL}${endpoint}`, options);

    if (!response.ok && response.status >= 500) {
      throw new Error(`Maytronics API error: HTTP ${response.status}`);
    }

    return response.json();
  }
}

/**
 * Cognito authentication service
 */
class CognitoAuthService {
  /**
   * Parse Cognito error response
   */
  static parseError(response) {
    if (!response.__type) {
      return null;
    }

    const errorMap = {
      NotAuthorizedException: 'Invalid email or password',
      UserNotFoundException: 'User not found. Please check your email address.',
      UserNotConfirmedException: 'Please confirm your email address first',
      CodeMismatchException: 'Invalid verification code',
      ExpiredCodeException: 'Verification code has expired. Please try again.',
    };

    for (const [errorType, message] of Object.entries(errorMap)) {
      if (response.__type.includes(errorType)) {
        return { success: false, error: message };
      }
    }

    return { success: false, error: response.message || 'Authentication failed' };
  }

  /**
   * Initiate CUSTOM_AUTH flow (triggers OTP)
   */
  static async initiateAuth(email) {
    const response = await HttpClient.cognitoRequest('InitiateAuth', {
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: email },
    });

    // Check for errors
    const error = this.parseError(response);
    if (error) {
      return error;
    }

    // Handle challenge (OTP required)
    if (response.ChallengeName) {
      return {
        success: false,
        requiresOtp: true,
        challengeName: response.ChallengeName,
        session: response.Session,
        message: CHALLENGE_MESSAGES[response.ChallengeName] || 'Please enter the verification code',
      };
    }

    // Direct success (rare with CUSTOM_AUTH)
    if (response.AuthenticationResult?.IdToken) {
      return {
        success: true,
        idToken: response.AuthenticationResult.IdToken,
        accessToken: response.AuthenticationResult.AccessToken,
        refreshToken: response.AuthenticationResult.RefreshToken,
      };
    }

    return { success: false, error: 'Unexpected authentication response' };
  }

  /**
   * Respond to auth challenge (OTP verification)
   */
  static async respondToChallenge(email, code, session, challengeName) {
    const challengeResponses = { USERNAME: email };

    // Set the appropriate response field based on challenge type
    const responseField = {
      SMS_MFA: 'SMS_MFA_CODE',
      SOFTWARE_TOKEN_MFA: 'SOFTWARE_TOKEN_MFA_CODE',
      CUSTOM_CHALLENGE: 'ANSWER',
    }[challengeName] || 'SMS_MFA_CODE';

    challengeResponses[responseField] = code;

    const response = await HttpClient.cognitoRequest('RespondToAuthChallenge', {
      ChallengeName: challengeName,
      ClientId: COGNITO_CLIENT_ID,
      Session: session,
      ChallengeResponses: challengeResponses,
    });

    // Check for errors
    const error = this.parseError(response);
    if (error) {
      return error;
    }

    // Another challenge (rare)
    if (response.ChallengeName) {
      return {
        success: false,
        requiresOtp: true,
        challengeName: response.ChallengeName,
        session: response.Session,
        message: CHALLENGE_MESSAGES[response.ChallengeName] || 'Please enter the verification code',
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
  }
}

/**
 * MyDolphin API service
 */
class MyDolphinService {
  /**
   * Authenticate with MyDolphin backend
   */
  static async authenticate(idToken) {
    const response = await HttpClient.maytronicsRequest(
      '/mobapi/user/authenticate-user/',
      idToken,
      '', // Empty body for POST
    );

    if (response.Status !== '1') {
      return { success: false, error: response.Alert || 'MyDolphin authentication failed' };
    }

    const data = response.Data;
    return {
      success: true,
      serialNumber: data.Sernum,
      robotName: data.MyRobotName || 'Dolphin Robot',
      deviceType: parseInt(data.connectVia, 10) || 62,
      mobToken: data.mob_token,
    };
  }

  /**
   * Get robot details including image URL
   */
  static async getRobotDetails(serialNumber, idToken) {
    const response = await HttpClient.maytronicsRequest(
      '/mobapi/serial-numbers/getRobotDetailsByRobotSN/',
      idToken,
      `SERNUM=${serialNumber}`,
    );

    if (response.Status !== '1') {
      return { success: false, error: response.Alert || 'Failed to get robot details' };
    }

    const data = response.Data;
    return {
      success: true,
      imageUrl: data.originalUrlImage || data.Originalmg,
      partName: data.PARTNAME,
      partDescription: data.PARTDES,
      robotFamily: data.RobotFamily,
      robotName: data.MyRobotName,
      warrantyDays: data.warranty_days,
      registrationDate: data.RegDate,
      truncatedSerial: data.eSERNUM,
    };
  }
}

/**
 * Homebridge UI Server for Dolphin plugin
 */
class DolphinUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();

    // Store pending auth sessions (email -> session data)
    this.pendingSessions = new Map();

    // Register request handlers
    this.onRequest('/authenticate', this.handleAuthenticate.bind(this));
    this.onRequest('/verify-otp', this.handleVerifyOtp.bind(this));
    this.onRequest('/get-robots', this.handleGetRobots.bind(this));
    this.onRequest('/test-connection', this.handleTestConnection.bind(this));

    this.ready();
  }

  /**
   * Handle authentication request
   * Initiates CUSTOM_AUTH flow with Cognito (triggers OTP)
   */
  async handleAuthenticate(payload) {
    const { email } = payload;

    if (!email) {
      return { success: false, error: 'Email is required' };
    }

    try {
      // Step 1: Initiate Cognito auth
      const cognitoResult = await CognitoAuthService.initiateAuth(email);

      // OTP required - store session and return
      if (cognitoResult.requiresOtp) {
        this.pendingSessions.set(email, {
          session: cognitoResult.session,
          challengeName: cognitoResult.challengeName,
          createdAt: Date.now(),
        });
        return cognitoResult;
      }

      if (!cognitoResult.success) {
        return cognitoResult;
      }

      // Step 2: Authenticate with MyDolphin
      return this.completeAuthentication(cognitoResult);
    } catch (error) {
      console.error('Authentication error:', error);
      return { success: false, error: error.message || 'Authentication failed' };
    }
  }

  /**
   * Handle OTP verification
   */
  async handleVerifyOtp(payload) {
    const { email, otpCode } = payload;

    if (!email || !otpCode) {
      return { success: false, error: 'Email and OTP code are required' };
    }

    // Clean up expired sessions
    this.cleanExpiredSessions();

    const session = this.pendingSessions.get(email);
    if (!session) {
      return { success: false, error: 'No pending authentication. Please try again.' };
    }

    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
      this.pendingSessions.delete(email);
      return { success: false, error: 'Session expired. Please try again.' };
    }

    try {
      // Respond to Cognito challenge
      const cognitoResult = await CognitoAuthService.respondToChallenge(
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

      // Complete authentication with MyDolphin
      const result = await this.completeAuthentication(cognitoResult);

      // Include tokens for plugin storage
      if (result.success) {
        result.idToken = cognitoResult.idToken;
        result.accessToken = cognitoResult.accessToken;
        result.refreshToken = cognitoResult.refreshToken;
      }

      return result;
    } catch (error) {
      console.error('OTP verification error:', error);
      return { success: false, error: error.message || 'OTP verification failed' };
    }
  }

  /**
   * Complete authentication by calling MyDolphin API
   */
  async completeAuthentication(cognitoResult) {
    const myDolphinResult = await MyDolphinService.authenticate(cognitoResult.idToken);

    if (!myDolphinResult.success) {
      return myDolphinResult;
    }

    // Try to fetch robot image
    let robotImageUrl = null;
    try {
      const details = await MyDolphinService.getRobotDetails(
        myDolphinResult.serialNumber,
        cognitoResult.idToken,
      );
      if (details.success) {
        robotImageUrl = details.imageUrl;
      }
    } catch (err) {
      console.log('Could not fetch robot image URL:', err.message);
    }

    return {
      success: true,
      serialNumber: myDolphinResult.serialNumber,
      robotName: myDolphinResult.robotName,
      deviceType: myDolphinResult.deviceType,
      robotImageUrl,
    };
  }

  /**
   * Get robot list for authenticated user
   */
  async handleGetRobots(payload) {
    const authResult = await this.handleAuthenticate(payload);

    if (!authResult.success) {
      return authResult;
    }

    return {
      success: true,
      robots: [{
        serialNumber: authResult.serialNumber,
        name: authResult.robotName,
        deviceType: authResult.deviceType,
      }],
    };
  }

  /**
   * Remove expired sessions from the pending sessions map
   */
  cleanExpiredSessions() {
    const now = Date.now();
    for (const [email, session] of this.pendingSessions) {
      if (now - session.createdAt > SESSION_TTL_MS) {
        this.pendingSessions.delete(email);
      }
    }
  }

  /**
   * Test connection to MyDolphin service
   */
  async handleTestConnection(payload) {
    const result = await this.handleAuthenticate(payload);

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
