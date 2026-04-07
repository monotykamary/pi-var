/**
 * Core type definitions for pi-var extension
 */

/**
 * CoW detection result with EDR awareness
 */
export interface CoWDetectionResult {
  /** Whether CoW is supported on this platform/filesystem */
  supported: boolean;
  /** CoW method if supported */
  method?: 'clonefile' | 'reflink';
  /** EDR detection results */
  edr?: {
    /** Whether any EDR was detected */
    detected: boolean;
    /** List of detected EDR products */
    products: string[];
    /** Whether any detected EDR is known to slow CoW operations */
    hasSlowCoWEDR: boolean;
  };
  /** Performance test results */
  performance?: {
    /** Whether CoW performed fast enough to be usable */
    fast: boolean;
    /** Average time in ms for CoW operations */
    durationMs: number;
    /** Number of timing samples collected */
    samples?: number;
    /** Maximum duration observed (helps detect spikes) */
    maxDurationMs?: number;
    /** Confidence level in the timing measurement */
    confidence?: 'high' | 'medium' | 'low';
  };
  /** Recommended variation type based on CoW support and EDR presence */
  recommendedType: 'cow' | 'worktree' | 'copy';
}

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
}

export interface VarRuntime {
  /** In-memory state (per-session) */
  state: VarState;
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
}

export interface MergeOptions {
  /** Dry run - show what would change */
  dryRun?: boolean;
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
