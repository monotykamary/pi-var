/**
 * State types and interfaces
 */

import type { VarRuntime, VarState, Variation } from '../types/index';

/** Custom entry type for session persistence */
export const VAR_STATE_ENTRY_TYPE = 'pi-var:state';

/** Serialized state for persistence */
export interface PersistedVarState {
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

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
