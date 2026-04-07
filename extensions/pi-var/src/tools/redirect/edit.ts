/**
 * Edit tool override for variation redirection
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  AgentToolUpdateCallback,
} from '@mariozechner/pi-coding-agent';
import { createEditTool, type EditToolInput } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import { createRedirectedEditOps } from '../file-redirect';

export function createEditHandler(
  getRuntime: (ctx: ExtensionContext) => VarRuntime,
  getDefaultTools: (cwd: string) => {
    edit: ReturnType<typeof createEditTool>;
  }
) {
  return {
    name: 'edit' as const,
    label: 'edit',
    description:
      'Edit a file by replacing exact text. The oldText must match exactly ' +
      '(including whitespace). Use this for precise, surgical edits. ' +
      'When in a variation, edits in the variation directory.',
    parameters: createEditTool('').parameters,

    async execute(
      toolCallId: string,
      params: EditToolInput,
      signal: AbortSignal,
      onUpdate: AgentToolUpdateCallback<unknown> | undefined,
      ctx: ExtensionContext
    ) {
      const runtime = getRuntime(ctx);

      // No active variation - use default behavior
      if (!runtime.state.activeVariationId) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.edit.execute(toolCallId, params, signal, onUpdate);
      }

      // Get active variation
      const variation = runtime.state.variations.find(
        (v) => v.id === runtime.state.activeVariationId
      );

      if (!variation) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.edit.execute(toolCallId, params, signal, onUpdate);
      }

      // Create tool with redirected operations
      const ops = createRedirectedEditOps(ctx.cwd, runtime);
      const tool = createEditTool(ctx.cwd, { operations: ops });
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
