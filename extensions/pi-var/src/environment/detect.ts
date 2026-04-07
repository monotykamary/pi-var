/**
 * Variation context detection from current working directory
 */

import path from 'path';
import { promises as fs } from 'fs';
import type { VariationContext } from '../types/index';

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
