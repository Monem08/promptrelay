'use strict';

// Backward-compatibility shim. The config system now lives in ./config/.
// Existing imports of `require('../src/config')` continue to work unchanged.
module.exports = require('./config/index');
