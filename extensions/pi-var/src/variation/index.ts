/**
 * Variation module exports
 */

export { createVariation } from './create.js';
export { removeVariation } from './remove.js';
export { createCoWVariation } from './create-cow.js';
export { createWorktreeVariation } from './create-worktree.js';
export { createCopyVariation } from './create-copy.js';
export { mergeVariation } from './merge/index.js';
export { detectMergeStrategy, hasGitRepo } from './merge/strategy.js';
export { getProjectName, getProjectHash, generateVariationId } from './paths.js';
export { detectCoWSupport } from '../cow/index.js';
