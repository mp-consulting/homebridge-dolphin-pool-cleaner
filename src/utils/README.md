# Utils Module

Shared utilities and error handling.

## Files

### `errors.ts`
Custom error classes with error codes for better error handling.

**Error Codes (`ErrorCode` enum):**
- `AUTH_COGNITO_FAILED`: Cognito authentication failed
- `AUTH_MYDOLPHIN_FAILED`: MyDolphin API authentication failed
- `AUTH_AWS_CREDENTIALS_FAILED`: AWS IoT credential retrieval failed
- `MQTT_CONNECTION_FAILED`: MQTT connection error
- `MQTT_PUBLISH_FAILED`: Failed to publish message
- `MQTT_SUBSCRIBE_FAILED`: Failed to subscribe to topic
- `API_REQUEST_FAILED`: Generic API request failure
- `DEVICE_NOT_FOUND`: Robot not found
- `INVALID_COMMAND`: Unknown command requested

**Error Classes:**
- `PluginError`: Base error class with error code and context
- `AuthError`: Authentication-specific errors
- `MQTTError`: MQTT communication errors
- `ApiError`: API request errors

### `index.ts`
Barrel export for utility functions and classes.

## Error Handling Pattern

```typescript
import { AuthError, ErrorCode } from './utils';

try {
  await authenticate();
} catch (error) {
  if (error instanceof AuthError) {
    switch (error.code) {
      case ErrorCode.AUTH_COGNITO_FAILED:
        log.error('Check your email/password');
        break;
      case ErrorCode.AUTH_MYDOLPHIN_FAILED:
        log.error('MyDolphin service unavailable');
        break;
    }
  }
  throw error;
}
```

## Error Context

Errors can include additional context for debugging:

```typescript
throw new ApiError(
  'Failed to start robot',
  ErrorCode.API_REQUEST_FAILED,
  { serialNumber: 'ABC123', response: data }
);
```
