# CLAUDE.md

## Project Overview

Homebridge plugin (`@mp-consulting/homebridge-dolphin-pool-cleaner`) for Maytronics Dolphin pool cleaning robots via the MyDolphin Plus cloud service. Controls start/stop, cleaning modes, water temperature monitoring, and filter status through HomeKit.

## Tech Stack

- **Language**: TypeScript (strict, ES2022, ESM via NodeNext)
- **Runtime**: Node.js >= 18, Homebridge >= 1.6.0
- **Testing**: Vitest
- **Linting**: ESLint 9 flat config with typescript-eslint
- **Cloud**: AWS Cognito (auth) + AWS IoT MQTT (real-time updates)

## Commands

- `npm run build` — Compile TypeScript and copy assets to `dist/`
- `npm run lint` — Lint with zero warnings
- `npm test` — Run tests (Vitest)
- `npm run test:coverage` — Tests with coverage
- `npm run watch` — Build, link, and watch with nodemon

## Project Structure

```
src/
├── index.ts                    # Plugin entry point
├── platform.ts                 # DolphinPoolCleanerPlatform (DynamicPlatformPlugin)
├── accessories/                # HomeKit accessory handler
├── api/                        # Maytronics API + MQTT client
│   └── auth/                   # AWS Cognito authentication
├── devices/                    # Device abstraction + catalog
├── parsers/                    # AWS Shadow state, filter status, fault codes
├── protocol/                   # IoT command builder + BLE command definitions
├── config/                     # Constants and defaults
└── utils/                      # Error utilities
test/
├── unit/                       # Unit tests with fixtures & mocks
├── integration/                # Platform integration tests
├── mocks/                      # AWS, Homebridge, MQTT mocks
└── fixtures/                   # Sample JSON responses
homebridge-ui/                  # Custom setup wizard UI
```

## Architecture

- **DynamicPlatformPlugin** pattern with cached accessory restoration
- **AWS IoT MQTT** for real-time state via Shadow document subscriptions
- **Polling fallback** with configurable interval (30-600s, default 60s)
- **Parser layer** decodes AWS Shadow state into device properties
- **Command builder** constructs IoT commands from BLE command protocol definitions

## Code Style

- Single quotes, 2-space indent, semicolons required
- Trailing commas in multiline, max line length 160
- Unix line endings, object curly spacing

## Git Settings

- `coAuthoredBy`: false
