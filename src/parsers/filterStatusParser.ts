/**
 * Filter Status Parser
 *
 * Parses filter status from various shadow formats.
 */
import type { FilterData, FilterStatus } from './types.js';
import { FILTER_NEEDS_CLEANING_THRESHOLD } from '../config/constants.js';

/**
 * Parse filter status from shadow data
 *
 * Handles multiple formats:
 * 1. filterBagIndication: { state: number (0-100), resetFBI: boolean }
 * 2. filterIndicator: { filterState: string, filterLevel: number }
 * 3. Legacy: filter_state: number (0 = clean, >0 = needs cleaning)
 *
 * @param filterBagData - filterBagIndication data from shadow
 * @param filterIndicatorData - filterIndicator data from shadow
 * @returns Filter status
 */
export function parseFilterStatus(
  filterBagData?: FilterData,
  filterIndicatorData?: FilterData,
): FilterStatus {
  const filterData = filterBagData || filterIndicatorData;

  if (!filterData) {
    return 'ok';
  }

  // Check for numeric state (0-100 percentage)
  const numericState = filterData.state;
  if (numericState !== undefined) {
    // Numeric state: 0-100 where higher means filter is fuller
    // Consider > threshold as needs cleaning
    return numericState > FILTER_NEEDS_CLEANING_THRESHOLD ? 'needs_cleaning' : 'ok';
  }

  // Check for string filterState
  const filterState = filterData.filterState;
  if (filterState) {
    const stateStr = filterState.toLowerCase();
    if (stateStr === 'clean' || stateStr === 'ok') {
      return 'ok';
    }
    if (stateStr === 'dirty' || stateStr === 'needs_cleaning' || stateStr === 'full') {
      return 'needs_cleaning';
    }
  }

  // Check for filterLevel
  const filterLevel = filterData.filterLevel;
  if (filterLevel !== undefined) {
    // filterLevel: 0 = clean, higher = needs cleaning
    return filterLevel > 0 ? 'needs_cleaning' : 'ok';
  }

  return 'ok';
}

/**
 * Parse legacy filter state (numeric)
 *
 * @param filterState - Numeric filter state (0 = clean, >0 = dirty)
 * @returns Filter status
 */
export function parseLegacyFilterStatus(filterState?: number): FilterStatus {
  if (filterState === undefined) {
    return 'ok';
  }
  return filterState > 0 ? 'needs_cleaning' : 'ok';
}

/**
 * Convert filter status to numeric representation
 *
 * @param status - Filter status
 * @returns 0 for ok, 1 for needs_cleaning
 */
export function filterStatusToNumber(status: FilterStatus): number {
  return status === 'needs_cleaning' ? 1 : 0;
}

/**
 * Check if filter needs cleaning
 *
 * @param status - Filter status
 * @returns true if filter needs cleaning
 */
export function filterNeedsCleaning(status: FilterStatus): boolean {
  return status === 'needs_cleaning';
}
