# Config Module

Plugin configuration constants and default values.

## Files

### `constants.ts`
Centralized constants used throughout the plugin.

**AWS Configuration:**
- `COGNITO_REGION`: AWS Cognito region (`us-west-2`)
- `COGNITO_CLIENT_ID`: MyDolphin app client ID
- `IOT_REGION`: AWS IoT Core region (`eu-west-1`)

**API Endpoints:**
- `MAYTRONICS_BASE_URL`: MyDolphin API base URL
- `APP_KEY`: Application identifier for API requests

**Robot States:**
- `ROBOT_STATES`: State codes (OFF, ON, INIT, PROGRAMMING, etc.)
- `CLEANING_MODES`: Available cleaning modes with API mappings

**Timeouts:**
- `SHADOW_TIMEOUT_MS`: Shadow operation timeout (10s)
- `API_TIMEOUT_MS`: API call timeout (15s)
- `CREDENTIAL_REFRESH_BUFFER_MS`: Refresh 1 hour before expiry

**Polling:**
- `DEFAULT_POLLING_INTERVAL`: Default poll interval (60s)
- `MIN_POLLING_INTERVAL`: Minimum allowed interval (30s)

### `index.ts`
Barrel export for all constants.

## Cleaning Modes

| Mode | Description | API Mode |
|------|-------------|----------|
| `all` | Full pool cleaning | `regular` |
| `floor` | Floor only | `floor` |
| `wall` | Walls only | `wall` |
| `water` | Waterline | `water` |
| `pickup` | Go to pickup point | `pickup` |

## Usage

```typescript
import {
  ROBOT_STATES,
  CLEANING_MODES,
  DEFAULT_POLLING_INTERVAL
} from './config';

if (state === ROBOT_STATES.CLEANING) {
  console.log('Robot is cleaning');
}

const apiMode = CLEANING_MODES['floor'].apiMode;
```
