/**
 * Merge strategy detection
 *
 * CoW variations with a git branch (created from a git repo source)
 * use git merge for proper three-way merge semantics — just like worktrees.
 * CoW variations without a branch (non-git source) fall back to rsync/copy.
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
 *
 * Priority:
 * 1. git — for worktrees (branch in same repo) and git-backed CoW (branch in variation repo)
 * 2. rsync — for non-git CoW/copy when rsync is available
 * 3. copy — fallback
 */
export async function detectMergeStrategy(
  variation: Variation,
  sourcePath: string
): Promise<'git' | 'rsync' | 'copy'> {
  // Prefer git for worktrees (branch is in the same repo as source)
  if (variation.type === 'worktree' && (await hasGitRepo(sourcePath))) {
    return 'git';
  }

  // Prefer git for CoW variations that have a branch (source was a git repo)
  // The branch is in the variation's own .git, so we merge via remote fetch.
  if (variation.type === 'cow' && variation.branchName && (await hasGitRepo(sourcePath))) {
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
