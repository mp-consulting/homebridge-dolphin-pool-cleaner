/**
 * Unit tests for timer utilities
 */

import { describe, it, expect } from 'vitest';
import { unrefTimer } from '../../src/utils/timers.js';

describe('unrefTimer', () => {
  it('should release the event loop reference', () => {
    const timer = unrefTimer(setTimeout(() => undefined, 60_000));

    expect(timer.hasRef()).toBe(false);
    clearTimeout(timer);
  });

  it('should return the timer so it can still be cleared', () => {
    const timer = setTimeout(() => undefined, 60_000);

    expect(unrefTimer(timer)).toBe(timer);
    clearTimeout(timer);
  });

  it('should tolerate runtimes without unref', () => {
    const plainTimer = 42 as unknown as ReturnType<typeof setTimeout>;

    expect(() => unrefTimer(plainTimer)).not.toThrow();
  });
});
