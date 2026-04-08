/**
 * merge_variation tool registration
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { VarRuntime } from '../../types/index';
import { mergeVariation } from '../../variation/merge/index.js';

export function registerMergeVariationTool(
  pi: ExtensionAPI,
  getRuntime: (ctx: ExtensionContext) => VarRuntime,
  persistState: (ctx: ExtensionContext) => void
): void {
  pi.registerTool({
    name: 'merge_variation',
    label: 'Merge Variation',
    description:
      'Merge changes from the current variation back to the source directory. ' +
      'Auto-selects merge strategy: git (for worktrees) > rsync > copy. ' +
      'Variations are never deleted automatically. Use /var clean to remove old variations.',
    parameters: Type.Object({
      dryRun: Type.Optional(
        Type.Boolean({
          default: false,
          description: 'Preview what would be merged without applying changes.',
        })
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const text = (msg: string) => ({
        content: [{ type: 'text' as const, text: msg }],
        details: undefined,
      });

      const runtime = getRuntime(ctx);
      const activeId = runtime.state.activeVariationId;

      if (!activeId) {
        return text('No active variation to merge. Create one with create_variation first.');
      }

      const variation = runtime.state.variations.find((v) => v.id === activeId);
      if (!variation) {
        return text('Active variation not found in state. This is a bug.');
      }

      try {
        const dryRunOutput = await mergeVariation(variation, ctx.cwd, {
          dryRun: params.dryRun,
        });

        // Deactivate variation after successful merge (not dry-run)
        if (!params.dryRun) {
          runtime.state.activeVariationId = null;
          ctx.ui.setStatus('pi-var', '');
        }

        // Persist state to session
        persistState(ctx);

        const action = params.dryRun ? 'Would merge' : 'Merged';
        const output = dryRunOutput ? `\n\n${dryRunOutput}` : '';
        const deactivated = !params.dryRun ? ' Now back in source directory.' : '';
        return text(`${action} variation "${variation.name}" to source.${deactivated}${output}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return text(`Failed to merge variation: ${message}`);
      }
    },
  });
}
