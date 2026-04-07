/**
 * Unit tests for /var command (autoregressive version)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerVarCommand } from '../../src/tools/command';
import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, Variation } from '../../src/types/index';
import type { RuntimeStore } from '../../src/state/store';

// Mock the dependencies
function createMockRuntimeStore(): RuntimeStore {
  return {
    ensure: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    persistState: vi.fn(),
    restoreState: vi.fn(),
  };
}

function createMockDeps(runtime: VarRuntime = createMockRuntime()) {
  return {
    pi: {
      registerCommand: vi.fn(),
      on: vi.fn(),
      exec: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI,
    getRuntime: () => runtime,
    runtimeStore: createMockRuntimeStore(),
  };
}

function createMockRuntime(
  overrides: Partial<VarRuntime> & { state?: Partial<VarRuntime['state']> } = {}
): VarRuntime {
  return {
    state: {
      activeVariationId: null,
      variations: [],
      sessionId: 'test-session',
      ...overrides.state,
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
    },
    hasUI: true,
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue('test-session'),
      getEntries: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  } as unknown as ExtensionContext;
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
        description: expect.stringContaining('status'),
        handler: expect.any(Function),
      })
    );
  });

  it('should register command handler', () => {
    const deps = createMockDeps();
    registerVarCommand(deps.pi, deps);

    expect(deps.pi.registerCommand).toHaveBeenCalled();
  });
});

describe('var command - status (no args)', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should show autoregressive message when no variations', async () => {
    const ctx = createMockCtx();
    await handler('', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('create_variation'), 'info');
  });

  it('should show active variation in status', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth' });
    const runtime = createMockRuntime({
      state: {
        variations: [variation],
        activeVariationId: 'var-1',
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('feature-auth'), 'info');
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('🌿'), 'info');
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

  it('should list variations with type indicators', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth', type: 'cow' });
    const runtime = createMockRuntime({
      state: {
        variations: [variation],
        activeVariationId: null,
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('list', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('feature-auth'), 'info');
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('⚡'), 'info');
  });
});

describe('var command - stop (return to source)', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should deactivate current variation with stop', async () => {
    const variation = createMockVariation({ id: 'var-1', name: 'feature-auth' });
    const runtime = createMockRuntime({
      state: {
        variations: [variation],
        activeVariationId: 'var-1',
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('stop', ctx);

    expect(runtime.state.activeVariationId).toBeNull();
    expect(runtime.redirectionActive).toBe(false);
    expect(ctx.ui.setStatus).toHaveBeenCalledWith('pi-var', '');
    // Should persist state after stop
    expect(deps.runtimeStore.persistState).toHaveBeenCalled();
  });

  it('should handle stop when already in source', async () => {
    const runtime = createMockRuntime({
      state: {
        variations: [],
        activeVariationId: null,
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('stop', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('Already'), 'info');
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
    const runtime = createMockRuntime({
      state: { variations: [variation], activeVariationId: null, sessionId: 'test-session' },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    ctx.ui.confirm = vi.fn().mockResolvedValue(false);

    await handler('clean old-feature', ctx);

    expect(ctx.ui.confirm).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith('Clean cancelled', 'info');
  });

  it('should error when variation not found', async () => {
    const ctx = createMockCtx();
    await handler('clean non-existent', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('not found'), 'error');
  });
});

describe('var command - stale cleanup', () => {
  let deps: ReturnType<typeof createMockDeps>;
  let handler: Function;

  beforeEach(() => {
    deps = createMockDeps();
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;
  });

  it('should clean variations older than specified days', async () => {
    const oldVariation = createMockVariation({
      id: 'var-1',
      name: 'old-feature',
      lastAccessed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    });
    const runtime = createMockRuntime({
      state: {
        variations: [oldVariation],
        activeVariationId: null,
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('clean --stale 7', ctx);

    expect(ctx.ui.confirm).toHaveBeenCalled();
  });

  it('should show message when no stale variations found', async () => {
    const freshVariation = createMockVariation({
      id: 'var-1',
      name: 'fresh-feature',
      lastAccessed: new Date().toISOString(),
    });
    const runtime = createMockRuntime({
      state: {
        variations: [freshVariation],
        activeVariationId: null,
        sessionId: 'test-session',
      },
    });
    deps = createMockDeps(runtime);
    registerVarCommand(deps.pi, deps);
    handler = vi.mocked(deps.pi.registerCommand).mock.calls[0][1].handler;

    const ctx = createMockCtx();
    await handler('clean --stale 7', ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining('No variations'), 'info');
  });
});
