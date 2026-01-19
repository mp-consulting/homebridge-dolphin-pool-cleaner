# Parsers Module

Parses AWS IoT Thing Shadow data into structured robot state.

## Files

### `shadowStateParser.ts`
Main parser for AWS IoT Thing Shadow data.

- `parseShadowState(shadow, existingState)`: Parses raw shadow into `ParsedRobotState`
- `createDefaultState()`: Returns default state for initialization
- `getShadowVersion(shadow)`: Extracts shadow version for change detection
- Handles both new IoT format and legacy BLE format automatically

### `filterStatusParser.ts`
Parses filter bag/cartridge status from shadow data.

- `parseFilterStatus(reported)`: Extracts filter information
- Handles 3 different data formats across device generations
- Returns `FilterStatus` with bag full indicator and cycle info

### `faultCodeParser.ts`
Detects and parses robot fault conditions.

- `parseFaultCodes(reported)`: Extracts all active faults
- `hasCriticalFault(faults)`: Checks for blocking errors
- Maps numeric fault codes to human-readable descriptions
- Fault categories: motor, sensor, communication, filter

### `types.ts`
TypeScript interfaces for parser inputs/outputs.

- `RawShadowState`: Unparsed shadow with `state.reported`
- `ParsedRobotState`: Fully parsed robot state
- `FilterStatus`: Filter condition information
- `FaultInfo`: Individual fault with code and description

## Shadow Formats

The parser handles two shadow formats:

**New IoT Format** (M400/M600):
```json
{
  "state": {
    "reported": {
      "systemState": { "pwsState": 5, "robotState": 1 },
      "equipment": { "robot": { "cycleInfo": {...} } }
    }
  }
}
```

**Legacy BLE Format**:
```json
{
  "state": {
    "reported": {
      "localTim": 1234567890,
      "cycleInf": { "mode": "all", "state": 5 }
    }
  }
}
```

## Usage

```typescript
import { parseShadowState, createDefaultState } from './parsers';

let state = createDefaultState();
state = parseShadowState(rawShadow, state);

console.log('Cleaning:', state.isCleaning);
console.log('Mode:', state.cleaningMode);
```
