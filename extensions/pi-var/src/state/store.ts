/**
 * Runtime store for per-session VarRuntime management
 */

import type { VarRuntime, VarState } from '../types/index.js';

/**
 * Extension context interface for session key extraction
 */
export interface ExtensionContext {
  sessionManager: {
    getSessionId(): string;
  };
}

/**
 * Runtime store interface for managing per-session VarRuntime instances
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
}

/**
 * Extract session ID from extension context
 * @param ctx - Extension context containing session manager
 * @returns Session key string
 */
export function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
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
    redirectionActive: false,
    lastPersisted: Date.now(),
  };
}

/**
 * Create a Map-based runtime store for managing per-session VarRuntime instances
 * @returns RuntimeStore instance with ensure, get, and delete methods
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
  };
}
