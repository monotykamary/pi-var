/**
 * /var command stop/main handler
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import type { RuntimeStore } from '../../state/types';

function getSessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId?.() || 'default';
}

export function handleStop(
  runtime: VarRuntime,
  ctx: ExtensionContext,
  runtimeStore: RuntimeStore,
  pi: ExtensionAPI
): void {
  // Deactivate current variation (return to source)
  if (runtime.state.activeVariationId) {
    const variation = runtime.state.variations.find(
      (v) => v.id === runtime.state.activeVariationId
    );
    runtime.state.activeVariationId = null;
    ctx.ui.setStatus('pi-var', '');

    // Persist the "stop" state to session
    runtimeStore.persistState(getSessionKey(ctx), pi);

    ctx.ui.notify(
      variation ? `Left variation "${variation.name}" — now in source` : 'Now in source directory',
      'info'
    );
  } else {
    ctx.ui.notify('Already in source directory', 'info');
  }
}
