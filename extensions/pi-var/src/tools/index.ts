/**
 * Tools index for pi-var
 *
 * Registers redirected file tools that route read, edit, and write operations
 * to the active variation directory when a variation is active.
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../types/index';

/**
 * Get runtime function type
 */
type GetRuntime = (ctx: ExtensionContext) => VarRuntime;

/**
 * Register redirected file tools that route operations to the active variation
 *
 * When a variation is active, all read, edit, and write operations are redirected
 * to the variation directory. This provides transparent copy-on-write behavior where
 * the agent works in the variation while leaving the source directory unchanged.
 *
 * @param pi - The ExtensionAPI for registering tools
 * @param getRuntime - Function to get the current VarRuntime from context
 */
export function registerRedirectedFileTools(_pi: ExtensionAPI, _getRuntime: GetRuntime): void {
  // TODO: Implement file redirection using the SDK's tool wrapping API
  // For now, this is a placeholder that will be implemented when the exact
  // SDK API is confirmed
}
