/**
 * Unit tests for RuntimeStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntimeStore, getSessionKey, type ExtensionContext } from '../../src/state/store';
import type { VarRuntime } from '../../src/types/index';

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
      expect(typeof store.ensure).toBe('function');
      expect(typeof store.get).toBe('function');
      expect(typeof store.delete).toBe('function');
    });
  });

  describe('ensure', () => {
    it('should create a new runtime for new session key', () => {
      const runtime = store.ensure('session-1');

      expect(runtime).toBeDefined();
      expect(runtime.state.sessionId).toBe('session-1');
      expect(runtime.state.activeVariationId).toBeNull();
      expect(runtime.state.variations).toEqual([]);
      expect(runtime.redirectionActive).toBe(false);
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

      runtime.redirectionActive = true;
      runtime.lastPersisted = 1234567890;

      const retrieved = store.get('session-1');
      expect(retrieved?.redirectionActive).toBe(true);
      expect(retrieved?.lastPersisted).toBe(1234567890);
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
});
