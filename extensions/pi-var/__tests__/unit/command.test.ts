/**
 * Unit tests for /var command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerVarCommand } from '../../src/tools/command.js';
import type { ExtensionAPI, ExtensionContext, UIContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, Variation } from '../../src/types/index.js';

// Mock the dependencies
function createMockDeps(runtime: VarRuntime = createMockRuntime()) {
  return {
    pi: {
      registerCommand: vi.fn(),
      on: vi.fn(),
      exec: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
    } as unknown as ExtensionAPI,
    getRuntime: () => runtime,
  };
}

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

function createMockCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: '/home/user/project',
    ui: {
      notify: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      setStatus: vi.fn(),
    } as unknown as UIContext,
    hasUI: true,
    ...overrides,
  } as ExtensionContext;
}

function createMockVariation(overrides: Partial<Variation> = {}): Variation {
  return {
    id: 'var-123',
    name: 'test-variation',
    path: '/tmp/variations/project-abc/test-var',
    sourcePath: '/home/user/project',
    type: 'cow',
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    ...overrides,
  };
}

describe('registerVarCommand', () => {
  it('should register the /var command', () => {
    const deps = createMockDeps();
    registerVarCommand(deps.pi, deps);

    expect(deps.pi.registerCommand).toHaveBeenCalledWith(
      'var',
      expect.objectContaining({
        description: expect.stringContaining('variations'),
        handler: expect.any(Function),
      })
    );
  });

  it('should register user_bash event handler', () => {
    const deps = createMockDeps();
    registerVarCommand(deps.pi, deps);

    expect(deps.pi.on).toHaveBeenCalledWith('user_bash', expect.any(Function));
  });
});

describe('var command - list', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should show empty message when no variations', async () => {
    const ctx = createMockCtx();
    await handler('', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining('No variations yet'),
      'info'
    );
  });

  it('should list variations with active indicator', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth' });
    const runtime = createMockRuntime({
      variations: [variation],
      activeVariationId: 'var-1',
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('🌿'), 'info');
  });
});

describe('var command - cd', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should switch to variation', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth' });
    const runtime = createMockRuntime({ variations: [variation] });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('cd feature-auth', ctx);

    expect(runtime.state.activeVariationId).toBe('var-1');
    expect(runtime.redirectionActive).toBe(true);
    expect(ctx.ui.setStatus).toHaveBeenCalled();
  });

  it('should return to source with cd main', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth' });
    const runtime = createMockRuntime({
      variations: [variation],
      activeVariationId: 'var-1',
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('cd main', ctx);

    expect(runtime.state.activeVariationId).toBeNull();
    expect(runtime.redirectionActive).toBe(false);
  });

  it('should error when variation not found', async () => {
    const ctx = createMockCtx();
    await handler('cd non-existent', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('not found'), 'error');
  });
});

describe('var command - clean', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should show usage when no name or stale flag', async () => {
    const ctx = createMockCtx();
    await handler('clean', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Usage'), 'warning');
  });

  it('should require confirmation before cleaning', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'old-feature' });
    const runtime = createMockRuntime({ variations: [variation] });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    ctx.ui.confirm = vi.fn().mockResolvedValue(false);

    await handler('clean old-feature', ctx);

    expect(ctx.ui.confirm).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith('Clean cancelled', 'info');
  });
});
