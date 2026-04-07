/**
 * /var command — Argument-free status and manual override
 *
 * The AI handles variation creation via tools. This command provides:
 * - Status overview (list variations, show active)
 * - Manual cleanup commands for power users
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../types/index';
import type { RuntimeStore } from '../state/store';
import { removeVariation } from '../utils/variations';

/** Dependencies for command handlers */
interface CommandDeps {
  pi: ExtensionAPI;
  getRuntime: (ctx: ExtensionContext) => VarRuntime;
  runtimeStore: RuntimeStore;
}

/**
 * Extract session key from extension context
 */
function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

/**
 * Register the /var command (argument-free, status/overview)
 */
export function registerVarCommand(pi: ExtensionAPI, deps: CommandDeps): void {
  const { getRuntime, runtimeStore } = deps;

  pi.registerCommand('var', {
    description: 'Show variation status and provide manual override commands',
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = args.trim();
      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0] || '';

      const runtime = getRuntime(ctx);

      // Parse flags
      const staleMatch = trimmed.match(/--stale\s+(\d+)/);
      const staleDays = staleMatch ? parseInt(staleMatch[1], 10) : null;

      try {
        // No args = status overview
        if (!trimmed) {
          if (runtime.state.variations.length === 0) {
            ctx.ui.notify(
              'No active variations.\n\n' +
                'The AI creates variations automatically via the create_variation tool ' +
                'when parallel or isolated work is needed.',
              'info'
            );
            return;
          }

          const lines = runtime.state.variations.map((v) => {
            const isActive = v.id === runtime.state.activeVariationId;
            const indicator = isActive ? '🌿 ' : '   ';
            const typeIcon = v.type === 'cow' ? '⚡' : v.type === 'worktree' ? 'Git' : 'Copy';
            return `${indicator}${v.name} [${typeIcon}]`;
          });

          const active = runtime.state.activeVariationId
            ? runtime.state.variations.find((v) => v.id === runtime.state.activeVariationId)
            : null;

          const header = active
            ? `Active variation: "${active.name}"\nAll operations redirect to: ${active.path}\n`
            : 'No active variation (working in source)';

          ctx.ui.notify(`${header}\n\nVariations:\n${lines.join('\n')}`, 'info');
          return;
        }

        // Manual subcommands (power user features)
        switch (subcommand) {
          case 'list': {
            // Same as no args
            if (runtime.state.variations.length === 0) {
              ctx.ui.notify(
                'No variations yet. The AI creates them via create_variation tool.',
                'info'
              );
              return;
            }

            const lines = runtime.state.variations.map((v) => {
              const isActive = v.id === runtime.state.activeVariationId;
              const indicator = isActive ? '🌿 ' : '   ';
              const typeIcon = v.type === 'cow' ? '⚡' : v.type === 'worktree' ? 'Git' : 'Copy';
              return `${indicator}${v.name} [${typeIcon}]`;
            });

            ctx.ui.notify(`Variations:\n${lines.join('\n')}`, 'info');
            break;
          }

          case 'clean': {
            // Handle --stale flag
            if (staleDays) {
              const cutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

              const staleVariations = runtime.state.variations.filter((v) => {
                const lastAccessed = new Date(v.lastAccessed).getTime();
                return lastAccessed < cutoff;
              });

              if (staleVariations.length === 0) {
                ctx.ui.notify(`No variations older than ${staleDays} days`, 'info');
                return;
              }

              const confirmed = await ctx.ui.confirm(
                'Clean stale variations?',
                `Delete ${staleVariations.length} variation(s) older than ${staleDays} days?`
              );

              if (!confirmed) return;

              for (const v of staleVariations) {
                await removeVariation(v);
                runtime.state.variations = runtime.state.variations.filter(
                  (existing) => existing.id !== v.id
                );
              }

              // Persist state after cleaning
              runtimeStore.persistState(getSessionKey(ctx), pi);

              ctx.ui.notify(`Cleaned ${staleVariations.length} stale variation(s)`, 'info');
              return;
            }

            // Clean specific variation
            const name = parts[1];
            if (!name) {
              ctx.ui.notify('Usage: /var clean <name> or /var clean --stale <days>', 'warning');
              return;
            }

            const variation = runtime.state.variations.find((v) => v.name === name);
            if (!variation) {
              ctx.ui.notify(`Variation "${name}" not found`, 'error');
              return;
            }

            const confirmed = await ctx.ui.confirm(
              'Delete variation?',
              `Delete "${name}"? This cannot be undone.`
            );

            if (!confirmed) {
              ctx.ui.notify('Clean cancelled', 'info');
              return;
            }

            await removeVariation(variation);
            runtime.state.variations = runtime.state.variations.filter(
              (v) => v.id !== variation.id
            );

            // If this was active, deactivate
            if (runtime.state.activeVariationId === variation.id) {
              runtime.state.activeVariationId = null;
              ctx.ui.setStatus('pi-var', '');
            }

            // Persist state after cleaning
            runtimeStore.persistState(getSessionKey(ctx), pi);

            ctx.ui.notify(`Deleted variation "${name}"`, 'info');
            break;
          }

          case 'stop':
          case 'main': {
            // Deactivate current variation (return to source)
            if (runtime.state.activeVariationId) {
              const variation = runtime.state.variations.find(
                (v) => v.id === runtime.state.activeVariationId
              );
              runtime.state.activeVariationId = null;
              ctx.ui.setStatus('pi-var', '');

              // Persist the "stop" state to session
              // This makes /var stop meaningful — it clears the active variation in the session
              runtimeStore.persistState(getSessionKey(ctx), pi);

              ctx.ui.notify(
                variation
                  ? `Left variation "${variation.name}" — now in source`
                  : 'Now in source directory',
                'info'
              );
            } else {
              ctx.ui.notify('Already in source directory', 'info');
            }
            break;
          }

          default: {
            ctx.ui.notify(
              `Unknown: ${subcommand}\n\n` +
                'Usage:\n' +
                '  /var                    Show status\n' +
                '  /var list               List variations\n' +
                '  /var clean <name>       Delete variation\n' +
                '  /var clean --stale <d>  Delete variations older than d days\n' +
                '  /var stop               Return to source (deactivate)',
              'warning'
            );
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Error: ${message}`, 'error');
      }
    },
  });
}
