/**
 * Unit tests for the shadow, filter and fault parsers
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import {
  parseShadowState,
  parseCleaningMode,
  getShadowVersion,
  createDefaultState,
  parseFilterStatus,
  parseLegacyFilterStatus,
  parseAllFaults,
  parseFaultsHexString,
  isCurrentSessionError,
  isRealErrorCode,
  type RawShadowState,
} from '../../src/parsers/index.js';

const loadFixture = (name: string): RawShadowState =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('parseShadowState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should parse an idle robot', () => {
    const state = parseShadowState(loadFixture('sample-shadow-response.json'));

    expect(state).toMatchObject({
      connected: true,
      isCleaning: false,
      cleaningMode: 'all',
      nextCycleMode: 'all',
      cycleTime: 150,
      filterStatus: 'ok',
    });
  });

  it('should parse a cleaning robot with a full filter', () => {
    const state = parseShadowState(loadFixture('sample-shadow-cleaning.json'));

    expect(state.isCleaning).toBe(true);
    expect(state.filterStatus).toBe('needs_cleaning');
  });

  it('should ignore a robot error left over from an earlier session', () => {
    // The fixture's robotError has turnOnCount 645, the robot is on its 656th run
    const state = parseShadowState(loadFixture('sample-shadow-cleaning.json'));

    expect(state.faultCode).toBeUndefined();
  });

  it('should keep a known filter status when a partial push omits it', () => {
    const full = parseShadowState({ version: 1, state: { reported: { filterBagIndication: { state: 95 } } } });
    const afterPush = parseShadowState(
      { version: 2, state: { reported: { inwatTemperature: { temperature: 24 } } } },
      full,
    );

    expect(afterPush.filterStatus).toBe('needs_cleaning');
    expect(afterPush.temperature).toBe(24);
  });

  it('should leave the state untouched for a desired-only document', () => {
    const existing = { ...createDefaultState(), isCleaning: true, filterStatus: 'needs_cleaning' as const };

    const state = parseShadowState({ version: 9, state: { desired: { systemState: { pwsState: 'off' } } } }, existing);

    expect(state).toEqual(existing);
  });

  it('should return defaults for invalid input', () => {
    expect(parseShadowState(null)).toEqual(createDefaultState());
    expect(parseShadowState('garbage')).toEqual(createDefaultState());
  });

  it('should mark a cycle that started recently as cleaning', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const startedTenMinutesAgo = Math.floor(Date.now() / 1000) - 600;

    const state = parseShadowState({
      state: { reported: { cycleInfo: { cycleStartTimeUTC: startedTenMinutesAgo, cleaningMode: { cycleTime: 120 } } } },
    });

    expect(state.isCleaning).toBe(true);
    expect(state.cycleTimeRemaining).toBeCloseTo(110);
  });

  it('should parse the legacy BLE format', () => {
    const state = parseShadowState({
      state: { reported: { mu_state: 0x03, cleaning_mode: 2, temperature: 255, filter_state: 1, faults: '04' } },
    });

    expect(state).toMatchObject({
      isCleaning: true,
      cleaningMode: 'floor',
      temperature: 25.5,
      filterStatus: 'needs_cleaning',
      faultCode: 4,
      faultDescription: 'Filter blocked',
    });
  });
});

describe('parseCleaningMode', () => {
  it.each([
    ['regular', 'all'],
    ['Standard', 'all'],
    ['fast', 'short'],
    ['walls', 'wall'],
    ['waterline', 'water'],
    ['cove', 'cove'],
    [7, 'spot'],
    [99, 'all'],
    [undefined, 'all'],
  ])('should map %s to %s', (input, expected) => {
    expect(parseCleaningMode(input)).toBe(expected);
  });
});

describe('getShadowVersion', () => {
  it('should read the version, or undefined when absent', () => {
    expect(getShadowVersion({ version: 4 })).toBe(4);
    expect(getShadowVersion({})).toBeUndefined();
    expect(getShadowVersion(undefined)).toBeUndefined();
  });
});

describe('parseFilterStatus', () => {
  it.each([
    [{ state: 81 }, 'needs_cleaning'],
    [{ state: 80 }, 'ok'],
    [{ filterState: 'Dirty' }, 'needs_cleaning'],
    [{ filterState: 'clean' }, 'ok'],
    [{ filterLevel: 2 }, 'needs_cleaning'],
    [{ filterLevel: 0 }, 'ok'],
    [{}, 'ok'],
  ])('should read %j as %s', (data, expected) => {
    expect(parseFilterStatus(data)).toBe(expected);
  });

  it('should return undefined when the shadow has no filter data', () => {
    expect(parseFilterStatus(undefined, undefined)).toBeUndefined();
  });

  it('should fall back to filterIndicator', () => {
    expect(parseFilterStatus(undefined, { filterState: 'full' })).toBe('needs_cleaning');
  });

  it('should parse the legacy numeric state', () => {
    expect(parseLegacyFilterStatus(undefined)).toBe('ok');
    expect(parseLegacyFilterStatus(0)).toBe('ok');
    expect(parseLegacyFilterStatus(3)).toBe('needs_cleaning');
  });
});

describe('fault parsing', () => {
  it('should treat 0, 255 and 65535 as no error', () => {
    expect([0, 255, 65535, undefined].map(isRealErrorCode)).toEqual([false, false, false, false]);
    expect(isRealErrorCode(2)).toBe(true);
  });

  it('should only report errors from the current session', () => {
    expect(isCurrentSessionError(10, 10)).toBe(true);
    expect(isCurrentSessionError(9, 10)).toBe(false);
    expect(isCurrentSessionError(undefined, 10)).toBe(true);
    expect(isCurrentSessionError(65535, 10)).toBe(true);
  });

  it('should prefer the robot error over the power supply error', () => {
    const fault = parseAllFaults(
      { errorCode: 2, turnOnCount: 10 },
      { errorCode: 6, turnOnCount: 10 },
      undefined,
      { rTurnOnCount: 10 },
    );

    expect(fault).toMatchObject({ code: 2, description: 'Robot out of water' });
  });

  it('should report a stale robot error while the power supply is in error', () => {
    const fault = parseAllFaults({ errorCode: 1, turnOnCount: 3 }, undefined, undefined, { rTurnOnCount: 10, pwsState: 'error' });

    expect(fault?.code).toBe(1);
  });

  it('should fall back to the power supply, then the legacy codes', () => {
    expect(parseAllFaults(undefined, { errorCode: 6 }, undefined, undefined)?.description).toBe('Overheating');
    expect(parseAllFaults(undefined, undefined, { faultCode: 42, faultDescription: 'Custom' }, undefined)).toMatchObject({
      code: 42,
      description: 'Custom',
    });
    expect(parseAllFaults(undefined, undefined, undefined, undefined)).toBeUndefined();
  });

  it('should parse the legacy hex string', () => {
    expect(parseFaultsHexString('00')).toBeUndefined();
    expect(parseFaultsHexString('99')?.description).toBe('Unknown fault (153)');
    expect(parseFaultsHexString(undefined)).toBeUndefined();
  });
});
