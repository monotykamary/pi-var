/**
 * Environment setup and variation context detection
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Variation, VarConfig, VariationContext } from '../types/index.js';

const execAsync = promisify(exec);

// Default configuration for environment sync
export const DEFAULT_CONFIG: VarConfig = {
  copy: ['.env', '.env.*', '.envrc', '.npmrc', '.tool-versions'],
  symlink: ['node_modules', '.next', '.nuxt', 'target', '.venv'],
  postCreate: [],
  usePortless: false,
};

/**
 * Setup the variation environment by copying env files and symlinking heavy directories
 */
export async function setupVariationEnvironment(
  source: string,
  variation: string,
  config: Partial<VarConfig> = {}
): Promise<void> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Copy environment files
  await copyEnvFiles(source, variation, mergedConfig.copy);

  // Symlink heavy directories
  await symlinkHeavyDirs(source, variation, mergedConfig.symlink);

  // Run post-create commands
  for (const cmd of mergedConfig.postCreate) {
    try {
      await execAsync(cmd, { cwd: variation });
    } catch (err) {
      console.warn(`Post-create command failed: ${cmd}`, err);
    }
  }
}

/**
 * Detect variation context from current working directory
 * Returns information about whether we're in a variation and which one
 */
export function detectVariationContext(cwd: string): VariationContext {
  // Normalize path
  const normalizedCwd = path.resolve(cwd);

  // Check if we're inside a .pi/variations directory structure
  const variationsPattern = /[\/\\]\.pi[\/\\]variations[\/\\][^\/\\]+[\/\\]([^\/\\]+)[\/\\]?/;
  const match = normalizedCwd.match(variationsPattern);

  if (match) {
    const variationName = match[1];
    const variationPath = normalizedCwd.substring(
      0,
      normalizedCwd.indexOf(match[0]) + match[0].length
    );

    // Find source path (go up to project root)
    const sourcePath = path.dirname(path.dirname(path.dirname(path.dirname(variationPath))));

    // Generate a consistent variation ID based on path
    const variationId = `var-${Buffer.from(variationPath)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 16)}`;

    return {
      inVariation: true,
      variationId,
      variationName,
      variationPath,
      sourcePath,
    };
  }

  // Not in a variation - return context with cwd as source
  return {
    inVariation: false,
    variationId: null,
    variationName: null,
    variationPath: null,
    sourcePath: normalizedCwd,
  };
}

/**
 * Detect variation context async - checks for marker file
 * Use this when you need to detect via marker file
 */
export async function detectVariationContextAsync(cwd: string): Promise<VariationContext> {
  // First try the sync version
  const syncContext = detectVariationContext(cwd);
  if (syncContext.inVariation) {
    return syncContext;
  }

  // Check for .pi-variation marker file
  const normalizedCwd = path.resolve(cwd);
  const markerPath = path.join(normalizedCwd, '.pi-variation');

  try {
    const stat = await fs.stat(markerPath);
    if (stat.isFile()) {
      const content = await fs.readFile(markerPath, 'utf-8');
      const info = JSON.parse(content);
      if (info.sourcePath && info.variationName) {
        return {
          inVariation: true,
          variationId: info.id || 'var-unknown',
          variationName: info.variationName,
          variationPath: normalizedCwd,
          sourcePath: info.sourcePath,
        };
      }
    }
  } catch {
    // No marker file or error reading it, ignore
  }

  return syncContext;
}

/**
 * Copy environment files from source to variation
 * Supports glob patterns like .env.*
 */
export async function copyEnvFiles(
  source: string,
  variation: string,
  patterns: string[] = DEFAULT_CONFIG.copy
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
 * Create symlinks for heavy directories (node_modules, .next, etc.)
 */
export async function symlinkHeavyDirs(
  source: string,
  variation: string,
  dirNames: string[] = DEFAULT_CONFIG.symlink
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
 */
export async function removeSymlinks(variation: string): Promise<void> {
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

/**
 * Create a marker file in the variation for context detection
 */
export async function createVariationMarker(
  variationPath: string,
  info: {
    id: string;
    name: string;
    sourcePath: string;
    type: string;
  }
): Promise<void> {
  const markerPath = path.join(variationPath, '.pi-variation');
  const content = {
    id: info.id,
    variationName: info.name,
    sourcePath: info.sourcePath,
    type: info.type,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(markerPath, JSON.stringify(content, null, 2));
}

/**
 * Remove the variation marker file
 */
export async function removeVariationMarker(variationPath: string): Promise<void> {
  const markerPath = path.join(variationPath, '.pi-variation');
  try {
    await fs.unlink(markerPath);
  } catch {
    // Ignore if doesn't exist
  }
}
