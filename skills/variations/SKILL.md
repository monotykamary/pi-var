# Variations

Use this skill when the user wants to work on multiple features simultaneously without switching branches or stashing changes.

## When to Use

- Working on a feature while needing to fix a bug
- Experimenting with different approaches
- Running parallel tasks with isolated environments
- Testing changes without affecting main workspace
- Collaborating on multiple PRs at once
- A/B testing different implementations

## Workflow

1. **Create variation**: `/var new feature-name`
2. **Work normally** — files auto-redirect to variation
3. **Merge back**: `/var merge feature-name`
4. **Clean up**: `/var clean feature-name`

## Commands

| Command                 | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `/var new [name]`       | Create new variation (auto-detects best method) |
| `/var`                  | List variations, show current context           |
| `/var cd <name>`        | Switch to variation                             |
| `/var cd main`          | Return to source directory                      |
| `/var merge [name]`     | Merge changes back to source                    |
| `/var clean [name]`     | Delete variation                                |
| `/var clean --stale 7d` | Remove variations older than 7 days             |

## Options

- `--isolated` — Use portless isolation (avoids port conflicts)
- `--type cow` — Force copy-on-write clone
- `--type worktree` — Force git worktree
- `--type copy` — Force full directory copy
- `--create-branch` — Create git branch for worktree

## Best Practices

- Use `--isolated` flag for dev servers (avoids port conflicts)
- Variations are per-session (ephemeral) — merge or lose changes
- `.env` files are copied automatically, `node_modules` are symlinked (saves space)
- Name variations descriptively: `fix-auth-bug`, `refactor-api`, `experiment-v2`
- Clean up stale variations regularly to free disk space

## How It Works

pi-var automatically:

1. Detects the best variation method (CoW > worktree > copy)
2. Redirects all file operations to the active variation
3. Syncs environment files (.env, .envrc, etc.)
4. Symlinks heavy directories (node_modules, .next, etc.)
5. Optionally assigns unique ports for isolated dev servers

## Example Session

```bash
# Main project has a bug
/var new fix-login-bug
# Now in variation — fix the bug
edit src/auth/login.ts
bash npm test
/var merge fix-login-bug
/var clean fix-login-bug

# Back to main, continue feature work
```

## Comparison with Git Worktrees Alone

| Feature          | Git Worktrees | pi-var Variations     |
| ---------------- | ------------- | --------------------- |
| Setup            | Manual        | One command           |
| File redirection | Manual cd     | Automatic             |
| Environment sync | Manual        | Automatic             |
| Port management  | Manual        | Integrated (portless) |
| Best method      | Git only      | CoW > worktree > copy |
| Cleanup          | Manual        | Built-in              |
