# API Module

Handles all communication with the Maytronics cloud services.

## Files

### `maytronicsApi.ts`
Main API client that orchestrates authentication and robot control.

- `MaytronicsAPI` class: Entry point for all cloud operations
- Manages MQTT client lifecycle
- Provides robot control methods: `startRobot()`, `stopRobot()`, `setCleaningMode()`
- Retrieves robot state via AWS IoT Thing Shadow
- Concurrent callers share one login and one MQTT connection attempt

### `httpClient.ts`
`MyDolphinHttpClient`: thin `fetch` wrapper for the MyDolphin REST backend (form-encoded bodies, timeouts, typed envelope).

### `mqttClient.ts`
MQTT over WebSocket client for AWS IoT Core.

- `MQTTClient` class: Handles real-time communication
- Connects to AWS IoT using SigV4-signed WebSocket URLs, re-signed with the
  current credentials on every reconnect (`transformWsUrl`)
- `connect()` always settles (bounded by `MQTT_CONNECT_TIMEOUT_MS`)
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
