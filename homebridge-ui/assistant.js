import { registerAiRoutes } from '@mp-consulting/homebridge-ai-core/plugin';

export const ASSISTANT_PLUGIN_NAME = '@mp-consulting/homebridge-dolphin-pool-cleaner';

/**
 * Dolphin / MyDolphin Plus background the Assistant gets with every request from
 * this plugin's setup wizard. Keep it short: it is sent with each prompt.
 */
export const DOLPHIN_AI_CONTEXT = [
  'The plugin bridges Maytronics Dolphin pool robots from the MyDolphin Plus cloud to HomeKit (a start/stop switch,',
  'water temperature and filter status); it never talks to the robot on the LAN. The setup wizard signs in with the',
  'MyDolphin Plus email only: AWS Cognito (CUSTOM_AUTH) sends a verification code by email (CUSTOM_CHALLENGE), SMS',
  '(SMS_MFA) or an authenticator app (SOFTWARE_TOKEN_MFA), and a pending code session expires after 5 minutes',
  '("Session expired. Please try again."). MFA_SETUP means two-factor setup must first be finished in the MyDolphin app.',
  'After the code, the MyDolphin backend (authenticate-user) returns the robot serial number, name and connection type',
  '(deviceType 62 or 60 = IoT connected, 50 = BLE connected), and the plugin stores a Cognito refresh token instead',
  'of the password. Wizard errors: "Invalid email or password" or',
  '"User not found. Please check your email address." (use the exact MyDolphin Plus account email), "Please confirm your',
  'email address first", "Invalid verification code", "Verification code has expired. Please try again.", "No pending',
  'authentication. Please try again." (start over), "Cognito service error: HTTP 5xx" or "Maytronics API error: HTTP',
  '5xx" (cloud outage, retry later), other texts are the MyDolphin backend Alert shown as-is (for example when the',
  'account has no robot), and "The request timed out" (the Homebridge host could not reach AWS or',
  'Maytronics: check DNS, firewall and internet access). At runtime the plugin logs "Refresh token expired. Please',
  're-authenticate through the plugin settings." when the stored token is no longer valid, gets temporary AWS IoT',
  'credentials (region eu-west-1) and controls the robot through the AWS IoT Thing Shadow over MQTT, polling every',
  '"pollingInterval" seconds (30-600, default 60); AWS IoT may throttle shadow requests (429 TOO_MANY_REQUESTS).',
  'A "notConnected" state is normal when the robot is out of the water',
  'or the power supply is off; water temperature only shows while the robot is in the water. Robot fault codes: 1 motor,',
  '2 out of water, 3 communication, 4 filter blocked, 5 impeller blocked, 6 overheating. Never ask the user for their',
  'password, verification codes, tokens or API keys.',
].join(' ');

/**
 * Adds the Assistant routes (/ai/status, /ai/explain, /ai/ask, /ai/config) to the
 * plugin UI server. The provider settings come from the shared `HomebridgeAiKit`
 * block in config.json; the key never reaches the browser.
 *
 * `options` is passed through to `registerAiRoutes` (tests inject a provider).
 */
export function registerAssistant(server, options = {}) {
  registerAiRoutes(server, {
    pluginName: ASSISTANT_PLUGIN_NAME,
    systemContext: DOLPHIN_AI_CONTEXT,
    ...options,
  });
}
