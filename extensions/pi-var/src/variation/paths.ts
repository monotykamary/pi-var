/**
 * Variation name and ID utilities
 */

import * as crypto from 'crypto';

/**
 * Get the project name from a path
 */
export function getProjectName(sourcePath: string): string {
  return sourcePath.split(/[/\\]/).pop() || 'project';
}

/**
 * Generate a short hash for the project path
 */
export function getProjectHash(sourcePath: string): string {
  return crypto.createHash('sha256').update(sourcePath).digest('hex').slice(0, 8);
}

/**
 * Generate a unique variation ID
 */
export function generateVariationId(): string {
  return `var-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
