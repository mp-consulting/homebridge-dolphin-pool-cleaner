/**
 * Dolphin Pool Cleaner Setup Wizard
 * Uses CUSTOM_AUTH flow - email only, then OTP verification
 */

(function () {
  'use strict';

  // ============================================================================
  // Constants
  // ============================================================================

  const IOT_REGION = 'eu-west-1';

  const DEVICE_TYPE_LABELS = {
    62: 'IoT Connected (M400/M600)',
    60: 'IoT Connected',
    50: 'BLE Connected',
  };

  const CLEANING_MODE_DETAILS = {
    all: {
      name: 'All Surfaces',
      description: 'Full pool cleaning covering floor, walls, and waterline. Most thorough cleaning option.',
      duration: 150,
    },
    floor: {
      name: 'Floor Only',
      description: 'Cleans just the pool bottom. Good for quick maintenance when walls are still clean.',
      duration: 150,
    },
    wall: {
      name: 'Walls Only',
      description: 'Cleans vertical surfaces of the pool. Useful after storms or algae treatment.',
      duration: 120,
    },
    water: {
      name: 'Waterline',
      description: 'Focuses on the water surface line where debris and oils accumulate.',
      duration: 150,
    },
    short: {
      name: 'Short/Fast',
      description: 'Quick cleaning cycle for light maintenance between full cleans.',
      duration: 150,
    },
    ultra: {
      name: 'Ultra Clean',
      description: 'Intensive deep cleaning mode for heavily soiled pools. Most thorough option.',
      duration: 150,
    },
    cove: {
      name: 'Cove',
      description: 'Focuses on corners and coves where floor meets walls. Catches hard-to-reach debris.',
      duration: 120,
    },
    spot: {
      name: 'Spot',
      description: 'Concentrated cleaning in a localized area. Drop robot where needed.',
      duration: 120,
    },
    tictac: {
      name: 'Tic Tac',
      description: 'Extended systematic coverage pattern for very large or complex pools.',
      duration: 600,
    },
    pickup: {
      name: 'Pickup',
      description: 'Quick retrieval mode - robot moves to edge for easy removal from pool.',
      duration: 5,
    },
    custom: {
      name: 'Custom',
      description: 'User-defined cleaning cycle with custom duration.',
      duration: 120,
    },
    regular: {
      name: 'All Surfaces',
      description: 'Full pool cleaning covering floor, walls, and waterline.',
      duration: 150,
    },
  };

  const ROBOT_SVG = `<svg viewBox="0 0 200 160" xmlns="http://www.w3.org/2000/svg">
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

  // ============================================================================
  // DOM Elements (lazy-loaded)
  // ============================================================================

  const dom = {
    get steps() {
      return {
        configured: document.getElementById('step-configured'),
        login: document.getElementById('step-login'),
        otp: document.getElementById('step-otp'),
        robot: document.getElementById('step-robot'),
        success: document.getElementById('step-success'),
      };
    },
    get loginForm() { return document.getElementById('login-form'); },
    get loginBtn() { return document.getElementById('login-btn'); },
    get loginError() { return document.getElementById('login-error'); },
    get otpForm() { return document.getElementById('otp-form'); },
    get otpBtn() { return document.getElementById('otp-btn'); },
    get otpError() { return document.getElementById('otp-error'); },
    get otpMessage() { return document.getElementById('otp-message'); },
    get otpBackBtn() { return document.getElementById('otp-back-btn'); },
    get backBtn() { return document.getElementById('back-btn'); },
    get saveBtn() { return document.getElementById('save-btn'); },
    get doneBtn() { return document.getElementById('done-btn'); },
    get addRobotBtn() { return document.getElementById('add-robot-btn'); },
    get reconfigureBtn() { return document.getElementById('reconfigure-btn'); },
    get configuredRobotsList() { return document.getElementById('configured-robots-list'); },
    get email() { return document.getElementById('email'); },
    get otpCode() { return document.getElementById('otp-code'); },
    get displayName() { return document.getElementById('display-name'); },
    get cleaningMode() { return document.getElementById('cleaning-mode'); },
    get pollingInterval() { return document.getElementById('polling-interval'); },
    get enableTemperature() { return document.getElementById('enable-temperature'); },
    get enableFilter() { return document.getElementById('enable-filter'); },
    get robotSerial() { return document.getElementById('robot-serial'); },
    get robotModel() { return document.getElementById('robot-model'); },
    get robotDeviceType() { return document.getElementById('robot-device-type'); },
    get robotImage() { return document.getElementById('robot-image'); },
    get robotSvgContainer() { return document.getElementById('robot-svg-container'); },
    get modeDescription() { return document.getElementById('mode-description'); },
    get modeDurationText() { return document.getElementById('mode-duration-text'); },
  };

  // ============================================================================
  // State
  // ============================================================================

  const state = {
    currentStep: 'login',
    robotData: null,
    pendingEmail: null,
    editingDeviceIndex: null,
    savedConfig: null,
  };

  // ============================================================================
  // Utilities
  // ============================================================================

  function getDeviceTypeLabel(deviceType) {
    return DEVICE_TYPE_LABELS[deviceType] || `Type ${deviceType}`;
  }

  function formatDuration(minutes) {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    if (minutes === 60) {
      return '1 hour';
    }
    if (minutes % 60 === 0) {
      return `${minutes / 60} hours`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }

  function getCleaningModeText(mode) {
    const modeInfo = CLEANING_MODE_DETAILS[mode];
    if (modeInfo) {
      return `${modeInfo.name} (${formatDuration(modeInfo.duration)})`;
    }
    return mode || 'All Surfaces';
  }

  // ============================================================================
  // UI Helpers
  // ============================================================================

  function detectDarkMode() {
    try {
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        document.body.classList.add('dark-mode');
      }
    } catch (_e) {
      // Ignore
    }
  }

  function showStep(step) {
    const steps = dom.steps;
    Object.keys(steps).forEach((key) => {
      steps[key].classList.remove('active');
    });
    steps[step].classList.add('active');
    state.currentStep = step;

    // Clear errors when changing steps
    hideError(dom.loginError);
    hideError(dom.otpError);
  }

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

  function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
  }

  function hideError(element) {
    element.style.display = 'none';
  }

  function updateModeInfo(mode) {
    const modeInfo = CLEANING_MODE_DETAILS[mode] || CLEANING_MODE_DETAILS.all;

    if (dom.modeDescription) {
      dom.modeDescription.textContent = modeInfo.description;
    }
    if (dom.modeDurationText) {
      dom.modeDurationText.textContent = `Duration: ~${modeInfo.duration} minutes`;
    }
  }

  function updateRobotImage(imageUrl) {
    const robotImage = dom.robotImage;
    const svgContainer = dom.robotSvgContainer;

    if (imageUrl && robotImage) {
      robotImage.src = imageUrl;
      robotImage.style.display = 'block';
      if (svgContainer) {
        svgContainer.style.display = 'none';
      }

      robotImage.onerror = () => {
        robotImage.style.display = 'none';
        if (svgContainer) {
          svgContainer.style.display = 'block';
        }
      };
    } else {
      if (robotImage) {
        robotImage.style.display = 'none';
      }
      if (svgContainer) {
        svgContainer.style.display = 'block';
      }
    }
  }

  function updateRobotDisplay(result) {
    dom.robotSerial.textContent = result.serialNumber;
    dom.displayName.value = result.robotName;

    if (dom.robotModel) {
      dom.robotModel.textContent = result.model || result.robotName || 'Dolphin Robot';
    }
    if (dom.robotDeviceType) {
      dom.robotDeviceType.textContent = getDeviceTypeLabel(result.deviceType);
    }

    updateRobotImage(result.robotImageUrl);
  }

  // ============================================================================
  // Authentication Handlers
  // ============================================================================

  async function handleLogin(event) {
    event.preventDefault();
    hideError(dom.loginError);

    const email = dom.email.value.trim();
    if (!email) {
      showError(dom.loginError, 'Please enter your email address');
      return;
    }

    state.pendingEmail = email;
    setLoading(dom.loginBtn, true);

    try {
      const result = await homebridge.request('/authenticate', { email });

      if (result.success) {
        handleAuthSuccess(result, email);
      } else if (result.requiresOtp) {
        dom.otpMessage.textContent = result.message || 'Please enter the verification code sent to your email.';
        showStep('otp');
        dom.otpCode.focus();
        homebridge.toast.info('Verification code sent to your email');
      } else {
        showError(dom.loginError, result.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      showError(dom.loginError, error.message || 'Failed to connect. Please try again.');
    } finally {
      setLoading(dom.loginBtn, false);
    }
  }

  async function handleOtpVerify(event) {
    event.preventDefault();
    hideError(dom.otpError);

    const otpCode = dom.otpCode.value.trim();
    if (!otpCode) {
      showError(dom.otpError, 'Please enter the verification code');
      return;
    }

    if (!state.pendingEmail) {
      showError(dom.otpError, 'Session expired. Please start over.');
      showStep('login');
      return;
    }

    setLoading(dom.otpBtn, true);

    try {
      const result = await homebridge.request('/verify-otp', {
        email: state.pendingEmail,
        otpCode,
      });

      if (result.success) {
        handleAuthSuccess(result, state.pendingEmail);
        homebridge.toast.success('Verification successful!');
      } else if (result.requiresOtp) {
        dom.otpMessage.textContent = result.message || 'Please enter the new verification code.';
        dom.otpCode.value = '';
        dom.otpCode.focus();
      } else {
        showError(dom.otpError, result.error || 'Verification failed');
      }
    } catch (error) {
      console.error('OTP error:', error);
      showError(dom.otpError, error.message || 'Failed to verify code. Please try again.');
    } finally {
      setLoading(dom.otpBtn, false);
    }
  }

  function handleAuthSuccess(result, email) {
    state.robotData = {
      email,
      iotRegion: IOT_REGION,
      serialNumber: result.serialNumber,
      robotName: result.robotName,
      deviceType: result.deviceType,
      robotImageUrl: result.robotImageUrl,
      idToken: result.idToken,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };

    updateRobotDisplay(result);
    dom.otpCode.value = '';
    showStep('robot');
    homebridge.toast.success('Connected successfully!');
  }

  // ============================================================================
  // Configuration Handlers
  // ============================================================================

  async function handleSave() {
    if (!state.robotData) {
      return;
    }

    const displayName = dom.displayName.value.trim() || state.robotData.robotName;
    const cleaningMode = dom.cleaningMode.value;
    const pollingInterval = parseInt(dom.pollingInterval.value, 10);
    const enableTemperature = dom.enableTemperature.checked;
    const enableFilter = dom.enableFilter.checked;

    const isEditing = state.editingDeviceIndex !== null;

    const deviceConfig = {
      serialNumber: state.robotData.serialNumber,
      name: displayName,
      deviceType: state.robotData.deviceType,
      robotImageUrl: state.robotData.robotImageUrl,
      cleaningMode,
      enableTemperature,
      enableFilterStatus: enableFilter,
    };

    try {
      const pluginConfig = await homebridge.getPluginConfig();
      const existingIndex = pluginConfig.findIndex((c) => c.platform === 'DolphinPoolCleaner');

      let config;
      if (existingIndex >= 0) {
        config = pluginConfig[existingIndex];
        config.pollingInterval = pollingInterval;
        config.devices = config.devices || [];

        if (isEditing) {
          config.devices[state.editingDeviceIndex] = deviceConfig;
        } else {
          const deviceIndex = config.devices.findIndex(
            (d) => d.serialNumber === state.robotData.serialNumber,
          );
          if (deviceIndex >= 0) {
            config.devices[deviceIndex] = deviceConfig;
          } else {
            config.devices.push(deviceConfig);
          }
          config.email = state.robotData.email;
          config.iotRegion = state.robotData.iotRegion;
          config.refreshToken = state.robotData.refreshToken;
        }
        pluginConfig[existingIndex] = config;
      } else {
        config = {
          platform: 'DolphinPoolCleaner',
          name: 'Dolphin Pool Cleaner',
          email: state.robotData.email,
          iotRegion: state.robotData.iotRegion,
          pollingInterval,
          refreshToken: state.robotData.refreshToken,
          devices: [deviceConfig],
        };
        pluginConfig.push(config);
      }

      await homebridge.updatePluginConfig(pluginConfig);
      await homebridge.savePluginConfig();

      homebridge.toast.success('Configuration saved!');

      if (isEditing) {
        resetEditingState();
        showConfiguredRobots(config);
      } else {
        showStep('success');
      }
    } catch (error) {
      console.error('Save error:', error);
      homebridge.toast.error('Failed to save configuration');
    }
  }

  function handleDone() {
    homebridge.closeSettings();
  }

  async function loadSavedConfig() {
    try {
      const pluginConfig = await homebridge.getPluginConfig();
      const existingConfig = pluginConfig.find((c) => c.platform === 'DolphinPoolCleaner');

      if (!existingConfig) {
        return;
      }

      dom.email.value = existingConfig.email || '';

      if (existingConfig.pollingInterval) {
        dom.pollingInterval.value = existingConfig.pollingInterval.toString();
      }

      if (existingConfig.devices?.length > 0) {
        const device = existingConfig.devices[0];
        if (device.cleaningMode) {
          dom.cleaningMode.value = device.cleaningMode;
          updateModeInfo(device.cleaningMode);
        }
        if (device.enableTemperature !== undefined) {
          dom.enableTemperature.checked = device.enableTemperature;
        }
        if (device.enableFilterStatus !== undefined) {
          dom.enableFilter.checked = device.enableFilterStatus;
        }

        showConfiguredRobots(existingConfig);
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  }

  // ============================================================================
  // Configured Robots View
  // ============================================================================

  function showConfiguredRobots(config) {
    if (!config.devices?.length) {
      return;
    }

    state.savedConfig = config;
    dom.configuredRobotsList.innerHTML = '';

    config.devices.forEach((device, index) => {
      const robotCard = createRobotCard(device, config.email, index);
      dom.configuredRobotsList.appendChild(robotCard);
    });

    showStep('configured');
  }

  function createRobotCard(device, email, deviceIndex) {
    const card = document.createElement('div');
    card.className = 'robot-card robot-card-clickable';

    const imageHtml = device.robotImageUrl
      ? `<img src="${device.robotImageUrl}" alt="${device.name}" class="robot-image"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
         <div class="robot-svg" style="display: none;">${ROBOT_SVG}</div>`
      : `<div class="robot-svg">${ROBOT_SVG}</div>`;

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
            <span class="detail-value">${getDeviceTypeLabel(device.deviceType)}</span>
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

    const editBtn = card.querySelector('.edit-robot-btn');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      editDevice(deviceIndex);
    });

    card.addEventListener('click', () => editDevice(deviceIndex));

    return card;
  }

  // ============================================================================
  // Edit Device
  // ============================================================================

  function editDevice(deviceIndex) {
    if (!state.savedConfig?.devices?.[deviceIndex]) {
      return;
    }

    const device = state.savedConfig.devices[deviceIndex];
    state.editingDeviceIndex = deviceIndex;

    state.robotData = {
      email: state.savedConfig.email,
      iotRegion: IOT_REGION,
      serialNumber: device.serialNumber,
      robotName: device.name,
      deviceType: device.deviceType,
      refreshToken: state.savedConfig.refreshToken,
    };

    updateRobotDisplay({
      robotName: device.name || 'Dolphin Robot',
      serialNumber: device.serialNumber || '-',
      deviceType: device.deviceType,
      robotImageUrl: device.robotImageUrl,
    });

    // Pre-fill form
    if (device.cleaningMode) {
      dom.cleaningMode.value = device.cleaningMode;
      updateModeInfo(device.cleaningMode);
    }
    if (state.savedConfig.pollingInterval) {
      dom.pollingInterval.value = state.savedConfig.pollingInterval.toString();
    }
    if (device.enableTemperature !== undefined) {
      dom.enableTemperature.checked = device.enableTemperature;
    }
    if (device.enableFilterStatus !== undefined) {
      dom.enableFilter.checked = device.enableFilterStatus;
    }

    // Update UI for editing mode
    const stepHeader = dom.steps.robot.querySelector('.step-header h2');
    const stepDesc = dom.steps.robot.querySelector('.step-description');

    if (stepHeader) {
      stepHeader.textContent = 'Edit Robot Settings';
    }
    if (stepDesc) {
      stepDesc.textContent = 'Update the settings for your Dolphin pool robot.';
    }

    dom.backBtn.onclick = () => {
      resetEditingState();
      showStep('configured');
    };

    showStep('robot');
  }

  function resetEditingState() {
    state.editingDeviceIndex = null;

    const stepHeader = dom.steps.robot.querySelector('.step-header h2');
    const stepDesc = dom.steps.robot.querySelector('.step-description');

    if (stepHeader) {
      stepHeader.textContent = 'Robot Found!';
    }
    if (stepDesc) {
      stepDesc.textContent = 'We found your Dolphin pool robot.';
    }
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  function setupEventListeners() {
    dom.loginForm.addEventListener('submit', handleLogin);
    dom.otpForm.addEventListener('submit', handleOtpVerify);
    dom.otpBackBtn.addEventListener('click', () => showStep('login'));
    dom.backBtn.addEventListener('click', () => showStep('login'));
    dom.saveBtn.addEventListener('click', handleSave);
    dom.doneBtn.addEventListener('click', handleDone);

    dom.addRobotBtn?.addEventListener('click', () => showStep('login'));
    dom.reconfigureBtn?.addEventListener('click', () => showStep('login'));

    dom.cleaningMode?.addEventListener('change', (e) => updateModeInfo(e.target.value));
  }

  function init() {
    detectDarkMode();
    setupEventListeners();
    loadSavedConfig();

    // Initialize cleaning mode info
    if (dom.cleaningMode) {
      updateModeInfo(dom.cleaningMode.value);
    }
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
