/**
 * pi-var — Copy-on-write variations extension (autoregressive)
 *
 * AI-driven variation management:
 * - create_variation tool — AI creates variations automatically
 * - /var command — argument-free status and manual override
 * - File redirection — transparent read/edit/write to active variation
 * - Environment sync — copy .env, symlink node_modules
 *
 * Port isolation is handled by the AI via bash (portless), not extension code.
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, Variation } from './src/types/index';
import { generateVariationName } from './src/utils/names';
import { getSessionKey, createRuntimeStore } from './src/state/store';
import { registerVarCommand } from './src/tools/command';
import { registerRedirectedFileTools } from './src/tools/index';
import { setupVariationEnvironment, detectVariationContext } from './src/utils/environment';
import { createVariation, mergeVariation } from './src/utils/variations';
import { Type } from '@sinclair/typebox';

// Default configuration
const DEFAULT_CONFIG = {
  copy: [
    '.env',
    '.env.*',
    '.envrc',
    '.npmrc',
    '.yarnrc',
    '.yarnrc.yml',
    '.tool-versions',
    '.node-version',
    '.python-version',
    'docker-compose.override.yml',
  ],
  symlink: [
    'node_modules',
    '.next',
    '.nuxt',
    '.angular',
    '.turbo',
    'target',
    '.venv',
    'venv',
    'vendor',
  ],
  postCreate: [],
};

export default function piVarExtension(pi: ExtensionAPI) {
  // Session-scoped runtime store
  const runtimeStore = createRuntimeStore();
  const getRuntime = (ctx: ExtensionContext): VarRuntime => runtimeStore.ensure(getSessionKey(ctx));

  // Register /var command (argument-free, status/overview)
  registerVarCommand(pi, { getRuntime, pi, runtimeStore });

  // Register redirected file tools (only when in variation)
  registerRedirectedFileTools(pi, getRuntime);

  // Session lifecycle
  pi.on('session_start', async (event, ctx) => {
    const sessionKey = getSessionKey(ctx);

    // First ensure runtime exists, then restore from session
    runtimeStore.ensure(sessionKey);
    runtimeStore.restoreState(sessionKey, ctx.sessionManager);

    const runtime = getRuntime(ctx);

    // Detect if we're inside a variation directory
    const context = detectVariationContext(ctx.cwd);
    if (context.inVariation && context.variationId) {
      // Reconnect to existing variation
      const existing = runtime.state.variations.find((v) => v.id === context.variationId);
      if (existing) {
        runtime.state.activeVariationId = existing.id;
        runtime.redirectionActive = true;
        ctx.ui.notify(`Reconnected to variation: ${existing.name}`, 'info');
        // Persist the reconnection
        runtimeStore.persistState(sessionKey, pi);
      }
    }
  });

  // System prompt extension when in variation
  pi.on('before_agent_start', async (event, ctx) => {
    const runtime = getRuntime(ctx);
    if (!runtime.state.activeVariationId) return;

    const variation = runtime.state.variations.find(
      (v) => v.id === runtime.state.activeVariationId
    );
    if (!variation) return;

    return {
      systemPrompt:
        event.systemPrompt +
        `

You are currently working in a variation: "${variation.name}"
- Source directory: ${variation.sourcePath}
- Variation directory: ${variation.path}
- Type: ${variation.type === 'cow' ? 'Copy-on-Write clone' : variation.type === 'worktree' ? 'Git worktree' : 'Full copy'}

All file operations (read, edit, write) and bash commands are automatically redirected to the variation directory.
When finished, use the merge_variation tool to merge changes back to the source.
`,
    };
  });

  // ---- Tool: AI creates variations automatically ----

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
        runtime.redirectionActive = true;

        // Persist state to session
        runtimeStore.persistState(getSessionKey(ctx), pi);

        const typeLabel =
          variation.type === 'cow'
            ? 'CoW clone'
            : variation.type === 'worktree'
              ? 'Git worktree'
              : 'Full copy';

        return text(
          `Created ${typeLabel} variation "${variation.name}" for: ${params.purpose}\n` +
            `Path: ${variation.path}\n\n` +
            `All file operations now redirect to this variation.` +
            (variation.type === 'worktree' && variation.branchName
              ? `\nBranch: ${variation.branchName}`
              : '')
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return text(`Failed to create variation: ${message}`);
      }
    },
  });

  // ---- Tool: Merge variation back to source ----

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

        // Persist state to session
        runtimeStore.persistState(getSessionKey(ctx), pi);

        const action = params.dryRun ? 'Would merge' : 'Merged';
        const output = dryRunOutput ? `\n\n${dryRunOutput}` : '';
        return text(`${action} variation "${variation.name}" to source.${output}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return text(`Failed to merge variation: ${message}`);
      }
    },
  });

  // Session end - persist final state
  pi.on('session_shutdown', async (_event, ctx) => {
    runtimeStore.persistState(getSessionKey(ctx), pi);
  });
}
