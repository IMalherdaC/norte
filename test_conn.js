process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';
process.env.JWT_SECRET = 'test-secret-long-enough-for-jwt-256bits-test';
const c = require('./database/connection');
try {
  const rows = c.queryAll('SELECT 1 as n');
  console.log('OK:', JSON.stringify(rows));
  c.closeDB();
} catch(e) {
  console.error('ERRO:', e.message);
}
