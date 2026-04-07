# pi-var

Copy-on-write variations for pi — work on multiple features simultaneously with isolated workspaces.

## Features

- 🚀 **CoW First**: Uses copy-on-write (APFS clonefile/Linux reflink) when available
- 🌿 **Git Worktree Fallback**: Native git integration for non-CoW filesystems
- 🔄 **Transparent File Redirection**: read/edit/write automatically resolve to variation
- 📦 **Environment Sync**: Copies .env files, symlinks node_modules (saves GBs)
- 🔌 **Portless Integration**: Optional isolated mode with unique ports via `npx portless`
- 🧹 **Auto-Cleanup**: Remove stale variations after 7 days

## Installation

```bash
pi install npm:pi-var
```

Or project-local:

```bash
pi install -l npm:pi-var
```

## Quick Start

```bash
# Create a variation for a new feature
/var new feature-auth

# Work normally — files automatically redirect to variation
edit src/auth.ts
bash npm test

# Merge changes back to source
/var merge feature-auth

# Clean up
/var clean feature-auth
```

## Commands

| Command                     | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `/var new [name]`           | Create new variation (auto-detects best method)  |
| `/var`                      | List variations, show current context            |
| `/var cd <name>`            | Switch to variation (activates file redirection) |
| `/var cd main`              | Return to source directory                       |
| `/var merge [name]`         | Merge changes back to source                     |
| `/var clean [name]`         | Delete variation                                 |
| `/var clean --stale <days>` | Remove variations older than N days              |

## Options

### /var new

- `--isolated` — Use portless for unique port assignment
- `--type cow` — Force copy-on-write clone
- `--type worktree` — Force git worktree
- `--type copy` — Force full directory copy

### /var merge

- `--dry-run` — Preview changes without applying
- `--keep` — Keep variation after merge (don't delete)

## How It Works

### Auto-Detection Strategy

When creating a variation, pi-var automatically selects the best method:

1. **CoW (Copy-on-Write)** — Fastest, most space-efficient
   - macOS APFS: Uses `cp -c` (clonefile)
   - Linux btrfs/xfs: Uses `cp --reflink=auto`

2. **Git Worktree** — Native git integration
   - Creates linked worktree with separate branch
   - Ideal for git-based projects on non-CoW filesystems

3. **Full Copy** — Universal fallback
   - Complete directory copy
   - Works everywhere, uses more disk space

### File Redirection

When you activate a variation (`/var cd <name>`):

- All `read` operations resolve to the variation directory
- All `edit` operations modify files in the variation
- All `write` operations create files in the variation
- User `!bash` commands execute in the variation directory
- External files (outside project) are accessed directly

### Environment Synchronization

When creating a variation, pi-var automatically:

**Copies these files:**

- `.env`, `.env.*`, `.envrc`
- `.npmrc`, `.yarnrc`, `.yarnrc.yml`
- `.tool-versions`, `.node-version`, `.python-version`
- `docker-compose.override.yml`

**Symlinks these directories** (saves disk space):

- `node_modules`, `.next`, `.nuxt`, `.angular`, `.turbo`
- `target/` (Rust), `.venv/` (Python), `vendor/` (Go)

## Portless Integration

For projects with dev servers, use the `--isolated` flag:

```bash
/var new feature-api --isolated
```

This runs `npx portless` to:

- Allocate a unique port (e.g., 3001, 3002)
- Set `PORT` environment variable
- Avoid conflicts with main dev server

## Configuration

Create `.varconfig.yaml` in your project root for custom settings:

```yaml
# Files to copy from source to variation
copy:
  - .env
  - .env.local
  - .npmrc

# Directories to symlink (saves space)
symlink:
  - node_modules
  - .next
  - .turbo

# Commands to run after variation creation
postCreate:
  - npm install
  - npm run db:migrate
```

## Comparison

### vs Git Worktrees Alone

| Feature          | Git Worktrees               | pi-var Variations     |
| ---------------- | --------------------------- | --------------------- |
| Setup            | Manual                      | One command           |
| File redirection | Manual cd                   | Automatic             |
| Environment sync | Manual (.env, node_modules) | Automatic             |
| Port management  | Manual                      | Integrated (portless) |
| Method selection | Git only                    | CoW > worktree > copy |
| Cleanup          | Manual git commands         | Built-in `/var clean` |

### vs Docker/Dev Containers

- **pi-var**: Native filesystem performance, instant startup, no image builds
- **Docker**: True isolation, different OS environments, slower startup

Use pi-var for same-environment parallel work, Docker for cross-environment work.

## Best Practices

1. **Name descriptively**: `fix-auth-bug`, `refactor-api`, `experiment-v2`
2. **Use `--isolated`** for any variation running dev servers
3. **Merge promptly** — variations are per-session and ephemeral
4. **Clean stale variations**: Run `/var clean --stale 7` weekly
5. **Don't nest variations** — create variations from source only

## Troubleshooting

### "Portless not available"

Install portless globally or ensure npx can fetch it:

```bash
npm install -g portless
# or
npx portless --version
```

### "CoW not supported"

Your filesystem doesn't support copy-on-write. pi-var will automatically fall back to git worktrees (if git repo) or full copy.

### Files not redirecting

Check footer status — it should show `📦 project-name • 🌿 variation-name`. If not, run `/var cd <name>` to activate.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run type check
npm run typecheck

# Run linter
npm run lint:dead
```

## License

MIT
