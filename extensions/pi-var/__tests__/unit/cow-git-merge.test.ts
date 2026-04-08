/**
 * Unit tests for git-backed CoW variation features
 *
 * Tests the new behavior:
 * - CoW variations in git repos get a branch and merge base commit
 * - Merge uses git three-way merge (via remote fetch) for CoW+branch
 * - Merge detects conflicts instead of silently overwriting
 * - Copy merge backs up conflict files
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

import {
  createVariation,
  removeVariation,
  mergeVariation,
  hasGitRepo,
} from '../../src/variation/index';
import { detectMergeStrategy } from '../../src/variation/merge/strategy';
import type { Variation } from '../../src/types/index';

// Helper to create a temporary test directory
async function createTempDir(prefix: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const randomId = crypto.randomBytes(4).toString('hex');
  const dir = path.join(tmpDir, `${prefix}-${randomId}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Helper to cleanup a directory
async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Helper to initialize a git repo with an initial commit
async function initGitRepo(dir: string): Promise<void> {
  await execAsync(`git init "${dir}"`);
  await execAsync(`git -C "${dir}" config user.email "test@test.com"`);
  await execAsync(`git -C "${dir}" config user.name "Test"`);
  await fs.writeFile(path.join(dir, 'README.md'), '# test');
  await execAsync(`git -C "${dir}" add README.md`);
  await execAsync(`git -C "${dir}" commit -m "initial commit"`);
}

describe('CoW variation with git branch', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('cow-git-source');
    await initGitRepo(sourceDir);
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should detect git merge strategy for CoW variations with a branch', async () => {
    // Simulate a CoW variation that has a branchName
    const variation: Variation = {
      id: 'var-test',
      name: 'test-branch',
      path: path.join(sourceDir, '.pi', 'variations', 'test-branch'),
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/test-branch',
      mergeBaseCommit: 'abc123',
    };

    const strategy = await detectMergeStrategy(variation, sourceDir);
    expect(strategy).toBe('git');
  });

  it('should detect rsync/copy strategy for CoW variations without a branch', async () => {
    const variation: Variation = {
      id: 'var-test',
      name: 'test-no-branch',
      path: path.join(sourceDir, '.pi', 'variations', 'test-no-branch'),
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      // No branchName — source was not a git repo at creation time
    };

    const strategy = await detectMergeStrategy(variation, sourceDir);
    // Should be rsync or copy (not git)
    expect(['rsync', 'copy']).toContain(strategy);
  });

  it('should detect git strategy for worktree variations', async () => {
    const variation: Variation = {
      id: 'var-test',
      name: 'test-worktree',
      path: path.join(sourceDir, '.pi', 'variations', 'test-worktree'),
      sourcePath: sourceDir,
      type: 'worktree',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/test-worktree',
    };

    const strategy = await detectMergeStrategy(variation, sourceDir);
    expect(strategy).toBe('git');
  });
});

describe('git-backed CoW merge via remote fetch', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('cow-merge-source');
    await initGitRepo(sourceDir);
    await fs.writeFile(path.join(sourceDir, 'app.js'), '// original');
    await execAsync(`git -C "${sourceDir}" add app.js`);
    await execAsync(`git -C "${sourceDir}" commit -m "add app.js"`);
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should merge a CoW variation with branch via git remote fetch', async () => {
    // Create a variation directory that simulates a CoW clone with its own .git
    const variationDir = path.join(sourceDir, '.pi', 'variations', 'test-merge');
    await fs.mkdir(variationDir, { recursive: true });

    // Clone the source repo into the variation (simulates CoW clone including .git)
    await execAsync(`git clone "${sourceDir}" "${variationDir}"`);
    await execAsync(`git -C "${variationDir}" config user.email "test@test.com"`);
    await execAsync(`git -C "${variationDir}" config user.name "Test"`);

    // Create branch and make changes
    await execAsync(`git -C "${variationDir}" checkout -b var/test-merge`);
    await fs.writeFile(path.join(variationDir, 'app.js'), '// modified by variation');
    await execAsync(`git -C "${variationDir}" add app.js`);
    await execAsync(`git -C "${variationDir}" commit -m "modify app.js"`);

    const variation: Variation = {
      id: 'var-test',
      name: 'test-merge',
      path: variationDir,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/test-merge',
      mergeBaseCommit: (await execAsync(`git -C "${sourceDir}" rev-parse HEAD`)).stdout.trim(),
    };

    // Merge using git strategy
    await mergeVariation(variation, sourceDir, { strategy: 'git' });

    // Verify the merge happened
    const content = await fs.readFile(path.join(sourceDir, 'app.js'), 'utf-8');
    expect(content).toBe('// modified by variation');

    // Verify no leftover temporary remote
    const { stdout: remotes } = await execAsync(`git -C "${sourceDir}" remote`);
    expect(remotes.trim()).toBe('');
  });

  it('should detect conflicts when another variation was merged first', async () => {
    // Setup: create two variation directories simulating CoW clones
    const varDir1 = path.join(sourceDir, '.pi', 'variations', 'var-a');
    const varDir2 = path.join(sourceDir, '.pi', 'variations', 'var-b');

    for (const dir of [varDir1, varDir2]) {
      await execAsync(`git clone "${sourceDir}" "${dir}"`);
      await execAsync(`git -C "${dir}" config user.email "test@test.com"`);
      await execAsync(`git -C "${dir}" config user.name "Test"`);
    }

    // Variation A: modify app.js
    await execAsync(`git -C "${varDir1}" checkout -b var/var-a`);
    await fs.writeFile(path.join(varDir1, 'app.js'), '// changed by A');
    await execAsync(`git -C "${varDir1}" add app.js`);
    await execAsync(`git -C "${varDir1}" commit -m "A modifies app.js"`);

    // Variation B: also modify app.js (differently)
    await execAsync(`git -C "${varDir2}" checkout -b var/var-b`);
    await fs.writeFile(path.join(varDir2, 'app.js'), '// changed by B');
    await execAsync(`git -C "${varDir2}" add app.js`);
    await execAsync(`git -C "${varDir2}" commit -m "B modifies app.js"`);

    const baseCommit = (await execAsync(`git -C "${sourceDir}" rev-parse HEAD`)).stdout.trim();

    const variationA: Variation = {
      id: 'var-a',
      name: 'var-a',
      path: varDir1,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/var-a',
      mergeBaseCommit: baseCommit,
    };

    const variationB: Variation = {
      id: 'var-b',
      name: 'var-b',
      path: varDir2,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/var-b',
      mergeBaseCommit: baseCommit,
    };

    // Merge A first — should succeed
    await mergeVariation(variationA, sourceDir, { strategy: 'git' });

    // Merge B second — should detect conflict (both modified same file)
    await expect(mergeVariation(variationB, sourceDir, { strategy: 'git' })).rejects.toThrow(
      /conflict/i
    );

    // Clean up the merge state (abort the conflicted merge)
    try {
      await execAsync(`git -C "${sourceDir}" merge --abort`);
    } catch {
      // Ignore
    }
  });

  it('should auto-merge non-conflicting changes from sequential variations', async () => {
    const varDir1 = path.join(sourceDir, '.pi', 'variations', 'seq-a');
    const varDir2 = path.join(sourceDir, '.pi', 'variations', 'seq-b');

    for (const dir of [varDir1, varDir2]) {
      await execAsync(`git clone "${sourceDir}" "${dir}"`);
      await execAsync(`git -C "${dir}" config user.email "test@test.com"`);
      await execAsync(`git -C "${dir}" config user.name "Test"`);
    }

    // Variation A: add new file
    await execAsync(`git -C "${varDir1}" checkout -b var/seq-a`);
    await fs.writeFile(path.join(varDir1, 'new-file-a.js'), '// from A');
    await execAsync(`git -C "${varDir1}" add new-file-a.js`);
    await execAsync(`git -C "${varDir1}" commit -m "A adds new-file-a.js"`);

    // Variation B: add different new file
    await execAsync(`git -C "${varDir2}" checkout -b var/seq-b`);
    await fs.writeFile(path.join(varDir2, 'new-file-b.js'), '// from B');
    await execAsync(`git -C "${varDir2}" add new-file-b.js`);
    await execAsync(`git -C "${varDir2}" commit -m "B adds new-file-b.js"`);

    const baseCommit = (await execAsync(`git -C "${sourceDir}" rev-parse HEAD`)).stdout.trim();

    const variationA: Variation = {
      id: 'seq-a',
      name: 'seq-a',
      path: varDir1,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/seq-a',
      mergeBaseCommit: baseCommit,
    };

    const variationB: Variation = {
      id: 'seq-b',
      name: 'seq-b',
      path: varDir2,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/seq-b',
      mergeBaseCommit: baseCommit,
    };

    // Merge A
    await mergeVariation(variationA, sourceDir, { strategy: 'git' });

    // Merge B — should succeed because no conflicting files
    await mergeVariation(variationB, sourceDir, { strategy: 'git' });

    // Both files should exist in source
    expect(await fs.readFile(path.join(sourceDir, 'new-file-a.js'), 'utf-8')).toBe('// from A');
    expect(await fs.readFile(path.join(sourceDir, 'new-file-b.js'), 'utf-8')).toBe('// from B');
  });
});

describe('copy merge with backup protection', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('copy-merge-source');
    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'original');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should back up source files that differ from variation before overwrite', async () => {
    // Create a variation
    const variation = await createVariation(sourceDir, {
      name: 'copy-overwrite',
      type: 'copy',
    });

    // Modify the same file in both source and variation
    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'source changed');
    await fs.writeFile(path.join(variation.path, 'file.txt'), 'variation changed');

    // Merge using copy strategy
    const result = await mergeVariation(variation, sourceDir, { strategy: 'copy' });

    // The variation's version should be in the source now
    expect(await fs.readFile(path.join(sourceDir, 'file.txt'), 'utf-8')).toBe('variation changed');

    // The source's original version should be backed up
    const backupPath = path.join(sourceDir, '.pi', 'merge-backup', variation.name, 'file.txt');
    expect(await fs.readFile(backupPath, 'utf-8')).toBe('source changed');

    // The result should mention the overwrite
    expect(result).toContain('overwritten');
  });

  it('should not back up files when source and variation are identical', async () => {
    const variation = await createVariation(sourceDir, {
      name: 'copy-identical',
      type: 'copy',
    });

    // Don't modify anything — source and variation are identical
    // Merge using copy strategy
    const result = await mergeVariation(variation, sourceDir, { strategy: 'copy' });

    // No backup directory should be created
    const backupDir = path.join(sourceDir, '.pi', 'merge-backup', variation.name);
    try {
      const entries = await fs.readdir(backupDir);
      // If it exists, it should be empty
      expect(entries.length).toBe(0);
    } catch {
      // Backup dir doesn't exist — expected when no files differ
    }

    expect(result).not.toContain('overwritten');
  });
});

describe('variation removal cleans up temporary remotes', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('remove-remote-source');
    await initGitRepo(sourceDir);
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should clean up temporary remote when removing CoW variation with branch', async () => {
    // Create a variation directory simulating a CoW clone
    const variationDir = path.join(sourceDir, '.pi', 'variations', 'remove-test');
    await execAsync(`git clone "${sourceDir}" "${variationDir}"`);
    await execAsync(`git -C "${variationDir}" config user.email "test@test.com"`);
    await execAsync(`git -C "${variationDir}" config user.name "Test"`);
    await execAsync(`git -C "${variationDir}" checkout -b var/remove-test`);

    // Simulate a leftover remote (as if a merge was attempted)
    await execAsync(`git -C "${sourceDir}" remote add pi-var-remove-test "${variationDir}"`);

    const variation: Variation = {
      id: 'var-test',
      name: 'remove-test',
      path: variationDir,
      sourcePath: sourceDir,
      type: 'cow',
      createdAt: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      branchName: 'var/remove-test',
    };

    // Remove the variation
    await removeVariation(variation);

    // Verify the remote was cleaned up
    const { stdout: remotes } = await execAsync(`git -C "${sourceDir}" remote`);
    expect(remotes.trim()).not.toContain('pi-var-remove-test');
  });
});
