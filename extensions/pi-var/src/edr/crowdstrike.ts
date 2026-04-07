/**
 * CrowdStrike Falcon specific detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

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
