/**
 * Rsync merge strategy
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { Variation, MergeOptions } from '../../types/index';

const execAsync = promisify(exec);

/**
 * Merge using rsync
 */
export async function mergeWithRsync(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  const rsyncFlags = options.dryRun ? '-avn' : '-av';

  // Build exclude patterns for rsync
  const excludes = [
    '--exclude=.git',
    '--exclude=.pi/variations',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=.nuxt',
    '--exclude=target',
    '--exclude=.venv',
    '--exclude=venv',
  ];

  const cmd = `rsync ${rsyncFlags} ${excludes.join(' ')} "${variation.path}/" "${sourcePath}/"`;

  if (options.dryRun) {
    const { stdout } = await execAsync(cmd);
    return `Files that would be merged:\n${stdout}`;
  }

  await execAsync(cmd);
  return '';
}
