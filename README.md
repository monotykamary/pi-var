<div align="center">

# 🌿 pi-var

**AI-driven copy-on-write variations for [pi](https://github.com/earendil-works/pi-coding-agent)**

_Work on multiple features simultaneously with isolated workspaces — automatically._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

---

## Philosophy: The AI Does It

Traditional variation management requires you to:

- Name the variation
- Remember to switch contexts
- Manually merge and clean up

**pi-var** removes all of that. The AI detects when isolated work is needed and handles everything:

- Creates variations with semantic names
- Redirects all file operations automatically
- Suggests merge when work is complete

You just say what you want. The AI manages the workspace.

---

## How It Works

```
User: "Work on the new dashboard feature while I fix this bug in main"
         │
         ▼
   ┌─────────────┐
   │  pi-var     │  ← AI decides isolation is needed
   └──────┬──────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌───────┐   ┌─────────┐
│ main  │   │ 🌿 dash │  ← CoW clone (instant, zero copy)
│ (src) │   │  (src') │
└───┬───┘   └────┬────┘
    │            │
    │ bug fix    │ dashboard feature
    │            │
    ▼            ▼
  merge ◄──────┘
```

**Auto-detected method** (fastest available):

1. **CoW** (APFS clonefile / Linux reflink) — fastest, instant
2. **Git worktree** — for git projects on non-CoW filesystems
3. **Full copy** — universal fallback

---

## Installation

```bash
pi install https://github.com/monotykamary/pi-var
```

Or project-local:

```bash
pi install -l https://github.com/monotykamary/pi-var
```

---

## Usage

### Natural Language

Just describe what you need:

> "Work on the new dashboard feature while I fix this bug in main"

The AI automatically:

1. Creates a variation for the dashboard work
2. Redirects all operations to that variation
3. When you mention the bug fix, creates another variation
4. Switches between them transparently
5. Merges completed work back

### Dev Server Isolation

> "Run this experiment on a different port so my main dev server keeps running"

The AI:

1. Creates a variation
2. Allocates a unique port via `npx portless`
3. Runs the dev server
4. All without touching your main server

---

## For Users: Manual Commands

If you need to intervene or check status:

| Command                | Purpose                             |
| ---------------------- | ----------------------------------- |
| `/var`                 | Show status and active variation    |
| `/var list`            | List all variations                 |
| `/var clean <name>`    | Delete a variation                  |
| `/var clean --stale 7` | Delete variations older than 7 days |
| `/var stop`            | Return to source directory          |

---

## For the AI: Tools Reference

### create_variation

Create an isolated workspace automatically.

```typescript
{
  purpose: string;           // "fix auth redirect bug"
  type?: 'cow' | 'worktree' | 'copy';  // Auto-detected if omitted
  createBranch?: boolean;    // Create git branch for worktrees
}
```

**Auto-generated name:** Creates semantic names from `purpose` (e.g., `fix-auth-redirect-bug`).

**Port isolation:** For dev servers, use `npx portless` via bash:

```bash
export PORT=$(npx portless --json | jq -r '.port')
npm run dev
```

### merge_variation

Merge current variation back to source.

```typescript
{
  dryRun?: boolean;   // Preview changes
}
```

**Variations persist after merge.** They are never automatically deleted to protect against data loss. Use `/var clean` to remove old variations.

---

## Environment Synchronization

**Copied files:** `.env`, `.envrc`, `.npmrc`, `.tool-versions`, `.node-version`

**Symlinked directories:** `node_modules`, `.next`, `.nuxt`, `target/`, `.venv/`

This saves gigabytes of disk space while ensuring each variation has isolated environment configuration.

---

## Transparent Redirection

When a variation is active:

- `read` → reads from variation directory
- `edit` → modifies files in variation
- `write` → creates files in variation
- `bash` → executes in variation directory
- External paths (outside project) → accessed directly

The footer shows: `🌿 variation-name`

---

## Comparison

### vs Git Worktrees Alone

| Feature          | Git Worktrees       | pi-var                     |
| ---------------- | ------------------- | -------------------------- |
| Setup            | Manual branching    | Automatic                  |
| File redirection | Manual `cd`         | Transparent                |
| Environment sync | Manual copy/symlink | Automatic                  |
| Port conflicts   | Manual management   | AI handles via portless    |
| Best method      | Git only            | CoW > worktree > copy      |
| Cleanup          | Manual git commands | AI-managed or `/var clean` |

### vs Docker/Dev Containers

- **pi-var:** Native filesystem performance, instant startup, same environment
- **Docker:** True OS isolation, image builds, slower startup

Use pi-var for parallel development work. Use Docker for different OS/toolchain environments.

---

## Configuration

Create `.varconfig.yaml` in project root for custom sync rules:

```yaml
# Files to copy
copy:
  - .env.local
  - secrets.json

# Directories to symlink
symlink:
  - node_modules
  - .turbo
```

---

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck
```

## License

MIT
