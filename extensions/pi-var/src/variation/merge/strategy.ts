/**
 * Merge strategy detection
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Variation } from '../../types/index.js';

const execAsync = promisify(exec);

/**
 * Check if a directory contains a git repository
 */
export async function hasGitRepo(checkPath: string): Promise<boolean> {
  try {
    const gitDir = (await import('path')).join(checkPath, '.git');
    const { promises: fs } = await import('fs');
    const stat = await fs.stat(gitDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect the best merge strategy for a variation
 */
export async function detectMergeStrategy(
  variation: Variation,
  sourcePath: string
): Promise<'git' | 'rsync' | 'copy'> {
  // Prefer git for worktrees
  if (variation.type === 'worktree' && (await hasGitRepo(sourcePath))) {
    return 'git';
  }

  // Check for rsync
  try {
    await execAsync('which rsync');
    return 'rsync';
  } catch {
    // rsync not available
  }

  // Fall back to copy
  return 'copy';
}
