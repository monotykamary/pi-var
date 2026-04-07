/**
 * Global gitignore management for .pi/variations
 */

import { promises as fs, constants as fsConstants } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

/** Get the path to the global gitignore file */
function getGlobalGitignorePath(): string | null {
  try {
    // Check if core.excludesfile is set
    const result = execSync('git config --global core.excludesfile', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const configured = result.trim();
    if (configured) return configured;
  } catch {
    // Not configured, fall through to default
  }

  // Default locations by platform
  // Check env vars first (allows testing with fake home), then os.homedir()
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(home, '.gitignore'),
    path.join(home, '.gitignore_global'),
    path.join(home, '.config', 'git', 'ignore'),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
  }

  // Default to ~/.gitignore if nothing exists
  return path.join(home, '.gitignore');
}

/** Ensure .pi/variations/ is in the global gitignore */
export function ensureGlobalGitignore(): void {
  try {
    const gitignorePath = getGlobalGitignorePath();
    if (!gitignorePath) return;

    const pattern = '.pi/variations/';
    let content = '';

    if (fsSync.existsSync(gitignorePath)) {
      content = fsSync.readFileSync(gitignorePath, 'utf-8');
      // Already present?
      if (content.split(/\r?\n/).some((line) => line.trim() === pattern)) {
        return;
      }
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(gitignorePath);
    if (!fsSync.existsSync(parentDir)) {
      fsSync.mkdirSync(parentDir, { recursive: true });
    }

    // Append with a comment
    const entry =
      content.endsWith('\n') || content === ''
        ? `# pi-var variations\n${pattern}\n`
        : `\n# pi-var variations\n${pattern}\n`;

    fsSync.appendFileSync(gitignorePath, entry, 'utf-8');
  } catch {
    // Silently fail — this is a convenience, not a requirement
  }
}
