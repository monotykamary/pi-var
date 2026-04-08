/**
 * Variation creation orchestration
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import type { Variation, VariationType, CreateVariationOptions } from '../types/index';
import { detectCoWSupport } from '../cow/index';
import { hasGitRepo } from './merge/strategy';
import { createCoWVariation } from './create-cow';
import { createWorktreeVariation } from './create-worktree';
import { createCopyVariation } from './create-copy';
import { ensureGlobalGitignore } from '../gitignore/manager';
import { getProjectName, getProjectHash, generateVariationId } from './paths';
import { generateVariationName } from '../utils/names';

/**
 * Get the base directory for variations
 */
function getVariationsBaseDir(sourcePath: string): string {
  const projectName = getProjectName(sourcePath);
  const projectHash = getProjectHash(sourcePath);
  return path.join(sourcePath, '.pi', 'variations', `${projectName}-${projectHash}`);
}

/**
 * Create a new variation
 * Auto-selects type: cow > worktree > copy
 *
 * CoW variations in git repos automatically get a branch and initial commit
 * for proper three-way merge semantics (see create-cow.ts).
 */
export async function createVariation(
  sourcePath: string,
  options: CreateVariationOptions = {}
): Promise<Variation> {
  const name = options.name || generateVariationName();
  const id = generateVariationId();
  const baseDir = getVariationsBaseDir(sourcePath);
  const variationPath = path.join(baseDir, name);

  // Ensure base directory exists
  await fs.mkdir(baseDir, { recursive: true });

  // Check if variation already exists
  try {
    await fs.access(variationPath);
    throw new Error(`Variation "${name}" already exists at ${variationPath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  let type: VariationType;
  let branchName: string | undefined;
  let mergeBaseCommit: string | undefined;

  // Determine variation type
  if (options.type) {
    type = options.type;
  } else {
    // Auto-select based on CoW detection result (includes EDR awareness)
    const cowResult = await detectCoWSupport(baseDir);
    const isGitRepo = await hasGitRepo(sourcePath);

    // Use the recommended type from detection
    type = cowResult.recommendedType;

    // If worktree is recommended but not a git repo, fall back to copy
    if (type === 'worktree' && !isGitRepo) {
      type = 'copy';
    }

    // Log EDR detection info if relevant (for debugging/visibility)
    if (cowResult.edr?.detected) {
      const edrList = cowResult.edr.products.join(', ');
      console.log(`[pi-var] Security software detected: ${edrList}`);

      if (cowResult.edr.hasSlowCoWEDR && cowResult.performance && !cowResult.performance.fast) {
        console.log(
          `[pi-var] CoW performance impacted (${cowResult.performance.durationMs.toFixed(1)}ms). ` +
            `Using ${type} instead.`
        );
      }
    }
  }

  // Create variation based on type
  switch (type) {
    case 'cow': {
      // CoW now returns git metadata when the source is a git repo
      const cowResult = await createCoWVariation(sourcePath, variationPath, name);
      branchName = cowResult.branchName;
      mergeBaseCommit = cowResult.mergeBaseCommit;
      break;
    }
    case 'worktree':
      branchName = await createWorktreeVariation(
        sourcePath,
        variationPath,
        name,
        options.createBranch
      );
      break;
    case 'copy':
      await createCopyVariation(sourcePath, variationPath);
      break;
  }

  // Ensure global gitignore ignores .pi/variations/ directories
  ensureGlobalGitignore();

  const now = new Date().toISOString();

  return {
    id,
    name,
    path: variationPath,
    sourcePath,
    type,
    createdAt: now,
    lastAccessed: now,
    branchName,
    mergeBaseCommit,
  };
}
