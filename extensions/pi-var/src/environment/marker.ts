/**
 * Variation marker file management
 */

import { promises as fs } from 'fs';
import * as path from 'path';

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
