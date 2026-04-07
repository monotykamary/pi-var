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
  CoWDetectionResult,
} from '../types/index';
import { detectEDR, detectCrowdStrike, hasSlowCoWEDR, getEDRSummary } from './edr';

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
 * Detect Copy-on-Write support on the current platform
 * Tests actual CoW functionality by creating test files
 * Includes EDR detection and multi-iteration performance testing
 *
 * Strategy:
 * 1. Known slow EDR detected (CrowdStrike, SentinelOne, etc.) → worktree
 * 2. No slow EDR detected + fast CoW timing → cow
 * 3. Uncertain cases → worktree (conservative)
 */
export async function detectCoWSupport(testDir: string): Promise<CoWDetectionResult> {
  // Ensure test directory exists
  await fs.mkdir(testDir, { recursive: true });

  const testFile = path.join(testDir, `.cow-test-${Date.now()}`);
  const clonedFile = path.join(testDir, `.cow-clone-${Date.now()}`);

  // Detect EDR software that may impact CoW performance
  let edrResult: import('../types/index').CoWDetectionResult['edr'] = {
    detected: false,
    products: [],
    hasSlowCoWEDR: false,
  };
  let hasCrowdStrike = false;

  try {
    const [edrDetection, crowdstrikeDetection] = await Promise.all([
      detectEDR(),
      detectCrowdStrike(),
    ]);

    hasCrowdStrike = crowdstrikeDetection;
    edrResult = {
      detected: edrDetection.detected,
      products: edrDetection.details.map((d) => d.product),
      hasSlowCoWEDR: hasSlowCoWEDR(edrDetection) || hasCrowdStrike,
    };
  } catch {
    // EDR detection failed, continue without EDR info
  }

  // If we detected a known slow CoW EDR, we can short-circuit to worktree
  // without needing timing validation (high confidence)
  if (edrResult.hasSlowCoWEDR) {
    return {
      supported: true, // CoW technically works, just slow
      edr: edrResult,
      recommendedType: 'worktree',
    };
  }

  try {
    const platform = os.platform();

    // Skip CoW detection entirely on Windows (no native CoW support)
    if (platform === 'win32') {
      return {
        supported: false,
        edr: edrResult,
        recommendedType: 'worktree',
      };
    }

    // Create test files of varying sizes
    // Larger files more likely to trigger EDR scanning
    const testSizes = [1 * 1024 * 1024, 5 * 1024 * 1024]; // 1MB and 5MB
    let cowSupported = false;
    let cowMethod: 'clonefile' | 'reflink' | undefined;
    const timings: number[] = [];

    for (const size of testSizes) {
      const dataFile = `${testFile}-${size}`;
      const cloneTarget = `${clonedFile}-${size}`;

      try {
        const testData = Buffer.alloc(size, 'x');
        await fs.writeFile(dataFile, testData);

        if (platform === 'darwin') {
          // macOS: Try cp -c (clonefile)
          const startTime = performance.now();
          await execAsync(`cp -c "${dataFile}" "${cloneTarget}"`);
          const duration = performance.now() - startTime;
          timings.push(duration);

          const [origStat, cloneStat] = await Promise.all([
            fs.stat(dataFile),
            fs.stat(cloneTarget),
          ]);

          if (origStat.size === cloneStat.size) {
            cowSupported = true;
            cowMethod = 'clonefile';
          }
        } else if (platform === 'linux') {
          // Linux: Try cp --reflink=auto
          const startTime = performance.now();
          await execAsync(`cp -a --reflink=auto "${dataFile}" "${cloneTarget}"`);
          const duration = performance.now() - startTime;
          timings.push(duration);

          const [origStat, cloneStat] = await Promise.all([
            fs.stat(dataFile),
            fs.stat(cloneTarget),
          ]);

          if (origStat.ino === cloneStat.ino) {
            cowSupported = true;
            cowMethod = 'reflink';
          } else {
            // Check filesystem type
            try {
              const { stdout } = await execAsync(`findmnt -T "${testDir}" -o FSTYPE --noheadings`);
              const fsType = stdout.trim();
              if (fsType === 'btrfs' || fsType.includes('xfs')) {
                cowSupported = true;
                cowMethod = 'reflink';
              }
            } catch {
              // findmnt failed
            }
          }
        }

        // Cleanup this iteration's files
        await fs.unlink(dataFile).catch(() => {});
        await fs.unlink(cloneTarget).catch(() => {});
      } catch {
        // This size test failed, continue to next
      }
    }

    // Analyze timing results
    const avgTiming = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;
    const maxTiming = timings.length > 0 ? Math.max(...timings) : 0;

    // Conservative thresholds:
    // - < 20ms: Definitely fast (no EDR interference)
    // - 20-100ms: Uncertain (might be EDR, might be system load)
    // - > 100ms: Definitely slow (likely EDR or very slow system)
    const fastThreshold = 20;
    const slowThreshold = 100;

    let cowFast: boolean;
    let confidence: 'high' | 'medium' | 'low';

    if (avgTiming < fastThreshold) {
      cowFast = true;
      confidence = 'high';
    } else if (avgTiming > slowThreshold) {
      cowFast = false;
      confidence = 'high';
    } else {
      // Gray zone - medium confidence
      cowFast = false;
      confidence = 'medium';
    }

    // Additional heuristics for gray zone:
    // If max timing is significantly higher than average, might be intermittent EDR
    const hasSpike = maxTiming > avgTiming * 3 && maxTiming > slowThreshold;

    // Decision logic - priority order matters!
    let recommendedType: 'cow' | 'worktree' | 'copy';

    if (!cowSupported) {
      recommendedType = 'worktree';
    } else if (hasSpike || confidence === 'medium') {
      // Uncertain or saw spikes - be conservative with worktree
      // This check MUST come before the fast+high check to catch spikes
      recommendedType = 'worktree';
    } else if (cowFast && confidence === 'high') {
      // Fast and confident - use CoW
      recommendedType = 'cow';
    } else {
      // Slow but confident - definitely worktree
      recommendedType = 'worktree';
    }

    return {
      supported: cowSupported,
      method: cowMethod,
      edr: edrResult,
      performance: {
        fast: cowFast,
        durationMs: avgTiming,
        samples: timings.length,
        maxDurationMs: maxTiming,
        confidence,
      },
      recommendedType,
    };
  } catch {
    // CoW detection failed entirely
    return {
      supported: false,
      edr: edrResult,
      recommendedType: 'worktree',
    };
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
