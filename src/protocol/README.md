# Protocol Module

BLE command protocol for communicating with Dolphin robots via AWS IoT.

## Files

### `commandBuilder.ts`
Builds BLE command packets from command definitions.

- `buildCommand(commandName, data?)`: Creates a complete BLE command packet
- `calculateChecksum(message)`: Computes XOR checksum for packet validation
- Validates commands exist before building
- Returns command with topic suffix for MQTT publishing

### `ble_commands_iot.json`
Command definitions mapping names to BLE protocol details.

Contains definitions for:
- `turnOnRobot` / `turnOffRobot`: Power control
- `setMode_*`: Cleaning mode selection (floor, wall, all, etc.)
- `getWifiList` / `resetWifi`: Network configuration
- `getRobotStatus`: State queries

Each command includes:
- `command_code`: Hex identifier
- `group_id`: Command category
- `data`: Optional payload template

### `types.ts`
TypeScript interfaces for protocol structures.

- `BLECommand`: Raw command definition from JSON
- `CommandDefinition`: Parsed command with metadata
- `BuiltCommand`: Ready-to-send command with topic

## Command Packet Structure

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│  Header │ Group   │ Command │  Data   │Checksum │
│  (AA)   │   ID    │  Code   │ (var)   │  (XOR)  │
└─────────┴─────────┴─────────┴─────────┴─────────┘
```

- Header: Always `0xAA`
- Checksum: XOR of all bytes

## Usage

```typescript
import { buildCommand } from './protocol';

const cmd = buildCommand('turnOnRobot');
// Returns: { command: 'AA0501...', topicSuffix: 'robot/bdi' }

const modeCmd = buildCommand('setMode_floor');
// Sets cleaning mode to floor-only
```

## MQTT Topics

Commands are published to:
```
$aws/things/{serialNumber}/shadow/name/{topicSuffix}
```

Common topic suffixes:
- `robot/bdi`: Robot control commands
- `wifi`: Network configuration
