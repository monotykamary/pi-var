/**
 * Environment setup and variation context detection module
 */

import type { VarConfig } from '../types/index';
import { copyEnvFiles } from './copy-env';
import { symlinkHeavyDirs } from './symlink';
import { detectVariationContext, detectVariationContextAsync } from './detect';
import { createVariationMarker, removeVariationMarker } from './marker';

// Default configuration for environment sync
export const DEFAULT_CONFIG = {
  copy: ['.env', '.env.*', '.envrc', '.npmrc', '.tool-versions'],
  symlink: ['node_modules', '.next', '.nuxt', 'target', '.venv'],
  postCreate: [],
};

/**
 * Setup the variation environment by copying env files and symlinking heavy directories
 */
export async function setupVariationEnvironment(
  source: string,
  variation: string,
  config: Partial<VarConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Copy environment files
  await copyEnvFiles(source, variation, mergedConfig.copy);

  // Symlink heavy directories
  await symlinkHeavyDirs(source, variation, mergedConfig.symlink);

  // Run post-create commands
  for (const cmd of mergedConfig.postCreate) {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      await execAsync(cmd, { cwd: variation });
    } catch (err) {
      console.warn(`Post-create command failed: ${cmd}`, err);
    }
  }
}

export {
  detectVariationContext,
  detectVariationContextAsync,
  createVariationMarker,
  removeVariationMarker,
  copyEnvFiles,
  symlinkHeavyDirs,
};
