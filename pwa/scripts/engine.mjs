#!/usr/bin/env node
// Publishes the bot's backtest engine (its Core, compiled to WebAssembly, without strategies) into public/engine, with a
// version.json naming the bot version and commit it was built from, and the made-up sample pack the development bot hands
// out into mock-bot/sample-pack/. The app compares the engine's version with the bot's.
//
//   BEYONDBOT_REPO=~/Documents/Programming/Beyond-Bot-Bybit npm run engine
//
// It needs the .NET 10 SDK and the bot's repository. Commit public/engine afterwards: the site's CI builds the app
// without either.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = (process.env.BEYONDBOT_REPO ?? join(homedir(), 'Documents', 'Programming', 'Beyond-Bot-Bybit')).replace(/^~(?=\/)/, homedir())
const script = join(repo, 'scripts', 'publish-engine.sh')
if (!existsSync(script)) {
  console.error(`No bot repository with scripts/publish-engine.sh at ${repo}. Set BEYONDBOT_REPO to it.`)
  process.exit(2)
}

// The engine ships without strategies; the development bot hands out the made-up sample pack (mock-bot/sample-pack/).
const result = spawnSync('bash', [script, fileURLToPath(new URL('../public/engine', import.meta.url)), fileURLToPath(new URL('../mock-bot/sample-pack/BeyondBot.Strategies.dll', import.meta.url))], { stdio: 'inherit' })
process.exit(result.status ?? 1)
