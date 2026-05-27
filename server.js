/**
 * @file server.js — Entrypoint do servidor Norte (Monolito Modular)
 *
 * Módulos registrados:
 *  - Core/Auth, Core/Security, Core/Events
 *  - Finances/Wallets, Finances/Transactions, Finances/Budgets, Finances/Goals, Finances/Investments
 *  - Reports/Analytics
 *
 * Paradigma: 100% JavaScript Funcional — zero classes, zero OOP.
 * Segurança: CORS, rate-limit, headers CSP, CSRF, Argon2id, AES-256-GCM, JWT RS256.
 */
'use strict';

require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');

// ─── Infraestrutura ────────────────────────────────────────────
const { runMigrations }         = require('./database/migrations/run');
const { seedDefaultCategories } = require('./database/seeds/default_categories');
const { registerDefaultListeners } = require('./core/events/event-bus');
const { securityHeaders, rateLimiter } = require('./server/middleware/auth.middleware');

// ─── Rotas ─────────────────────────────────────────────────────
const authRoutes        = require('./server/routes/auth.routes');
const transactionRoutes = require('./server/routes/transactions.routes');
const budgetRoutes      = require('./server/routes/budgets.routes');
const reportRoutes      = require('./server/routes/reports.routes');
const walletRoutes      = require('./server/routes/wallets.routes');
const goalRoutes        = require('./server/routes/goals.routes');
const investmentRoutes  = require('./server/routes/investments.routes');

// ─── App ───────────────────────────────────────────────────────
const app  = express();
const PORT = Number(process.env.PORT) || 3000;

// ─── Middlewares globais ───────────────────────────────────────
app.set('trust proxy', 1); // para req.ip correto atrás de nginx/cloudflare

app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieParser());

// CORS
app.use((req, res, next) => {
  const origin  = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');
  if (!origin || allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin',      origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers',     'Content-Type,Authorization,X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Methods',     'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Rate limiter global (200 req/min por IP)
app.use('/api/', rateLimiter(200, 60_000));

// ─── Servir UI estática ────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'ui/pages')));
app.use(express.static(path.join(__dirname, 'ui')));
app.use('/sw.js', express.static(path.join(__dirname, 'ui/utils/sw.js')));
app.use('/manifest.json', express.static(path.join(__dirname, 'manifest.json')));

// ─── API Routes ────────────────────────────────────────────────
app.use('/api/v1/auth',         authRoutes);
app.use('/api/v1/wallets',      walletRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/budgets',      budgetRoutes);
app.use('/api/v1/goals',        goalRoutes);
app.use('/api/v1/investments',  investmentRoutes);
app.use('/api/v1/reports',      reportRoutes);

// ─── Health check ──────────────────────────────────────────────
app.get('/api/v1/health', (_req, res) =>
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() })
);

// ─── SPA fallback ──────────────────────────────────────────────
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'ui/pages/index.html'))
);

// ─── Error handler global ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? 'Erro interno do servidor' : err.message,
    code:  err.code || 'SERVER_ERROR',
  });
});

// ─── Startup ───────────────────────────────────────────────────
const start = () => {
  // 1. Migrations ACID
  runMigrations();

  // 2. Seed de dados padrão
  seedDefaultCategories();

  // 3. Event Bus
  registerDefaultListeners({
    emailSvc: require('./core/email/email.service'),
    budgetSvc: require('./finances/budgets/budget.service'),
    goalSvc:   require('./finances/goals/goal.service'),
    userRepo:  require('./database/repositories/user.repository'),
  });

  // 4. Inicia servidor
  app.listen(PORT, () => {
    console.log(`\n🧭 Norte rodando em http://localhost:${PORT}`);
    console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   DB:       ${process.env.DB_PATH || './data/norte.db'}\n`);
  });
};

// Graceful shutdown
const shutdown = (signal) => {
  console.log(`\n[${signal}] Encerrando Norte gracefully...`);
  require('./database/connection').closeDB();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

if (require.main === module) start();

module.exports = app; // para testes
