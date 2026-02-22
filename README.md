# Delve Dungeon

An AI-powered dungeon crawler Discord bot where players explore procedurally generated dungeons through natural language. An AI Dungeon Master narrates your actions in vivid prose while a deterministic game engine handles all mechanical outcomes — ensuring gameplay stays fair and transparent while the narrative stays immersive.

---

## Features

- **Natural Language Gameplay** — Type actions freely in designated Discord channels or DMs; the AI interprets your intent and narrates the result
- **Deterministic Mechanics** — All outcomes (combat, skill checks, loot) are resolved by the game engine before the AI narrates, preventing hallucinated results
- **D&D-Style Dice System** — d20 skill checks, stat modifiers (STR/DEX/CON/INT/WIS/CHA), critical successes and failures
- **Procedural Dungeon Generation** — Each floor is generated fresh with randomized rooms, branches, traps, enemies, and loot
- **Persistent Characters** — Characters persist between sessions with leveling skills, inventory, and dungeon history
- **11 Damage Types** — Slashing, piercing, blunt, fire, ice, arcane, poison, radiant, necrotic, psychic, thunder
- **Status Effects** — Burn, freeze, poison, stun, and more
- **Slash Commands** — Structured commands for character management, equipment, shopping, and maps
- **In-Game Help** — `/help [topic]` works directly in the game channel for quick rule lookups mid-run
- **Data-Driven Content** — All enemies, items, dungeons, and loot rules live in a SQLite database for easy customization

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Discord Bot Setup](#discord-bot-setup)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Bot](#running-the-bot)
- [Gameplay Guide](#gameplay-guide)
- [Slash Commands](#slash-commands)
- [Game Mechanics](#game-mechanics)
- [Project Structure](#project-structure)
- [Adding Content](#adding-content)
- [Contributing](#contributing)
- [License](#license)

---

## Prerequisites

- **Node.js** v18 or higher
- **npm** v8 or higher
- A **Discord application** with a bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- An **OpenAI API key** ([OpenAI Platform](https://platform.openai.com))

---

## Installation

```bash
git clone https://github.com/your-username/delve-dungeon.git
cd delve-dungeon
npm install
```

---

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Navigate to **Bot** and create a bot. Copy the token.
3. Under **OAuth2 → URL Generator**, select the scopes:
   - `bot`
   - `applications.commands`
4. Under **Bot Permissions**, select:
   - Send Messages
   - Use Slash Commands
   - Embed Links
   - Read Message History
   - Add Reactions
5. Use the generated URL to invite the bot to your server.
6. Copy your **Application ID** (Client ID) from the General Information page.
7. Create one or more dedicated text channels for freeform gameplay and copy their channel IDs (enable Developer Mode in Discord settings to see IDs).
8. (Optional) If you want DM playtesting, keep DMs enabled for your bot and set `ALLOW_DM_GAMEPLAY=true`.

---

## Configuration

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `DISCORD_TOKEN` | Yes | — | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Yes | — | Your Discord application (client) ID |
| `GAME_GUILD_ID` | No | — | Single guild ID for slash command registration (legacy/simplest) |
| `GAME_GUILD_IDS` | No | — | Comma-separated guild IDs for multi-server slash command registration |
| `GAME_CHANNEL_ID` | No | — | Single allowed gameplay channel ID (legacy/simplest) |
| `GAME_CHANNEL_IDS` | No | — | Comma-separated allowed gameplay channel IDs across servers |
| `ALLOW_DM_GAMEPLAY` | No | `false` | If `true`, users can play by DMing the bot directly |
| `REGISTER_GLOBAL_COMMANDS` | No | `true` | If `true`, also register global slash commands in addition to guild commands (recommended) |
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model to use for narration |
| `DB_PATH` | No | `./data/adventure.db` | Path to the SQLite database file |
| `DEFAULT_START_GOLD` | No | `100` | Starting gold for new characters |
| `DEFAULT_START_HP` | No | `50` | Base starting HP for new characters |
| `DEFAULT_INVENTORY_SLOTS` | No | `20` | Inventory slot count per character |
| `GENERATE_DUNGEON_IMAGES` | No | `false` | Enable DALL-E room image generation (additional cost) |

> **Tip:** By default, startup now registers both guild-scoped and global commands so you do not need a second rollout step later. If you need faster iteration without touching globals, set `REGISTER_GLOBAL_COMMANDS=false`.

---

## Database Setup

Initialize the schema, then seed it with the included starter dungeon (*The Sunken Crypt*):

```bash
npm run db:init   # Create tables
npm run db:seed   # Load starter content
```

To wipe the database and start fresh:

```bash
npm run db:reset
```

> The database file is created at the path set in `DB_PATH`. The `data/` directory is created automatically.

---

## Running the Bot

**Production:**
```bash
npm start
```

**Development** (auto-restarts on file changes):
```bash
npm run dev
```

On startup the bot registers slash commands, connects to Discord, and is ready to play.

---

## Gameplay Guide

### Getting Started

1. Create a character with `/characters` by selecting an empty slot. You'll receive a set of randomly rolled stats (3d6 each).
2. Browse available dungeons with `/dungeons`.
3. Enter a dungeon with `/delve`. This costs a small gold entry fee.
4. Head to any configured game channel (or DM the bot if enabled) and start typing actions.

If someone DMs the bot before creating a character, Delve now replies with a quick start checklist (`/characters` → `/dungeons` → `/delve`).

### Playing

In the game channel, describe what your character does in plain English:

> *Search the room for hidden passages*
> *Attack the skeleton with my sword*
> *Try to pick the lock on the chest*
> *Use a healing potion*

The bot will:
1. Parse your intent
2. Determine the appropriate skill check or action
3. Roll dice and calculate mechanical outcomes
4. Have the AI Dungeon Master narrate the result in 2–3 atmospheric paragraphs

### Tips

- Check your current state with `/status`
- View your character sheet with `/stats` — skill bonuses are shown next to each level
- Manage items with `/inventory` and `/equip`
- Use `/map` to see the current floor layout
- Rest rooms restore HP — seek them out when low
- Carry a torch for perception bonuses in dark areas
- Not every room has loot — searching is worth doing, but don't expect a reward every time
- Type `/help [topic]` anywhere in the game channel for quick rule lookups (e.g. `/help flee`, `/help skills`)

---

## Slash Commands

| Command | Description |
|---|---|
| `/characters` | Create, view, and switch between your character slots (3 per user) |
| `/delve` | Enter a dungeon (costs gold) |
| `/status` | View current run progress, floor, and room |
| `/stats` | View your character's stats, skills, and current skill bonuses |
| `/inventory` | Browse and manage your items |
| `/equip [item]` | Equip or unequip an item |
| `/shop` | Browse and buy items (unlocks after first dungeon completion) |
| `/sell [item]` | Sell an item for gold |
| `/map` | Display the current floor map |
| `/abandon` | Quit the current dungeon run (no rewards) |
| `/help [topic]` | How-to-play guide; also works as a plain message in the game channel |

**Help topics:** `overview` · `commands` · `combat` · `flee` · `search` · `skills` · `items` · `dungeon`

---

## Game Mechanics

### Stats

Characters have six base stats, each rolled as 3d6 at creation:

| Stat | Abbreviation | Affects |
|---|---|---|
| Strength | STR | Melee attack and damage |
| Dexterity | DEX | Dodge chance, ranged attacks |
| Constitution | CON | Max HP |
| Intelligence | INT | Magic skill checks |
| Wisdom | WIS | Perception, survival |
| Charisma | CHA | Persuasion |

Stat modifiers follow the D&D formula: `floor((stat - 10) / 2)`

### Skills

Ten skills track XP and level independently (1–100):

`melee` · `ranged` · `magic` · `stealth` · `perception` · `persuasion` · `lockpicking` · `survival` · `crafting` · `alchemy`

Skills improve through use. Every 10 levels a skill gains +1 to all related dice rolls (level 10 = +1, level 20 = +2, up to +10 at level 100). Current bonuses are visible on `/stats` and called out on level-up.

### Skill Checks

```
d20 + stat_modifier + skill_bonus + item_perks  vs.  DC (Difficulty Class)
```

- **Natural 20** — Critical success (automatic, regardless of total)
- **Natural 1** — Critical failure (automatic, regardless of total)
- Beat the DC → success; within 2 below DC → partial success; further below → failure

### Combat

Each round:
1. Player declares an attack action
2. Engine calculates hit chance based on relevant skill and stat
3. Damage is rolled, then reduced by enemy armor/resistance
4. Enemy selects an ability and attacks back
5. Player dodge/block chance is checked (DEX-based)
6. Status effects tick (burn, poison, freeze, stun, etc.)
7. AI narrates the full round

On death, the run ends and 25% of your gold is lost as a penalty.

### Dungeon Floors

Each floor is procedurally generated with 4–8 rooms. Room types include:

| Type | Description |
|---|---|
| Standard | Combat encounter, may contain loot |
| Treasure | Dedicated loot room |
| Trap | Hazard (Poison Darts, Flame Jets, Collapsing Floor, Runes, Webs) |
| Rest | Restore 20–35% HP |
| Locked | Requires a successful lockpicking check to enter |
| Boss | Final-floor boss encounter with unique loot |

Rooms connect in a primary linear path with a 20% chance of optional branch rooms.

### Loot

Items drop based on loot rules stored in the database. Rules support:

- Guaranteed vs. weighted-random drops
- Skill-gated items (minimum skill level required)
- Hidden items (requires a perception check)
- Conditional drops based on equipped items or dungeon completion

### Items & Equipment

Equipment slots: **Main Hand**, **Off-Hand**, **Armor**, **Accessories**

Item rarities: Common · Uncommon · Rare · Epic · Legendary

Item types: Weapons, Armor, Consumables, Scrolls, Spellbooks, Valuables, Quest Items

---

## Project Structure

```
delve-dungeon/
├── src/
│   ├── index.js              # Bot entry point, Discord client setup
│   ├── config.js             # Runtime configuration
│   ├── ai/
│   │   ├── narrator.js       # Builds prompts and calls OpenAI
│   │   └── image-gen.js      # Optional DALL-E room images
│   ├── commands/
│   │   ├── index.js          # Command loader and slash command registration
│   │   ├── embeds.js         # Shared Discord embed builders
│   │   ├── game-channel.js   # Natural language message handler
│   │   └── *.js              # Individual slash command handlers
│   ├── engine/
│   │   ├── index.js          # Public API
│   │   ├── action-processor.js  # Main game loop orchestrator
│   │   ├── floor-generator.js   # Procedural floor layout
│   │   ├── combat.js            # Combat resolution
│   │   ├── dice.js              # All dice rolling and RNG
│   │   └── loot.js              # Loot drop resolution
│   └── db/
│       ├── index.js          # Database connection and query helpers
│       ├── schema.js         # Table definitions (v1)
│       ├── init.js           # Schema initialization script
│       ├── reset.js          # Database wipe script
│       └── seed.js           # Starter content (The Sunken Crypt)
├── .env.example              # Environment variable template
├── package.json
└── README.md
```

### Key Design Principles

**Engine / Narration Separation** — The game engine computes all mechanical outcomes before the AI is called. The narrator receives a complete summary of what happened and wraps it in prose. The AI cannot alter game state.

**Database-Driven Content** — Enemies, items, dungeons, and loot rules are rows in the database. Adding new content requires no code changes.

**Auditable Randomness** — All dice rolls flow through `engine/dice.js` and are logged to the `run_action_log` table with their outcomes.

---

## Adding Content

All game content is stored in the SQLite database. Use the seed file (`src/db/seed.js`) as a reference for the insert format.

### Adding a Dungeon

Insert a row into `dungeons`, then add associated rows to `enemy_rules` and `loot_rules`.

```js
db.prepare(`INSERT INTO dungeons (name, description, theme, min_level, difficulty, entry_cost, num_floors)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'The Ashen Wastes', 'A scorched plain ruled by fire elementals.',
  'volcanic', 1, 'medium', 50, 3
);
```

### Adding an Enemy

```js
db.prepare(`INSERT INTO enemies (name, description, base_hp, base_attack, base_defense, xp_reward, gold_reward_min, gold_reward_max)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'Fire Elemental', 'A sentient column of flame.', 60, 12, 5, 120, 20, 40
);
```

### Adding an Item

```js
db.prepare(`INSERT INTO items (name, description, item_type, rarity, value, equip_slot, damage_bonus, defense_bonus)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
  'Ember Blade', 'A sword wreathed in fire.', 'weapon', 'rare', 300, 'main_hand', 8, 0
);
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a pull request.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
