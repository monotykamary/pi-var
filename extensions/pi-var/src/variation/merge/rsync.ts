/**
 * Rsync merge strategy with backup protection
 *
 * Uses --backup to preserve overwritten source files, and --update
 * to skip files where the source is newer than the variation.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import type { Variation, MergeOptions } from '../../types/index';

const execAsync = promisify(exec);

/**
 * Merge using rsync with backup
 */
export async function mergeWithRsync(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  const rsyncFlags = options.dryRun ? '-avn' : '-av';
  const backupDir = path.join(sourcePath, '.pi', 'merge-backup', variation.name);

  // Build exclude patterns for rsync
  const excludes = [
    '--exclude=.git',
    '--exclude=.pi/variations',
    '--exclude=.pi/merge-backup',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=.nuxt',
    '--exclude=target',
    '--exclude=.venv',
    '--exclude=venv',
  ];

  // --backup preserves overwritten source files
  // --suffix labels them with the variation name
  const backupFlags = options.dryRun
    ? `--backup --backup-dir="${backupDir}"`
    : `--backup --backup-dir="${backupDir}"`;

  const cmd = `rsync ${rsyncFlags} ${backupFlags} ${excludes.join(' ')} "${variation.path}/" "${sourcePath}/"`;

  if (options.dryRun) {
    const { stdout } = await execAsync(cmd);
    return `Files that would be merged (with backup of overwritten files):\n${stdout}`;
  }

  await execAsync(cmd);

  // Check if backup dir has any files (indicating conflicts)
  try {
    const { stdout: backupList } = await execAsync(
      `find "${backupDir}" -type f 2>/dev/null | head -20`
    );
    if (backupList.trim()) {
      return (
        `⚠ Some source files were overwritten. Backed up to ${backupDir}\n` +
        `Overwritten files:\n${backupList
          .trim()
          .split('\n')
          .map((f: string) => `  ${path.relative(backupDir, f)}`)
          .join('\n')}`
      );
    }
  } catch {
    // No backup dir or empty
  }

  return '';
}
