/**
 * /var command clean handlers
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import { removeVariation } from '../../variation/remove';
import type { RuntimeStore } from '../../state/types';

function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId?.() || 'default';
}

export async function handleCleanStale(
  runtime: VarRuntime,
  ctx: ExtensionContext,
  staleDays: number,
  runtimeStore: RuntimeStore,
  pi: ExtensionAPI
): Promise<void> {
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
    runtime.state.variations = runtime.state.variations.filter((existing) => existing.id !== v.id);
  }

  // Persist state after cleaning
  runtimeStore.persistState(getSessionKey(ctx), pi);

  ctx.ui.notify(`Cleaned ${staleVariations.length} stale variation(s)`, 'info');
}

export async function handleCleanSpecific(
  runtime: VarRuntime,
  ctx: ExtensionContext,
  name: string,
  runtimeStore: RuntimeStore,
  pi: ExtensionAPI
): Promise<void> {
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
  runtime.state.variations = runtime.state.variations.filter((v) => v.id !== variation.id);

  // If this was active, deactivate
  if (runtime.state.activeVariationId === variation.id) {
    runtime.state.activeVariationId = null;
    ctx.ui.setStatus('pi-var', '');
  }

  // Persist state after cleaning
  runtimeStore.persistState(getSessionKey(ctx), pi);

  ctx.ui.notify(`Deleted variation "${name}"`, 'info');
}
