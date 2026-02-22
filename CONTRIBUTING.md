# Contributing to Delve Dungeon

Thank you for your interest in contributing. This document covers how to set up a development environment, the conventions used in this codebase, and the process for submitting changes.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Code Conventions](#code-conventions)
- [Adding Game Content](#adding-game-content)
- [Submitting Changes](#submitting-changes)
- [Reporting Issues](#reporting-issues)

---

## Development Setup

1. Fork the repository and clone your fork:
   ```bash
   git clone https://github.com/your-username/delve-dungeon.git
   cd delve-dungeon
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy the environment template and fill in your credentials:
   ```bash
   cp .env.example .env
   ```
   At minimum you need `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `GAME_CHANNEL_ID`, and `OPENAI_API_KEY`. Set `GAME_GUILD_ID` to your test server's ID so slash commands sync immediately.

4. Initialize and seed the database:
   ```bash
   npm run db:init
   npm run db:seed
   ```

5. Start the bot in development mode:
   ```bash
   npm run dev
   ```

### Resetting State

If you need a clean slate during development:
```bash
npm run db:reset && npm run db:init && npm run db:seed
```

---

## Project Architecture

Understanding the separation of concerns will help you contribute in the right place.

```
src/
├── ai/          ← OpenAI integration (narrator, image gen)
├── commands/    ← Discord slash commands and message handlers
├── engine/      ← Game logic (combat, dice, loot, floor gen)
└── db/          ← Database schema, queries, migrations
```

### The Engine / Narrator Contract

The game engine in `src/engine/` computes **all mechanical outcomes** before the AI narrator is ever called. The narrator in `src/ai/narrator.js` receives a completed summary (what happened, dice results, damage dealt, items found) and converts it to prose.

**The AI must never determine game outcomes.** If you are adding a feature:
- Mechanical logic belongs in `src/engine/`
- Presentation belongs in `src/commands/embeds.js` or the narrator prompt
- The narrator prompt must not be changed to give the AI decision-making authority

### Database-Driven Content

All game content (enemies, items, dungeons, loot rules) lives in the database. The code reads this data at runtime. When adding new content types, prefer extending the schema rather than hardcoding values in source files.

### Dice and Randomness

All randomness flows through `src/engine/dice.js`. Do not call `Math.random()` directly in game logic. This keeps outcomes auditable and replaceable (e.g., for seeded testing).

---

## Code Conventions

- **ES Modules** — use `import`/`export`, not `require()`
- **Async/await** — preferred over raw promise chains
- **No magic numbers** — constants belong in `src/config.js` or the database
- **Prepared statements** — all database queries must use `better-sqlite3` prepared statements; never interpolate user input into SQL
- **Error handling** — catch and log errors at command/handler boundaries; do not let unhandled promise rejections crash the bot

---

## Adding Game Content

Content additions (new dungeons, enemies, items) do not require code changes. Add rows to the seed file (`src/db/seed.js`) or directly to the database. See the [Adding Content](README.md#adding-content) section of the README for examples.

For structural changes (new item properties, new room types, new mechanics), update the schema in `src/db/schema.js` and coordinate the migration.

---

## Submitting Changes

1. Create a branch from `main` with a descriptive name:
   ```bash
   git checkout -b feat/multi-floor-boss-scaling
   ```

2. Make your changes. Keep commits focused — one logical change per commit.

3. Test your changes against a live Discord server and database before opening a pull request.

4. Open a pull request against `main`. In the description:
   - Explain **what** changed and **why**
   - List any new environment variables or database migrations required
   - Note any breaking changes to existing saves or commands

### Pull Request Checklist

- [ ] Changes are limited to the scope of the PR description
- [ ] No secrets or personal credentials committed
- [ ] New database columns have default values (to avoid breaking existing installs)
- [ ] Slash command changes have been tested end-to-end in Discord
- [ ] AI prompt changes do not grant the narrator mechanical authority

---

## Reporting Issues

Open an issue with:
- A clear description of the bug or request
- Steps to reproduce (for bugs)
- The Node.js version and OS you are running
- Relevant log output (with any tokens or keys redacted)
