/**
 * Unit tests for tool registration with redirection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, VarState, Variation } from '../../src/types/index';

// Mock the SDK
vi.mock('@mariozechner/pi-coding-agent', async () => {
  const actual = await vi.importActual('@mariozechner/pi-coding-agent');
  return {
    ...actual,
    createReadTool: vi.fn((cwd, options) => ({
      name: 'read',
      parameters: {},
      execute: vi.fn(),
      ...(options?.operations && { operations: options.operations }),
    })),
    createEditTool: vi.fn((cwd, options) => ({
      name: 'edit',
      parameters: {},
      execute: vi.fn(),
      ...(options?.operations && { operations: options.operations }),
    })),
    createWriteTool: vi.fn((cwd, options) => ({
      name: 'write',
      parameters: {},
      execute: vi.fn(),
      ...(options?.operations && { operations: options.operations }),
    })),
    createBashTool: vi.fn((cwd, options) => ({
      name: 'bash',
      parameters: {},
      execute: vi.fn(),
      ...(options?.spawnHook && { spawnHook: options.spawnHook }),
    })),
  };
});

describe('registerRedirectedTools', () => {
  let mockPi: ExtensionAPI;
  let mockCtx: ExtensionContext;
  let registeredTools: Map<string, any>;

  beforeEach(async () => {
    registeredTools = new Map();

    mockPi = {
      registerTool: vi.fn((tool) => {
        registeredTools.set(tool.name, tool);
      }),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    mockCtx = {
      cwd: '/home/user/project',
      sessionManager: {
        getSessionId: vi.fn(() => 'test-session'),
      },
    } as unknown as ExtensionContext;
  });

  // Lazy import to get mocked SDK
  const importModule = async () => {
    const { registerRedirectedTools } = await import('../../src/tools/index');
    return { registerRedirectedTools };
  };

  it('registers all four tools (read, edit, write, bash)', async () => {
    const { registerRedirectedTools } = await importModule();

    const getRuntime = vi.fn(() => ({
      state: {
        activeVariationId: null,
        variations: [],
        sessionId: 'test-session',
      },

      lastPersisted: Date.now(),
    }));

    registerRedirectedTools(mockPi, getRuntime);

    expect(registeredTools.has('read')).toBe(true);
    expect(registeredTools.has('edit')).toBe(true);
    expect(registeredTools.has('write')).toBe(true);
    expect(registeredTools.has('bash')).toBe(true);
  });

  it('tool descriptions mention variation redirection', async () => {
    const { registerRedirectedTools } = await importModule();

    const getRuntime = vi.fn(() => ({
      state: {
        activeVariationId: null,
        variations: [],
        sessionId: 'test-session',
      },

      lastPersisted: Date.now(),
    }));

    registerRedirectedTools(mockPi, getRuntime);

    expect(registeredTools.get('read')?.description).toContain('variation');
    expect(registeredTools.get('edit')?.description).toContain('variation');
    expect(registeredTools.get('write')?.description).toContain('variation');
    expect(registeredTools.get('bash')?.description).toContain('variation');
  });
});

describe('tool execute behavior', () => {
  const createMockVariation = (): Variation => ({
    id: 'var-123',
    name: 'test-variation',
    path: '/tmp/variations/test-var',
    sourcePath: '/home/user/project',
    type: 'cow',
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
  });

  it('uses default tools when no variation is active', async () => {
    // This test would verify that when no variation is active,
    // the tools delegate to default behavior with ctx.cwd
  });

  it('redirects to variation when variation is active', async () => {
    // This test would verify that when a variation is active,
    // the tools use variation.path for operations
  });
});
