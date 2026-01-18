# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.0]: https://github.com/mickael/homebridge-dolphin-pool-cleaner/releases/tag/v1.0.0
