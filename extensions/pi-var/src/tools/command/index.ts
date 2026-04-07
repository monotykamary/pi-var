/**
 * /var command registration
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import type { RuntimeStore } from '../../state/types';
import { handleStatus, handleList } from './status';
import { handleCleanStale, handleCleanSpecific } from './clean';
import { handleStop } from './stop';

/** Dependencies for command handlers */
interface CommandDeps {
  pi: ExtensionAPI;
  getRuntime: (ctx: ExtensionContext) => VarRuntime;
  runtimeStore: RuntimeStore;
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
          handleStatus(runtime, ctx);
          return;
        }

        // Manual subcommands (power user features)
        switch (subcommand) {
          case 'list': {
            handleList(runtime, ctx);
            break;
          }

          case 'clean': {
            // Handle --stale flag
            if (staleDays) {
              await handleCleanStale(runtime, ctx, staleDays, runtimeStore, pi);
              return;
            }

            // Clean specific variation
            const name = parts[1];
            if (!name) {
              ctx.ui.notify('Usage: /var clean <name> or /var clean --stale <days>', 'warning');
              return;
            }

            await handleCleanSpecific(runtime, ctx, name, runtimeStore, pi);
            break;
          }

          case 'stop':
          case 'main': {
            handleStop(runtime, ctx, runtimeStore, pi);
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
