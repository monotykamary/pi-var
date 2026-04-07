/**
 * Variation lifecycle management: CoW detection, create/remove/merge
 */

import { promises as fs, constants as fsConstants } from 'fs';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import type {
  Variation,
  VariationType,
  CreateVariationOptions,
  MergeOptions,
} from '../types/index';

const execAsync = promisify(exec);

// ============================================================================
// Global Gitignore Management (copied from pi-autoresearch)
// ============================================================================

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
function ensureGlobalGitignore(): void {
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

/**
 * CoW detection result
 */
interface CoWDetectionResult {
  supported: boolean;
  method?: 'clonefile' | 'reflink';
}

/**
 * Detect Copy-on-Write support on the current platform
 * Tests actual CoW functionality by creating test files
 */
export async function detectCoWSupport(testDir: string): Promise<CoWDetectionResult> {
  // Ensure test directory exists
  await fs.mkdir(testDir, { recursive: true });

  const testFile = path.join(testDir, `.cow-test-${Date.now()}`);
  const clonedFile = path.join(testDir, `.cow-clone-${Date.now()}`);

  try {
    // Create a test file with some content
    await fs.writeFile(testFile, 'test content for CoW detection');

    const platform = os.platform();

    if (platform === 'darwin') {
      // macOS: Try cp -c (clonefile)
      try {
        await execAsync(`cp -c "${testFile}" "${clonedFile}"`);

        // Verify files exist and have same content
        const [originalStat, cloneStat] = await Promise.all([
          fs.stat(testFile),
          fs.stat(clonedFile),
        ]);

        // On APFS with clonefile, inodes may be the same or different depending on implementation
        // The key is that cp -c succeeded without error
        if (originalStat.size === cloneStat.size) {
          return { supported: true, method: 'clonefile' };
        }
      } catch {
        // clonefile not supported, fall through
      }
    } else if (platform === 'linux') {
      // Linux: Try cp --reflink=auto
      try {
        await execAsync(`cp -a --reflink=auto "${testFile}" "${clonedFile}"`);

        // Check if files share the same inode (indicating CoW)
        const [originalStat, cloneStat] = await Promise.all([
          fs.stat(testFile),
          fs.stat(clonedFile),
        ]);

        // If inodes match, reflink worked
        if (originalStat.ino === cloneStat.ino) {
          return { supported: true, method: 'reflink' };
        }

        // Even if inodes differ, the command succeeded - CoW may still work
        // Check if the filesystem supports reflink
        try {
          const { stdout } = await execAsync(`findmnt -T "${testDir}" -o FSTYPE --noheadings`);
          const fsType = stdout.trim();
          // btrfs and xfs support reflink
          if (fsType === 'btrfs' || fsType.includes('xfs')) {
            return { supported: true, method: 'reflink' };
          }
        } catch {
          // findmnt failed, assume no CoW
        }
      } catch {
        // reflink not supported, fall through
      }
    }

    return { supported: false };
  } finally {
    // Cleanup test files
    try {
      await fs.unlink(testFile);
      await fs.unlink(clonedFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Check if a directory contains a git repository
 */
export async function hasGitRepo(checkPath: string): Promise<boolean> {
  try {
    const gitDir = path.join(checkPath, '.git');
    const stat = await fs.stat(gitDir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the project name from a path
 */
function getProjectName(sourcePath: string): string {
  return path.basename(sourcePath) || 'project';
}

/**
 * Generate a short hash for the project path
 */
function getProjectHash(sourcePath: string): string {
  return crypto.createHash('sha256').update(sourcePath).digest('hex').slice(0, 8);
}

/**
 * Generate a unique variation ID
 */
function generateVariationId(): string {
  return `var-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate a default variation name
 */
function generateVariationName(): string {
  const adjectives = ['swift', 'bright', 'calm', 'bold', 'keen', 'warm', 'cool', 'vivid'];
  const nouns = ['wave', 'spark', 'flow', 'pulse', 'drift', 'glow', 'peak', 'beam'];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}`;
}

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

  // Determine variation type
  if (options.type) {
    type = options.type;
  } else {
    // Auto-select: cow > worktree > copy
    const cowSupport = await detectCoWSupport(baseDir);
    const isGitRepo = await hasGitRepo(sourcePath);

    if (cowSupport.supported) {
      type = 'cow';
    } else if (isGitRepo) {
      type = 'worktree';
    } else {
      type = 'copy';
    }
  }

  // Create variation based on type
  switch (type) {
    case 'cow':
      await createCoWVariation(sourcePath, variationPath);
      break;
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
  };
}

/**
 * Create a CoW clone using platform-specific methods
 */
async function createCoWVariation(sourcePath: string, destPath: string): Promise<void> {
  const platform = os.platform();
  const cowSupport = await detectCoWSupport(path.dirname(destPath));

  if (!cowSupport.supported) {
    throw new Error('CoW not supported on this platform/filesystem');
  }

  if (platform === 'darwin' && cowSupport.method === 'clonefile') {
    // macOS: Use cp -c for clonefile
    await execAsync(`cp -c -R "${sourcePath}" "${destPath}"`);
  } else if (platform === 'linux' && cowSupport.method === 'reflink') {
    // Linux: Use cp --reflink=auto
    await execAsync(`cp -a --reflink=auto "${sourcePath}" "${destPath}"`);
  } else {
    throw new Error(`Unsupported CoW method: ${cowSupport.method}`);
  }

  // Remove the .pi/variations directory from the clone to avoid recursion
  const nestedVariations = path.join(destPath, '.pi', 'variations');
  try {
    await fs.rm(nestedVariations, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }
}

/**
 * Create a git worktree variation
 */
async function createWorktreeVariation(
  sourcePath: string,
  destPath: string,
  name: string,
  createBranch?: boolean
): Promise<string | undefined> {
  // Validate git repo
  if (!(await hasGitRepo(sourcePath))) {
    throw new Error('Source path is not a git repository');
  }

  const branchName = createBranch ? `var/${name}` : undefined;

  if (branchName) {
    // Create new branch and worktree
    await execAsync(`git -C "${sourcePath}" branch "${branchName}"`);
    await execAsync(`git -C "${sourcePath}" worktree add "${destPath}" "${branchName}"`);
  } else {
    // Add worktree from current HEAD (detached)
    await execAsync(`git -C "${sourcePath}" worktree add --detach "${destPath}"`);
  }

  return branchName;
}

/**
 * Create a full copy variation
 */
async function createCopyVariation(sourcePath: string, destPath: string): Promise<void> {
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

/**
 * Remove a variation
 */
export async function removeVariation(variation: Variation): Promise<void> {
  // Clean up based on variation type
  switch (variation.type) {
    case 'worktree':
      // Remove git worktree
      try {
        await execAsync(
          `git -C "${variation.sourcePath}" worktree remove "${variation.path}" --force`
        );
      } catch {
        // If worktree remove fails, try manual cleanup
        await fs.rm(variation.path, { recursive: true, force: true });
      }

      // Remove branch if we created it
      if (variation.branchName?.startsWith('var/')) {
        try {
          await execAsync(`git -C "${variation.sourcePath}" branch -D "${variation.branchName}"`);
        } catch {
          // Ignore branch deletion errors
        }
      }
      break;

    case 'cow':
    case 'copy':
      // Simple directory removal
      await fs.rm(variation.path, { recursive: true, force: true });
      break;
  }

  // Clean up empty parent directories
  try {
    const baseDir = path.dirname(variation.path);
    const entries = await fs.readdir(baseDir);
    if (entries.length === 0) {
      await fs.rmdir(baseDir);

      // Try to clean up .pi/variations if empty
      const variationsDir = path.dirname(baseDir);
      const varEntries = await fs.readdir(variationsDir);
      if (varEntries.length === 0) {
        await fs.rmdir(variationsDir);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

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

/**
 * Detect the best merge strategy for a variation
 */
async function detectMergeStrategy(
  variation: Variation,
  sourcePath: string
): Promise<'git' | 'rsync' | 'copy'> {
  // Prefer git for worktrees
  if (variation.type === 'worktree' && (await hasGitRepo(sourcePath))) {
    return 'git';
  }

  // Check for rsync
  try {
    await execAsync('which rsync');
    return 'rsync';
  } catch {
    // rsync not available
  }

  // Fall back to copy
  return 'copy';
}

/**
 * Merge using git (for worktrees)
 */
async function mergeWithGit(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  if (!variation.branchName) {
    throw new Error('Cannot merge: variation has no associated branch');
  }

  // Get current branch in source
  const { stdout: currentBranch } = await execAsync(`git -C "${sourcePath}" branch --show-current`);
  const targetBranch = currentBranch.trim();

  if (!targetBranch) {
    throw new Error('Cannot merge: source is in detached HEAD state');
  }

  if (options.dryRun) {
    // Show what would be merged
    const { stdout } = await execAsync(
      `git -C "${sourcePath}" diff "${targetBranch}...${variation.branchName}" --stat`
    );
    return `Files that would be merged:\n${stdout}`;
  }

  // Merge the branch
  try {
    await execAsync(`git -C "${sourcePath}" merge "${variation.branchName}" --no-edit`);
    return '';
  } catch (err) {
    // Merge conflict or failure
    throw new Error(
      `Git merge failed: ${err}. Please resolve conflicts manually or use a different merge strategy.`
    );
  }
}

/**
 * Merge using rsync
 */
async function mergeWithRsync(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  const rsyncFlags = options.dryRun ? '-avn' : '-av';

  // Build exclude patterns for rsync
  const excludes = [
    '--exclude=.git',
    '--exclude=.pi/variations',
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=.nuxt',
    '--exclude=target',
    '--exclude=.venv',
    '--exclude=venv',
  ];

  const cmd = `rsync ${rsyncFlags} ${excludes.join(' ')} "${variation.path}/" "${sourcePath}/"`;

  if (options.dryRun) {
    const { stdout } = await execAsync(cmd);
    return `Files that would be merged:\n${stdout}`;
  }

  await execAsync(cmd);
  return '';
}

/**
 * Merge using direct file copy
 */
async function mergeWithCopy(
  variation: Variation,
  sourcePath: string,
  options: MergeOptions
): Promise<string> {
  // Get list of files to merge
  const files = await getFilesToMerge(variation.path, sourcePath);

  if (options.dryRun) {
    const fileList = files.map((f) => `  ${f}`).join('\n');
    return `Files that would be merged:\n${fileList}`;
  }

  // Copy each file
  for (const relativePath of files) {
    const srcFile = path.join(variation.path, relativePath);
    const destFile = path.join(sourcePath, relativePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(destFile), { recursive: true });

    // Copy file
    await fs.copyFile(srcFile, destFile);
  }
  return '';
}

/**
 * Get list of files that should be merged (excluding certain directories)
 */
async function getFilesToMerge(variationPath: string, sourcePath: string): Promise<string[]> {
  const files: string[] = [];
  const excludePatterns = [
    '.git',
    '.pi/variations',
    'node_modules',
    '.next',
    '.nuxt',
    'target',
    '.venv',
    'venv',
  ];

  async function scan(dir: string, relativeDir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const fullPath = path.join(dir, entry.name);

      // Check if this path should be excluded
      if (excludePatterns.some((pattern) => relativePath.startsWith(pattern))) {
        continue;
      }

      if (entry.isDirectory()) {
        await scan(fullPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  await scan(variationPath, '');
  return files;
}
