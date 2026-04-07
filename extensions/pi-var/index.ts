/**
 * pi-var — Copy-on-write variations extension
 *
 * Provides:
 * - /var command — create, switch, merge, clean variations
 * - File redirection — transparent read/edit/write to active variation
 * - Status indicator — footer shows current variation
 * - Environment sync — copy .env, symlink node_modules
 * - Portless integration — isolated mode with unique ports
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime, VarState, Variation } from './types/index.js';
import { generateVariationId, generateVariationName } from './utils/names.js';
import { getSessionKey, createRuntimeStore } from './state/store.js';
import { registerVarCommand } from './tools/command.js';
import { registerRedirectedFileTools } from './tools/index.js';
import { setupVariationEnvironment, detectVariationContext } from './utils/environment.js';
import { createVariation, removeVariation, mergeVariation } from './utils/variations.js';

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
  usePortless: false,
};

export default function piVarExtension(pi: ExtensionAPI) {
  // Session-scoped runtime store
  const runtimeStore = createRuntimeStore();
  const getRuntime = (ctx: ExtensionContext): VarRuntime => runtimeStore.ensure(getSessionKey(ctx));

  // Register /var command (includes bash guardrails)
  registerVarCommand(pi, { getRuntime, pi });

  // Register redirected file tools (only when in variation)
  registerRedirectedFileTools(pi, getRuntime);

  // Status line updater
  const updateStatus = (ctx: ExtensionContext) => {
    const runtime = getRuntime(ctx);
    const active = runtime.state.activeVariationId;

    if (active) {
      const variation = runtime.state.variations.find((v) => v.id === active);
      if (variation) {
        const project = variation.sourcePath.split('/').pop() || 'project';
        ctx.ui.setStatus('pi-var', `📦 ${project} • 🌿 ${variation.name}`);
        return;
      }
    }

    ctx.ui.setStatus('pi-var', '');
  };

  // Session lifecycle
  pi.on('session_start', async (event, ctx) => {
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
      }
    }

    updateStatus(ctx);
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
When finished, use /var merge ${variation.name} to merge changes back to the source.
`,
    };
  });

  // Clean up on session end
  pi.on('session_shutdown', async (_event, ctx) => {
    const runtime = getRuntime(ctx);
    // No need to clean files - per-session variations are ephemeral
    // But we should stop portless processes
    for (const v of runtime.state.variations) {
      if (v.portlessPid) {
        try {
          process.kill(v.portlessPid, 'SIGTERM');
        } catch {
          // Process may already be dead
        }
      }
    }
  });
}
