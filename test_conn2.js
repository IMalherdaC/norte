process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
process.env.JWT_SECRET = 'test-secret-long-enough-for-jwt-256bits-test';

// Patch para ver o que acontece dentro do connection.js
const Module = require('module');
const orig = Module._load;
Module._load = function(name, ...args) {
  if (name === 'node-sqlite3-wasm') {
    const mod = orig.call(this, name, ...args);
    const OrigDB = mod.Database;
    mod.Database = function(path, opts) {
      console.log('[WASM] new Database("' + path + '")');
      try {
        const db = new OrigDB(path, opts);
        console.log('[WASM] opened OK');
        return db;
      } catch(e) {
        console.error('[WASM] open FAILED:', e.message);
        throw e;
      }
    };
    return mod;
  }
  return orig.call(this, name, ...args);
};

const c = require('./database/connection');
try {
  const db = c.getDB();
  console.log('connection OK');
  c.closeDB();
} catch(e) {
  console.error('connection FAILED:', e.message);
}
