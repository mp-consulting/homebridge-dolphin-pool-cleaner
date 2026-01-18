/**
 * Dolphin Pool Cleaner Setup Wizard
 * Uses CUSTOM_AUTH flow - email only, then OTP verification
 */

(function () {
  'use strict';

  // State
  let _currentStep = 'login';
  let robotData = null;
  let pendingEmail = null;
  const IOT_REGION = 'eu-west-1'; // Production region (hardcoded)
  let editingDeviceIndex = null; // Track which device we're editing
  let savedConfig = null; // Store the full config for editing

  // DOM Elements
  const steps = {
    configured: document.getElementById('step-configured'),
    login: document.getElementById('step-login'),
    otp: document.getElementById('step-otp'),
    robot: document.getElementById('step-robot'),
    success: document.getElementById('step-success'),
  };

  // Login form
  const loginForm = document.getElementById('login-form');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');

  // OTP form
  const otpForm = document.getElementById('otp-form');
  const otpBtn = document.getElementById('otp-btn');
  const otpError = document.getElementById('otp-error');
  const otpMessage = document.getElementById('otp-message');
  const otpBackBtn = document.getElementById('otp-back-btn');

  // Robot step
  const backBtn = document.getElementById('back-btn');
  const saveBtn = document.getElementById('save-btn');
  const doneBtn = document.getElementById('done-btn');

  // Configured robots step
  const addRobotBtn = document.getElementById('add-robot-btn');
  const reconfigureBtn = document.getElementById('reconfigure-btn');
  const configuredRobotsList = document.getElementById('configured-robots-list');

  // Initialize
  function init() {
    // Detect dark mode from parent window
    detectDarkMode();

    // Set up event listeners
    loginForm.addEventListener('submit', handleLogin);
    otpForm.addEventListener('submit', handleOtpVerify);
    otpBackBtn.addEventListener('click', () => showStep('login'));
    backBtn.addEventListener('click', () => showStep('login'));
    saveBtn.addEventListener('click', handleSave);
    doneBtn.addEventListener('click', handleDone);

    // Configured robots step listeners
    if (addRobotBtn) {
      addRobotBtn.addEventListener('click', () => showStep('login'));
    }
    if (reconfigureBtn) {
      reconfigureBtn.addEventListener('click', () => showStep('login'));
    }

    // Load saved config if exists
    loadSavedConfig();

    // Set up cleaning mode info handler
    setupCleaningModeHandler();
  }

  // Detect dark mode
  function detectDarkMode() {
    try {
      const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (isDark) {
        document.body.classList.add('dark-mode');
      }
    } catch (_e) {
      // Ignore
    }
  }

  // Show a specific step
  function showStep(step) {
    Object.keys(steps).forEach((key) => {
      steps[key].classList.remove('active');
    });
    steps[step].classList.add('active');
    _currentStep = step;

    // Clear errors when changing steps
    hideError(loginError);
    hideError(otpError);
  }

  // Show/hide loading state
  function setLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const loadingText = btn.querySelector('.btn-loading');

    if (loading) {
      text.style.display = 'none';
      loadingText.style.display = 'inline-flex';
      btn.disabled = true;
    } else {
      text.style.display = 'inline';
      loadingText.style.display = 'none';
      btn.disabled = false;
    }
  }

  // Show error message
  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
  }

  // Hide error message
  function hideError(element) {
    element.style.display = 'none';
  }

  // Handle login form submission (email only for CUSTOM_AUTH)
  async function handleLogin(event) {
    event.preventDefault();
    hideError(loginError);

    const email = document.getElementById('email').value.trim();

    if (!email) {
      showError(loginError, 'Please enter your email address');
      return;
    }

    // Store for OTP flow
    pendingEmail = email;

    setLoading(loginBtn, true);

    try {
      const result = await homebridge.request('/authenticate', {
        email,
      });

      if (result.success) {
        // Success without OTP (rare for CUSTOM_AUTH)
        handleAuthSuccess(result, email);
      } else if (result.requiresOtp) {
        // OTP required - show OTP step (this is the expected flow)
        otpMessage.textContent = result.message || 'Please enter the verification code sent to your email.';
        showStep('otp');
        document.getElementById('otp-code').focus();
        homebridge.toast.info('Verification code sent to your email');
      } else {
        showError(loginError, result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      showError(loginError, error.message || 'Failed to connect. Please try again.');
    } finally {
      setLoading(loginBtn, false);
    }
  }

  // Handle OTP verification
  async function handleOtpVerify(event) {
    event.preventDefault();
    hideError(otpError);

    const otpCode = document.getElementById('otp-code').value.trim();

    if (!otpCode) {
      showError(otpError, 'Please enter the verification code');
      return;
    }

    if (!pendingEmail) {
      showError(otpError, 'Session expired. Please start over.');
      showStep('login');
      return;
    }

    setLoading(otpBtn, true);

    try {
      const result = await homebridge.request('/verify-otp', {
        email: pendingEmail,
        otpCode,
      });

      if (result.success) {
        // Success - go to robot step
        handleAuthSuccess(result, pendingEmail);
        homebridge.toast.success('Verification successful!');
      } else if (result.requiresOtp) {
        // Another challenge (rare)
        otpMessage.textContent = result.message || 'Please enter the new verification code.';
        document.getElementById('otp-code').value = '';
        document.getElementById('otp-code').focus();
      } else {
        showError(otpError, result.error || 'Verification failed');
      }
    } catch (error) {
      console.error('OTP error:', error);
      showError(otpError, error.message || 'Failed to verify code. Please try again.');
    } finally {
      setLoading(otpBtn, false);
    }
  }

  // Handle successful authentication
  function handleAuthSuccess(result, email) {
    // Store robot data and tokens for plugin authentication
    robotData = {
      email,
      iotRegion: IOT_REGION,
      serialNumber: result.serialNumber,
      robotName: result.robotName,
      deviceType: result.deviceType,
      robotImageUrl: result.robotImageUrl,
      // Store tokens for plugin to use
      idToken: result.idToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };

    // Update robot info display
    document.getElementById('robot-name').textContent = result.robotName;
    document.getElementById('robot-serial').textContent = result.serialNumber;
    document.getElementById('display-name').value = result.robotName;

    // Update model info
    const modelElement = document.getElementById('robot-model');
    if (modelElement) {
      modelElement.textContent = result.robotName || 'Dolphin Robot';
    }

    // Update device type
    const deviceTypeElement = document.getElementById('robot-device-type');
    if (deviceTypeElement) {
      const deviceTypes = {
        62: 'IoT Connected (M400/M600)',
        60: 'IoT Connected',
        50: 'BLE Connected',
      };
      deviceTypeElement.textContent = deviceTypes[result.deviceType] || `Type ${result.deviceType}`;
    }

    // Update robot image if URL available from API
    updateRobotImage(result.robotImageUrl);

    // Clear OTP code
    document.getElementById('otp-code').value = '';

    // Show robot step
    showStep('robot');
    homebridge.toast.success('Connected successfully!');
  }

  // Handle save configuration
  async function handleSave() {
    if (!robotData) {
      return;
    }

    const displayName = document.getElementById('display-name').value.trim() || robotData.robotName;
    const cleaningMode = document.getElementById('cleaning-mode').value;
    const pollingInterval = parseInt(document.getElementById('polling-interval').value, 10);
    const enableTemperature = document.getElementById('enable-temperature').checked;
    const enableFilter = document.getElementById('enable-filter').checked;

    const isEditing = editingDeviceIndex !== null;

    // Build the device configuration
    const deviceConfig = {
      serialNumber: robotData.serialNumber,
      name: displayName,
      deviceType: robotData.deviceType,
      robotImageUrl: robotData.robotImageUrl,
      cleaningMode,
      enableTemperature,
      enableFilterStatus: enableFilter,
    };

    try {
      // Get current plugin config
      const pluginConfig = await homebridge.getPluginConfig();

      // Find existing Dolphin config
      const existingIndex = pluginConfig.findIndex(
        (c) => c.platform === 'DolphinPoolCleaner',
      );

      let config;
      if (existingIndex >= 0) {
        // Update existing config
        config = pluginConfig[existingIndex];
        config.pollingInterval = pollingInterval;

        // Ensure devices array exists
        if (!config.devices) {
          config.devices = [];
        }

        if (isEditing) {
          // Update existing device
          config.devices[editingDeviceIndex] = deviceConfig;
        } else {
          // Add new device or replace if same serial
          const deviceIndex = config.devices.findIndex(
            (d) => d.serialNumber === robotData.serialNumber,
          );
          if (deviceIndex >= 0) {
            config.devices[deviceIndex] = deviceConfig;
          } else {
            config.devices.push(deviceConfig);
          }
          // Update auth info from new login
          config.email = robotData.email;
          config.iotRegion = robotData.iotRegion;
          config.refreshToken = robotData.refreshToken;
        }
        pluginConfig[existingIndex] = config;
      } else {
        // Create new config
        config = {
          platform: 'DolphinPoolCleaner',
          name: 'Dolphin Pool Cleaner',
          email: robotData.email,
          iotRegion: robotData.iotRegion,
          pollingInterval,
          refreshToken: robotData.refreshToken,
          devices: [deviceConfig],
        };
        pluginConfig.push(config);
      }

      // Save config
      await homebridge.updatePluginConfig(pluginConfig);
      await homebridge.savePluginConfig();

      homebridge.toast.success('Configuration saved!');

      if (isEditing) {
        // Reset editing state
        editingDeviceIndex = null;
        // Reset header text
        const stepHeader = steps.robot.querySelector('.step-header h2');
        const stepDesc = steps.robot.querySelector('.step-description');
        if (stepHeader) {
          stepHeader.textContent = 'Robot Found!';
        }
        if (stepDesc) {
          stepDesc.textContent = 'We found your Dolphin pool robot.';
        }
        // Go back to configured robots list with updated data
        showConfiguredRobots(config);
      } else {
        showStep('success');
      }
    } catch (error) {
      console.error('Save error:', error);
      homebridge.toast.error('Failed to save configuration');
    }
  }

  // Handle done button
  function handleDone() {
    homebridge.closeSettings();
  }

  // Load saved configuration
  async function loadSavedConfig() {
    try {
      const pluginConfig = await homebridge.getPluginConfig();
      const existingConfig = pluginConfig.find(
        (c) => c.platform === 'DolphinPoolCleaner',
      );

      if (existingConfig) {
        // Pre-fill form with saved values
        document.getElementById('email').value = existingConfig.email || '';

        if (existingConfig.pollingInterval) {
          document.getElementById('polling-interval').value = existingConfig.pollingInterval.toString();
        }

        if (existingConfig.devices && existingConfig.devices.length > 0) {
          const device = existingConfig.devices[0];
          if (device.cleaningMode) {
            document.getElementById('cleaning-mode').value = device.cleaningMode;
            // Update the mode info box to match the loaded mode
            updateModeInfo(device.cleaningMode);
          }
          if (device.enableTemperature !== undefined) {
            document.getElementById('enable-temperature').checked = device.enableTemperature;
          }
          if (device.enableFilterStatus !== undefined) {
            document.getElementById('enable-filter').checked = device.enableFilterStatus;
          }

          // Show configured robots view if we have devices
          showConfiguredRobots(existingConfig);
        }
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  // Show configured robots list
  function showConfiguredRobots(config) {
    if (!config.devices || config.devices.length === 0) {
      return;
    }

    // Store config for editing
    savedConfig = config;

    // Clear existing content
    configuredRobotsList.innerHTML = '';

    // Create robot cards for each configured device
    config.devices.forEach((device, index) => {
      const robotCard = createRobotCard(device, config.email, index);
      configuredRobotsList.appendChild(robotCard);
    });

    // Show the configured step
    showStep('configured');
  }

  // Edit a specific device
  function editDevice(deviceIndex) {
    if (!savedConfig || !savedConfig.devices || !savedConfig.devices[deviceIndex]) {
      return;
    }

    const device = savedConfig.devices[deviceIndex];
    editingDeviceIndex = deviceIndex;

    // Populate robotData with existing device info (for save function)
    robotData = {
      email: savedConfig.email,
      iotRegion: IOT_REGION,
      serialNumber: device.serialNumber,
      robotName: device.name,
      deviceType: device.deviceType,
      refreshToken: savedConfig.refreshToken,
    };

    // Update robot info display
    document.getElementById('robot-name').textContent = device.name || 'Dolphin Robot';
    document.getElementById('robot-serial').textContent = device.serialNumber || '-';
    document.getElementById('display-name').value = device.name || '';

    // Update model info
    const modelElement = document.getElementById('robot-model');
    if (modelElement) {
      modelElement.textContent = device.name || 'Dolphin Robot';
    }

    // Update device type
    const deviceTypeElement = document.getElementById('robot-device-type');
    if (deviceTypeElement) {
      const deviceTypes = {
        62: 'IoT Connected (M400/M600)',
        60: 'IoT Connected',
        50: 'BLE Connected',
      };
      deviceTypeElement.textContent = deviceTypes[device.deviceType] || `Type ${device.deviceType}`;
    }

    // Update robot image if URL available from saved config
    updateRobotImage(device.robotImageUrl);

    // Pre-fill form with existing values
    const cleaningModeSelect = document.getElementById('cleaning-mode');
    if (device.cleaningMode && cleaningModeSelect) {
      cleaningModeSelect.value = device.cleaningMode;
      // Update the mode info box to match the selected mode
      updateModeInfo(device.cleaningMode);
    }
    if (savedConfig.pollingInterval) {
      document.getElementById('polling-interval').value = savedConfig.pollingInterval.toString();
    }
    if (device.enableTemperature !== undefined) {
      document.getElementById('enable-temperature').checked = device.enableTemperature;
    }
    if (device.enableFilterStatus !== undefined) {
      document.getElementById('enable-filter').checked = device.enableFilterStatus;
    }

    // Update the step header to indicate editing
    const stepHeader = steps.robot.querySelector('.step-header h2');
    if (stepHeader) {
      stepHeader.textContent = 'Edit Robot Settings';
    }
    const stepDesc = steps.robot.querySelector('.step-description');
    if (stepDesc) {
      stepDesc.textContent = 'Update the settings for your Dolphin pool robot.';
    }

    // Change the back button to go back to configured list
    backBtn.onclick = () => {
      // Reset header text
      if (stepHeader) {
        stepHeader.textContent = 'Robot Found!';
      }
      if (stepDesc) {
        stepDesc.textContent = 'We found your Dolphin pool robot.';
      }
      editingDeviceIndex = null;
      showStep('configured');
    };

    // Show the robot edit step
    showStep('robot');
  }

  // Create a robot card element
  function createRobotCard(device, email, deviceIndex) {
    const card = document.createElement('div');
    card.className = 'robot-card robot-card-clickable';

    // Get device type description
    const deviceTypes = {
      62: 'IoT Connected (M400/M600)',
      60: 'IoT Connected',
      50: 'BLE Connected',
    };
    const deviceTypeText = deviceTypes[device.deviceType] || `Type ${device.deviceType}`;

    // Use real robot image if available, otherwise use SVG
    const imageHtml = device.robotImageUrl
      ? `<img src="${device.robotImageUrl}" alt="${device.name}" class="robot-image"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
         <div class="robot-svg" style="display: none;">${getRobotSVG()}</div>`
      : `<div class="robot-svg">${getRobotSVG()}</div>`;

    card.innerHTML = `
      <div class="robot-image-container">
        ${imageHtml}
        <div class="robot-status-badge">
          <span class="status-dot green"></span>
          <span>Configured</span>
        </div>
        <button type="button" class="edit-robot-btn" title="Edit settings">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      </div>
      <div class="robot-card-content">
        <h3 class="robot-card-name">${device.name || 'Dolphin Robot'}</h3>
        <div class="robot-card-details">
          <div class="robot-detail-item">
            <span class="detail-label">Serial Number</span>
            <span class="detail-value">${device.serialNumber || '-'}</span>
          </div>
          <div class="robot-detail-item">
            <span class="detail-label">Device Type</span>
            <span class="detail-value">${deviceTypeText}</span>
          </div>
          <div class="robot-detail-item">
            <span class="detail-label">Account</span>
            <span class="detail-value">${email || '-'}</span>
          </div>
          <div class="robot-detail-item">
            <span class="detail-label">Cleaning Mode</span>
            <span class="detail-value">${getCleaningModeText(device.cleaningMode)}</span>
          </div>
        </div>
      </div>
    `;

    // Add click handler to edit button
    const editBtn = card.querySelector('.edit-robot-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editDevice(deviceIndex);
    });

    // Also allow clicking the whole card to edit
    card.addEventListener('click', () => {
      editDevice(deviceIndex);
    });

    return card;
  }

  // Get SVG robot illustration
  function getRobotSVG() {
    return `<svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#4A90D9;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#2E5A8B;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="topGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#5BA0E9;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#4A90D9;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="wheelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#333;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#111;stop-opacity:1" />
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="145" rx="70" ry="8" fill="rgba(0,0,0,0.15)"/>
      <rect x="25" y="100" width="30" height="40" rx="8" fill="url(#wheelGradient)"/>
      <rect x="145" y="100" width="30" height="40" rx="8" fill="url(#wheelGradient)"/>
      <line x1="30" y1="108" x2="50" y2="108" stroke="#444" stroke-width="2"/>
      <line x1="30" y1="116" x2="50" y2="116" stroke="#444" stroke-width="2"/>
      <line x1="30" y1="124" x2="50" y2="124" stroke="#444" stroke-width="2"/>
      <line x1="30" y1="132" x2="50" y2="132" stroke="#444" stroke-width="2"/>
      <line x1="150" y1="108" x2="170" y2="108" stroke="#444" stroke-width="2"/>
      <line x1="150" y1="116" x2="170" y2="116" stroke="#444" stroke-width="2"/>
      <line x1="150" y1="124" x2="170" y2="124" stroke="#444" stroke-width="2"/>
      <line x1="150" y1="132" x2="170" y2="132" stroke="#444" stroke-width="2"/>
      <path d="M40 120 Q40 70 100 60 Q160 70 160 120 L160 130 Q160 140 150 140 L50 140 Q40 140 40 130 Z" fill="url(#bodyGradient)"/>
      <ellipse cx="100" cy="75" rx="55" ry="25" fill="url(#topGradient)"/>
      <path d="M70 55 Q100 35 130 55" stroke="#3A80C9" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M55 90 Q100 100 145 90" stroke="#3A80C9" stroke-width="2" fill="none"/>
      <circle cx="100" cy="75" r="6" fill="#4ADE80">
        <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite"/>
      </circle>
      <path d="M60 100 L60 125" stroke="#5BA0E9" stroke-width="3"/>
      <path d="M75 95 L75 130" stroke="#5BA0E9" stroke-width="3"/>
      <path d="M125 95 L125 130" stroke="#5BA0E9" stroke-width="3"/>
      <path d="M140 100 L140 125" stroke="#5BA0E9" stroke-width="3"/>
      <rect x="45" y="135" width="110" height="6" rx="3" fill="#2E5A8B"/>
    </svg>`;
  }

  // Cleaning mode details with descriptions and durations
  const CLEANING_MODE_DETAILS = {
    'all': {
      name: 'All Surfaces',
      description: 'Full pool cleaning covering floor, walls, and waterline. Most thorough cleaning option.',
      duration: 150,
    },
    'floor': {
      name: 'Floor Only',
      description: 'Cleans just the pool bottom. Good for quick maintenance when walls are still clean.',
      duration: 150,
    },
    'wall': {
      name: 'Walls Only',
      description: 'Cleans vertical surfaces of the pool. Useful after storms or algae treatment.',
      duration: 120,
    },
    'water': {
      name: 'Waterline',
      description: 'Focuses on the water surface line where debris and oils accumulate.',
      duration: 150,
    },
    'short': {
      name: 'Short/Fast',
      description: 'Quick cleaning cycle for light maintenance between full cleans.',
      duration: 150,
    },
    'ultra': {
      name: 'Ultra Clean',
      description: 'Intensive deep cleaning mode for heavily soiled pools. Most thorough option.',
      duration: 150,
    },
    'cove': {
      name: 'Cove',
      description: 'Focuses on corners and coves where floor meets walls. Catches hard-to-reach debris.',
      duration: 120,
    },
    'spot': {
      name: 'Spot',
      description: 'Concentrated cleaning in a localized area. Drop robot where needed.',
      duration: 120,
    },
    'tictac': {
      name: 'Tic Tac',
      description: 'Extended systematic coverage pattern for very large or complex pools.',
      duration: 600,
    },
    'pickup': {
      name: 'Pickup',
      description: 'Quick retrieval mode - robot moves to edge for easy removal from pool.',
      duration: 5,
    },
    'custom': {
      name: 'Custom',
      description: 'User-defined cleaning cycle with custom duration.',
      duration: 120,
    },
    'regular': {
      name: 'All Surfaces',
      description: 'Full pool cleaning covering floor, walls, and waterline.',
      duration: 150,
    },
  };

  // Get cleaning mode text
  function getCleaningModeText(mode) {
    const modeInfo = CLEANING_MODE_DETAILS[mode];
    if (modeInfo) {
      return `${modeInfo.name} (${formatDuration(modeInfo.duration)})`;
    }
    return mode || 'All Surfaces';
  }

  // Format duration in minutes to human-readable text
  function formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes} min`;
    } else if (minutes === 60) {
      return '1 hour';
    } else if (minutes % 60 === 0) {
      return `${minutes / 60} hours`;
    } else {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
  }

  // Update the mode info box with details for the selected mode
  function updateModeInfo(mode) {
    const modeInfo = CLEANING_MODE_DETAILS[mode] || CLEANING_MODE_DETAILS['all'];
    const descriptionEl = document.getElementById('mode-description');
    const durationTextEl = document.getElementById('mode-duration-text');

    if (descriptionEl) {
      descriptionEl.textContent = modeInfo.description;
    }
    if (durationTextEl) {
      durationTextEl.textContent = `Duration: ~${modeInfo.duration} minutes`;
    }
  }

  // Set up cleaning mode select change handler
  function setupCleaningModeHandler() {
    const cleaningModeSelect = document.getElementById('cleaning-mode');
    if (cleaningModeSelect) {
      cleaningModeSelect.addEventListener('change', (e) => {
        updateModeInfo(e.target.value);
      });
      // Initialize with current selection
      updateModeInfo(cleaningModeSelect.value);
    }
  }

  // Update robot image - show real image from API if available, otherwise show SVG
  function updateRobotImage(imageUrl) {
    const robotImage = document.getElementById('robot-image');
    const svgContainer = document.getElementById('robot-svg-container');

    if (imageUrl && robotImage) {
      // Show real image, hide SVG
      robotImage.src = imageUrl;
      robotImage.style.display = 'block';
      if (svgContainer) {
        svgContainer.style.display = 'none';
      }

      // If image fails to load, show SVG as fallback
      robotImage.onerror = () => {
        robotImage.style.display = 'none';
        if (svgContainer) {
          svgContainer.style.display = 'block';
        }
      };
    } else {
      // No image URL, show SVG
      if (robotImage) {
        robotImage.style.display = 'none';
      }
      if (svgContainer) {
        svgContainer.style.display = 'block';
      }
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
