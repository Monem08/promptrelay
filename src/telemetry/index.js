'use strict';

const secrets = require('./secrets');
const logger = require('./logger');

module.exports = {
  ...secrets,
  logger,
};
