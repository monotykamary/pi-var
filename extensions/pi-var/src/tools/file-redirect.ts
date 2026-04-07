/**
 * File Redirection Tools for pi-var
 *
 * Provides redirected file operations that automatically route read, edit, and write
 * calls to the active variation directory when a variation is active.
 *
 * Path resolution logic:
 * - If no active variation: return inputPath unchanged
 * - If absolute path in source: redirect to variation
 * - If absolute path already in variation: keep as-is
 * - If relative path: resolve against variation path
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { VarRuntime, VarState, Variation } from '../types/index';

/**
 * Resolve a path to the variation directory when redirection is active
 *
 * @param inputPath - The original path (relative or absolute)
 * @param cwd - Current working directory
 * @param state - The current VarState containing active variation info
 * @returns The resolved path (redirected to variation if active)
 */
export function resolveVariationPath(inputPath: string, cwd: string, state: VarState): string {
  // No active variation - return path unchanged
  if (!state.activeVariationId) {
    return inputPath;
  }

  const variation = state.variations.find((v) => v.id === state.activeVariationId);
  if (!variation) {
    return inputPath;
  }

  // Handle absolute paths
  if (path.isAbsolute(inputPath)) {
    // Check if already in variation directory
    const relativeToVariation = path.relative(variation.path, inputPath);
    if (!relativeToVariation.startsWith('..') && !path.isAbsolute(relativeToVariation)) {
      // Already in variation path - keep as-is
      return inputPath;
    }

    // Check if in source directory
    const relativeToSource = path.relative(variation.sourcePath, inputPath);
    if (!relativeToSource.startsWith('..') && !path.isAbsolute(relativeToSource)) {
      // In source - redirect to variation
      return path.join(variation.path, relativeToSource);
    }

    // External file (outside both source and variation) - keep as-is
    return inputPath;
  }

  // Relative path - resolve against variation path
  return path.join(variation.path, inputPath);
}

/**
 * Create read operations that redirect to the variation directory when active
 */
export function createRedirectedReadOps(cwd: string, runtime: VarRuntime) {
  return {
    readFile: async (filePath: string): Promise<Buffer> => {
      const resolvedPath = resolveVariationPath(filePath, cwd, runtime.state);
      return fs.readFile(resolvedPath);
    },

    access: async (filePath: string, mode?: number): Promise<void> => {
      const resolvedPath = resolveVariationPath(filePath, cwd, runtime.state);
      return fs.access(resolvedPath, mode);
    },

    detectImageMimeType: async (filePath: string): Promise<string | null | undefined> => {
      const resolvedPath = resolveVariationPath(filePath, cwd, runtime.state);
      try {
        const ext = path.extname(resolvedPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        };
        return mimeTypes[ext] || null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Create write operations that redirect to the variation directory when active
 */
export function createRedirectedWriteOps(cwd: string, runtime: VarRuntime) {
  return {
    writeFile: async (filePath: string, content: string | Buffer): Promise<void> => {
      const resolvedPath = resolveVariationPath(filePath, cwd, runtime.state);
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      await fs.writeFile(resolvedPath, content);
    },

    mkdir: async (dirPath: string, options?: { recursive?: boolean }): Promise<void> => {
      const resolvedPath = resolveVariationPath(dirPath, cwd, runtime.state);
      await fs.mkdir(resolvedPath, options);
    },
  };
}

/**
 * Create edit operations that redirect to the variation directory when active
 */
export function createRedirectedEditOps(cwd: string, runtime: VarRuntime) {
  const readOps = createRedirectedReadOps(cwd, runtime);
  const writeOps = createRedirectedWriteOps(cwd, runtime);

  return {
    readFile: readOps.readFile,
    access: readOps.access,
    writeFile: writeOps.writeFile,
  };
}
