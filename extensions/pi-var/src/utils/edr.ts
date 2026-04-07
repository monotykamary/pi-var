/**
 * EDR (Endpoint Detection and Response) detection utilities
 * Detects security software that may interfere with CoW operations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

/**
 * Known EDR/AV process names by platform
 */
const EDR_PROCESSES: Record<string, string[]> = {
  darwin: [
    'Falcon', // CrowdStrike Falcon
    'falconctl', // CrowdStrike CLI
    'SentinelAgent', // SentinelOne
    'SentinelOne', // SentinelOne alternative
    'CylanceSvc', // Cylance
    'CylanceUI', // Cylance UI
    'eset_daemon', // ESET
    'eset_nod32', // ESET NOD32
    'kav', // Kaspersky
    'kaspersky', // Kaspersky
    'SophosScanD', // Sophos
    'SophosMRT', // Sophos MRT
    'sophosscan', // Sophos
    'com.symantec.nfm', // Symantec/Norton
    'norton', // Norton
    'mcshield', // McAfee
    'McAfee', // McAfee
    '的趋势', // Trend Micro (UTF-8)
    'TrendMicro', // Trend Micro
    'tmux', // Trend Micro
    'CbDefense', // Carbon Black/VMware
    'cbdaemon', // Carbon Black daemon
    'xagt', // FireEye/XAGENT
    'osqueryd', // osquery (often used for EDR)
    'elastic-agent', // Elastic Security
    'elastic-endpoint', // Elastic Endpoint
    'jamf', // Jamf (MDM+security)
    'defense', // Apple XProtect
    'RTProtectionDaemon', // Various macOS AV
  ],
  linux: [
    'falcon-sensor', // CrowdStrike Falcon
    'falconctl', // CrowdStrike CLI
    'sentinel-agent', // SentinelOne
    'sentinelone', // SentinelOne alternative
    'cylancesvc', // Cylance
    'cylanceui', // Cylance UI
    'eset_daemon', // ESET
    'klnagent', // Kaspersky
    'kav', // Kaspersky
    'savscand', // Sophos
    'sophos', // Sophos
    'nscd', // Symantec
    'symcscan', // Symantec
    'mcshield', // McAfee
    'nailsd', // McAfee Linux
    'TrendMicro', // Trend Micro
    'ds_agent', // Trend Micro Deep Security
    'cbdaemon', // Carbon Black
    'xagt', // FireEye
    'osqueryd', // osquery
    'elastic-agent', // Elastic Security
    'elastic-endpoint', // Elastic Endpoint
    'filebeat', // Elastic Filebeat (often used with security)
    'auditd', // Linux audit daemon (security monitoring)
    'apparmor', // AppArmor
    'selinux', // SELinux userspace tools
    'clamd', // ClamAV
    'freshclam', // ClamAV updater
  ],
  win32: [
    'CSAgent', // CrowdStrike (csagent service)
    'CSFalconService', // CrowdStrike service
    'SentinelAgent', // SentinelOne
    'SentinelServiceHost', // SentinelOne service
    'CylanceSvc', // Cylance
    'CylanceUI', // Cylance UI
    'ekrn', // ESET
    'avp', // Kaspersky
    'avpui', // Kaspersky UI
    'avps', // Kaspersky service
    'SavService', // Sophos
    'SophosSafestore64', // Sophos
    'SymCorpUI', // Symantec
    'ccSvcHst', // Symantec service
    'mcshield', // McAfee
    'ModuleCoreService', // McAfee
    'mcsvc', // McAfee
    'TmListen', // Trend Micro
    'TmProxy', // Trend Micro
    'TmCCSF', // Trend Micro
    'CbDefense', // Carbon Black
    'repwx', // Carbon Black
    'xagt', // FireEye
    'osqueryd', // osquery
    'elastic-agent', // Elastic Security
    'elastic-endpoint', // Elastic Endpoint
    'MsMpEng', // Microsoft Defender
    'MsSense', // Microsoft Defender for Endpoint
    'Sense', // Microsoft Defender for Endpoint
    'WdFilter', // Windows Defender filter driver
    'clamav', // ClamAV
    'ImmunetProtect', // Cisco Immunet
    'cyserver', // Cylance
  ],
};

/**
 * EDR detection result
 */
export interface EDRDetectionResult {
  /** Whether any EDR was detected */
  detected: boolean;
  /** List of detected EDR process names */
  found: string[];
  /** Detailed info about each detected EDR */
  details: EDRDetails[];
}

/**
 * Detailed information about a detected EDR
 */
export interface EDRDetails {
  /** Process name */
  process: string;
  /** EDR vendor/product name */
  product: string;
  /** Whether this EDR is known to significantly impact CoW operations */
  knownSlowCoW: boolean;
}

// Mapping of process names to product names and CoW impact
const EDR_INFO: Record<string, { product: string; knownSlowCoW: boolean }> = {
  // CrowdStrike - major CoW impact
  Falcon: { product: 'CrowdStrike Falcon', knownSlowCoW: true },
  falconctl: { product: 'CrowdStrike Falcon', knownSlowCoW: true },
  'falcon-sensor': { product: 'CrowdStrike Falcon', knownSlowCoW: true },
  CSAgent: { product: 'CrowdStrike Falcon', knownSlowCoW: true },
  CSFalconService: { product: 'CrowdStrike Falcon', knownSlowCoW: true },

  // SentinelOne - major CoW impact
  SentinelAgent: { product: 'SentinelOne', knownSlowCoW: true },
  SentinelOne: { product: 'SentinelOne', knownSlowCoW: true },
  SentinelServiceHost: { product: 'SentinelOne', knownSlowCoW: true },
  'sentinel-agent': { product: 'SentinelOne', knownSlowCoW: true },
  sentinelone: { product: 'SentinelOne', knownSlowCoW: true },

  // Cylance - moderate to high CoW impact
  CylanceSvc: { product: 'Cylance', knownSlowCoW: true },
  CylanceUI: { product: 'Cylance', knownSlowCoW: true },
  cylancesvc: { product: 'Cylance', knownSlowCoW: true },
  cylanceui: { product: 'Cylance', knownSlowCoW: true },
  cyserver: { product: 'Cylance', knownSlowCoW: true },

  // Carbon Black - moderate CoW impact
  CbDefense: { product: 'Carbon Black/VMware', knownSlowCoW: true },
  cbdaemon: { product: 'Carbon Black/VMware', knownSlowCoW: true },
  repwx: { product: 'Carbon Black/VMware', knownSlowCoW: true },

  // Microsoft Defender for Endpoint - moderate CoW impact
  MsSense: { product: 'Microsoft Defender for Endpoint', knownSlowCoW: true },
  Sense: { product: 'Microsoft Defender for Endpoint', knownSlowCoW: true },

  // FireEye - high CoW impact
  xagt: { product: 'FireEye/XAGENT', knownSlowCoW: true },

  // Traditional AV - generally lower CoW impact but still present
  eset_daemon: { product: 'ESET', knownSlowCoW: false },
  eset_nod32: { product: 'ESET', knownSlowCoW: false },
  ekrn: { product: 'ESET', knownSlowCoW: false },
  kav: { product: 'Kaspersky', knownSlowCoW: false },
  kaspersky: { product: 'Kaspersky', knownSlowCoW: false },
  klnagent: { product: 'Kaspersky', knownSlowCoW: false },
  avp: { product: 'Kaspersky', knownSlowCoW: false },
  avpui: { product: 'Kaspersky', knownSlowCoW: false },
  avps: { product: 'Kaspersky', knownSlowCoW: false },
  SophosScanD: { product: 'Sophos', knownSlowCoW: false },
  SophosMRT: { product: 'Sophos', knownSlowCoW: false },
  sophosscan: { product: 'Sophos', knownSlowCoW: false },
  savscand: { product: 'Sophos', knownSlowCoW: false },
  sophos: { product: 'Sophos', knownSlowCoW: false },
  SavService: { product: 'Sophos', knownSlowCoW: false },
  SophosSafestore64: { product: 'Sophos', knownSlowCoW: false },
  'com.symantec.nfm': { product: 'Symantec/Norton', knownSlowCoW: false },
  norton: { product: 'Symantec/Norton', knownSlowCoW: false },
  SymCorpUI: { product: 'Symantec', knownSlowCoW: false },
  ccSvcHst: { product: 'Symantec', knownSlowCoW: false },
  nscd: { product: 'Symantec', knownSlowCoW: false },
  symcscan: { product: 'Symantec', knownSlowCoW: false },
  mcshield: { product: 'McAfee', knownSlowCoW: false },
  mcsvc: { product: 'McAfee', knownSlowCoW: false },
  ModuleCoreService: { product: 'McAfee', knownSlowCoW: false },
  nailsd: { product: 'McAfee', knownSlowCoW: false },
  的趋势: { product: 'Trend Micro', knownSlowCoW: false },
  TrendMicro: { product: 'Trend Micro', knownSlowCoW: false },
  tmux: { product: 'Trend Micro', knownSlowCoW: false },
  ds_agent: { product: 'Trend Micro Deep Security', knownSlowCoW: false },
  TmListen: { product: 'Trend Micro', knownSlowCoW: false },
  TmProxy: { product: 'Trend Micro', knownSlowCoW: false },
  TmCCSF: { product: 'Trend Micro', knownSlowCoW: false },

  // Microsoft Defender (standard) - generally lower impact
  MsMpEng: { product: 'Microsoft Defender', knownSlowCoW: false },
  WdFilter: { product: 'Windows Defender', knownSlowCoW: false },

  // Open source/enterprise tools - variable impact
  osqueryd: { product: 'osquery', knownSlowCoW: false },
  'elastic-agent': { product: 'Elastic Security', knownSlowCoW: false },
  'elastic-endpoint': { product: 'Elastic Security', knownSlowCoW: false },
  filebeat: { product: 'Elastic Filebeat', knownSlowCoW: false },
  clamd: { product: 'ClamAV', knownSlowCoW: false },
  freshclam: { product: 'ClamAV', knownSlowCoW: false },
  ImmunetProtect: { product: 'Cisco Immunet', knownSlowCoW: false },

  // Linux security tools
  auditd: { product: 'Linux audit daemon', knownSlowCoW: false },
  apparmor: { product: 'AppArmor', knownSlowCoW: false },
  selinux: { product: 'SELinux', knownSlowCoW: false },

  // macOS specific
  defense: { product: 'Apple XProtect', knownSlowCoW: false },
  RTProtectionDaemon: { product: 'macOS RTProtection', knownSlowCoW: false },
  jamf: { product: 'Jamf', knownSlowCoW: false },
};

/**
 * Detect EDR/AV software running on the system
 * Uses multiple detection methods for robustness
 */
export async function detectEDR(): Promise<EDRDetectionResult> {
  const platform = os.platform();
  const processes = EDR_PROCESSES[platform] || [];
  const found: string[] = [];
  const details: EDRDetails[] = [];

  for (const proc of processes) {
    try {
      const isRunning = await checkProcessRunning(proc, platform);
      if (isRunning && !found.includes(proc)) {
        found.push(proc);
        const info = EDR_INFO[proc] || { product: proc, knownSlowCoW: false };
        details.push({
          process: proc,
          product: info.product,
          knownSlowCoW: info.knownSlowCoW,
        });
      }
    } catch {
      // Ignore errors for individual process checks
    }
  }

  return {
    detected: found.length > 0,
    found,
    details,
  };
}

/**
 * Check if a specific process is running
 */
async function checkProcessRunning(processName: string, platform: string): Promise<boolean> {
  try {
    if (platform === 'darwin' || platform === 'linux') {
      // Use pgrep for Unix-like systems
      // -x requires exact match, -l lists process name
      await execAsync(`pgrep -x "${processName}"`, { timeout: 5000 });
      return true;
    } else if (platform === 'win32') {
      // Use tasklist for Windows
      // /FI filters by image name, /NH suppresses header
      await execAsync(`tasklist /FI "IMAGENAME eq ${processName}.exe" /NH`, { timeout: 5000 });
      return true;
    }
    return false;
  } catch {
    // Process not found or command failed
    return false;
  }
}

/**
 * Check specifically for CrowdStrike Falcon (most common CoW blocker)
 * Uses platform-specific methods for reliable detection
 */
export async function detectCrowdStrike(): Promise<boolean> {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      // Check for falconctl binary
      try {
        await execAsync('which falconctl', { timeout: 5000 });
        return true;
      } catch {
        // falconctl not in PATH, check for the app
        const { execSync } = await import('child_process');
        try {
          execSync('test -d /Applications/Falcon.app', { stdio: 'ignore' });
          return true;
        } catch {
          // App not found
        }
      }
    } else if (platform === 'linux') {
      // Check for falcon-sensor service or binary
      try {
        await execAsync('which falconctl', { timeout: 5000 });
        return true;
      } catch {
        // Check systemctl
        try {
          await execAsync('systemctl is-active falcon-sensor', { timeout: 5000 });
          return true;
        } catch {
          // Service not active
        }
      }
    } else if (platform === 'win32') {
      // Check for csagent service
      try {
        await execAsync('sc query csagent', { timeout: 5000 });
        return true;
      } catch {
        // Service not found
      }
    }
  } catch {
    // Any error means not detected
  }

  return false;
}

/**
 * Check if any known CoW-slowing EDR is present
 */
export function hasSlowCoWEDR(result: EDRDetectionResult): boolean {
  return result.details.some((d) => d.knownSlowCoW);
}

/**
 * Get human-readable EDR summary for UI display
 */
export function getEDRSummary(result: EDRDetectionResult): string {
  if (!result.detected) {
    return 'No EDR/AV software detected';
  }

  const slowEdrs = result.details.filter((d) => d.knownSlowCoW);
  const otherEdrs = result.details.filter((d) => !d.knownSlowCoW);

  let summary = '';

  if (slowEdrs.length > 0) {
    summary += `CoW-impacting EDR detected: ${slowEdrs.map((d) => d.product).join(', ')}`;
  }

  if (otherEdrs.length > 0) {
    if (summary) summary += '; ';
    summary += `Other security software: ${otherEdrs.map((d) => d.product).join(', ')}`;
  }

  return summary;
}
