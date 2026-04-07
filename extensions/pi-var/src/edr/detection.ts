/**
 * EDR detection utilities
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { EDR_PROCESSES, EDR_INFO } from './constants';
import type { EDRDetectionResult, EDRDetails } from '../types/index';

const execAsync = promisify(exec);

/**
 * Check if a specific process is running
 */
async function checkProcessRunning(processName: string, platform: string): Promise<boolean> {
  try {
    if (platform === 'darwin' || platform === 'linux') {
      // Use pgrep for Unix-like systems
      await execAsync(`pgrep -x "${processName}"`, { timeout: 5000 });
      return true;
    } else if (platform === 'win32') {
      // Use tasklist for Windows
      await execAsync(`tasklist /FI "IMAGENAME eq ${processName}.exe" /NH`, { timeout: 5000 });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

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
