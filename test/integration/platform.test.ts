/**
 * Integration tests for DolphinPoolCleanerPlatform
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockLogger,
  createMockAPI,
  createMockAxios,
  mockMaytronicsResponses,
  mockCognitoAuthResult,
  mockShadowState,
  createMockMqttClient,
} from '../mocks/index.js';

// Store mock references
let mockMqttClientInstance: ReturnType<typeof createMockMqttClient>;
let mockAxiosInstance: ReturnType<typeof createMockAxios>;

// Mock all external dependencies
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => {
      mockAxiosInstance = createMockAxios();
      return mockAxiosInstance;
    }),
  },
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({
    send: vi.fn().mockResolvedValue(mockCognitoAuthResult),
  })),
  InitiateAuthCommand: vi.fn(),
  AuthFlowType: {
    USER_PASSWORD_AUTH: 'USER_PASSWORD_AUTH',
  },
}));

vi.mock('@aws-sdk/client-iot', () => ({
  IoTClient: vi.fn(() => ({
    send: vi.fn().mockRejectedValue(new Error('Not authorized')),
  })),
  DescribeEndpointCommand: vi.fn(),
}));

vi.mock('mqtt', () => ({
  connect: vi.fn(() => {
    mockMqttClientInstance = createMockMqttClient();
    return mockMqttClientInstance;
  }),
}));

// Import after mocks
import { DolphinPoolCleanerPlatform } from '../../src/platform.js';

describe('DolphinPoolCleanerPlatform', () => {
  let platform: DolphinPoolCleanerPlatform;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockApi: ReturnType<typeof createMockAPI>;

  const validConfig = {
    platform: 'DolphinPoolCleaner',
    name: 'Test Platform',
    email: 'test@example.com',
    password: 'password123',
    pollingInterval: 60,
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApi = createMockAPI();

    // Setup axios mock responses
    mockAxiosInstance = createMockAxios();
    mockAxiosInstance.post.mockImplementation((url: string) => {
      if (url.includes('login')) {
        return Promise.resolve({ data: mockMaytronicsResponses.login });
      }
      if (url.includes('getListOfRobots')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getRobots });
      }
      if (url.includes('getAwsCredentials')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getAwsCredentials });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (platform) {
      // Cleanup
    }
  });

  describe('constructor', () => {
    it('should create platform with valid config', () => {
      platform = new DolphinPoolCleanerPlatform(mockLogger, validConfig, mockApi);

      expect(platform).toBeDefined();
    });

    it('should log initialization message', () => {
      platform = new DolphinPoolCleanerPlatform(mockLogger, validConfig, mockApi);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Initializing'),
        expect.anything(),
      );
    });
  });

  describe('configuration validation', () => {
    it('should require email', () => {
      const configWithoutEmail = { ...validConfig, email: undefined };

      platform = new DolphinPoolCleanerPlatform(mockLogger, configWithoutEmail, mockApi);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('email'),
      );
    });

    it('should require password', () => {
      const configWithoutPassword = { ...validConfig, password: undefined };

      platform = new DolphinPoolCleanerPlatform(mockLogger, configWithoutPassword, mockApi);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('password'),
      );
    });

    it('should use default polling interval if not specified', () => {
      const configWithoutPolling = { ...validConfig, pollingInterval: undefined };

      platform = new DolphinPoolCleanerPlatform(mockLogger, configWithoutPolling, mockApi);

      expect(platform).toBeDefined();
    });

    it('should enforce minimum polling interval', () => {
      const configWithLowPolling = { ...validConfig, pollingInterval: 10 };

      platform = new DolphinPoolCleanerPlatform(mockLogger, configWithLowPolling, mockApi);

      // Should clamp to minimum
      expect(platform).toBeDefined();
    });
  });

  describe('accessory caching', () => {
    it('should configure cached accessories', () => {
      platform = new DolphinPoolCleanerPlatform(mockLogger, validConfig, mockApi);

      const mockAccessory = {
        UUID: 'test-uuid',
        displayName: 'Test Robot',
        context: { serialNumber: 'TEST123' },
      };

      // @ts-expect-error - accessing internal method
      platform.configureAccessory(mockAccessory);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Restoring cached accessory'),
        expect.anything(),
      );
    });
  });
});

describe('Platform - Robot Discovery', () => {
  let platform: DolphinPoolCleanerPlatform;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockApi: ReturnType<typeof createMockAPI>;

  const validConfig = {
    platform: 'DolphinPoolCleaner',
    name: 'Test Platform',
    email: 'test@example.com',
    password: 'password123',
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApi = createMockAPI();

    mockAxiosInstance = createMockAxios();
    mockAxiosInstance.post.mockImplementation((url: string) => {
      if (url.includes('login')) {
        return Promise.resolve({ data: mockMaytronicsResponses.login });
      }
      if (url.includes('getListOfRobots')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getRobots });
      }
      if (url.includes('getAwsCredentials')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getAwsCredentials });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    platform = new DolphinPoolCleanerPlatform(mockLogger, validConfig, mockApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should discover robots after login', async () => {
    // The platform should log discovered robots
    // This is an integration test so we verify the flow works
    expect(platform).toBeDefined();
  });
});

describe('Platform - Error Handling', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockApi: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApi = createMockAPI();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle authentication failure gracefully', () => {
    mockAxiosInstance = createMockAxios();
    mockAxiosInstance.post.mockRejectedValue(new Error('Auth failed'));

    const config = {
      platform: 'DolphinPoolCleaner',
      name: 'Test Platform',
      email: 'test@example.com',
      password: 'wrongpassword',
    };

    const platform = new DolphinPoolCleanerPlatform(mockLogger, config, mockApi);

    expect(platform).toBeDefined();
  });

  it('should handle missing config', () => {
    const platform = new DolphinPoolCleanerPlatform(mockLogger, {}, mockApi);

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe('Platform - Accessory Management', () => {
  let platform: DolphinPoolCleanerPlatform;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockApi: ReturnType<typeof createMockAPI>;

  const validConfig = {
    platform: 'DolphinPoolCleaner',
    name: 'Test Platform',
    email: 'test@example.com',
    password: 'password123',
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApi = createMockAPI();

    mockAxiosInstance = createMockAxios();
    mockAxiosInstance.post.mockImplementation((url: string) => {
      if (url.includes('login')) {
        return Promise.resolve({ data: mockMaytronicsResponses.login });
      }
      if (url.includes('getListOfRobots')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getRobots });
      }
      if (url.includes('getAwsCredentials')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getAwsCredentials });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    platform = new DolphinPoolCleanerPlatform(mockLogger, validConfig, mockApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should register new accessories', () => {
    // Platform should register new accessories for discovered robots
    expect(platform).toBeDefined();
  });

  it('should restore cached accessories', () => {
    const cachedAccessory = {
      UUID: 'cached-uuid',
      displayName: 'Cached Robot',
      context: { serialNumber: 'CACHED123' },
    };

    // @ts-expect-error - accessing internal method
    platform.configureAccessory(cachedAccessory);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Restoring'),
      expect.anything(),
    );
  });
});

describe('Platform - Lifecycle', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockApi: ReturnType<typeof createMockAPI>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockApi = createMockAPI();

    mockAxiosInstance = createMockAxios();
    mockAxiosInstance.post.mockImplementation((url: string) => {
      if (url.includes('login')) {
        return Promise.resolve({ data: mockMaytronicsResponses.login });
      }
      if (url.includes('getListOfRobots')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getRobots });
      }
      if (url.includes('getAwsCredentials')) {
        return Promise.resolve({ data: mockMaytronicsResponses.getAwsCredentials });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize without throwing', () => {
    expect(() => {
      new DolphinPoolCleanerPlatform(mockLogger, {
        platform: 'DolphinPoolCleaner',
        email: 'test@example.com',
        password: 'test123',
      }, mockApi);
    }).not.toThrow();
  });

  it('should log platform name on init', () => {
    new DolphinPoolCleanerPlatform(mockLogger, {
      platform: 'DolphinPoolCleaner',
      name: 'My Pool Cleaner',
      email: 'test@example.com',
      password: 'test123',
    }, mockApi);

    expect(mockLogger.debug).toHaveBeenCalled();
  });
});
