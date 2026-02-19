# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2026-02-17

### Security

- **Fixed XSS vulnerability in setup wizard** - User-controlled values (robot name, serial number, email, image URL) were injected into `innerHTML` without sanitization. Added HTML escaping and URL protocol validation to prevent script injection via malicious API responses.
- **Removed sensitive credential logging** - AWS `AccessKeyId`, `SecretAccessKey`, and `SessionToken` were being logged at debug level via `JSON.stringify()`. Also removed logging of the SigV4 canonical request which contained the access key.

### Fixed

- **Fixed event listener leak in MQTT client** - `getShadow()` and `updateShadow()` used `removeAllListeners()` which stripped external listeners registered by other components. Replaced with targeted `removeListener()` to only clean up operation-specific handlers.
- **Fixed BLE command data length encoding** - Data length field was encoded in big-endian but the protocol specifies little-endian (matching the checksum encoding). Commands with data payloads > 255 bytes would be malformed.
- **Fixed missing HTTP response status checks in UI server** - `fetch()` responses from Cognito and Maytronics APIs were parsed as JSON without checking for HTTP 5xx errors, producing silent garbage results on server failures.
- **Fixed session memory leak in UI server** - Pending OTP sessions were stored without TTL. Abandoned authentication flows accumulated indefinitely. Added 5-minute expiry with automatic cleanup.
- **Added overflow protection for BLE command builder** - Data payloads exceeding 65,535 bytes (the 2-byte field maximum) now return `undefined` instead of producing malformed packets.
- Fixed stale unit tests that didn't match current implementation (cleaning modes API, M-Series temperature sensor default, shadow fetch error handling)

## [1.0.8] - 2026-01-19

### Changed

- Redesigned robot configuration step with 2-column layout
  - Left column: Robot details (image, display name, serial, model, device type)
  - Right column: Settings (cleaning mode, polling interval, sensors)
- Increased robot image size for better visibility (200x150px)
- Moved Display Name field into the robot card for better UX

## [1.0.7] - 2026-01-19

### Changed

- **Major refactoring** of codebase for improved maintainability
  - Extracted authentication into dedicated `AuthenticationManager` and `CredentialManager` classes
  - Extracted shadow parsing into `parsers/` module with unified `parseShadowState()` function
  - Extracted BLE command building into `protocol/commandBuilder.ts`
  - Created custom error classes with error codes in `utils/errors.ts`
  - Reduced `MaytronicsAPI` from 622 to ~390 lines
  - Reduced `MQTTClient` from 525 to ~330 lines
  - Reduced `DolphinDevice` from 680 to ~240 lines
- Modernized `homebridge-ui/server.js` with native `fetch` API (removed curl dependency)
- Reorganized `homebridge-ui/public/wizard.js` with centralized state and DOM management
- Replaced all `any` types with proper TypeScript types
- Replaced magic numbers with named constants for better code readability

### Added

- README documentation for all `src/` modules explaining architecture and usage
- New modules: `src/api/auth/`, `src/parsers/`, `src/protocol/`, `src/utils/`
- Proper TypeScript interfaces for shadow state, filter status, and fault info
- Named constants for MQTT settings, timeouts, timestamps, and error codes

### Fixed

- Fixed incorrect `isCleaning=true` when robot is idle (`holdWeekly`, `notConnected` states)
- Fixed timestamp validation to ignore `cycleStartTime=0` (no active cycle)
- Disabled temperature sensor by default for M-Series (not all models have it)
- Security improvement: removed shell command injection risk in UI server

## [1.0.6] - 2026-01-18

### Changed

- Silenced IoT endpoint discovery message to debug level (expected behavior)

## [1.0.5] - 2026-01-18

### Added

- homebridge-config-ui-x as dev dependency for local UI testing
- Cleaning mode info box showing description and duration

### Changed

- Simplified cleaning mode dropdown options with details in info box
- Improved nodemon config to also watch homebridge-ui folder
- Fixed plugin name constant to use scoped package name

### Fixed

- Fixed server.js imports for CommonJS compatibility with ES modules
- Fixed checkmark alignment in success message using flexbox

## [1.0.4] - 2026-01-18

### Changed

- Reduced MQTT log verbosity for cleaner logs
- MQTT connection now logged once per session instead of on every reconnect

### Fixed

- Fixed import paths in dump-shadow script

## [1.0.3] - 2026-01-18

### Added

- ConfiguredName characteristic for better HomeKit display
- Maytronics logo in README

### Fixed

- Checkmark positioning in setup wizard success screen

## [1.0.2] - 2026-01-18

### Changed

- Added more npm keywords for better discoverability
- Fixed repository URLs in package.json

## [1.0.1] - 2026-01-18

### Added

- Complete test suite with Vitest (125 tests)
- Test coverage reporting

### Changed

- Improved code quality and consistency

## [1.0.0] - 2026-01-18

### Added

- **HomeKit Integration**
  - Switch service to start/stop cleaning cycles
  - Temperature sensor for water temperature (when robot is in water)
  - Filter Maintenance indicator showing filter bag status

- **MyDolphin Plus Authentication**
  - AWS Cognito authentication with email/password
  - Full OTP/MFA (two-factor authentication) support
  - Automatic token refresh

- **Real-time Communication**
  - AWS IoT Core MQTT connection for instant status updates
  - Thing Shadow integration for reliable state synchronization
  - Automatic reconnection on connection loss

- **Cleaning Modes**
  - All Surfaces (regular) - full 2.5 hour clean
  - Fast Mode (short) - 1 hour quick clean
  - Floor Only - clean floor surfaces
  - Walls Only - clean wall surfaces
  - Waterline - clean waterline
  - Ultra Clean - extended deep clean
  - Cove - focus on cove areas
  - Spot Clean - localized cleaning

- **Custom UI Wizard**
  - Step-by-step setup wizard in Homebridge UI
  - Automatic robot discovery after login
  - OTP verification flow
  - Configuration preview before saving

- **Developer Tools**
  - Shadow dump script for debugging (`test/scripts/dump-shadow.mjs`)
  - Comprehensive logging with debug mode
  - Protocol documentation in `src/protocol/`

### Supported Models

- Dolphin M400/M600 series
- Dolphin S series (S200, S300, etc.)
- Dolphin E series (E50, E60, etc.)
- Dolphin Liberty series (cordless)
- All other MyDolphin Plus compatible robots

### Technical Details

- Built with TypeScript and ES modules
- Requires Node.js 18+ and Homebridge 1.6+
- Uses AWS SDK v3 for Cognito and IoT
- MQTT 5.x for real-time communication

[1.0.9]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.9
[1.0.8]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.8
[1.0.7]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.7
[1.0.6]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.6
[1.0.5]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.5
[1.0.4]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.4
[1.0.3]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.3
[1.0.2]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.2
[1.0.1]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.1
[1.0.0]: https://github.com/mp-consulting/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.0
