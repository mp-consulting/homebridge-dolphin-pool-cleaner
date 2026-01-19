# Devices Module

Represents Dolphin pool cleaning robots and their capabilities.

## Files

### `dolphinDevice.ts`
Main device class representing a single robot.

- `DolphinDevice` class: State management and control interface
- Polls AWS IoT Thing Shadow for state updates
- Emits `stateChange` and `disconnect` events
- Provides control methods: `startCleaning()`, `stopCleaning()`, `setCleaningMode()`, `pickup()`
- Applies device-specific features (e.g., temperature sensor availability)

### `deviceCatalog.ts`
Device model definitions and feature detection.

- `getDeviceFeatures(deviceType)`: Returns capabilities for a device type
- `getDeviceModelName(deviceType)`: Returns human-readable model name
- Supports IoT-connected devices (M400/M600), BLE devices, and legacy models
- Feature flags: `hasTemperatureSensor`, `supportsPickup`, `supportedModes`

### `types.ts`
Re-exports commonly used types from parsers module.

- `ParsedRobotState`: Current robot state
- `FilterStatus`: Filter bag/cartridge status
- `FaultInfo`: Error/fault information
- `RawShadowState`: Unparsed AWS IoT shadow

## Device State

```typescript
interface ParsedRobotState {
  connected: boolean;
  isCleaning: boolean;
  cleaningMode: string;
  muState: number;           // Robot state code
  temperature?: number;      // Water temperature (if supported)
  filterStatus?: FilterStatus;
  faults: FaultInfo[];
  cycleStartTime?: Date;
  cycleEndTime?: Date;
}
```

## Usage

```typescript
import { DolphinDevice, getDeviceFeatures } from './devices';

const device = new DolphinDevice(config, api, log);
device.on('stateChange', (state) => {
  console.log('Cleaning:', state.isCleaning);
});

await device.start();  // Begin polling
await device.startCleaning('floor');
```
