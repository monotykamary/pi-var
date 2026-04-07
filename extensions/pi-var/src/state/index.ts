/**
 * State management module
 */

export { VAR_STATE_ENTRY_TYPE } from './types';
export type {
  PersistedVarState,
  SessionEntry,
  SessionManager,
  RuntimeStore,
  ExtensionContext,
} from './types';
export { getSessionKey } from './keys';
export { createRuntimeStore } from './store.js';
