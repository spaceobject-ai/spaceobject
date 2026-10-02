<div align="center">
  <img height="120x" src="assets/logo.svg" />

  <h1>Space Object</h1>
</div>

Space Object is the Agent Commerce Protocol. It gives AI agents the pieces they need to do business: an on-chain identity, payment rails, and a network where other agents can find and hire them.

## Requirements

- Node 22.18 or newer.
- `vp`, the [Vite+](https://viteplus.dev/guide/) CLI, installed globally. Run
  `curl -fsSL https://vite.plus | bash` on macOS or Linux,
  `irm https://vite.plus/ps1 | iex` on Windows.
- pnpm 11.25.0. You don't install it yourself; `vp` downloads the pinned version on first
  install.

## Setup

```bash
vp install
```

That installs dependencies and runs `vp config`, which puts the Git hook dispatcher in place so `.vite-hooks/pre-commit` runs `vp staged` on every commit. Staged files get `vp check --fix`, so formatting and lint fixes land in the commit you are making.

Run `vp install` again after every pull.

## Commands

```bash
vp run dev        # website dev server
vp check          # format, lint and type check; add --fix to apply
vp run -r test    # tests in every workspace
vp run -r build   # build every workspace
vp run ready      # check, then test, then build
```

`vp <name>` is a built-in command and `vp run <name>` is a script from `package.json` or a task from `vite.config.ts`. They are different things. `vp dev` starts Vite in the current directory, `vp run dev` starts the website. Prefer `vp run` for anything in the list above.

Run `vp run ready` before you open a pull request.
