/**
 * Variation removal and cleanup
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { Variation } from '../types/index';

const execAsync = promisify(exec);

/**
 * Remove a variation
 */
export async function removeVariation(variation: Variation): Promise<void> {
  // Clean up based on variation type
  switch (variation.type) {
    case 'worktree':
      // Remove git worktree
      try {
        await execAsync(
          `git -C "${variation.sourcePath}" worktree remove "${variation.path}" --force`
        );
      } catch {
        // If worktree remove fails, try manual cleanup
        await fs.rm(variation.path, { recursive: true, force: true });
      }

      // Remove branch if we created it
      if (variation.branchName?.startsWith('var/')) {
        try {
          await execAsync(`git -C "${variation.sourcePath}" branch -D "${variation.branchName}"`);
        } catch {
          // Ignore branch deletion errors
        }
      }
      break;

    case 'cow':
    case 'copy':
      // Simple directory removal
      await fs.rm(variation.path, { recursive: true, force: true });
      break;
  }

  // Clean up empty parent directories
  try {
    const baseDir = path.dirname(variation.path);
    const entries = await fs.readdir(baseDir);
    if (entries.length === 0) {
      await fs.rmdir(baseDir);

      // Try to clean up .pi/variations if empty
      const variationsDir = path.dirname(baseDir);
      const varEntries = await fs.readdir(variationsDir);
      if (varEntries.length === 0) {
        await fs.rmdir(variationsDir);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}
