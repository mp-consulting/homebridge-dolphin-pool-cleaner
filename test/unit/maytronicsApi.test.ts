/**
 * Unit tests for MaytronicsAPI
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockLogger } from '../mocks/index.js';

// We test the API at a higher level since it requires complex AWS SDK mocking
describe('MaytronicsAPI', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should be importable', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      expect(MaytronicsAPI).toBeDefined();
    });

    it('should create an instance with required parameters', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(api).toBeDefined();
    });

    it('should accept custom region', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger, 'us-east-2');
      expect(api).toBeDefined();
    });

    it('should accept refresh token', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI(
        'test@example.com',
        'password123',
        mockLogger,
        'eu-west-1',
        'existing-refresh-token',
      );
      expect(api).toBeDefined();
    });
  });

  describe('methods', () => {
    it('should have login method', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(typeof api.login).toBe('function');
    });

    it('should have getRobots method', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(typeof api.getRobots).toBe('function');
    });

    it('should have getThingShadow method', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(typeof api.getThingShadow).toBe('function');
    });

    it('should have startRobot method', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(typeof api.startRobot).toBe('function');
    });

    it('should have stopRobot method', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);
      expect(typeof api.stopRobot).toBe('function');
    });
  });

  describe('getRobots', () => {
    it('should return empty array when not logged in', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);

      // getRobots returns empty array when mobToken is not set
      const robots = await api.getRobots();
      expect(Array.isArray(robots)).toBe(true);
      expect(robots).toHaveLength(0);
    });
  });

  describe('getThingShadow', () => {
    it('should throw when called before login', async () => {
      const { MaytronicsAPI } = await import('../../src/api/maytronicsApi.js');
      const api = new MaytronicsAPI('test@example.com', 'password123', mockLogger);

      await expect(api.getThingShadow('SERIAL123')).rejects.toThrow();
    });
  });
});
