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
import type { VarRuntime } from './src/types/index';
import { generateVariationName } from './src/utils/names';
import { getSessionKey, createRuntimeStore } from './src/state/index';
import { registerVarCommand } from './src/tools/command/index';
import { registerRedirectedTools } from './src/tools/redirect/index';
import { registerCreateVariationTool } from './src/tools/variation/create';
import { registerMergeVariationTool } from './src/tools/variation/merge';
import { detectVariationContext } from './src/environment/index';
import { DEFAULT_CONFIG } from './src/config';

export default function piVarExtension(pi: ExtensionAPI) {
  // Session-scoped runtime store
  const runtimeStore = createRuntimeStore();
  const getRuntime = (ctx: ExtensionContext): VarRuntime => runtimeStore.ensure(getSessionKey(ctx));
  const persistState = (ctx: ExtensionContext): void =>
    runtimeStore.persistState(getSessionKey(ctx), pi);

  // Register /var command (argument-free, status/overview)
  registerVarCommand(pi, { getRuntime, pi, runtimeStore });

  // Register redirected tools (read, edit, write, bash) - overrides built-ins when variation is active
  registerRedirectedTools(pi, getRuntime);

  // Register variation management tools
  registerCreateVariationTool(pi, getRuntime);
  registerMergeVariationTool(pi, getRuntime, persistState);

  // Session lifecycle
  pi.on('session_start', async (_event, ctx) => {
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

    const typeLabel =
      variation.type === 'cow'
        ? 'Copy-on-Write (APFS clonefile)'
        : variation.type === 'worktree'
          ? 'Git worktree'
          : 'Full copy';

    return {
      systemPrompt:
        event.systemPrompt +
        `

## Active Variation: "${variation.name}"
You are working in an isolated variation. All operations automatically redirect:

**File Operations:** read, edit, write → variation directory (${variation.path})
**Shell Commands:** bash → executes in variation directory with cwd=${variation.path}
**Environment:** PI_VARIATION=${variation.name}, PI_VARIATION_PATH, PI_SOURCE_PATH set

- Source: ${variation.sourcePath}
- Variation: ${variation.path}
- Type: ${typeLabel}

Use tools normally - the extension handles all redirection. When finished, use merge_variation to merge back to source.
`,
    };
  });

  // Session end - persist final state
  pi.on('session_shutdown', async (_event, ctx) => {
    runtimeStore.persistState(getSessionKey(ctx), pi);
  });
}
