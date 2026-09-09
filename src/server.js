'use strict';

/**
 * Entry point. Historically this file bound the port on import; it now delegates
 * to the ./server/ factory and only starts the server when run directly, so the
 * app can be imported/tested without side effects.
 */
const server = require('./server/index');

if (require.main === module) {
  server.main();
}

module.exports = {
  createApp: server.createApp,
  startServer: server.startServer,
};
