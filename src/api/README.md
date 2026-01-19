# API Module

Handles all communication with the Maytronics cloud services.

## Files

### `maytronicsApi.ts`
Main API client that orchestrates authentication and robot control.

- `MaytronicsAPI` class: Entry point for all cloud operations
- Manages MQTT client lifecycle
- Provides robot control methods: `startRobot()`, `stopRobot()`, `pickupRobot()`, `setCleaningMode()`
- Retrieves robot state via AWS IoT Thing Shadow

### `mqttClient.ts`
MQTT over WebSocket client for AWS IoT Core.

- `MQTTClient` class: Handles real-time communication
- Connects to AWS IoT using SigV4-signed WebSocket URLs
- Publishes BLE commands to robot topics
- Subscribes to Thing Shadow updates

### `auth/`
Authentication submodule (see [auth/README.md](auth/README.md)).

## Architecture

```
┌─────────────────┐
│ MaytronicsAPI   │
├─────────────────┤
│ - login()       │──────┐
│ - startRobot()  │      │
│ - stopRobot()   │      ▼
│ - getThingShadow│  ┌─────────────────────┐
└────────┬────────┘  │ AuthenticationManager│
         │           └─────────────────────┘
         │
         ▼
┌─────────────────┐
│   MQTTClient    │
├─────────────────┤
│ - connect()     │
│ - publish()     │
│ - subscribe()   │
└─────────────────┘
```

## Authentication Flow

1. Cognito CUSTOM_AUTH → ID token
2. MyDolphin API → Robot serial, AWS credentials
3. AWS IoT → MQTT connection with SigV4

## Usage

```typescript
import { MaytronicsAPI } from './api';

const api = new MaytronicsAPI(config, log);
await api.login();
await api.startRobot('SERIAL123');
```
