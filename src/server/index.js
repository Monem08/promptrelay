'use strict';

const { createApp, VERSION } = require('./app');
const { loadConfig } = require('../config');
const { promptConfigured } = require('../prompts');
const logger = require('../telemetry/logger');

/**
 * Create the app and bind it to a port. Returns the http.Server plus helpers.
 * @param {{ host?: string, port?: number, quiet?: boolean }} [options]
 */
function startServer(options = {}) {
  const config = loadConfig();
  const host = options.host || config.server.host;
  const port = options.port || config.server.port;
  const app = createApp();

  const server = app.listen(port, host, () => {
    if (options.quiet) return;
    printBanner(host, port);
  });

  return { app, server, host, port };
}

function printBanner(host, port) {
  const config = loadConfig();
  logger.log('');
  logger.log('══════════════════════════════════════════════');
  logger.log(`⚡ PROMPTRELAY v${VERSION}`);
  logger.log('══════════════════════════════════════════════');
  logger.log(`Local       : http://${host}:${port}`);
  logger.log(`Provider    : ${config.provider.name}`);
  logger.log(`Transport   : ${config.provider.transport}`);
  logger.log(`Base URL    : ${config.provider.baseURL}`);
  logger.log(`Model       : ${config.provider.model}`);
  logger.log(`Prompt mode : ${config.prompt.mode}`);
  logger.log(`Prompt file : ${config.paths.promptFile}`);
  logger.log(`Configured  : ${promptConfigured(config)}`);
  logger.log('');
  logger.log('PROMPT EDIT → HOT RELOAD');
  logger.log('PROVIDER    → HOT RELOAD');
  logger.log('STREAMING   → ENABLED');
  logger.log('TOOLS       → ENABLED');
  logger.log('REASONING   → ENABLED');
  logger.log('RETRY       → ENABLED');
  logger.log('══════════════════════════════════════════════');
  logger.log('');
}

/**
 * Start the server and wire graceful shutdown. Used by the bin entry.
 */
function main() {
  const { server } = startServer();

  function shutdown(signal) {
    logger.log(`\n${signal} received. Shutting down PromptRelay...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

module.exports = { createApp, startServer, main, VERSION };
