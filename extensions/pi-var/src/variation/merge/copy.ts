/**
 * Copy merge strategy (fallback for non-git sources)
 *
 * Backs up any source file that differs from the variation's version
 * before overwriting, so data is never silently lost.
 * For proper three-way merge with conflict detection, use git-backed
 * CoW variations (source must be a git repo).
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
    '.pi/merge-backup',
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
 * Check if a source file differs from the variation's version.
 * When they differ, backing up the source version prevents data loss
 * regardless of which side changed.
 */
async function differsFromVariation(
  relativePath: string,
  variationPath: string,
  sourcePath: string
): Promise<boolean> {
  const sourceFile = path.join(sourcePath, relativePath);
  const variationFile = path.join(variationPath, relativePath);

  try {
    const [sourceContent, variationContent] = await Promise.all([
      fs.readFile(sourceFile),
      fs.readFile(variationFile),
    ]);

    // If files are identical, overwriting is a no-op
    return !sourceContent.equals(variationContent);
  } catch {
    // One of the files doesn't exist — new file or deleted, no backup needed
    return false;
  }
}

/**
 * Merge using direct file copy with backup protection
 */
export async function mergeWithCopy(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  // Get list of files to merge
  const files = await getFilesToMerge(variation.path, sourcePath);

  // Find files where the source version differs from the variation
  // (these will be overwritten — back them up to prevent data loss)
  const overwrittenFiles: string[] = [];
  const backupDir = path.join(sourcePath, '.pi', 'merge-backup', variation.name);

  for (const relativePath of files) {
    if (await differsFromVariation(relativePath, variation.path, sourcePath)) {
      overwrittenFiles.push(relativePath);
    }
  }

  if (options.dryRun) {
    const fileList = files.map((f) => `  ${f}`).join('\n');
    const overwrittenList = overwrittenFiles.length
      ? `\n\n⚠ Source files that differ from variation (will be backed up before overwrite):\n${overwrittenFiles.map((f) => `  ${f}`).join('\n')}\n  → Backups saved to .pi/merge-backup/${variation.name}/`
      : '';
    return `Files that would be merged:\n${fileList}${overwrittenList}`;
  }

  // Back up source files that will be overwritten with different content
  if (overwrittenFiles.length > 0) {
    await fs.mkdir(backupDir, { recursive: true });

    for (const relativePath of overwrittenFiles) {
      const sourceFile = path.join(sourcePath, relativePath);
      const backupFile = path.join(backupDir, relativePath);

      try {
        await fs.mkdir(path.dirname(backupFile), { recursive: true });
        await fs.copyFile(sourceFile, backupFile);
      } catch {
        // Source file may not exist — skip backup
      }
    }
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

  // Report overwritten files and backups
  if (overwrittenFiles.length > 0) {
    return (
      `⚠ ${overwrittenFiles.length} source file(s) overwritten. ` +
      `Originals backed up to ${backupDir}\n` +
      `Overwritten files:\n${overwrittenFiles.map((f) => `  ${f}`).join('\n')}`
    );
  }

  return '';
}
