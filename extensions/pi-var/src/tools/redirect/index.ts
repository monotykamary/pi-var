/**
 * Redirected tools registration module
 */

import type { ExtensionAPI, ExtensionContext } from '@mariozechner/pi-coding-agent';
import {
  createReadTool,
  createEditTool,
  createWriteTool,
  createBashTool,
} from '@mariozechner/pi-coding-agent';
import type { VarRuntime } from '../../types/index';
import { createReadHandler } from './read';
import { createEditHandler } from './edit';
import { createWriteHandler } from './write';
import { createBashHandler } from './bash';

/**
 * Get runtime function type
 */
type GetRuntime = (ctx: ExtensionContext) => VarRuntime;

/**
 * Register redirected file tools (read, edit, write) and bash tool.
 * These override the built-in tools to redirect operations to the active variation
 * when a variation is active.
 */
export function registerRedirectedTools(pi: ExtensionAPI, getRuntime: GetRuntime): void {
  // Cache for default tools by cwd to avoid recreating
  const defaultTools = new Map<
    string,
    {
      read: ReturnType<typeof createReadTool>;
      edit: ReturnType<typeof createEditTool>;
      write: ReturnType<typeof createWriteTool>;
      bash: ReturnType<typeof createBashTool>;
    }
  >();

  function getDefaultTools(cwd: string) {
    let tools = defaultTools.get(cwd);
    if (!tools) {
      tools = {
        read: createReadTool(cwd),
        edit: createEditTool(cwd),
        write: createWriteTool(cwd),
        bash: createBashTool(cwd),
      };
      defaultTools.set(cwd, tools);
    }
    return tools;
  }

  // Register all redirected tools
  const readTool = createReadHandler(getRuntime, getDefaultTools);
  const editTool = createEditHandler(getRuntime, getDefaultTools);
  const writeTool = createWriteHandler(getRuntime, getDefaultTools);
  const bashTool = createBashHandler(getRuntime, getDefaultTools);

  pi.registerTool(readTool);
  pi.registerTool(editTool);
  pi.registerTool(writeTool);
  pi.registerTool(bashTool);
}
