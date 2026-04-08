/**
 * create_variation tool registration
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { VarRuntime } from '../../types/index';
import { createVariation } from '../../variation/create';
import { setupVariationEnvironment, DEFAULT_CONFIG } from '../../environment/index';
import { generateVariationName } from '../../utils/names';

export function registerCreateVariationTool(
  pi: ExtensionAPI,
  getRuntime: (ctx: ExtensionContext) => VarRuntime
): void {
  pi.registerTool({
    name: 'create_variation',
    label: 'Create Variation',
    description:
      'Create a copy-on-write variation for isolated development work. ' +
      'Auto-generates a semantic name from the purpose. ' +
      'Auto-detects best method: CoW (APFS clonefile/Linux reflink) > Git worktree > Full copy. ' +
      'All file operations automatically redirect to the variation. ' +
      'For port isolation (dev servers), run `npx portless --json` via bash and set PORT from result.',
    parameters: Type.Object({
      purpose: Type.String({
        description:
          'Brief description of what this variation is for (e.g., "fix auth bug", "experiment with new UI"). ' +
          'Used to auto-generate a semantic name.',
      }),
      type: Type.Optional(
        Type.Union([Type.Literal('cow'), Type.Literal('worktree'), Type.Literal('copy')], {
          description:
            'Optional: Force specific creation method. If omitted, auto-detects best available.',
        })
      ),
      createBranch: Type.Optional(
        Type.Boolean({
          default: false,
          description: 'For worktrees: create a git branch (var/<name>) for this variation.',
        })
      ),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const text = (msg: string) => ({
        content: [{ type: 'text' as const, text: msg }],
        details: undefined,
      });

      const runtime = getRuntime(ctx);

      // Auto-generate name from purpose
      const semanticName = params.purpose
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30);
      const variationName = semanticName || generateVariationName();

      // Check for existing
      const existing = runtime.state.variations.find((v) => v.name === variationName);
      if (existing) {
        return text(
          `Variation "${variationName}" already exists. ` +
            `Switch to it with the variation context, or create with a different purpose.`
        );
      }

      try {
        // Create variation
        const variation = await createVariation(ctx.cwd, {
          name: variationName,
          type: params.type,
          createBranch: params.createBranch,
        });

        // Setup environment
        await setupVariationEnvironment(ctx.cwd, variation.path, DEFAULT_CONFIG);

        // Add to runtime and activate
        runtime.state.variations.push(variation);
        runtime.state.activeVariationId = variation.id;

        const typeLabel =
          variation.type === 'cow'
            ? 'CoW clone'
            : variation.type === 'worktree'
              ? 'Git worktree'
              : 'Full copy';

        const branchInfo = variation.branchName
          ? `\nBranch: ${variation.branchName}` +
            (variation.mergeBaseCommit ? ` (base: ${variation.mergeBaseCommit.slice(0, 8)})` : '')
          : '';

        return text(
          `Created ${typeLabel} variation "${variation.name}" for: ${params.purpose}\n` +
            `Path: ${variation.path}\n\n` +
            `All file operations now redirect to this variation.` +
            branchInfo
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return text(`Failed to create variation: ${message}`);
      }
    },
  });
}
