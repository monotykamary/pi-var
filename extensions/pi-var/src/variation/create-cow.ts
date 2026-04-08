/**
 * CoW variation creation with git branch initialization
 *
 * After the CoW clone (delegated to cow/clone.ts), if the source is a git repo,
 * we create a branch inside the variation and commit any uncommitted changes
 * from the source. This gives CoW variations a proper merge base for three-way
 * git merge, solving the "overwrite previous merges" and "dirty base" problems.
 */

import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { createCoWClone } from '../cow/clone';

const execAsync = promisify(exec);

/** Result of CoW variation creation with optional git metadata */
interface CoWCreationResult {
  /** Git branch name, if variation was initialized in a git repo */
  branchName?: string;
  /** The commit SHA the branch was created from (merge base) */
  mergeBaseCommit?: string;
}

/**
 * Create a CoW variation: clone the source, then initialize a git branch.
 *
 * The CoW clone is delegated to cow/clone.ts (platform-specific cp -c / --reflink).
 * Then, if .git exists in the clone, we create a var/<name> branch and commit
 * any uncommitted changes from the source as an initial commit.
 */
export async function createCoWVariation(
  sourcePath: string,
  destPath: string,
  variationName: string
): Promise<CoWCreationResult> {
  // 1. CoW clone (platform-specific, includes .git if present)
  await createCoWClone(sourcePath, destPath);

  // 2. Initialize git branch in the variation (if .git exists)
  // This gives us proper merge semantics — the branch creates a named ref
  // and the initial commit captures the source's working tree state at
  // creation time (including any uncommitted changes).
  const result: CoWCreationResult = {};

  try {
    const gitDir = path.join(destPath, '.git');
    await fs.access(gitDir);

    // Record the current HEAD commit as the merge base
    // This is the commit BEFORE any variation-specific changes,
    // so it serves as the common ancestor for three-way merge.
    const { stdout: headCommit } = await execAsync(`git -C "${destPath}" rev-parse HEAD`);
    result.mergeBaseCommit = headCommit.trim();

    // Create a named branch in the variation's git repo
    const branchName = `var/${variationName}`;
    await execAsync(`git -C "${destPath}" checkout -b "${branchName}"`);
    result.branchName = branchName;

    // Capture any uncommitted changes from the source as an initial commit.
    // This records "what the source looked like" at creation time —
    // including dirty working tree files — so that the merge base is
    // accurate even if the source had uncommitted changes.
    try {
      await execAsync(`git -C "${destPath}" add -A`);
      await execAsync(
        `git -C "${destPath}" commit -m "variation base: ${variationName}" --allow-empty`
      );
    } catch {
      // Nothing to commit — source was clean. The branch already points
      // to the right commit, so this is fine.
    }
  } catch {
    // No .git directory — source is not a git repo.
    // Skip git branch setup; merge will fall back to rsync/copy.
  }

  return result;
}
