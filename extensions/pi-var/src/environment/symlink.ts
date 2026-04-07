/**
 * Symlink management for heavy directories
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Create symlinks for heavy directories (node_modules, .next, etc.)
 */
export async function symlinkHeavyDirs(
  source: string,
  variation: string,
  dirNames: string[]
): Promise<void> {
  for (const dirName of dirNames) {
    const srcPath = path.join(source, dirName);
    const destPath = path.join(variation, dirName);

    try {
      // Check if source directory exists
      const stat = await fs.stat(srcPath);
      if (!stat.isDirectory()) {
        continue;
      }

      // Ensure the variation parent directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true });

      // Remove destination if it exists (but is not a symlink)
      try {
        const destStat = await fs.lstat(destPath);
        if (destStat.isSymbolicLink()) {
          // Already a symlink, might be from previous setup
          await fs.unlink(destPath);
        } else if (destStat.isDirectory()) {
          // It's a directory - remove it to replace with symlink
          await fs.rm(destPath, { recursive: true });
        } else {
          // It's a file
          await fs.unlink(destPath);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
        // Destination doesn't exist, proceed
      }

      // Create the symlink
      // Use relative path for portability
      const relativeSrc = path.relative(path.dirname(destPath), srcPath);
      await fs.symlink(relativeSrc, destPath, 'junction');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Source directory doesn't exist, skip
        continue;
      }
      // Log but don't throw - symlinks are optional optimizations
      console.warn(`Failed to symlink ${dirName}:`, (err as Error).message);
    }
  }
}

/**
 * Remove symlinks from a variation (before merge or delete)
 * @internal Not currently used but kept for future cleanup operations
 */
async function removeSymlinks(variation: string): Promise<void> {
  try {
    const entries = await fs.readdir(variation, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const linkPath = path.join(variation, entry.name);
        await fs.unlink(linkPath);
      }
    }
  } catch (err) {
    // Ignore errors during cleanup
  }
}
