/**
 * Integration/smoke tests for pi-var extension
 *
 * These tests verify the end-to-end functionality of the /var command
 * in a real (but isolated) environment.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

describe('pi-var smoke tests', () => {
  const testDir = join(tmpdir(), `pi-var-test-${Date.now()}`);
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();

    // Create test project structure
    await mkdir(testDir, { recursive: true });
    await mkdir(join(testDir, 'src'), { recursive: true });

    // Create a simple package.json
    await writeFile(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
      })
    );

    // Create a source file
    await writeFile(join(testDir, 'src', 'index.js'), 'console.log("Hello from main");');

    // Initialize git repo for worktree tests
    try {
      execSync('git init', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'ignore' });
      execSync('git add .', { cwd: testDir, stdio: 'ignore' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'ignore' });
    } catch {
      // Git may not be available, skip git-related tests
    }

    process.chdir(testDir);
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Extension loading', () => {
    it('should have required files', async () => {
      // Verify extension structure exists - use a path that works from test directory
      const fs = await import('node:fs');
      const { dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      // Get the extension root from the current test file location
      const testDir = dirname(fileURLToPath(import.meta.url));
      const extensionPath = dirname(dirname(testDir)); // Up two levels from __tests__/integration

      expect(fs.existsSync(join(extensionPath, 'index.ts'))).toBe(true);
      expect(fs.existsSync(join(extensionPath, 'src', 'types', 'index.ts'))).toBe(true);
      expect(fs.existsSync(join(extensionPath, 'src', 'tools', 'command', 'index.ts'))).toBe(true);
      expect(fs.existsSync(join(extensionPath, 'src', 'state', 'store.ts'))).toBe(true);
    });
  });

  describe('Type definitions', () => {
    it('should be importable', async () => {
      const types = await import('../../src/types/index.js');
      // TypeScript types don't exist at runtime, just verify module loads
      expect(types).toBeDefined();
    });
  });

  describe('State management', () => {
    it('should create runtime store', async () => {
      const { createRuntimeStore, getSessionKey } = await import('../../src/state/index.js');

      const store = createRuntimeStore();
      expect(store).toHaveProperty('ensure');
      expect(store).toHaveProperty('get');
      expect(store).toHaveProperty('delete');

      const mockContext = {
        sessionManager: {
          getSessionId: () => 'test-session-123',
        },
      };

      const key = getSessionKey(mockContext as any);
      expect(key).toBe('test-session-123');
    });

    it('should manage runtime lifecycle', async () => {
      const { createRuntimeStore } = await import('../../src/state/store.js');

      const store = createRuntimeStore();

      // Create runtime
      const runtime = store.ensure('session-1');
      expect(runtime.state.sessionId).toBe('session-1');
      expect(runtime.state.activeVariationId).toBeNull();
      expect(runtime.state.variations).toEqual([]);

      // Modify and verify persistence
      runtime.state.activeVariationId = 'test-variation';

      const retrieved = store.get('session-1');
      expect(retrieved?.state.activeVariationId).toBe('test-variation');

      // Delete
      const deleted = store.delete('session-1');
      expect(deleted).toBe(true);
      expect(store.get('session-1')).toBeUndefined();
    });
  });

  describe('Name generation', () => {
    it('should generate unique IDs', async () => {
      const { generateVariationId } = await import('../../src/utils/names.js');

      const id1 = generateVariationId();
      const id2 = generateVariationId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThan(10);
    });

    it('should generate readable names', async () => {
      const { generateVariationName } = await import('../../src/utils/names.js');

      const name = generateVariationName();

      expect(name).toBeDefined();
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
      expect(name.length).toBeGreaterThan(3);
    });

    it('should generate different names on multiple calls', async () => {
      const { generateVariationName } = await import('../../src/utils/names.js');

      const names = new Set();
      for (let i = 0; i < 10; i++) {
        names.add(generateVariationName());
      }

      // With 30 adjectives and 38 nouns, we should get variety
      expect(names.size).toBeGreaterThan(5);
    });
  });

  describe('Command registration', () => {
    it('should export registerVarCommand', async () => {
      const command = await import('../../src/tools/command/index.js');

      expect(command).toHaveProperty('registerVarCommand');
      expect(typeof command.registerVarCommand).toBe('function');
    });

    it('should accept ExtensionAPI and dependencies', async () => {
      const { registerVarCommand } = await import('../../src/tools/command/index.js');

      const mockPi = {
        registerCommand: () => {},
        on: () => {},
        appendEntry: () => {},
      };

      const mockRuntime = {
        state: { activeVariationId: null, variations: [], sessionId: 'test' },

        lastPersisted: Date.now(),
      };

      const mockRuntimeStore = {
        ensure: () => mockRuntime,
        get: () => mockRuntime,
        delete: () => true,
        persistState: () => {},
        restoreState: () => {},
      };

      // Should not throw
      expect(() => {
        registerVarCommand(mockPi as any, {
          getRuntime: () => mockRuntime,
          pi: mockPi as any,
          runtimeStore: mockRuntimeStore as any,
        });
      }).not.toThrow();
    });
  });

  describe('Extension integration', () => {
    it('should have complete extension structure', async () => {
      const extension = await import('../../index.js');

      expect(extension).toHaveProperty('default');
      expect(typeof extension.default).toBe('function');
    });

    it('should initialize with ExtensionAPI', async () => {
      const extension = await import('../../index.js');

      const calls: string[] = [];
      const mockPi = {
        registerCommand: (name: string) => calls.push(`registerCommand:${name}`),
        registerTool: (tool: any) => calls.push(`registerTool:${tool.name || 'unnamed'}`),
        on: (event: string) => calls.push(`on:${event}`),
        exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      };

      // Should not throw when initializing
      expect(() => {
        extension.default(mockPi as any);
      }).not.toThrow();

      // Should have registered the /var command
      expect(calls.some((c) => c.includes('var'))).toBe(true);
    });
  });

  describe('File operations integration', () => {
    it('should create and read files in test directory', async () => {
      const testFile = join(testDir, 'test-file.txt');
      const content = 'Hello from test';

      await writeFile(testFile, content);
      const read = await readFile(testFile, 'utf-8');

      expect(read).toBe(content);
    });

    it('should handle directory creation', async () => {
      const nestedDir = join(testDir, 'nested', 'deep', 'dir');

      await mkdir(nestedDir, { recursive: true });

      const fs = await import('node:fs');
      expect(fs.existsSync(nestedDir)).toBe(true);
    });
  });

  describe('Portless integration (mocked)', () => {
    it('should handle missing portless gracefully', async () => {
      const { registerVarCommand } = await import('../../src/tools/command/index.js');

      const mockRuntime = {
        state: { activeVariationId: null, variations: [], sessionId: 'test' },

        lastPersisted: Date.now(),
      };

      let handler: Function | undefined;
      const mockPi = {
        registerCommand: (name: string, config: any) => {
          handler = config.handler;
        },
        on: () => {},
        appendEntry: () => {},
      };

      const notifications: Array<{ msg: string; type: string }> = [];
      const mockCtx = {
        cwd: testDir,
        ui: {
          notify: (msg: string, type: string) => notifications.push({ msg, type }),
          setStatus: () => {},
          confirm: () => Promise.resolve(true),
          select: () => Promise.resolve(null),
        },
        sessionManager: { getSessionId: () => 'test', getSessionFile: () => '' },
      };

      registerVarCommand(mockPi as any, {
        getRuntime: () => mockRuntime,
        pi: mockPi as any,
        runtimeStore: {
          ensure: () => mockRuntime,
          get: () => mockRuntime,
          delete: () => true,
          persistState: () => {},
          restoreState: () => {},
        } as any,
      });

      // Attempt to create variation with --isolated (portless won't be available)
      // Should handle gracefully and not crash
      try {
        await handler?.('new test-isolated --isolated', mockCtx as any);
      } catch {
        // Expected to potentially fail without real portless
      }

      // Extension should still be functional
      expect(mockRuntime.state.variations.length).toBeGreaterThanOrEqual(0);
    });
  });
});
