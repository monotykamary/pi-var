/**
 * Session key extraction
 */

import type { ExtensionContext } from './types';

/**
 * Extract session ID from extension context
 * @param ctx - Extension context containing session manager
 * @returns Session key string
 */
export function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId?.() || 'default';
}
