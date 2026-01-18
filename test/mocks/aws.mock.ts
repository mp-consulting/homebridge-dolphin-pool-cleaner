/**
 * Mock AWS SDK services for testing
 */

import { vi } from 'vitest';

/**
 * Mock Cognito authentication response
 */
export const mockCognitoAuthResult = {
  AuthenticationResult: {
    AccessToken: 'mock-access-token',
    IdToken: 'mock-id-token',
    RefreshToken: 'mock-refresh-token',
    ExpiresIn: 3600,
    TokenType: 'Bearer',
  },
};

/**
 * Mock Cognito challenge response (for OTP)
 */
export const mockCognitoChallengeResult = {
  ChallengeName: 'CUSTOM_CHALLENGE',
  Session: 'mock-session-id',
  ChallengeParameters: {
    USERNAME: 'test@example.com',
  },
};

/**
 * Create mock Cognito client
 */
export function createMockCognitoClient() {
  return {
    send: vi.fn().mockResolvedValue(mockCognitoAuthResult),
  };
}

/**
 * Create mock IoT client
 */
export function createMockIoTClient() {
  return {
    send: vi.fn().mockResolvedValue({
      endpointAddress: 'mock-iot-endpoint.iot.eu-west-1.amazonaws.com',
    }),
  };
}

/**
 * Mock Maytronics API responses
 */
export const mockMaytronicsResponses = {
  login: {
    Data: {
      access_token: 'mock-maytronics-token',
      refresh_token: 'mock-maytronics-refresh-token',
      awsUserId: 'mock-aws-user-id',
    },
  },

  getRobots: {
    Data: [
      {
        robot_serial_number: 'E3086OFG2M',
        robot_name: 'Dolphin M400',
        pws_serial_number: 'PWS123456',
        motor_unit_serial_number: 'MU123456',
        device_type: 62,
        iot_region: 'eu-west-1',
      },
    ],
  },

  getAwsCredentials: {
    Status: '1',
    Data: {
      AccessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      SecretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      Token: 'mock-session-token',
      TokenExpiration: new Date(Date.now() + 3600000).toISOString(),
      TokenExpirationMilliseconds: String(Date.now() + 3600000),
    },
  },
};

/**
 * Mock Thing Shadow state
 */
export const mockShadowState = {
  state: {
    reported: {
      isConnected: {
        connected: true,
      },
      systemState: {
        pwsState: 'idle',
        robotState: 'idle',
        robotType: 'M5',
        isBusy: false,
        timeZone: 60,
        timeZoneName: 'Europe/Paris',
      },
      cycleInfo: {
        cleaningMode: {
          cycleTime: 150,
          mode: 'all',
        },
        cycleStartTime: 0,
        cycleStartTimeUTC: 0,
      },
      filterBagIndication: {
        state: 30,
        resetFBI: false,
      },
      robotError: {
        errorCode: 0,
        pcbHours: 100,
        turnOnCount: 50,
      },
      pwsError: {
        errorCode: 255,
      },
      cleaningModes: {
        all: 150,
        short: 60,
        floor: 150,
        wall: 120,
        water: 150,
        ultra: 150,
        cove: 120,
        spot: 120,
      },
      versions: {
        sysVersion: 2,
        pwsVersion: {
          pwsHwVersion: '00',
          pwsSwVersion: '4.5020',
        },
        robotVersion: {
          muHwVersion: '21',
          muSwVersion: '9EAC',
        },
      },
      wifi: {
        netName: 'TestNetwork',
      },
      debug: {
        WIFI_RSSI: -55,
      },
    },
  },
  metadata: {},
  version: 12345,
  timestamp: Date.now() / 1000,
};

/**
 * Create mock shadow state for cleaning robot
 */
export function createMockCleaningShadow(): typeof mockShadowState {
  const now = Math.floor(Date.now() / 1000);
  return {
    ...mockShadowState,
    state: {
      reported: {
        ...mockShadowState.state.reported,
        systemState: {
          ...mockShadowState.state.reported.systemState,
          pwsState: 'cleaning',
          robotState: 'cleaning',
          isBusy: true,
        },
        cycleInfo: {
          cleaningMode: {
            cycleTime: 150,
            mode: 'all',
          },
          cycleStartTime: now - 1800, // Started 30 min ago
          cycleStartTimeUTC: now - 1800,
        },
      },
    },
  };
}

/**
 * Create mock shadow state with error
 */
export function createMockErrorShadow(errorCode: number): typeof mockShadowState {
  return {
    ...mockShadowState,
    state: {
      reported: {
        ...mockShadowState.state.reported,
        robotError: {
          ...mockShadowState.state.reported.robotError,
          errorCode,
        },
      },
    },
  };
}

/**
 * Create mock shadow state with dirty filter
 */
export function createMockDirtyFilterShadow(): typeof mockShadowState {
  return {
    ...mockShadowState,
    state: {
      reported: {
        ...mockShadowState.state.reported,
        filterBagIndication: {
          state: 95, // 95% full
          resetFBI: false,
        },
      },
    },
  };
}

/**
 * Create mock axios instance
 */
export function createMockAxios() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn(), eject: vi.fn() },
      response: { use: vi.fn(), eject: vi.fn() },
    },
  };
}
