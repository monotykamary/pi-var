/**
 * Core type definitions for pi-var extension
 */

export type VariationType = 'cow' | 'worktree' | 'copy';

export interface Variation {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Absolute path to variation directory */
  path: string;
  /** Absolute path to source directory */
  sourcePath: string;
  /** Creation method used */
  type: VariationType;
  /** ISO timestamp when created */
  createdAt: string;
  /** Last accessed timestamp */
  lastAccessed: string;
  /** Git branch name (for worktrees) */
  branchName?: string;
  /** Assigned port for isolated mode */
  assignedPort?: number;
  /** Portless process ID (for cleanup) */
  portlessPid?: number;
}

export interface VarState {
  /** Currently active variation ID, null if in source */
  activeVariationId: string | null;
  /** All variations for this session */
  variations: Variation[];
  /** Session ID for isolation */
  sessionId: string;
}

export interface VarConfig {
  /** Files to copy from source to variation */
  copy: string[];
  /** Directories to symlink (saves space) */
  symlink: string[];
  /** Commands to run after variation creation */
  postCreate: string[];
  /** Enable portless isolation */
  usePortless: boolean;
}

export interface VarRuntime {
  /** In-memory state (per-session) */
  state: VarState;
  /** Whether file redirection is currently active */
  redirectionActive: boolean;
  /** Last time the state was persisted to JSONL */
  lastPersisted: number;
}

export interface CreateVariationOptions {
  /** Variation name (auto-generated if not provided) */
  name?: string;
  /** Force specific type */
  type?: VariationType;
  /** Create git branch */
  createBranch?: boolean;
  /** Use portless for port isolation */
  isolated?: boolean;
}

export interface MergeOptions {
  /** Dry run - show what would change */
  dryRun?: boolean;
  /** Keep variation after merge */
  keep?: boolean;
  /** Merge strategy: 'auto' | 'git' | 'rsync' | 'copy' */
  strategy?: 'auto' | 'git' | 'rsync' | 'copy';
}

/** Context detection result */
export interface VariationContext {
  /** True if currently inside a variation directory */
  inVariation: boolean;
  /** Variation ID (if in variation) */
  variationId: string | null;
  /** Variation name (if in variation) */
  variationName: string | null;
  /** Current variation path (if in variation) */
  variationPath: string | null;
  /** Source directory path */
  sourcePath: string;
}
