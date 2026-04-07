/**
 * Git merge strategy for worktree variations
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Variation, MergeOptions } from '../../types/index';

const execAsync = promisify(exec);

/**
 * Merge using git (for worktrees)
 */
export async function mergeWithGit(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  if (!variation.branchName) {
    throw new Error('Cannot merge: variation has no associated branch');
  }

  // Get current branch in source
  const { stdout: currentBranch } = await execAsync(`git -C "${sourcePath}" branch --show-current`);
  const targetBranch = currentBranch.trim();

  if (!targetBranch) {
    throw new Error('Cannot merge: source is in detached HEAD state');
  }

  if (options.dryRun) {
    // Show what would be merged
    const { stdout } = await execAsync(
      `git -C "${sourcePath}" diff "${targetBranch}...${variation.branchName}" --stat`
    );
    return `Files that would be merged:\n${stdout}`;
  }

  // Merge the branch
  try {
    await execAsync(`git -C "${sourcePath}" merge "${variation.branchName}" --no-edit`);
    return '';
  } catch (err) {
    // Merge conflict or failure
    throw new Error(
      `Git merge failed: ${err}. Please resolve conflicts manually or use a different merge strategy.`
    );
  }
}
