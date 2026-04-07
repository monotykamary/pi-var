/**
 * Full copy variation creation
 */

import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Create a full copy variation
 */
export async function createCopyVariation(sourcePath: string, destPath: string): Promise<void> {
  // Create destination directory first
  await fs.mkdir(destPath, { recursive: true });

  // Get all entries from source
  const entries = await fs.readdir(sourcePath, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(sourcePath, entry.name);
    const destFilePath = path.join(destPath, entry.name);

    // Skip the .pi directory to avoid recursion
    if (entry.name === '.pi') {
      continue;
    }

    if (entry.isDirectory()) {
      // Recursively copy subdirectory
      await createCopyVariation(srcPath, destFilePath);
    } else {
      // Copy file
      await fs.copyFile(srcPath, destFilePath);
    }
  }
}
