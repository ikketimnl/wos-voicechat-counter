'use strict';
// Bare-metal compatibility shim — re-exports the canonical implementation.
// The actual code lives in src/svc/CommandHandler.js
module.exports = require('./svc/CommandHandler');
