/**
 * Git worktree variation creation
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Create a git worktree variation
 */
export async function createWorktreeVariation(
  sourcePath: string,
  destPath: string,
  name: string,
  createBranch?: boolean
): Promise<string | undefined> {
  const branchName = createBranch ? `var/${name}` : undefined;

  if (branchName) {
    // Create new branch and worktree
    await execAsync(`git -C "${sourcePath}" branch "${branchName}"`);
    await execAsync(`git -C "${sourcePath}" worktree add "${destPath}" "${branchName}"`);
  } else {
    // Add worktree from current HEAD (detached)
    await execAsync(`git -C "${sourcePath}" worktree add --detach "${destPath}"`);
  }

  return branchName;
}
