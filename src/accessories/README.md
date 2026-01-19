# Accessories Module

Homebridge accessory implementation for Dolphin robots.

## Files

### `dolphinAccessory.ts`
Main HomeKit accessory class.

- `DolphinAccessory` class: Bridges Dolphin device to HomeKit
- Creates and manages HomeKit services:
  - **Switch**: Main power/cleaning control
  - **TemperatureSensor**: Water temperature (if supported)
  - **FilterMaintenance**: Filter bag status
  - **OccupancySensor**: Fault indicator
- Handles characteristic get/set operations
- Listens to device state changes and updates HomeKit

### `index.ts`
Barrel export for the module.

## HomeKit Services

```
┌───────────────────────────────────────────────┐
│              DolphinAccessory                 │
├───────────────────────────────────────────────┤
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │   Switch    │  │  TemperatureSensor   │   │
│  │ (cleaning)  │  │  (water temp)        │   │
│  └─────────────┘  └──────────────────────┘   │
│                                               │
│  ┌─────────────────┐  ┌─────────────────┐    │
│  │FilterMaintenance│  │ OccupancySensor │    │
│  │  (filter bag)   │  │   (faults)      │    │
│  └─────────────────┘  └─────────────────┘    │
└───────────────────────────────────────────────┘
```

## Characteristic Mapping

| HomeKit Characteristic | Robot State |
|------------------------|-------------|
| Switch.On | `isCleaning` |
| TemperatureSensor.CurrentTemperature | `temperature` |
| FilterMaintenance.FilterChangeIndication | `filterStatus.bagFull` |
| OccupancySensor.OccupancyDetected | `faults.length > 0` |

## Usage

```typescript
import { DolphinAccessory } from './accessories';

// Created by platform during device discovery
const accessory = new DolphinAccessory(platform, platformAccessory, device);
```

The accessory is typically instantiated by `DolphinPlatform` when devices are discovered, not directly by user code.
