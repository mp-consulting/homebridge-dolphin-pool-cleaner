# Authentication Module

Handles multi-step authentication with AWS Cognito and Maytronics services.

## Files

### `authenticationManager.ts`
Orchestrates the complete authentication flow.

- `AuthenticationManager` class: Main authentication coordinator
- Handles Cognito CUSTOM_AUTH flow (email-based OTP)
- Exchanges Cognito tokens for Maytronics credentials
- Retrieves AWS IoT credentials for MQTT access
- Automatic token refresh when credentials expire

### `credentialManager.ts`
Stores and manages authentication credentials.

- `CredentialManager` class: Credential storage and validation
- Tracks token expiration times
- Provides `needsRefresh()` and `hasValidCredentials()` checks
- Stores Cognito tokens, AWS credentials, and robot info

### `types.ts`
TypeScript interfaces for authentication data structures.

- `CognitoCredentials`: ID/access/refresh tokens
- `AWSIoTCredentials`: AWS access key, secret, session token
- `MyDolphinTokens`: Maytronics-specific tokens
- `LoginResult`: Authentication result with robot info

## Authentication Flow

```
┌──────────────┐    ┌─────────────┐    ┌──────────────┐
│   Cognito    │    │  MyDolphin  │    │   AWS IoT    │
│  (CUSTOM_AUTH)│    │    API      │    │  Credentials │
└──────┬───────┘    └──────┬──────┘    └──────┬───────┘
       │                   │                  │
       │ 1. InitiateAuth   │                  │
       │ (email → OTP)     │                  │
       │                   │                  │
       │ 2. ID Token       │                  │
       │──────────────────►│                  │
       │                   │ 3. Exchange      │
       │                   │ for robot info   │
       │                   │──────────────────►
       │                   │                  │
       │                   │ 4. AWS creds     │
       │                   │◄─────────────────│
       │                   │                  │
```

## Usage

```typescript
import { AuthenticationManager } from './auth';

const authManager = new AuthenticationManager(email, log);
const result = await authManager.login();

// Later, ensure credentials are still valid
await authManager.ensureValidCredentials();
```
