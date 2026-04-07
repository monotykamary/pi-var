/**
 * Tools index for pi-var
 *
 * Registers redirected file and bash tools that route operations to the active
 * variation directory when a variation is active.
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
  createReadTool,
  createEditTool,
  createWriteTool,
  createBashTool,
  type BashSpawnContext,
} from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../types/index';
import {
  createRedirectedReadOps,
  createRedirectedEditOps,
  createRedirectedWriteOps,
} from './file-redirect';

/**
 * Get runtime function type
 */
type GetRuntime = (ctx: ExtensionContext) => VarRuntime;

/**
 * Register redirected file tools (read, edit, write) and bash tool.
 * These override the built-in tools to redirect operations to the active variation
 * when a variation is active.
 *
 * @param pi - The ExtensionAPI for registering tools
 * @param getRuntime - Function to get the current VarRuntime from context
 */
export function registerRedirectedTools(pi: ExtensionAPI, getRuntime: GetRuntime): void {
  // Cache for default tools by cwd to avoid recreating
  const defaultTools = new Map<
    string,
    {
      read: ReturnType<typeof createReadTool>;
      edit: ReturnType<typeof createEditTool>;
      write: ReturnType<typeof createWriteTool>;
      bash: ReturnType<typeof createBashTool>;
    }
  >();

  function getDefaultTools(cwd: string) {
    let tools = defaultTools.get(cwd);
    if (!tools) {
      tools = {
        read: createReadTool(cwd),
        edit: createEditTool(cwd),
        write: createWriteTool(cwd),
        bash: createBashTool(cwd),
      };
      defaultTools.set(cwd, tools);
    }
    return tools;
  }

  // =========================================================================
  // Read Tool Override
  // =========================================================================
  pi.registerTool({
    name: 'read',
    label: 'read',
    description:
      'Read the contents of a file. Supports text files and images (jpg, png, gif, webp). ' +
      'Images are sent as attachments. For text files, output is truncated to 2000 lines ' +
      'or 50KB (whichever is hit first). Use offset/limit for large files. ' +
      'When in a variation, reads from the variation directory.',
    parameters: createReadTool('').parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
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
  });

  // =========================================================================
  // Edit Tool Override
  // =========================================================================
  pi.registerTool({
    name: 'edit',
    label: 'edit',
    description:
      'Edit a file by replacing exact text. The oldText must match exactly ' +
      '(including whitespace). Use this for precise, surgical edits. ' +
      'When in a variation, edits in the variation directory.',
    parameters: createEditTool('').parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
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
  });

  // =========================================================================
  // Write Tool Override
  // =========================================================================
  pi.registerTool({
    name: 'write',
    label: 'write',
    description:
      'Write content to a file. Creates the file if it does not exist, overwrites if it does. ' +
      'Automatically creates parent directories. ' +
      'When in a variation, writes to the variation directory.',
    parameters: createWriteTool('').parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
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
  });

  // =========================================================================
  // Bash Tool Override with CWD Redirection
  // =========================================================================
  pi.registerTool({
    name: 'bash',
    label: 'bash',
    description:
      'Execute a bash command. Returns stdout and stderr. ' +
      'Output is truncated to last 2000 lines or 50KB (whichever is hit first). ' +
      'When in a variation, executes in the variation directory.',
    parameters: createBashTool('').parameters,

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const runtime = getRuntime(ctx);

      // No active variation - use default behavior with ctx.cwd
      if (!runtime.state.activeVariationId) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.bash.execute(toolCallId, params, signal, onUpdate);
      }

      // Get active variation
      const variation = runtime.state.variations.find(
        (v) => v.id === runtime.state.activeVariationId
      );

      if (!variation) {
        const tools = getDefaultTools(ctx.cwd);
        return tools.bash.execute(toolCallId, params, signal, onUpdate);
      }

      // Create bash tool with variation as cwd and spawn hook for env vars
      const tool = createBashTool(variation.path, {
        spawnHook: (context: BashSpawnContext): BashSpawnContext => ({
          ...context,
          cwd: variation.path,
          env: {
            ...context.env,
            PI_VARIATION: variation.name,
            PI_VARIATION_PATH: variation.path,
            PI_SOURCE_PATH: variation.sourcePath,
            PI_VARIATION_TYPE: variation.type,
          },
        }),
      });

      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  });
}
