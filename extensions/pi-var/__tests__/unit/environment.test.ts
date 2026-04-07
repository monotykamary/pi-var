/**
 * Unit tests for environment utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import {
  setupVariationEnvironment,
  detectVariationContext,
  detectVariationContextAsync,
  copyEnvFiles,
  symlinkHeavyDirs,
  createVariationMarker,
  removeVariationMarker,
  DEFAULT_CONFIG,
} from '../../src/environment/index';

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

describe('DEFAULT_CONFIG', () => {
  it('should have copy patterns', () => {
    expect(DEFAULT_CONFIG.copy).toContain('.env');
    expect(DEFAULT_CONFIG.copy).toContain('.env.*');
    expect(DEFAULT_CONFIG.copy).toContain('.envrc');
    expect(DEFAULT_CONFIG.copy).toContain('.npmrc');
    expect(DEFAULT_CONFIG.copy).toContain('.tool-versions');
  });

  it('should have symlink patterns', () => {
    expect(DEFAULT_CONFIG.symlink).toContain('node_modules');
    expect(DEFAULT_CONFIG.symlink).toContain('.next');
    expect(DEFAULT_CONFIG.symlink).toContain('.nuxt');
    expect(DEFAULT_CONFIG.symlink).toContain('target');
    expect(DEFAULT_CONFIG.symlink).toContain('.venv');
  });
});

describe('detectVariationContext', () => {
  it('should return not in variation for regular directory', () => {
    const context = detectVariationContext('/home/user/project');

    expect(context.inVariation).toBe(false);
    expect(context.variationId).toBeNull();
    expect(context.variationName).toBeNull();
    expect(context.variationPath).toBeNull();
    expect(context.sourcePath).toBe('/home/user/project');
  });

  it('should detect variation from .pi/variations path', () => {
    const cwd = '/home/user/project/.pi/variations/myproject-abc123/test-var';
    const context = detectVariationContext(cwd);

    expect(context.inVariation).toBe(true);
    expect(context.variationName).toBe('test-var');
    expect(context.variationPath).toBe(
      '/home/user/project/.pi/variations/myproject-abc123/test-var'
    );
    expect(context.sourcePath).toBe('/home/user/project');
    expect(context.variationId).toBeDefined();
  });

  it('should handle paths with backslashes (Windows)', () => {
    const cwd = '\\Users\\user\\project\\.pi\\variations\\myproject-abc123\\test-var';
    const context = detectVariationContext(cwd);

    expect(context.inVariation).toBe(true);
    expect(context.variationName).toBe('test-var');
  });

  it('should normalize relative paths', () => {
    const context = detectVariationContext('.');

    expect(context.sourcePath).toBe(process.cwd());
  });
});

describe('copyEnvFiles', () => {
  let sourceDir: string;
  let variationDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');
    variationDir = await createTempDir('variation');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
    await cleanupDir(variationDir);
  });

  it('should copy .env file', async () => {
    await fs.writeFile(path.join(sourceDir, '.env'), 'KEY=value');

    await copyEnvFiles(sourceDir, variationDir, ['.env']);

    const content = await fs.readFile(path.join(variationDir, '.env'), 'utf-8');
    expect(content).toBe('KEY=value');
  });

  it('should copy files matching glob pattern', async () => {
    await fs.writeFile(path.join(sourceDir, '.env'), 'KEY=base');
    await fs.writeFile(path.join(sourceDir, '.env.local'), 'KEY=local');
    await fs.writeFile(path.join(sourceDir, '.env.production'), 'KEY=prod');

    await copyEnvFiles(sourceDir, variationDir, ['.env', '.env.*']);

    const base = await fs.readFile(path.join(variationDir, '.env'), 'utf-8');
    const local = await fs.readFile(path.join(variationDir, '.env.local'), 'utf-8');
    const prod = await fs.readFile(path.join(variationDir, '.env.production'), 'utf-8');

    expect(base).toBe('KEY=base');
    expect(local).toBe('KEY=local');
    expect(prod).toBe('KEY=prod');
  });

  it('should skip missing files', async () => {
    // Don't create any files in source

    await expect(copyEnvFiles(sourceDir, variationDir, ['.env', '.envrc'])).resolves.not.toThrow();

    // Variation should be empty
    const entries = await fs.readdir(variationDir);
    expect(entries).toHaveLength(0);
  });

  it('should handle nested directories', async () => {
    await fs.mkdir(path.join(sourceDir, 'config'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'config', '.env'), 'NESTED=value');

    // Only top-level patterns are supported currently
    await copyEnvFiles(sourceDir, variationDir, ['.env']);

    // File in subdirectory won't be copied with simple pattern
    const entries = await fs.readdir(variationDir);
    expect(entries).not.toContain('config');
  });
});

describe('symlinkHeavyDirs', () => {
  let sourceDir: string;
  let variationDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');
    variationDir = await createTempDir('variation');
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
    await cleanupDir(variationDir);
  });

  it('should create symlinks for existing directories', async () => {
    // Create source directories
    const nodeModulesSrc = path.join(sourceDir, 'node_modules');
    await fs.mkdir(nodeModulesSrc, { recursive: true });
    await fs.writeFile(path.join(nodeModulesSrc, 'package.json'), '{}');

    const nextSrc = path.join(sourceDir, '.next');
    await fs.mkdir(nextSrc, { recursive: true });

    await symlinkHeavyDirs(sourceDir, variationDir, ['node_modules', '.next']);

    // Check symlinks were created
    const nodeModulesDest = path.join(variationDir, 'node_modules');
    const nextDest = path.join(variationDir, '.next');

    const nmStat = await fs.lstat(nodeModulesDest);
    const nextStat = await fs.lstat(nextDest);

    expect(nmStat.isSymbolicLink()).toBe(true);
    expect(nextStat.isSymbolicLink()).toBe(true);

    // Verify we can read through symlink
    const pkg = await fs.readFile(path.join(nodeModulesDest, 'package.json'), 'utf-8');
    expect(pkg).toBe('{}');
  });

  it('should skip non-existent directories', async () => {
    // Don't create node_modules in source

    await expect(
      symlinkHeavyDirs(sourceDir, variationDir, ['node_modules'])
    ).resolves.not.toThrow();

    // Variation should be empty
    const entries = await fs.readdir(variationDir);
    expect(entries).toHaveLength(0);
  });

  it('should replace existing directories with symlinks', async () => {
    // Create source directory
    const nodeModulesSrc = path.join(sourceDir, 'node_modules');
    await fs.mkdir(nodeModulesSrc, { recursive: true });
    await fs.writeFile(path.join(nodeModulesSrc, 'original.json'), '{}');

    // Create a directory (not symlink) in variation
    const nodeModulesDest = path.join(variationDir, 'node_modules');
    await fs.mkdir(nodeModulesDest, { recursive: true });
    await fs.writeFile(path.join(nodeModulesDest, 'copied.json'), '{}');

    await symlinkHeavyDirs(sourceDir, variationDir, ['node_modules']);

    // Should now be a symlink pointing to source
    const stat = await fs.lstat(nodeModulesDest);
    expect(stat.isSymbolicLink()).toBe(true);

    // Content should come from source
    const content = await fs.readFile(path.join(nodeModulesDest, 'original.json'), 'utf-8');
    expect(content).toBe('{}');
  });
});

describe('createVariationMarker / removeVariationMarker', () => {
  let variationDir: string;

  beforeEach(async () => {
    variationDir = await createTempDir('variation');
  });

  afterEach(async () => {
    await cleanupDir(variationDir);
  });

  it('should create marker file with variation info', async () => {
    const info = {
      id: 'var-test-123',
      name: 'test-variation',
      sourcePath: '/home/user/project',
      type: 'cow',
    };

    await createVariationMarker(variationDir, info);

    const markerPath = path.join(variationDir, '.pi-variation');
    const content = await fs.readFile(markerPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(parsed.id).toBe(info.id);
    expect(parsed.variationName).toBe(info.name);
    expect(parsed.sourcePath).toBe(info.sourcePath);
    expect(parsed.type).toBe(info.type);
    expect(parsed.createdAt).toBeDefined();
  });

  it('should remove marker file', async () => {
    await createVariationMarker(variationDir, {
      id: 'var-test',
      name: 'test',
      sourcePath: '/source',
      type: 'copy',
    });

    const markerPath = path.join(variationDir, '.pi-variation');
    await fs.access(markerPath); // Should exist

    await removeVariationMarker(variationDir);

    await expect(fs.access(markerPath)).rejects.toThrow();
  });

  it('should not throw when removing non-existent marker', async () => {
    await expect(removeVariationMarker(variationDir)).resolves.not.toThrow();
  });
});

describe('detectVariationContextAsync with marker file', () => {
  let variationDir: string;

  beforeEach(async () => {
    variationDir = await createTempDir('variation');
  });

  afterEach(async () => {
    await cleanupDir(variationDir);
  });

  it('should detect variation from marker file', async () => {
    await createVariationMarker(variationDir, {
      id: 'var-marker-123',
      name: 'marker-test',
      sourcePath: '/home/user/source',
      type: 'worktree',
    });

    const context = await detectVariationContextAsync(variationDir);

    expect(context.inVariation).toBe(true);
    expect(context.variationId).toBe('var-marker-123');
    expect(context.variationName).toBe('marker-test');
    expect(context.sourcePath).toBe('/home/user/source');
    expect(context.variationPath).toBe(variationDir);
  });
});

describe('setupVariationEnvironment', () => {
  let sourceDir: string;
  let variationDir: string;

  beforeEach(async () => {
    sourceDir = await createTempDir('source');
    variationDir = await createTempDir('variation');

    // Create typical project structure in source
    await fs.writeFile(path.join(sourceDir, '.env'), 'API_KEY=secret');
    await fs.writeFile(path.join(sourceDir, '.env.local'), 'LOCAL=true');
    await fs.mkdir(path.join(sourceDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'node_modules', 'package.json'), '{"name": "test"}');
    await fs.mkdir(path.join(sourceDir, '.next'), { recursive: true });
  });

  afterEach(async () => {
    await cleanupDir(sourceDir);
    await cleanupDir(variationDir);
  });

  it('should setup complete environment', async () => {
    await setupVariationEnvironment(sourceDir, variationDir, DEFAULT_CONFIG);

    // Check env files were copied
    const env = await fs.readFile(path.join(variationDir, '.env'), 'utf-8');
    const envLocal = await fs.readFile(path.join(variationDir, '.env.local'), 'utf-8');
    expect(env).toBe('API_KEY=secret');
    expect(envLocal).toBe('LOCAL=true');

    // Check symlinks were created
    const nmStat = await fs.lstat(path.join(variationDir, 'node_modules'));
    const nextStat = await fs.lstat(path.join(variationDir, '.next'));
    expect(nmStat.isSymbolicLink()).toBe(true);
    expect(nextStat.isSymbolicLink()).toBe(true);
  });

  it('should respect custom config', async () => {
    const customConfig = {
      copy: ['.env'],
      symlink: ['node_modules'],
    };

    await setupVariationEnvironment(sourceDir, variationDir, customConfig);

    // Only .env copied
    await fs.access(path.join(variationDir, '.env'));
    await expect(fs.access(path.join(variationDir, '.env.local'))).rejects.toThrow();

    // Only node_modules symlinked
    const nmStat = await fs.lstat(path.join(variationDir, 'node_modules'));
    expect(nmStat.isSymbolicLink()).toBe(true);
    await expect(fs.lstat(path.join(variationDir, '.next'))).rejects.toThrow();
  });
});
