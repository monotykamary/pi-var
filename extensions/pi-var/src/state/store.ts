/**
 * State persistence and restoration
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { VAR_STATE_ENTRY_TYPE, PersistedVarState, SessionManager, RuntimeStore } from './types.js';
import type { VarRuntime, VarState } from '../types/index.js';

/**
 * Create default initial state for a new session
 * @param sessionId - The session identifier
 * @returns Initial VarState object
 */
function createInitialState(sessionId: string): VarState {
  return {
    activeVariationId: null,
    variations: [],
    sessionId,
  };
}

/**
 * Create a new VarRuntime instance with initial state
 * @param sessionId - The session identifier
 * @returns New VarRuntime instance
 */
function createRuntime(sessionId: string): VarRuntime {
  return {
    state: createInitialState(sessionId),
    lastPersisted: Date.now(),
  };
}

/**
 * Create Map-based runtime store for managing per-session VarRuntime instances
 * @returns RuntimeStore instance with ensure, get, delete, and persistState methods
 */
export function createRuntimeStore(): RuntimeStore {
  const store = new Map<string, VarRuntime>();

  return {
    ensure(sessionKey: string): VarRuntime {
      let runtime = store.get(sessionKey);
      if (!runtime) {
        runtime = createRuntime(sessionKey);
        store.set(sessionKey, runtime);
      }
      return runtime;
    },

    get(sessionKey: string): VarRuntime | undefined {
      return store.get(sessionKey);
    },

    delete(sessionKey: string): boolean {
      return store.delete(sessionKey);
    },

    persistState(sessionKey: string, pi: ExtensionAPI): void {
      const runtime = store.get(sessionKey);
      if (!runtime) return;

      const persistedState: PersistedVarState = {
        variations: runtime.state.variations,
        activeVariationId: runtime.state.activeVariationId,
      };

      pi.appendEntry(VAR_STATE_ENTRY_TYPE, persistedState);
      runtime.lastPersisted = Date.now();
    },

    restoreState(sessionKey: string, sessionManager: SessionManager): void {
      const runtime = store.get(sessionKey);
      if (!runtime) return;

      // Get entries - prefer getEntries() as it's always available during session_start
      // getBranch() may fail early in session lifecycle before tree is initialized
      let entries: SessionEntry[] = [];
      try {
        if (sessionManager.getEntries) {
          entries = sessionManager.getEntries();
        } else if (sessionManager.getBranch) {
          entries = sessionManager.getBranch();
        }
      } catch {
        // Session manager may not be fully initialized yet
        return;
      }

      if (!entries || entries.length === 0) return;

      // Find the last state entry (entries are in order, so we take the last one)
      const stateEntries = entries.filter(
        (e: SessionEntry) => e.type === 'custom' && e.customType === VAR_STATE_ENTRY_TYPE
      );

      if (stateEntries.length === 0) return;

      const lastEntry = stateEntries[stateEntries.length - 1];
      const persistedState = lastEntry.data as PersistedVarState;

      if (persistedState) {
        runtime.state.variations = persistedState.variations || [];
        runtime.state.activeVariationId = persistedState.activeVariationId ?? null;
      }
    },
  };
}

import type { SessionEntry } from './types.js';
