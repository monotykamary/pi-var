/**
 * Copy merge strategy (fallback)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { Variation, MergeOptions } from '../../types/index';

/**
 * Get list of files that should be merged (excluding certain directories)
 */
async function getFilesToMerge(variationPath: string, sourcePath: string): Promise<string[]> {
  const files: string[] = [];
  const excludePatterns = [
    '.git',
    '.pi/variations',
    'node_modules',
    '.next',
    '.nuxt',
    'target',
    '.venv',
    'venv',
  ];

  async function scan(dir: string, relativeDir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(dir, entry.name);

      // Check if this path should be excluded
      if (excludePatterns.some((pattern) => relativePath.startsWith(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scan(fullPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  await scan(variationPath, '');
  return files;
}

/**
 * Merge using direct file copy
 */
export async function mergeWithCopy(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  // Get list of files to merge
  const files = await getFilesToMerge(variation.path, sourcePath);

  if (options.dryRun) {
    const fileList = files.map((f) => `  ${f}`).join('\n');
    return `Files that would be merged:\n${fileList}`;
  }

  // Copy each file
  for (const relativePath of files) {
    const srcFile = path.join(variation.path, relativePath);
    const destFile = path.join(sourcePath, relativePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(destFile), { recursive: true });

    // Copy file
    await fs.copyFile(srcFile, destFile);
  }
  return '';
}
