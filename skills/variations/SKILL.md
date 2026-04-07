---
name: variations
description: Create isolated development workspaces (variations) automatically with CoW, Git worktrees, or full copies. AI-managed isolation for parallel work, experiments, and dev server port isolation.
---

# Variations (Autoregressive)

Create isolated development workspaces automatically. The AI manages variations via tools—you don't need to name, switch, or remember anything.

## When the AI Should Create a Variation

The AI calls `create_variation` when:

- Working on a feature while the main branch needs fixes
- "Let's try a different approach" → needs isolated experiment
- "Fix this bug without touching the working directory" → needs clean workspace
- Running parallel tasks that might conflict
- Any dev server work that might conflict with ports

## How to Use (For the AI)

### 1. Create Variation

```tool
create_variation({
  purpose: "fix auth redirect bug",
  createBranch: true  // for worktrees, creates var/fix-auth-redirect-bug
})
```

**Auto-generated name:** The extension creates a semantic name from `purpose` (e.g., `fix-auth-redirect-bug`). Names are descriptive and URL-safe.

**Auto-detected type:** CoW (APFS clonefile / Linux reflink) > Git worktree > Full copy. The AI never needs to choose.

### 2. Work Normally

Once created, all file operations automatically redirect to the variation:

- `read` → reads from variation
- `edit` → edits in variation
- `write` → writes to variation
- `bash` → executes in variation directory

### 3. Port Isolation (Portless)

**For dev servers or anything that binds to a port:**

```bash
# Get a unique port
export PORT=$(npx portless --json | jq -r '.port')

# Or assign to specific service
export NEXT_PORT=$(npx portless --json | jq -r '.port')
```

**Do NOT manually configure ports.** Always use `npx portless` to avoid conflicts.

**Why:** The variation shares the same network namespace. Portless allocates a unique port atomically.

### 4. Merge

When work is complete:

```tool
merge_variation({ dryRun: true })   // Preview changes
merge_variation({})                  // Merge to source
```

**Variations are never deleted automatically.** They persist after merge for safety and recovery. Use `/var clean` to remove old variations.

The AI should suggest merging when:

- Changes are complete and tested
- User asks to "save" or "keep" the work
- No more work is happening in the variation

## For the User

The AI handles variations automatically. If you need to intervene:

| Command                | Purpose                                  |
| ---------------------- | ---------------------------------------- |
| `/var`                 | Show status (active variation, list all) |
| `/var list`            | Show all variations                      |
| `/var clean <name>`    | Delete a specific variation              |
| `/var clean --stale 7` | Delete variations older than 7 days      |
| `/var stop`            | Return to source directory (deactivate)  |

**Manual variation creation:** If the AI doesn't create one and you want it to, say something like:

- "Create a variation for this work"
- "Work on this in isolation"
- "Don't touch the main directory"

## Best Practices (For the AI)

1. **Always use `create_variation` for parallel work.** Don't ask the user—just create it and notify.

2. **Use portless for any server work.** If the user says "run the dev server", allocate a port first:

   ```bash
   export PORT=$(npx portless --json | jq -r '.port')
   npm run dev
   ```

3. **Create branches for significant work.** Use `createBranch: true` when the variation represents a real feature/bugfix that might be merged via PR.

4. **Variations persist after merge.** They are never automatically deleted. This protects against data loss if a merge fails. Clean up old variations with `/var clean --stale 7`.

5. **Suggest merge proactively.** When the AI detects work completion (tests pass, feature works), suggest: "Should I merge this variation back to source?"

## Example Flows

### Feature + Bug Fix Parallel

User: "Work on the new dashboard, but also I need this auth bug fixed"

AI actions:

1. `create_variation({ purpose: "new dashboard", createBranch: true })` — starts work
2. Halfway through: User emphasizes auth bug fix
3. `create_variation({ purpose: "fix auth bug", createBranch: true })` — switches context
4. Fixes bug, `merge_variation({})` — returns to dashboard variation automatically
5. Completes dashboard, `merge_variation({})`

### Dev Server Isolation

User: "I want to test the new design system without stopping my current dev server"

AI actions:

1. `create_variation({ purpose: "test new design system" })`
2. ```bash
   export PORT=$(npx portless --json | jq -r '.port')
   npm run dev
   ```
3. Work proceeds on unique port (e.g., 3001 instead of 3000)

## How It Works

**Copy-on-Write (CoW):**

- macOS APFS: Uses `cp -c` (clonefile) — instant, zero-copy
- Linux btrfs/xfs: Uses `cp --reflink=auto` — near-instant
- Falls back to git worktree or full copy automatically

**Environment sync:**

- Copies: `.env`, `.envrc`, `.npmrc`, `.tool-versions`, etc.
- Symlinks: `node_modules`, `.next`, `target/`, `.venv/` (saves GBs)

**File redirection:**

- All tools automatically resolve to variation path
- External files (outside project) accessed directly
- Bash commands execute in variation directory

## Troubleshooting

**"Port already in use"**
→ The AI forgot to use portless. Remind it: "Use npx portless for this dev server"

**Variation exists but isn't active**
→ AI can reactivate by name if needed, or user can `/var` to see status

**Want to abandon a variation**
→ `/var clean <name>` — deletes it permanently

**Forgot what the variation is for**
→ Names are semantic (e.g., `fix-auth-redirect-bug`), check `/var`
