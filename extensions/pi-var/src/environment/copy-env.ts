/**
 * Environment variable and file copying utilities
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Copy a single file if it exists
 */
async function copySingleFile(source: string, variation: string, filename: string): Promise<void> {
  const srcPath = path.join(source, filename);
  const destPath = path.join(variation, filename);

  try {
    await fs.access(srcPath);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // File doesn't exist in source, skip
  }
}

/**
 * Copy files matching a glob pattern
 */
async function copyGlobPattern(source: string, variation: string, pattern: string): Promise<void> {
  // Simple glob implementation - split pattern and match
  const [baseName, ...extParts] = pattern.split('*');
  const ext = extParts.join('*');

  try {
    const entries = await fs.readdir(source, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name;

        // Check if file matches pattern
        if (name.startsWith(baseName) && name.endsWith(ext)) {
          // Additional check: ensure middle part exists for patterns like .env.*
          if (pattern.includes('.*') && !name.slice(baseName.length, -ext.length || undefined)) {
            continue;
          }

          await copySingleFile(source, variation, name);
        }
      }
    }
  } catch (err) {
    // Directory doesn't exist or can't be read, skip
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Copy environment files from source to variation
 * Supports glob patterns like .env.*
 */
export async function copyEnvFiles(
  source: string,
  variation: string,
  patterns: string[]
): Promise<void> {
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      // Handle glob patterns
      await copyGlobPattern(source, variation, pattern);
    } else {
      // Handle exact file paths
      await copySingleFile(source, variation, pattern);
    }
  }
}
