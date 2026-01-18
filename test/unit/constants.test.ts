/**
 * Unit tests for constants and configuration
 */

import { describe, it, expect } from 'vitest';
import {
  MAYTRONICS_API,
  COGNITO,
  IOT_ENDPOINTS,
  DEFAULT_IOT_REGION,
  ROBOT_STATES,
  PWS_STATES,
  CLEANING_MODES,
  CREDENTIAL_REFRESH_BUFFER_MS,
} from '../../src/config/constants.js';

describe('Constants', () => {
  describe('MAYTRONICS_API', () => {
    it('should have valid base URL', () => {
      expect(MAYTRONICS_API.BASE_URL).toBeDefined();
      expect(MAYTRONICS_API.BASE_URL).toMatch(/^https?:\/\//);
    });

    it('should have app key', () => {
      expect(MAYTRONICS_API.APP_KEY).toBeDefined();
      expect(MAYTRONICS_API.APP_KEY.length).toBeGreaterThan(0);
    });

    it('should have user agent', () => {
      expect(MAYTRONICS_API.USER_AGENT).toBeDefined();
      expect(MAYTRONICS_API.USER_AGENT).toContain('MyDolphin');
    });
  });

  describe('COGNITO', () => {
    it('should have region', () => {
      expect(COGNITO.REGION).toBeDefined();
      expect(COGNITO.REGION).toMatch(/^[a-z]{2}-[a-z]+-\d$/);
    });

    it('should have client ID', () => {
      expect(COGNITO.CLIENT_ID).toBeDefined();
      expect(COGNITO.CLIENT_ID.length).toBeGreaterThan(0);
    });

    it('should have user pool ID', () => {
      expect(COGNITO.USER_POOL_ID).toBeDefined();
      expect(COGNITO.USER_POOL_ID).toContain('_');
    });
  });

  describe('IOT_ENDPOINTS', () => {
    it('should have EU West 1 endpoint', () => {
      expect(IOT_ENDPOINTS['eu-west-1']).toBeDefined();
      expect(IOT_ENDPOINTS['eu-west-1']).toContain('.iot.eu-west-1.amazonaws.com');
    });

    it('should have EU Central 1 endpoint', () => {
      expect(IOT_ENDPOINTS['eu-central-1']).toBeDefined();
      expect(IOT_ENDPOINTS['eu-central-1']).toContain('.iot.eu-central-1.amazonaws.com');
    });

    it('should have US East 2 endpoint', () => {
      expect(IOT_ENDPOINTS['us-east-2']).toBeDefined();
      expect(IOT_ENDPOINTS['us-east-2']).toContain('.iot.us-east-2.amazonaws.com');
    });
  });

  describe('DEFAULT_IOT_REGION', () => {
    it('should be a valid region', () => {
      expect(DEFAULT_IOT_REGION).toBeDefined();
      expect(Object.keys(IOT_ENDPOINTS)).toContain(DEFAULT_IOT_REGION);
    });
  });

  describe('ROBOT_STATES', () => {
    it('should have OFF state', () => {
      expect(ROBOT_STATES.OFF).toBeDefined();
      expect(typeof ROBOT_STATES.OFF).toBe('number');
    });

    it('should have CLEANING state', () => {
      expect(ROBOT_STATES.CLEANING).toBeDefined();
      expect(typeof ROBOT_STATES.CLEANING).toBe('number');
    });

    it('should have INIT state', () => {
      expect(ROBOT_STATES.INIT).toBeDefined();
      expect(typeof ROBOT_STATES.INIT).toBe('number');
    });

    it('should have FAULT state', () => {
      expect(ROBOT_STATES.FAULT).toBeDefined();
      expect(typeof ROBOT_STATES.FAULT).toBe('number');
    });
  });

  describe('PWS_STATES', () => {
    it('should have OFF state', () => {
      expect(PWS_STATES.OFF).toBeDefined();
      expect(typeof PWS_STATES.OFF).toBe('number');
    });

    it('should have IDLE state', () => {
      expect(PWS_STATES.IDLE).toBeDefined();
      expect(typeof PWS_STATES.IDLE).toBe('number');
    });

    it('should have CLEANING state', () => {
      expect(PWS_STATES.CLEANING).toBeDefined();
      expect(typeof PWS_STATES.CLEANING).toBe('number');
    });

    it('should have PROGRAMMING state', () => {
      expect(PWS_STATES.PROGRAMMING).toBeDefined();
      expect(typeof PWS_STATES.PROGRAMMING).toBe('number');
    });
  });

  describe('CLEANING_MODES', () => {
    it('should have regular mode', () => {
      expect(CLEANING_MODES.regular).toBeDefined();
      expect(CLEANING_MODES.regular.name).toBe('All Surfaces');
    });

    it('should have short mode', () => {
      expect(CLEANING_MODES.short).toBeDefined();
      expect(CLEANING_MODES.short.name).toBe('Fast Mode');
    });

    it('should have floor mode', () => {
      expect(CLEANING_MODES.floor).toBeDefined();
      expect(CLEANING_MODES.floor.name).toBe('Floor Only');
    });

    it('should have wall mode', () => {
      expect(CLEANING_MODES.wall).toBeDefined();
      expect(CLEANING_MODES.wall.name).toBe('Walls Only');
    });

    it('should have water mode', () => {
      expect(CLEANING_MODES.water).toBeDefined();
      expect(CLEANING_MODES.water.name).toBe('Waterline');
    });

    it('all modes should have duration', () => {
      Object.values(CLEANING_MODES).forEach((mode) => {
        expect(mode.duration).toBeDefined();
        expect(mode.duration).toBeGreaterThan(0);
      });
    });

    it('all modes should have value', () => {
      Object.values(CLEANING_MODES).forEach((mode) => {
        expect(mode.value).toBeDefined();
        expect(typeof mode.value).toBe('number');
      });
    });
  });

  describe('CREDENTIAL_REFRESH_BUFFER_MS', () => {
    it('should be a positive number', () => {
      expect(CREDENTIAL_REFRESH_BUFFER_MS).toBeGreaterThan(0);
    });

    it('should be at least 5 minutes', () => {
      expect(CREDENTIAL_REFRESH_BUFFER_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
    });
  });
});
