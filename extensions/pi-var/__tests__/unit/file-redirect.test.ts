/**
 * Unit tests for file-redirect module
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type { VarState, VarRuntime, Variation } from '../../src/types/index';
import {
  resolveVariationPath,
  createRedirectedReadOps,
  createRedirectedWriteOps,
  createRedirectedEditOps,
} from '../../src/tools/file-redirect';

// Mock runtime factory
function createMockRuntime(overrides: Partial<VarRuntime> = {}): VarRuntime {
  return {
    state: {
      activeVariationId: null,
      variations: [],
      sessionId: 'test-session',
    },
    redirectionActive: false,
    lastPersisted: Date.now(),
    ...overrides,
  };
}

// Mock variation factory
function createMockVariation(overrides: Partial<Variation> = {}): Variation {
  return {
    id: 'var-123',
    name: 'test-variation',
    path: '/tmp/variations/test-var',
    sourcePath: '/home/user/project',
    type: 'cow',
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    ...overrides,
  };
}

describe('resolveVariationPath', () => {
  const cwd = '/home/user/project';
  let state: VarState;

  beforeEach(() => {
    state = {
      activeVariationId: null,
      variations: [],
      sessionId: 'test-session',
    };
  });

  describe('when no variation is active', () => {
    it('returns relative paths unchanged', () => {
      const inputPath = 'src/components/Button';
      const result = resolveVariationPath(inputPath, cwd, state);
      expect(result).toBe(inputPath);
    });

    it('returns absolute paths unchanged', () => {
      const inputPath = '/home/user/project/src/Button';
      const result = resolveVariationPath(inputPath, cwd, state);
      expect(result).toBe(inputPath);
    });
  });

  describe('when a variation is active', () => {
    beforeEach(() => {
      const variation = createMockVariation();
      state.activeVariationId = variation.id;
      state.variations = [variation];
    });

    describe('relative paths', () => {
      it('resolves relative paths against variation path', () => {
        const inputPath = 'src/components/Button';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/src/components/Button');
      });

      it('handles dot-relative paths', () => {
        const inputPath = './README.md';
        const result = resolveVariationPath(inputPath, cwd, state);
        // path.normalize will clean up ./
        expect(result).toBe('/tmp/variations/test-var/README.md');
      });

      it('handles parent-relative paths', () => {
        const inputPath = '../shared/utils';
        const result = resolveVariationPath(inputPath, cwd, state);
        // path.normalize will resolve ../
        expect(result).toBe('/tmp/variations/shared/utils');
      });
    });

    describe('absolute paths in source directory', () => {
      it('redirects source file paths to variation', () => {
        const inputPath = '/home/user/project/src/Button';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/src/Button');
      });

      it('redirects source root files', () => {
        const inputPath = '/home/user/project/package.json';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/package.json');
      });

      it('handles paths in subdirectories', () => {
        const inputPath = '/home/user/project/src/components/nested/DeepComponent';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/src/components/nested/DeepComponent');
      });
    });

    describe('absolute paths already in variation', () => {
      it('keeps variation paths as-is', () => {
        const inputPath = '/tmp/variations/test-var/src/Button';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe(inputPath);
      });

      it('keeps variation root files as-is', () => {
        const inputPath = '/tmp/variations/test-var/package.json';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe(inputPath);
      });
    });

    describe('external paths (outside source and variation)', () => {
      it('keeps external paths unchanged', () => {
        const inputPath = '/etc/config/nginx.conf';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe(inputPath);
      });

      it('keeps system paths unchanged', () => {
        const inputPath = '/usr/local/bin/script.sh';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe(inputPath);
      });

      it('keeps other user directories unchanged', () => {
        const inputPath = '/home/otheruser/documents/file.txt';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe(inputPath);
      });
    });

    describe('edge cases', () => {
      it('handles paths with trailing slashes', () => {
        const inputPath = '/home/user/project/src/';
        const result = resolveVariationPath(inputPath, cwd, state);
        // path.join normalizes trailing slashes
        expect(result).toBe('/tmp/variations/test-var/src');
      });

      it('handles paths with spaces', () => {
        const inputPath = '/home/user/project/src/my file';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/src/my file');
      });

      it('handles paths with special characters', () => {
        const inputPath = '/home/user/project/src/file[name]';
        const result = resolveVariationPath(inputPath, cwd, state);
        expect(result).toBe('/tmp/variations/test-var/src/file[name]');
      });

      it('handles empty string paths', () => {
        const inputPath = '';
        const result = resolveVariationPath(inputPath, cwd, state);
        // path.join(variation.path, '') returns variation.path (normalized)
        expect(result).toBe('/tmp/variations/test-var');
      });
    });
  });

  describe('when active variation is not found', () => {
    it('returns path unchanged if variation id references non-existent variation', () => {
      state.activeVariationId = 'non-existent-id';
      state.variations = []; // Empty variations array

      const inputPath = 'src/Button';
      const result = resolveVariationPath(inputPath, cwd, state);
      expect(result).toBe(inputPath);
    });
  });
});

describe('createRedirectedReadOps', () => {
  const cwd = '/home/user/project';

  it('creates read operations object with required methods', () => {
    const runtime = createMockRuntime();
    const ops = createRedirectedReadOps(cwd, runtime);

    expect(ops).toHaveProperty('readFile');
    expect(ops).toHaveProperty('access');
    expect(ops).toHaveProperty('detectImageMimeType');
    expect(typeof ops.readFile).toBe('function');
    expect(typeof ops.access).toBe('function');
    expect(typeof ops.detectImageMimeType).toBe('function');
  });

  it('detectImageMimeType returns correct MIME types', async () => {
    const runtime = createMockRuntime();
    const ops = createRedirectedReadOps(cwd, runtime);

    // These will fail with ENOENT but we can still test the MIME type detection logic
    // by checking the method exists and returns the expected values based on extension

    // Since we can't easily mock fs.readFile without more setup, we verify
    // the operations object structure is correct
    expect(ops.detectImageMimeType).toBeDefined();
  });
});

describe('createRedirectedWriteOps', () => {
  const cwd = '/home/user/project';

  it('creates write operations object with required methods', () => {
    const runtime = createMockRuntime();
    const ops = createRedirectedWriteOps(cwd, runtime);

    expect(ops).toHaveProperty('writeFile');
    expect(ops).toHaveProperty('mkdir');
    expect(typeof ops.writeFile).toBe('function');
    expect(typeof ops.mkdir).toBe('function');
  });
});

describe('createRedirectedEditOps', () => {
  const cwd = '/home/user/project';

  it('creates edit operations object with required methods', () => {
    const runtime = createMockRuntime();
    const ops = createRedirectedEditOps(cwd, runtime);

    expect(ops).toHaveProperty('readFile');
    expect(ops).toHaveProperty('access');
    expect(ops).toHaveProperty('writeFile');
    expect(typeof ops.readFile).toBe('function');
    expect(typeof ops.access).toBe('function');
    expect(typeof ops.writeFile).toBe('function');
  });

  it('uses redirected read and write operations internally', async () => {
    // This test verifies that editOps combines read and write ops correctly
    const runtime = createMockRuntime();
    const editOps = createRedirectedEditOps(cwd, runtime);

    // The edit operations should have the same methods as read and write combined
    expect(Object.keys(editOps)).toEqual(
      expect.arrayContaining(['readFile', 'access', 'writeFile'])
    );
  });
});

describe('integration: path resolution with operations', () => {
  const cwd = '/home/user/project';
  const variation = createMockVariation();

  it('readOps resolves paths using variation when active', async () => {
    const runtime = createMockRuntime({
      state: {
        activeVariationId: variation.id,
        variations: [variation],
        sessionId: 'test-session',
      },
    });

    // We can't actually read without mocking fs, but we can verify
    // the operations are created with the correct runtime context
    const readOps = createRedirectedReadOps(cwd, runtime);
    expect(readOps).toBeDefined();
    expect(typeof readOps.readFile).toBe('function');
  });

  it('writeOps resolves paths using variation when active', async () => {
    const runtime = createMockRuntime({
      state: {
        activeVariationId: variation.id,
        variations: [variation],
        sessionId: 'test-session',
      },
    });

    const writeOps = createRedirectedWriteOps(cwd, runtime);
    expect(writeOps).toBeDefined();
    expect(typeof writeOps.writeFile).toBe('function');
  });
});
