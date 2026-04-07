/**
 * Read tool override for variation redirection
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createReadTool } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import { createRedirectedReadOps } from '../file-redirect';

export function createReadHandler(
  getRuntime: (ctx: ExtensionContext) => VarRuntime,
  getDefaultTools: (cwd: string) => {
    read: ReturnType<typeof createReadTool>;
  }
) {
  return {
    name: 'read' as const,
    label: 'read',
    description:
      'Read the contents of a file. Supports text files and images (jpg, png, gif, webp). ' +
      'Images are sent as attachments. For text files, output is truncated to 2000 lines ' +
      'or 50KB (whichever is hit first). Use offset/limit for large files. ' +
      'When in a variation, reads from the variation directory.',
    parameters: createReadTool('').parameters,

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
        return tools.read.execute(toolCallId, params, signal, onUpdate);
      }

      // Get active variation
      const variation = runtime.state.variations.find(
        (v) => v.id === runtime.state.activeVariationId
      );

      if (!variation) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.read.execute(toolCallId, params, signal, onUpdate);
      }

      // Create tool with redirected operations
      const ops = createRedirectedReadOps(ctx.cwd, runtime);
      const tool = createReadTool(ctx.cwd, { operations: ops });
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
