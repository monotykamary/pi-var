/**
 * Git merge strategy for worktree and git-backed CoW variations
 *
 * Worktrees share the same .git as the source, so `git merge <branch>` works directly.
 * CoW variations have their own .git (CoW-cloned from the source), so we add the
 * variation as a temporary remote, fetch the branch, merge, and clean up.
 *
 * Both paths give proper three-way merge semantics with conflict detection,
 * so merging Variation B after Variation A won't silently overwrite A's changes.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Variation, MergeOptions } from '../../types/index';

const execAsync = promisify(exec);

/**
 * Generate a temporary remote name for a CoW variation merge.
 * Uses a pi-var- prefix to avoid conflicts with user-defined remotes.
 */
function tempRemoteName(variation: Variation): string {
  // Sanitize the variation name for use as a git remote name
  const safe = variation.name.replace(/[^a-zA-Z0-9-_]/g, '-');
  return `pi-var-${safe}`;
}

/**
 * Merge a CoW variation via remote fetch.
 *
 * Flow:
 * 1. Commit any pending work in the variation
 * 2. Add variation as a temporary remote to the source
 * 3. Fetch the variation's branch
 * 4. Merge with three-way merge
 * 5. Clean up the temporary remote
 */
async function mergeCowViaRemote(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  if (!variation.branchName) {
    throw new Error('Cannot merge: CoW variation has no associated branch');
  }

  const remoteName = tempRemoteName(variation);

  // 1. Commit any pending work in the variation so it's all captured
  try {
    await execAsync(`git -C "${variation.path}" add -A`);
    // Use --allow-empty so this doesn't fail if there's nothing new to commit
    await execAsync(
      `git -C "${variation.path}" commit -m "variation work: ${variation.name}" --allow-empty`
    );
  } catch {
    // Nothing to commit or commit failed (e.g. empty repo) — proceed with what we have
  }

  // 2. Add variation as a temporary remote
  try {
    await execAsync(`git -C "${sourcePath}" remote add "${remoteName}" "${variation.path}"`);
  } catch {
    // Remote might already exist from a failed previous merge — update the URL
    try {
      await execAsync(`git -C "${sourcePath}" remote set-url "${remoteName}" "${variation.path}"`);
    } catch {
      throw new Error(`Failed to add temporary remote ${remoteName}`);
    }
  }

  try {
    // 3. Fetch the variation's branch
    await execAsync(`git -C "${sourcePath}" fetch "${remoteName}" "${variation.branchName}"`);

    // 4. Get current branch in source
    const { stdout: currentBranch } = await execAsync(
      `git -C "${sourcePath}" branch --show-current`
    );
    const targetBranch = currentBranch.trim();

    if (!targetBranch) {
      throw new Error('Cannot merge: source is in detached HEAD state');
    }

    if (options.dryRun) {
      // Show what would be merged
      const { stdout } = await execAsync(
        `git -C "${sourcePath}" diff "${targetBranch}...${remoteName}/${variation.branchName}" --stat`
      );
      return `Files that would be merged (via git three-way merge):\n${stdout}`;
    }

    // 5. Merge with three-way merge
    try {
      await execAsync(
        `git -C "${sourcePath}" merge "${remoteName}/${variation.branchName}" --no-edit`
      );
      return '';
    } catch (err) {
      // Merge conflict — report clearly so the user can resolve
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Git merge conflict. Resolve conflicts in ${sourcePath} and commit, then run:\n` +
          `  git -C "${sourcePath}" mergetool\n` +
          `  git -C "${sourcePath}" commit\n\n` +
          `Details: ${message}`
      );
    }
  } finally {
    // 6. Always clean up the temporary remote, even on failure
    try {
      await execAsync(`git -C "${sourcePath}" remote remove "${remoteName}"`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Merge a worktree variation directly (branch is in the same repo).
 */
async function mergeWorktreeDirect(
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
    return `Files that would be merged (via git three-way merge):\n${stdout}`;
  }

  // Merge the branch
  try {
    await execAsync(`git -C "${sourcePath}" merge "${variation.branchName}" --no-edit`);
    return '';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Git merge conflict. Resolve conflicts in ${sourcePath} and commit, then run:\n` +
        `  git -C "${sourcePath}" mergetool\n` +
        `  git -C "${sourcePath}" commit\n\n` +
        `Details: ${message}`
    );
  }
}

/**
 * Merge using git (for worktrees and git-backed CoW variations)
 */
export async function mergeWithGit(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  if (variation.type === 'cow') {
    return mergeCowViaRemote(variation, sourcePath, options);
  }

  return mergeWorktreeDirect(variation, sourcePath, options);
}
