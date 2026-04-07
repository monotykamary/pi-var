/**
 * /var command implementation for pi-var
 *
 * Provides subcommands:
 * - /var new [name] [--type <cow|worktree|copy>] [--isolated]
 * - /var cd <name>|main
 * - /var merge [name] [--dry-run] [--keep]
 * - /var clean [name] [--stale <days>]
 * - /var (list)
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type {
  VarRuntime,
  Variation,
  CreateVariationOptions,
  MergeOptions,
} from '../types/index.js';
import { generateVariationName } from '../utils/names.js';
import {
  detectCoWSupport,
  hasGitRepo,
  createVariation,
  removeVariation,
  mergeVariation,
} from '../utils/variations.js';
import { setupVariationEnvironment, detectVariationContext } from '../utils/environment.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

/** Dependencies for command handlers */
interface CommandDeps {
  pi: ExtensionAPI;
  getRuntime: (ctx: ExtensionContext) => VarRuntime;
}

/** Portless allocation result */
interface PortlessResult {
  port: number;
  pid: number;
}

/**
 * Allocate a unique port using portless
 * @returns Port number and process PID, or null if portless fails
 */
async function allocatePortless(): Promise<PortlessResult | null> {
  try {
    // Run portless and get JSON output
    const { stdout } = await execAsync('npx portless --json', { timeout: 30000 });
    const result = JSON.parse(stdout);

    if (result.port && result.pid) {
      return { port: result.port, pid: result.pid };
    }
    return null;
  } catch {
    // Portless not available or failed
    return null;
  }
}

/**
 * Get or create a variation by name
 */
async function getOrCreateVariation(
  name: string | undefined,
  sourcePath: string,
  options: CreateVariationOptions,
  deps: CommandDeps,
  ctx: ExtensionContext
): Promise<Variation | null> {
  const runtime = deps.getRuntime(ctx);

  // Generate name if not provided
  const variationName = name || generateVariationName();

  // Check if variation already exists
  const existing = runtime.state.variations.find((v) => v.name === variationName);
  if (existing) {
    ctx.ui.notify(`Variation "${variationName}" already exists`, 'warning');
    return null;
  }

  // Determine variation type
  let type = options.type;
  if (!type) {
    // Auto-detect: CoW > worktree > copy
    const cowSupport = await detectCoWSupport(sourcePath);
    const hasGit = await hasGitRepo(sourcePath);

    if (cowSupport.supported) {
      type = 'cow';
    } else if (hasGit) {
      type = 'worktree';
    } else {
      type = 'copy';
    }
  }

  // Allocate port if isolated mode requested
  let assignedPort: number | undefined;
  let portlessPid: number | undefined;

  if (options.isolated) {
    const portlessResult = await allocatePortless();
    if (portlessResult) {
      assignedPort = portlessResult.port;
      portlessPid = portlessResult.pid;
      ctx.ui.notify(`Allocated port ${assignedPort} for isolated mode`, 'info');
    } else {
      ctx.ui.notify('Portless not available, continuing without port isolation', 'warning');
    }
  }

  // Create the variation
  const variation = await createVariation(sourcePath, {
    name: variationName,
    type,
    createBranch: options.createBranch,
  });

  // Store portless info if allocated
  if (assignedPort) {
    variation.assignedPort = assignedPort;
    variation.portlessPid = portlessPid;
  }

  // Setup environment (copy .env, symlink node_modules)
  await setupVariationEnvironment(sourcePath, variation.path, {
    usePortless: !!assignedPort,
  });

  // Add to runtime state
  runtime.state.variations.push(variation);
  runtime.state.activeVariationId = variation.id;
  runtime.redirectionActive = true;

  return variation;
}

/**
 * Register the /var command with all subcommands
 */
export function registerVarCommand(pi: ExtensionAPI, deps: CommandDeps): void {
  const { getRuntime } = deps;

  pi.registerCommand('var', {
    description: 'Manage copy-on-write variations for parallel development',
    handler: async (args: string, ctx: ExtensionContext) => {
      const trimmed = args.trim();
      const parts = trimmed.split(/\s+/);
      const subcommand = parts[0] || '';

      const runtime = getRuntime(ctx);

      // Parse flags from args
      const flags = {
        cow: trimmed.includes('--cow'),
        worktree: trimmed.includes('--worktree'),
        copy: trimmed.includes('--copy'),
        isolated: trimmed.includes('--isolated'),
        dryRun: trimmed.includes('--dry-run'),
        keep: trimmed.includes('--keep'),
        stale: trimmed.match(/--stale\s+(\d+)/)?.[1],
      };

      // Determine variation type from flags
      let type: CreateVariationOptions['type'];
      if (flags.cow) type = 'cow';
      else if (flags.worktree) type = 'worktree';
      else if (flags.copy) type = 'copy';

      try {
        switch (subcommand) {
          case '':
          case 'list': {
            // List variations
            if (runtime.state.variations.length === 0) {
              ctx.ui.notify('No variations yet. Use /var new <name> to create one.', 'info');
              return;
            }

            const lines = runtime.state.variations.map((v) => {
              const isActive = v.id === runtime.state.activeVariationId;
              const indicator = isActive ? '🌿 ' : '   ';
              const typeIcon = v.type === 'cow' ? '⚡' : v.type === 'worktree' ? 'Git' : 'Copy';
              const portInfo = v.assignedPort ? ` (port ${v.assignedPort})` : '';
              return `${indicator}${v.name} [${typeIcon}]${portInfo}`;
            });

            const header = runtime.state.activeVariationId
              ? 'Variations (🌿 = active):'
              : 'Variations:';

            ctx.ui.notify(`${header}\n${lines.join('\n')}`, 'info');
            break;
          }

          case 'new': {
            const name = parts[1];

            const variation = await getOrCreateVariation(
              name,
              ctx.cwd,
              { type, isolated: flags.isolated },
              deps,
              ctx
            );

            if (variation) {
              const typeLabel =
                variation.type === 'cow'
                  ? 'CoW'
                  : variation.type === 'worktree'
                    ? 'worktree'
                    : 'copy';
              const portInfo = variation.assignedPort ? ` with port ${variation.assignedPort}` : '';
              ctx.ui.notify(
                `Created ${typeLabel} variation "${variation.name}"${portInfo}`,
                'success'
              );

              // Update status
              const project = path.basename(variation.sourcePath);
              ctx.ui.setStatus('pi-var', `📦 ${project} • 🌿 ${variation.name}`);
            }
            break;
          }

          case 'cd': {
            const target = parts[1];

            if (!target || target === 'main') {
              // Return to source
              runtime.state.activeVariationId = null;
              runtime.redirectionActive = false;
              ctx.ui.setStatus('pi-var', '');
              ctx.ui.notify('Returned to source directory', 'info');
              return;
            }

            // Find variation by name
            const variation = runtime.state.variations.find((v) => v.name === target);
            if (!variation) {
              ctx.ui.notify(`Variation "${target}" not found`, 'error');
              return;
            }

            // Activate variation
            runtime.state.activeVariationId = variation.id;
            runtime.redirectionActive = true;
            variation.lastAccessed = new Date().toISOString();

            // Set port environment if allocated
            if (variation.assignedPort) {
              process.env.PORT = String(variation.assignedPort);
            }

            const project = path.basename(variation.sourcePath);
            ctx.ui.setStatus('pi-var', `📦 ${project} • 🌿 ${variation.name}`);
            ctx.ui.notify(`Switched to variation "${variation.name}"`, 'info');
            break;
          }

          case 'merge': {
            const name = parts[1];

            if (!name) {
              ctx.ui.notify('Usage: /var merge <name> [--dry-run] [--keep]', 'warning');
              return;
            }

            const variation = runtime.state.variations.find((v) => v.name === name);
            if (!variation) {
              ctx.ui.notify(`Variation "${name}" not found`, 'error');
              return;
            }

            // Confirm merge
            if (!flags.dryRun && ctx.hasUI) {
              const confirmed = await ctx.ui.confirm(
                'Merge variation?',
                `Merge "${name}" back to source? This will copy changes to:\n${variation.sourcePath}`
              );
              if (!confirmed) {
                ctx.ui.notify('Merge cancelled', 'info');
                return;
              }
            }

            // Perform merge
            await mergeVariation(variation, ctx.cwd, {
              dryRun: flags.dryRun,
              keep: flags.keep,
            });

            const action = flags.dryRun ? 'Would merge' : 'Merged';
            ctx.ui.notify(`${action} variation "${name}"`, flags.dryRun ? 'info' : 'success');

            // Clean up if not keeping
            if (!flags.dryRun && !flags.keep) {
              await removeVariation(variation);
              runtime.state.variations = runtime.state.variations.filter(
                (v) => v.id !== variation.id
              );

              // If this was the active variation, deactivate it
              if (runtime.state.activeVariationId === variation.id) {
                runtime.state.activeVariationId = null;
                runtime.redirectionActive = false;
                ctx.ui.setStatus('pi-var', '');
              }

              ctx.ui.notify(`Cleaned up variation "${name}"`, 'info');
            }
            break;
          }

          case 'clean': {
            const name = parts[1];

            // Handle --stale flag
            if (flags.stale) {
              const days = parseInt(flags.stale, 10);
              const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

              const staleVariations = runtime.state.variations.filter((v) => {
                const lastAccessed = new Date(v.lastAccessed).getTime();
                return lastAccessed < cutoff;
              });

              if (staleVariations.length === 0) {
                ctx.ui.notify(`No variations older than ${days} days`, 'info');
                return;
              }

              const confirmed = await ctx.ui.confirm(
                'Clean stale variations?',
                `Delete ${staleVariations.length} variation(s) older than ${days} days?`
              );

              if (!confirmed) return;

              for (const v of staleVariations) {
                await removeVariation(v);
                runtime.state.variations = runtime.state.variations.filter(
                  (existing) => existing.id !== v.id
                );
              }

              ctx.ui.notify(`Cleaned ${staleVariations.length} stale variation(s)`, 'success');
              return;
            }

            // Clean specific variation
            if (!name) {
              ctx.ui.notify('Usage: /var clean <name> or /var clean --stale <days>', 'warning');
              return;
            }

            const variation = runtime.state.variations.find((v) => v.name === name);
            if (!variation) {
              ctx.ui.notify(`Variation "${name}" not found`, 'error');
              return;
            }

            // Confirm if has unmerged changes (check if variation files differ from source)
            const confirmed = await ctx.ui.confirm(
              'Delete variation?',
              `Delete "${name}"? This cannot be undone.`
            );

            if (!confirmed) {
              ctx.ui.notify('Clean cancelled', 'info');
              return;
            }

            // Stop portless process if running
            if (variation.portlessPid) {
              try {
                process.kill(variation.portlessPid, 'SIGTERM');
              } catch {
                // Process may already be dead
              }
            }

            await removeVariation(variation);
            runtime.state.variations = runtime.state.variations.filter(
              (v) => v.id !== variation.id
            );

            // If this was active, deactivate
            if (runtime.state.activeVariationId === variation.id) {
              runtime.state.activeVariationId = null;
              runtime.redirectionActive = false;
              ctx.ui.setStatus('pi-var', '');
            }

            ctx.ui.notify(`Deleted variation "${name}"`, 'success');
            break;
          }

          default: {
            ctx.ui.notify(
              `Unknown subcommand: ${subcommand}\n\n` +
                'Usage:\n' +
                '  /var                    List variations\n' +
                '  /var new [name]         Create variation\n' +
                '  /var cd <name|main>     Switch to variation or back to source\n' +
                '  /var merge <name>       Merge variation back to source\n' +
                '  /var clean <name>       Delete variation\n' +
                '  /var clean --stale <d>  Delete variations older than d days',
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

  // Hook user_bash events to ensure commands run in variation directory
  pi.on('user_bash', async (event, ctx) => {
    const runtime = getRuntime(ctx);

    // No active variation, let command proceed normally
    if (!runtime.state.activeVariationId) {
      return undefined;
    }

    const variation = runtime.state.variations.find(
      (v) => v.id === runtime.state.activeVariationId
    );

    if (!variation) {
      return undefined;
    }

    // Check if command already has cd or is a cd itself
    const command = event.command.trim();
    if (command.startsWith('cd ') || command === 'cd') {
      return undefined; // Let cd commands through
    }

    // Check if command already references the variation path
    if (command.includes(variation.path)) {
      return undefined;
    }

    // Prepend cd to variation directory
    const modifiedCommand = `cd ${JSON.stringify(variation.path)} && ${command}`;

    return {
      result: await deps.pi.exec('bash', ['-c', modifiedCommand], {
        cwd: variation.path,
        timeout: event.timeout || 30000,
      }),
    };
  });
}
