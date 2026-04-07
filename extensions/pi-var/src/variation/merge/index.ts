/**
 * Variation merge orchestration
 */

import type { Variation, MergeOptions } from '../../types/index';
import { detectMergeStrategy } from './strategy';
import { mergeWithGit } from './git';
import { mergeWithRsync } from './rsync';
import { mergeWithCopy } from './copy';

/**
 * Merge a variation back to source
 */
export async function mergeVariation(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions = {}
): Promise<string> {
  const strategy = options.strategy || 'auto';
  const effectiveStrategy =
    strategy === 'auto' ? await detectMergeStrategy(variation, sourcePath) : strategy;

  let result = '';
  switch (effectiveStrategy) {
    case 'git':
      result = await mergeWithGit(variation, sourcePath, options);
      break;
    case 'rsync':
      result = await mergeWithRsync(variation, sourcePath, options);
      break;
    default:
      result = await mergeWithCopy(variation, sourcePath, options);
  }

  return result;
}
