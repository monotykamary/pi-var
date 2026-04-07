/**
 * Unit tests for RuntimeStore with session persistence
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RuntimeStore } from '../../src/state/types';
import {
  createRuntimeStore,
  getSessionKey,
  type ExtensionContext,
  type SessionManager,
} from '../../src/state/index';
import type { VarRuntime, Variation } from '../../src/types/index';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

describe('RuntimeStore', () => {
  let store: ReturnType<typeof createRuntimeStore>;

  beforeEach(() => {
    store = createRuntimeStore();
  });

  describe('createRuntimeStore', () => {
    it('should create a store with required methods', () => {
      expect(store).toHaveProperty('ensure');
      expect(store).toHaveProperty('get');
      expect(store).toHaveProperty('delete');
      expect(store).toHaveProperty('persistState');
      expect(store).toHaveProperty('restoreState');
      expect(typeof store.ensure).toBe('function');
      expect(typeof store.get).toBe('function');
      expect(typeof store.delete).toBe('function');
      expect(typeof store.persistState).toBe('function');
      expect(typeof store.restoreState).toBe('function');
    });
  });

  describe('ensure', () => {
    it('should create a new runtime for new session key', () => {
      const runtime = store.ensure('session-1');

      expect(runtime).toBeDefined();
      expect(runtime.state.sessionId).toBe('session-1');
      expect(runtime.state.activeVariationId).toBeNull();
      expect(runtime.state.variations).toEqual([]);
      expect(typeof runtime.lastPersisted).toBe('number');
    });

    it('should return existing runtime for same session key', () => {
      const runtime1 = store.ensure('session-1');
      runtime1.state.activeVariationId = 'variation-1';

      const runtime2 = store.ensure('session-1');

      expect(runtime2).toBe(runtime1);
      expect(runtime2.state.activeVariationId).toBe('variation-1');
    });

    it('should create separate runtimes for different session keys', () => {
      const runtime1 = store.ensure('session-1');
      const runtime2 = store.ensure('session-2');

      expect(runtime1).not.toBe(runtime2);
      expect(runtime1.state.sessionId).toBe('session-1');
      expect(runtime2.state.sessionId).toBe('session-2');
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent session', () => {
      const runtime = store.get('non-existent');
      expect(runtime).toBeUndefined();
    });

    it('should return existing runtime', () => {
      const created = store.ensure('session-1');
      const retrieved = store.get('session-1');

      expect(retrieved).toBe(created);
    });

    it('should not create new runtime when getting non-existent', () => {
      store.get('non-existent');
      const runtime = store.get('non-existent');

      expect(runtime).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('should return false for non-existent session', () => {
      const result = store.delete('non-existent');
      expect(result).toBe(false);
    });

    it('should delete existing runtime and return true', () => {
      store.ensure('session-1');
      const result = store.delete('session-1');

      expect(result).toBe(true);
      expect(store.get('session-1')).toBeUndefined();
    });

    it('should not affect other sessions', () => {
      store.ensure('session-1');
      store.ensure('session-2');

      store.delete('session-1');

      expect(store.get('session-1')).toBeUndefined();
      expect(store.get('session-2')).toBeDefined();
    });
  });

  describe('persistState', () => {
    it('should call pi.appendEntry with correct data', () => {
      const mockAppendEntry = vi.fn();
      const mockPi = {
        appendEntry: mockAppendEntry,
      } as unknown as ExtensionAPI;

      const runtime = store.ensure('session-1');
      runtime.state.variations = [
        {
          id: 'var-1',
          name: 'test-variation',
          path: '/tmp/var-1',
          sourcePath: '/tmp/source',
          type: 'cow',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessed: '2024-01-01T00:00:00.000Z',
        } as Variation,
      ];
      runtime.state.activeVariationId = 'var-1';
      const beforePersist = runtime.lastPersisted;

      store.persistState('session-1', mockPi);

      expect(mockAppendEntry).toHaveBeenCalledOnce();
      expect(mockAppendEntry).toHaveBeenCalledWith('pi-var:state', {
        variations: runtime.state.variations,
        activeVariationId: 'var-1',
      });

      // Should update lastPersisted
      const runtimeAfter = store.get('session-1');
      expect(runtimeAfter?.lastPersisted).toBeGreaterThanOrEqual(beforePersist);
    });

    it('should handle null activeVariationId', () => {
      const mockAppendEntry = vi.fn();
      const mockPi = {
        appendEntry: mockAppendEntry,
      } as unknown as ExtensionAPI;

      const runtime = store.ensure('session-1');
      runtime.state.activeVariationId = null;
      runtime.state.variations = [];

      store.persistState('session-1', mockPi);

      expect(mockAppendEntry).toHaveBeenCalledWith('pi-var:state', {
        variations: [],
        activeVariationId: null,
      });
    });

    it('should not throw for non-existent session', () => {
      const mockAppendEntry = vi.fn();
      const mockPi = {
        appendEntry: mockAppendEntry,
      } as unknown as ExtensionAPI;

      expect(() => store.persistState('non-existent', mockPi)).not.toThrow();
      expect(mockAppendEntry).not.toHaveBeenCalled();
    });
  });

  describe('restoreState', () => {
    it('should restore state from session entries (using getEntries)', () => {
      const mockEntries = [
        { type: 'message', id: '1' },
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: { variations: [], activeVariationId: null },
        },
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: {
            variations: [
              {
                id: 'var-1',
                name: 'restored-variation',
                path: '/tmp/var-1',
                sourcePath: '/tmp/source',
                type: 'cow',
                createdAt: '2024-01-01T00:00:00.000Z',
                lastAccessed: '2024-01-01T00:00:00.000Z',
              },
            ],
            activeVariationId: 'var-1',
          },
        },
      ];

      const mockSessionManager: SessionManager = {
        getEntries: () => mockEntries,
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      store.restoreState('session-1', mockSessionManager);

      expect(runtime.state.variations).toHaveLength(1);
      expect(runtime.state.variations[0].name).toBe('restored-variation');
      expect(runtime.state.activeVariationId).toBe('var-1');
      expect(runtime.state.activeVariationId).not.toBeNull();
    });

    it('should restore state from session entries (using getBranch as fallback)', () => {
      const mockEntries = [
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: {
            variations: [{ id: 'var-2', name: 'fallback-variation' } as Variation],
            activeVariationId: 'var-2',
          },
        },
      ];

      const mockSessionManager: SessionManager = {
        getBranch: () => mockEntries,
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      store.restoreState('session-1', mockSessionManager);

      expect(runtime.state.variations[0].name).toBe('fallback-variation');
    });

    it('should take the last state entry when multiple exist', () => {
      const mockEntries = [
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: { variations: [], activeVariationId: 'var-old' },
        },
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: { variations: [], activeVariationId: 'var-new' },
        },
      ];

      const mockSessionManager: SessionManager = {
        getBranch: () => mockEntries,
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      store.restoreState('session-1', mockSessionManager);

      expect(runtime.state.activeVariationId).toBe('var-new');
    });

    it('should handle no state entries gracefully', () => {
      const mockEntries = [
        { type: 'message', id: '1' },
        { type: 'custom', customType: 'other-extension', data: {} },
      ];

      const mockSessionManager: SessionManager = {
        getBranch: () => mockEntries,
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      runtime.state.variations = [{ id: 'existing', name: 'existing' } as Variation];
      runtime.state.activeVariationId = 'existing';

      store.restoreState('session-1', mockSessionManager);

      // Should remain unchanged
      expect(runtime.state.variations).toHaveLength(1);
      expect(runtime.state.activeVariationId).toBe('existing');
    });

    it('should handle null activeVariationId in restored state', () => {
      const mockEntries = [
        {
          type: 'custom',
          customType: 'pi-var:state',
          data: {
            variations: [{ id: 'var-1', name: 'test' } as Variation],
            activeVariationId: null,
          },
        },
      ];

      const mockSessionManager: SessionManager = {
        getBranch: () => mockEntries,
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      runtime.state.activeVariationId = 'some-variation';

      store.restoreState('session-1', mockSessionManager);

      expect(runtime.state.activeVariationId).toBeNull();
    });

    it('should not throw for non-existent session', () => {
      const mockSessionManager: SessionManager = {
        getBranch: () => [],
        getSessionId: () => 'session-1',
      };

      expect(() => store.restoreState('non-existent', mockSessionManager)).not.toThrow();
    });

    it('should not throw when getBranch throws (e.g., during early session_start)', () => {
      const mockSessionManager: SessionManager = {
        getEntries: () => {
          throw new Error('Session not initialized');
        },
        getBranch: () => {
          throw new Error('leafId is undefined');
        },
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');
      runtime.state.variations = [{ id: 'existing', name: 'existing' } as Variation];

      // Should not throw and should preserve existing state
      expect(() => store.restoreState('session-1', mockSessionManager)).not.toThrow();
      expect(runtime.state.variations).toHaveLength(1);
    });

    it('should not throw when getBranch and getEntries are unavailable', () => {
      const mockSessionManager: SessionManager = {
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');

      expect(() => store.restoreState('session-1', mockSessionManager)).not.toThrow();
      // State should remain unchanged
      expect(runtime.state.variations).toEqual([]);
    });

    it('should handle empty entries array', () => {
      const mockSessionManager: SessionManager = {
        getBranch: () => [],
        getSessionId: () => 'session-1',
      };

      const runtime = store.ensure('session-1');

      expect(() => store.restoreState('session-1', mockSessionManager)).not.toThrow();
      expect(runtime.state.variations).toEqual([]);
    });
  });

  describe('integration', () => {
    it('should handle multiple sessions independently', () => {
      const session1 = store.ensure('session-1');
      const session2 = store.ensure('session-2');
      const session3 = store.ensure('session-3');

      // Modify session 1
      session1.state.activeVariationId = 'var-1';
      session1.state.variations = [
        {
          id: 'var-1',
          name: 'test-variation',
          path: '/tmp/var-1',
          sourcePath: '/tmp/source',
          type: 'cow',
          createdAt: new Date().toISOString(),
          lastAccessed: new Date().toISOString(),
        },
      ];

      // Verify isolation
      expect(session1.state.activeVariationId).toBe('var-1');
      expect(session2.state.activeVariationId).toBeNull();
      expect(session3.state.activeVariationId).toBeNull();

      expect(session1.state.variations).toHaveLength(1);
      expect(session2.state.variations).toHaveLength(0);
    });

    it('should persist state modifications', () => {
      const runtime = store.ensure('session-1');

      runtime.state.activeVariationId = 'test-variation';
      runtime.lastPersisted = 1234567890;

      const retrieved = store.get('session-1');
      expect(retrieved?.state.activeVariationId).toBe('test-variation');
      expect(retrieved?.lastPersisted).toBe(1234567890);
    });

    it('should support full persist/restore cycle', () => {
      const mockAppendEntry = vi.fn();
      const mockPi = {
        appendEntry: mockAppendEntry,
      } as unknown as ExtensionAPI;

      // Setup initial state
      const runtime = store.ensure('session-1');
      runtime.state.variations = [
        {
          id: 'var-1',
          name: 'my-variation',
          path: '/tmp/var-1',
          sourcePath: '/tmp/source',
          type: 'cow',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastAccessed: '2024-01-01T00:00:00.000Z',
        } as Variation,
      ];
      runtime.state.activeVariationId = 'var-1';

      // Persist
      store.persistState('session-1', mockPi);

      // Get the data that was passed to appendEntry
      const persistedData = mockAppendEntry.mock.calls[0][1];

      // Create a new store and restore
      const newStore = createRuntimeStore();
      const newRuntime = newStore.ensure('session-1');

      const mockSessionManager: SessionManager = {
        getBranch: () => [{ type: 'custom', customType: 'pi-var:state', data: persistedData }],
        getSessionId: () => 'session-1',
      };

      newStore.restoreState('session-1', mockSessionManager);

      // Verify restored state
      expect(newRuntime.state.variations).toHaveLength(1);
      expect(newRuntime.state.variations[0].name).toBe('my-variation');
      expect(newRuntime.state.activeVariationId).toBe('var-1');
      expect(newRuntime.state.activeVariationId).not.toBeNull();
    });
  });
});

describe('getSessionKey', () => {
  it('should extract session ID from context', () => {
    const mockContext: ExtensionContext = {
      sessionManager: {
        getSessionId: () => 'test-session-123',
      },
    };

    const key = getSessionKey(mockContext);
    expect(key).toBe('test-session-123');
  });

  it('should handle different session IDs', () => {
    const ctx1: ExtensionContext = {
      sessionManager: { getSessionId: () => 'session-a' },
    };
    const ctx2: ExtensionContext = {
      sessionManager: { getSessionId: () => 'session-b' },
    };

    expect(getSessionKey(ctx1)).toBe('session-a');
    expect(getSessionKey(ctx2)).toBe('session-b');
  });

  it('should return default when getSessionId is unavailable', () => {
    const mockContext: ExtensionContext = {
      sessionManager: {},
    };

    const key = getSessionKey(mockContext);
    expect(key).toBe('default');
  });
});
