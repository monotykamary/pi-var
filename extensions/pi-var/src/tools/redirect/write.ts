/**
 * Write tool override for variation redirection
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createWriteTool } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import { createRedirectedWriteOps } from '../file-redirect';

export function createWriteHandler(
  getRuntime: (ctx: ExtensionContext) => VarRuntime,
  getDefaultTools: (cwd: string) => {
    write: ReturnType<typeof createWriteTool>;
  }
) {
  return {
    name: 'write' as const,
    label: 'write',
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does. ' +
      'Automatically creates parent directories. ' +
      'When in a variation, writes to the variation directory.',
    parameters: createWriteTool('').parameters,

    async execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal,
      onUpdate: unknown,
      ctx: ExtensionContext
    ) {
      const runtime = getRuntime(ctx);

      // No active variation - use default behavior
      if (!runtime.state.activeVariationId) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.write.execute(toolCallId, params, signal, onUpdate);
      }

      // Get active variation
      const variation = runtime.state.variations.find(
        (v) => v.id === runtime.state.activeVariationId
      );

      if (!variation) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.write.execute(toolCallId, params, signal, onUpdate);
      }

      // Create tool with redirected operations
      const ops = createRedirectedWriteOps(ctx.cwd, runtime);
      const tool = createWriteTool(ctx.cwd, { operations: ops });
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
