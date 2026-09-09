#!/usr/bin/env node

'use strict';

/**
 * PromptRelay CLI router.
 *
 * This file is intentionally thin: it parses argv and delegates to the
 * non-interactive command primitives in ../src/cli/commands and the
 * interactive wizards in ../src/cli/wizard. All real behavior lives in those
 * modules so it can be unit-tested without spawning a process.
 */

const { stdin: input, stdout: output } = require('process');

const io = require('../src/cli/io');
const commands = require('../src/cli/commands');
const wizard = require('../src/cli/wizard');

/** Parse `--flag` and `--flag value` style options from an argv slice. */
function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function handleProvider(sub, rest) {
  const { flags, positional } = parseFlags(rest);
  switch ((sub || '').toLowerCase()) {
    case undefined:
    case '':
    case 'add':
    case 'setup':
      await wizard.providerSetup();
      break;
    case 'list':
      commands.providerList();
      break;
    case 'use':
      commands.providerUse(positional[0]);
      break;
    case 'test':
      await commands.providerTest({ live: Boolean(flags.live) });
      break;
    case 'remove':
    case 'rm':
      commands.providerRemove(positional[0]);
      break;
    default:
      console.error(`Unknown provider subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleModels(sub, rest) {
  const { flags } = parseFlags(rest);
  switch ((sub || 'list').toLowerCase()) {
    case 'list':
      await commands.modelsList({ json: Boolean(flags.json), refresh: Boolean(flags.refresh) });
      break;
    case 'free':
      await commands.modelsFree();
      break;
    case 'refresh':
      await commands.modelsRefresh();
      break;
    case 'recommend':
      await commands.modelsRecommend({ profile: flags.profile || 'balanced' });
      break;
    default:
      console.error(`Unknown models subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleReasoning(sub, rest) {
  const { positional } = parseFlags(rest);
  switch ((sub || 'list').toLowerCase()) {
    case 'list':
      commands.reasoningList();
      break;
    case 'set':
      commands.reasoningSet(positional[0]);
      break;
    default:
      // Allow `reasoning <level>` as a shortcut for `reasoning set <level>`.
      commands.reasoningSet(sub);
  }
}

async function handleConfig(sub) {
  switch ((sub || '').toLowerCase()) {
    case 'validate':
      commands.configValidate();
      break;
    case undefined:
    case '':
      commands.openFile(io.CONFIG_FILE);
      break;
    default:
      console.error(`Unknown config subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleOpencode(sub) {
  switch ((sub || '').toLowerCase()) {
    case undefined:
    case '':
    case 'setup':
    case 'repair':
      await commands.opencodeSetup();
      break;
    case 'status':
      commands.opencodeStatus();
      break;
    default:
      console.error(`Unknown opencode subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleClient(sub, rest) {
  const { flags, positional } = parseFlags(rest);
  const model = typeof flags.model === 'string' ? flags.model : undefined;
  const smallModel = typeof flags['small-model'] === 'string' ? flags['small-model'] : undefined;
  switch ((sub || 'list').toLowerCase()) {
    case 'list':
      commands.clientList();
      break;
    case 'detect':
      commands.clientDetect();
      break;
    case 'status':
      commands.clientStatus(positional[0]);
      break;
    case 'setup':
    case 'configure':
    case 'repair':
      await commands.clientSetup(positional[0], { model, smallModel });
      break;
    case 'remove':
    case 'rm':
      commands.clientRemove(positional[0]);
      break;
    default:
      // Allow `client <id>` as a shortcut for `client setup <id>`.
      if (sub) {
        await commands.clientSetup(sub, { model, smallModel });
      } else {
        commands.clientList();
      }
  }
}

async function handlePrompt(sub, rest) {
  const { positional } = parseFlags(rest);
  switch ((sub || '').toLowerCase()) {
    case undefined:
    case '':
      commands.openFile(io.PROMPT_FILE);
      break;
    case 'use':
      commands.promptUse(positional[0]);
      break;
    default:
      console.error(`Unknown prompt subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleKeys(sub, rest) {
  const { positional } = parseFlags(rest);
  switch ((sub || '').toLowerCase()) {
    case 'set':
      commands.keysSet(positional[0], positional.slice(1).join(' '));
      break;
    case 'list':
      commands.keysList();
      break;
    case 'remove':
    case 'rm':
      commands.keysRemove(positional[0]);
      break;
    default:
      console.error(`Unknown keys subcommand: ${sub}`);
      process.exitCode = 1;
  }
}

async function handleStart(rest) {
  const { flags } = parseFlags(rest);
  const fs = require('fs');
  // First-run experience: if there is no config and we have a TTY, run setup.
  if (!fs.existsSync(io.CONFIG_FILE) && input.isTTY && output.isTTY) {
    console.log('First run detected — launching easy setup.');
    await wizard.setup();
    return;
  }
  await commands.startServer({ daemon: Boolean(flags.daemon) });
}

async function main() {
  const argv = process.argv.slice(2);
  const command = String(argv[0] || 'start').toLowerCase();
  const sub = argv[1];
  const rest = argv.slice(2);

  switch (command) {
    case 'start':
      await handleStart(argv.slice(1));
      break;
    case 'stop':
      commands.stopServer();
      break;
    case 'restart':
      await commands.restartServer();
      break;
    case 'status':
      await commands.status();
      break;
    case 'dashboard':
      await commands.dashboard({ print: rest.includes('--print') || rest.includes('--terminal') });
      break;
    case 'setup':
      await wizard.setup();
      break;
    case 'provider':
      await handleProvider(sub, rest);
      break;
    case 'models':
      await handleModels(sub, rest);
      break;
    case 'model':
      // `model use <id>`
      if ((sub || '').toLowerCase() === 'use') {
        commands.modelUse(rest[0]);
      } else {
        console.error('Usage: promptrelay model use <model-id>');
        process.exitCode = 1;
      }
      break;
    case 'auto': {
      const { flags } = parseFlags(argv.slice(1));
      await commands.auto({ profile: flags.profile || 'balanced' });
      break;
    }
    case 'reasoning':
      await handleReasoning(sub, rest);
      break;
    case 'prompt':
      await handlePrompt(sub, rest);
      break;
    case 'config':
      await handleConfig(sub);
      break;
    case 'opencode':
      await handleOpencode(sub);
      break;
    case 'client':
    case 'clients':
      await handleClient(sub, rest);
      break;
    case 'keys':
      await handleKeys(sub, rest);
      break;
    case 'doctor': {
      const { flags } = parseFlags(argv.slice(1));
      await commands.doctor({ deep: Boolean(flags.deep), fix: Boolean(flags.fix) });
      break;
    }
    case 'init':
      commands.init({});
      break;
    case 'path':
      console.log(io.HOME);
      break;
    case 'help':
    case '--help':
    case '-h':
      commands.printHelp();
      break;
    case '--version':
    case '-v':
    case 'version':
      commands.version();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      commands.printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`PromptRelay CLI error: ${error.message}`);
  process.exitCode = 1;
});
