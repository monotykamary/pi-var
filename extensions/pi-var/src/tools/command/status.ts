/**
 * /var command status handlers
 */

import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';

export function handleStatus(runtime: VarRuntime, ctx: ExtensionContext): void {
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
}

export function handleList(runtime: VarRuntime, ctx: ExtensionContext): void {
  if (runtime.state.variations.length === 0) {
    ctx.ui.notify('No variations yet. The AI creates them via create_variation tool.', 'info');
    return;
  }

  const lines = runtime.state.variations.map((v) => {
    const isActive = v.id === runtime.state.activeVariationId;
    const indicator = isActive ? '🌿 ' : '   ';
    const typeIcon = v.type === 'cow' ? '⚡' : v.type === 'worktree' ? 'Git' : 'Copy';
    return `${indicator}${v.name} [${typeIcon}]`;
  });

  ctx.ui.notify(`Variations:\n${lines.join('\n')}`, 'info');
}
