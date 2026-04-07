/**
 * CoW variation creation using platform-specific clone methods
 */

import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { detectCoWSupport } from './detection';

const execAsync = promisify(exec);

/**
 * Create a CoW clone using platform-specific methods
 */
export async function createCoWVariation(sourcePath: string, destPath: string): Promise<void> {
  const platform = os.platform();
  const cowSupport = await detectCoWSupport(path.dirname(destPath));

  if (!cowSupport.supported) {
    throw new Error('CoW not supported on this platform/filesystem');
  }

  if (platform === 'darwin' && cowSupport.method === 'clonefile') {
    // macOS: Use cp -c for clonefile
    await execAsync(`cp -c -R "${sourcePath}" "${destPath}"`);
  } else if (platform === 'linux' && cowSupport.method === 'reflink') {
    // Linux: Use cp --reflink=auto
    await execAsync(`cp -a --reflink=auto "${sourcePath}" "${destPath}"`);
  } else {
    throw new Error(`Unsupported CoW method: ${cowSupport.method}`);
  }

  // Remove the .pi/variations directory from the clone to avoid recursion
  const nestedVariations = path.join(destPath, '.pi', 'variations');
  try {
    await fs.rm(nestedVariations, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
}
