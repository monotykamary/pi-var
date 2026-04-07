/**
 * Runtime store for per-session VarRuntime management
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, VarState, Variation } from '../types/index';

/** Custom entry type for session persistence */
const VAR_STATE_ENTRY_TYPE = 'pi-var:state';

/** Serialized state for persistence */
interface PersistedVarState {
  variations: Variation[];
  activeVariationId: string | null;
}

/** Session entry interface for state restoration */
export interface SessionEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

/** Session manager interface for accessing entries */
export interface SessionManager {
  getEntries?(): SessionEntry[];
  getBranch?(): SessionEntry[];
  getSessionId?(): string;
}

/**
 * Extension context interface for session key extraction
 */
export interface ExtensionContext {
  sessionManager: SessionManager;
}

/**
 * Runtime store interface for managing per-session VarRuntime instances
 * @internal
 */
export interface RuntimeStore {
  /**
   * Ensure a VarRuntime exists for the given session key,
   * creating one if it doesn't exist
   */
  ensure(sessionKey: string): VarRuntime;

  /**
   * Get an existing VarRuntime for the session key,
   * returning undefined if not found
   */
  get(sessionKey: string): VarRuntime | undefined;

  /**
   * Delete a VarRuntime for the given session key
   */
  delete(sessionKey: string): boolean;

  /**
   * Persist current state to the session using pi.appendEntry()
   */
  persistState(sessionKey: string, pi: ExtensionAPI): void;

  /**
   * Restore state from session entries
   */
  restoreState(sessionKey: string, sessionManager: SessionManager): void;
}

/**
 * Extract session ID from extension context
 * @param ctx - Extension context containing session manager
 * @returns Session key string
 */
export function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId?.() || 'default';
}

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
