/**
 * Tools index for pi-var
 *
 * Registers redirected file tools that route read, edit, and write operations
 * to the active variation directory when a variation is active.
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createReadTool, createEditTool, createWriteTool } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../types/index.js';
import {
  createRedirectedReadOps,
  createRedirectedEditOps,
  createRedirectedWriteOps,
} from './file-redirect.js';

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
export function registerRedirectedFileTools(pi: ExtensionAPI, getRuntime: GetRuntime): void {
  // Store original cwd for path resolution
  const baseCwd = process.cwd();

  // Create base tool definitions (we'll override their execute methods)
  const baseReadTool = createReadTool(baseCwd);
  const baseEditTool = createEditTool(baseCwd);
  const baseWriteTool = createWriteTool(baseCwd);

  // Override read tool with redirection
  pi.registerTool({
    ...baseReadTool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const runtime = getRuntime(ctx);

      // Only redirect when there's an active variation
      if (runtime.state.activeVariationId) {
        const tool = createReadTool(baseCwd, {
          operations: createRedirectedReadOps(baseCwd, runtime),
        });
        return tool.execute(toolCallId, params, signal, onUpdate, ctx);
      }

      // No active variation - use original behavior
      return baseReadTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });

  // Override edit tool with redirection
  pi.registerTool({
    ...baseEditTool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const runtime = getRuntime(ctx);

      // Only redirect when there's an active variation
      if (runtime.state.activeVariationId) {
        const tool = createEditTool(baseCwd, {
          operations: createRedirectedEditOps(baseCwd, runtime),
        });
        return tool.execute(toolCallId, params, signal, onUpdate, ctx);
      }

      // No active variation - use original behavior
      return baseEditTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });

  // Override write tool with redirection
  pi.registerTool({
    ...baseWriteTool,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const runtime = getRuntime(ctx);

      // Only redirect when there's an active variation
      if (runtime.state.activeVariationId) {
        const tool = createWriteTool(baseCwd, {
          operations: createRedirectedWriteOps(baseCwd, runtime),
        });
        return tool.execute(toolCallId, params, signal, onUpdate, ctx);
      }

      // No active variation - use original behavior
      return baseWriteTool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
