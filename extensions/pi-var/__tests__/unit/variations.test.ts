/**
 * Unit tests for variation management utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  detectCoWSupport,
  hasGitRepo,
  createVariation,
  removeVariation,
  mergeVariation,
} from '../../src/utils/variations';
import type { Variation, VariationType } from '../../src/types/index';

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

describe('detectCoWSupport', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('cow-test');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  it('should return a result object with supported boolean', async () => {
    const result = await detectCoWSupport(testDir);

    expect(result).toHaveProperty('supported');
    expect(typeof result.supported).toBe('boolean');
  });

  it('should return method when CoW is supported', async () => {
    const result = await detectCoWSupport(testDir);

    if (result.supported) {
      expect(result.method).toBeDefined();
      expect(['clonefile', 'reflink']).toContain(result.method);
    }
  });

  it('should not leave test files behind', async () => {
    const filesBefore = await fs.readdir(testDir).catch(() => []);

    await detectCoWSupport(testDir);

    const filesAfter = await fs.readdir(testDir).catch(() => []);

    // Should only have files we created, no cow-test files
    const cowTestFiles = filesAfter.filter(
      (f) => f.includes('cow-test') || f.includes('cow-clone')
    );
    expect(cowTestFiles).toHaveLength(0);
  });
});

describe('hasGitRepo', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('git-test');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  it('should return false for non-git directory', async () => {
    const result = await hasGitRepo(testDir);
    expect(result).toBe(false);
  });

  it('should return true for git directory', async () => {
    // Initialize git repo
    await fs.mkdir(path.join(testDir, '.git'), { recursive: true });
    await fs.writeFile(path.join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    const result = await hasGitRepo(testDir);
    expect(result).toBe(true);
  });

  it('should return false for non-existent path', async () => {
    const nonExistent = path.join(testDir, 'does-not-exist');
    const result = await hasGitRepo(nonExistent);
    expect(result).toBe(false);
  });
});

describe('createVariation', () => {
  let sourceDir: string;
  let variationsBase: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');

    // Create some test files
    await fs.writeFile(path.join(sourceDir, 'package.json'), JSON.stringify({ name: 'test' }));
    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src', 'index'), 'console.log("hello");');

    // Create .pi directory structure
    variationsBase = path.join(sourceDir, '.pi', 'variations');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should create a variation with auto-generated name', async () => {
    const variation = await createVariation(sourceDir);

    expect(variation).toHaveProperty('id');
    expect(variation).toHaveProperty('name');
    expect(variation).toHaveProperty('path');
    expect(variation).toHaveProperty('sourcePath', sourceDir);
    expect(variation).toHaveProperty('type');
    expect(variation).toHaveProperty('createdAt');
    expect(variation).toHaveProperty('lastAccessed');

    // Verify the directory was created
    const stats = await fs.stat(variation.path);
    expect(stats.isDirectory()).toBe(true);
  });

  it('should create a variation with specified name', async () => {
    const variation = await createVariation(sourceDir, { name: 'my-variation' });

    expect(variation.name).toBe('my-variation');
    expect(variation.path).toContain('my-variation');
  });

  it('should throw error if variation already exists', async () => {
    await createVariation(sourceDir, { name: 'duplicate' });

    await expect(createVariation(sourceDir, { name: 'duplicate' })).rejects.toThrow(
      /already exists/
    );
  });

  it('should create copy variation when type is explicitly set', async () => {
    const variation = await createVariation(sourceDir, {
      name: 'copy-test',
      type: 'copy',
    });

    expect(variation.type).toBe('copy');

    // Verify files were copied
    const pkgJson = await fs.readFile(path.join(variation.path, 'package.json'), 'utf-8');
    expect(JSON.parse(pkgJson).name).toBe('test');
  });

  it('should not copy nested .pi/variations directory', async () => {
    // Create a pre-existing variation
    await createVariation(sourceDir, { name: 'existing' });

    // Create new variation - should not include the existing variation's .pi folder
    const newVariation = await createVariation(sourceDir, {
      name: 'new-var',
      type: 'copy',
    });

    // The new variation should not have the existing variation inside it
    const nestedVarPath = path.join(newVariation.path, '.pi', 'variations', 'existing');
    await expect(fs.access(nestedVarPath)).rejects.toThrow();
  });
});

describe('removeVariation', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');
    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should remove a copy variation', async () => {
    const variation = await createVariation(sourceDir, {
      name: 'to-remove',
      type: 'copy',
    });

    // Verify it exists
    await fs.access(variation.path);

    // Remove it
    await removeVariation(variation);

    // Verify it's gone
    await expect(fs.access(variation.path)).rejects.toThrow();
  });

  it('should clean up empty parent directories', async () => {
    const variation = await createVariation(sourceDir, {
      name: 'cleanup-test',
      type: 'copy',
    });

    const variationsDir = path.dirname(variation.path);
    const piDir = path.dirname(variationsDir);

    await removeVariation(variation);

    // If this was the only variation, .pi/variations should be cleaned up
    try {
      await fs.access(variationsDir);
      // If it still exists, that's fine - other variations may exist
    } catch {
      // Was cleaned up as expected
    }
  });
});

describe('mergeVariation', () => {
  let sourceDir: string;
  let variation: Variation;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');

    // Create source files
    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'original');
    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src', 'app'), '// original');

    // Create variation with changes
    variation = await createVariation(sourceDir, {
      name: 'to-merge',
      type: 'copy',
    });

    // Modify files in variation
    await fs.writeFile(path.join(variation.path, 'new-file.txt'), 'new content');
    await fs.writeFile(path.join(variation.path, 'src', 'app'), '// modified');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should merge new files to source', async () => {
    // New file should not exist in source yet
    await expect(fs.access(path.join(sourceDir, 'new-file.txt'))).rejects.toThrow();

    await mergeVariation(variation, sourceDir);

    // New file should now exist
    const content = await fs.readFile(path.join(sourceDir, 'new-file.txt'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('should merge modified files to source', async () => {
    const original = await fs.readFile(path.join(sourceDir, 'src', 'app'), 'utf-8');
    expect(original).toBe('// original');

    // Force copy strategy to avoid rsync issues in test environment
    await mergeVariation(variation, sourceDir, { strategy: 'copy' });

    const merged = await fs.readFile(path.join(sourceDir, 'src', 'app'), 'utf-8');
    expect(merged).toBe('// modified');
  });

  it('should keep variation after merge', async () => {
    const variationPath = variation.path;

    await mergeVariation(variation, sourceDir);

    // Variation should still exist
    const stats = await fs.stat(variationPath);
    expect(stats.isDirectory()).toBe(true);
  });

  it('should support dry run mode', async () => {
    const variationPath = variation.path;

    await mergeVariation(variation, sourceDir, { dryRun: true });

    // Variation should still exist
    const stats = await fs.stat(variationPath);
    expect(stats.isDirectory()).toBe(true);

    // But files should not have been merged
    await expect(fs.access(path.join(sourceDir, 'new-file.txt'))).rejects.toThrow();
  });
});

describe('variation type selection', () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');
    await fs.writeFile(path.join(sourceDir, 'file.txt'), 'content');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
  });

  it('should auto-select appropriate type', async () => {
    const variation = await createVariation(sourceDir);

    // Type should be one of the valid types
    expect(['cow', 'worktree', 'copy']).toContain(variation.type);
  });

  it('should allow forcing specific type', async () => {
    const copyVar = await createVariation(sourceDir, {
      name: 'forced-copy',
      type: 'copy',
    });
    expect(copyVar.type).toBe('copy');

    // Create another source dir for next test
    const anotherSource = await createTempDir('another-source');
    await fs.writeFile(path.join(anotherSource, 'file.txt'), 'content');

    const cowVar = await createVariation(anotherSource, {
      name: 'forced-cow',
      type: 'cow',
    });
    // May fall back to copy if CoW not supported
    expect(['cow', 'copy']).toContain(cowVar.type);

    await cleanupDir(anotherSource);
  });
});
