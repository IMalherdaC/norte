/**
 * @module shared
 * @description Barrel export — ponto de entrada único para o módulo shared.
 */
'use strict';

const fpUtils   = require('./fp-utils');
const validators= require('./validators');
const constants = require('./constants');

module.exports = Object.freeze({
  ...fpUtils,
  ...validators,
  ...constants,
});
