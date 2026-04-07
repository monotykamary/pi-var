/**
 * Bash tool override for variation redirection
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { createBashTool, type BashSpawnContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';

export function createBashHandler(
  getRuntime: (ctx: ExtensionContext) => VarRuntime,
  getDefaultTools: (cwd: string) => {
    bash: ReturnType<typeof createBashTool>;
  }
) {
  return {
    name: 'bash' as const,
    label: 'bash',
    description:
      'Execute a bash command. Returns stdout and stderr. ' +
      'Output is truncated to last 2000 lines or 50KB (whichever is hit first). ' +
      'When in a variation, executes in the variation directory.',
    parameters: createBashTool('').parameters,

    async execute(
      toolCallId: string,
      params: unknown,
      signal: AbortSignal,
      onUpdate: unknown,
      ctx: ExtensionContext
    ) {
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
  };
}
