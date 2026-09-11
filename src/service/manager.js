'use strict';

/**
 * Cross-platform background service manager for PromptRelay.
 *
 * Supported OS platforms:
 *  - Windows: Scheduled Task (schtasks.exe) running at user logon / on-demand
 *  - Linux: systemd user service (~/.config/systemd/user/promptrelay.service)
 *  - macOS: launchd agent (~/Library/LaunchAgents/com.monem08.promptrelay.plist)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SERVICE_NAME = 'PromptRelay';
const SYSTEMD_UNIT_NAME = 'promptrelay.service';
const LAUNCHD_LABEL = 'com.monem08.promptrelay';

function getPlatform() {
  return process.platform; // 'win32', 'linux', 'darwin'
}

function getNodeExecutable() {
  return process.execPath;
}

function getServerScriptPath() {
  return path.resolve(__dirname, '..', 'server.js');
}

// ---------------------------------------------------------------------------
// Linux: systemd user service
// ---------------------------------------------------------------------------

function systemdUnitDir() {
  const home = os.homedir();
  return path.join(home, '.config', 'systemd', 'user');
}

function systemdUnitPath() {
  return path.join(systemdUnitDir(), SYSTEMD_UNIT_NAME);
}

function generateSystemdUnit(nodePath, serverPath, envFile) {
  const envFileLine = envFile && fs.existsSync(envFile) ? `EnvironmentFile=${envFile}\n` : '';
  return `[Unit]
Description=PromptRelay AI Gateway
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${serverPath}
Restart=always
RestartSec=3
Environment=NODE_ENV=production
${envFileLine}
[Install]
WantedBy=default.target
`;
}

// ---------------------------------------------------------------------------
// macOS: launchd agent
// ---------------------------------------------------------------------------

function launchdAgentDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function launchdPlistPath() {
  return path.join(launchdAgentDir(), `${LAUNCHD_LABEL}.plist`);
}

function generateLaunchdPlist(nodePath, serverPath) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${serverPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.promptrelay', 'service-error.log')}</string>
    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.promptrelay', 'service.log')}</string>
</dict>
</plist>
`;
}

// ---------------------------------------------------------------------------
// Service Manager API
// ---------------------------------------------------------------------------

/**
 * Check the status of the background service on the current OS.
 */
function status() {
  const platform = getPlatform();

  if (platform === 'win32') {
    try {
      const output = execSync(`schtasks /query /tn "${SERVICE_NAME}" /fo CSV /nh 2>nul`, { encoding: 'utf8' });
      const installed = output.includes(SERVICE_NAME);
      const running = output.toLowerCase().includes('running');
      return {
        platform,
        serviceType: 'Windows Scheduled Task',
        installed,
        running,
        name: SERVICE_NAME,
        details: output.trim(),
      };
    } catch {
      return {
        platform,
        serviceType: 'Windows Scheduled Task',
        installed: false,
        running: false,
        name: SERVICE_NAME,
        details: 'Not registered',
      };
    }
  }

  if (platform === 'darwin') {
    const plist = launchdPlistPath();
    const installed = fs.existsSync(plist);
    let running = false;
    if (installed) {
      try {
        const out = execSync(`launchctl list | grep ${LAUNCHD_LABEL} 2>/dev/null`, { encoding: 'utf8' });
        running = out.includes(LAUNCHD_LABEL);
      } catch {
        running = false;
      }
    }
    return {
      platform,
      serviceType: 'macOS launchd Agent',
      installed,
      running,
      path: plist,
      name: LAUNCHD_LABEL,
    };
  }

  // Linux / default
  const unitFile = systemdUnitPath();
  const installed = fs.existsSync(unitFile);
  let running = false;
  if (installed) {
    try {
      const out = execSync(`systemctl --user is-active ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { encoding: 'utf8' });
      running = out.trim() === 'active';
    } catch {
      running = false;
    }
  }
  return {
    platform,
    serviceType: 'Linux systemd user service',
    installed,
    running,
    path: unitFile,
    name: SYSTEMD_UNIT_NAME,
  };
}

/**
 * Install and enable the background service for the current OS.
 */
function install(options = {}) {
  const platform = getPlatform();
  const nodePath = getNodeExecutable();
  const serverPath = getServerScriptPath();

  if (platform === 'win32') {
    // Windows: Use schtasks to create a background task that runs on user logon
    const taskCmd = `schtasks /create /tn "${SERVICE_NAME}" /tr "\"${nodePath}\" \"${serverPath}\"" /sc onlogon /f`;
    try {
      execSync(taskCmd, { stdio: 'pipe' });
      return {
        success: true,
        platform,
        serviceType: 'Windows Scheduled Task',
        name: SERVICE_NAME,
        command: taskCmd,
      };
    } catch (err) {
      throw new Error(`Failed to create Windows Scheduled Task: ${err.message}`);
    }
  }

  if (platform === 'darwin') {
    const dir = launchdAgentDir();
    const plist = launchdPlistPath();
    fs.mkdirSync(dir, { recursive: true });
    const content = generateLaunchdPlist(nodePath, serverPath);
    fs.writeFileSync(plist, content, 'utf8');

    try {
      execSync(`launchctl load -w "${plist}" 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // May fail if already loaded
    }

    return {
      success: true,
      platform,
      serviceType: 'macOS launchd Agent',
      path: plist,
      name: LAUNCHD_LABEL,
    };
  }

  // Linux systemd
  const dir = systemdUnitDir();
  const unitFile = systemdUnitPath();
  fs.mkdirSync(dir, { recursive: true });
  const content = generateSystemdUnit(nodePath, serverPath, options.envFile);
  fs.writeFileSync(unitFile, content, 'utf8');

  try {
    execSync('systemctl --user daemon-reload 2>/dev/null', { stdio: 'pipe' });
    execSync(`systemctl --user enable --now ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' });
  } catch {
    // Non-fatal if systemd user daemon is not running in test container
  }

  return {
    success: true,
    platform,
    serviceType: 'Linux systemd user service',
    path: unitFile,
    name: SYSTEMD_UNIT_NAME,
  };
}

/**
 * Uninstall and disable the background service for the current OS.
 */
function uninstall() {
  const platform = getPlatform();

  if (platform === 'win32') {
    try {
      execSync(`schtasks /end /tn "${SERVICE_NAME}" 2>nul`, { stdio: 'pipe' });
    } catch {}
    try {
      execSync(`schtasks /delete /tn "${SERVICE_NAME}" /f 2>nul`, { stdio: 'pipe' });
      return { success: true, platform, removed: true };
    } catch (err) {
      return { success: false, platform, removed: false, error: err.message };
    }
  }

  if (platform === 'darwin') {
    const plist = launchdPlistPath();
    if (fs.existsSync(plist)) {
      try { execSync(`launchctl unload "${plist}" 2>/dev/null`, { stdio: 'pipe' }); } catch {}
      try { fs.unlinkSync(plist); } catch {}
      return { success: true, platform, removed: true };
    }
    return { success: true, platform, removed: false, note: 'Service plist not found' };
  }

  // Linux
  const unitFile = systemdUnitPath();
  if (fs.existsSync(unitFile)) {
    try { execSync(`systemctl --user stop ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
    try { execSync(`systemctl --user disable ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
    try { fs.unlinkSync(unitFile); } catch {}
    try { execSync('systemctl --user daemon-reload 2>/dev/null', { stdio: 'pipe' }); } catch {}
    return { success: true, platform, removed: true };
  }
  return { success: true, platform, removed: false, note: 'Unit file not found' };
}

/**
 * Start the background service.
 */
function start() {
  const platform = getPlatform();
  if (platform === 'win32') {
    execSync(`schtasks /run /tn "${SERVICE_NAME}" 2>nul`, { stdio: 'pipe' });
    return { success: true, action: 'start' };
  }
  if (platform === 'darwin') {
    const plist = launchdPlistPath();
    execSync(`launchctl start ${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' });
    return { success: true, action: 'start' };
  }
  execSync(`systemctl --user start ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' });
  return { success: true, action: 'start' };
}

/**
 * Stop the background service.
 */
function stop() {
  const platform = getPlatform();
  if (platform === 'win32') {
    execSync(`schtasks /end /tn "${SERVICE_NAME}" 2>nul`, { stdio: 'pipe' });
    return { success: true, action: 'stop' };
  }
  if (platform === 'darwin') {
    execSync(`launchctl stop ${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' });
    return { success: true, action: 'stop' };
  }
  execSync(`systemctl --user stop ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' });
  return { success: true, action: 'stop' };
}

/**
 * Restart the background service.
 */
function restart() {
  const platform = getPlatform();
  if (platform === 'win32') {
    try { execSync(`schtasks /end /tn "${SERVICE_NAME}" 2>nul`, { stdio: 'pipe' }); } catch {}
    execSync(`schtasks /run /tn "${SERVICE_NAME}" 2>nul`, { stdio: 'pipe' });
    return { success: true, action: 'restart' };
  }
  if (platform === 'darwin') {
    try { execSync(`launchctl stop ${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
    execSync(`launchctl start ${LAUNCHD_LABEL} 2>/dev/null`, { stdio: 'pipe' });
    return { success: true, action: 'restart' };
  }
  execSync(`systemctl --user restart ${SYSTEMD_UNIT_NAME} 2>/dev/null`, { stdio: 'pipe' });
  return { success: true, action: 'restart' };
}

module.exports = {
  SERVICE_NAME,
  SYSTEMD_UNIT_NAME,
  LAUNCHD_LABEL,
  status,
  install,
  uninstall,
  start,
  stop,
  restart,
  generateSystemdUnit,
  generateLaunchdPlist,
};

