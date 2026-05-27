/**
 * @module server/middleware/auth.middleware
 * @description Middleware de autenticação JWT + CSRF para o servidor Express.
 *
 * Funções puras compostas em pipeline de middleware.
 */
'use strict';

const { verifyToken, validateCSRFToken } = require('../../core/security/crypto');
const { Err } = require('../../shared');

// ─────────────────────────────────────────────
// HELPERS PUROS
// ─────────────────────────────────────────────

/**
 * Extrai Bearer token do header Authorization.
 * @param {string} header
 * @returns {string|null}
 */
const extractBearer = (header) => {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 10 ? token : null;
};

/**
 * Cria objeto req.user padronizado a partir do payload JWT.
 * @param {object} payload
 * @returns {object}
 */
const buildUserFromPayload = (payload) =>
  Object.freeze({
    sub:       payload.sub,
    role:      payload.role || 'user',
    sessionId: payload.sid,
    type:      payload.type,
  });

// ─────────────────────────────────────────────
// MIDDLEWARES
// ─────────────────────────────────────────────

/**
 * Verifica JWT de acesso obrigatório.
 * Injeta req.user se válido.
 */
const requireAuth = (req, res, next) => {
  const token = extractBearer(req.headers['authorization']);

  if (!token) {
    return res.status(401).json({
      error: 'Autenticação necessária',
      code:  'MISSING_TOKEN',
    });
  }

  const result = verifyToken(token, 'access');
  if (!result.ok) {
    return res.status(401).json({
      error: result.error || 'Token inválido ou expirado',
      code:  'INVALID_TOKEN',
    });
  }

  req.user = buildUserFromPayload(result.value);
  next();
};

/**
 * Verifica JWT — modo permissivo (não bloqueia, apenas popula req.user se válido).
 */
const optionalAuth = (req, _res, next) => {
  const token = extractBearer(req.headers['authorization']);
  if (token) {
    const result = verifyToken(token, 'access');
    if (result.ok) req.user = buildUserFromPayload(result.value);
  }
  next();
};

/**
 * Exige role específica após requireAuth.
 * @param {...string} roles
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Permissão insuficiente', code: 'FORBIDDEN' });
  }
  next();
};

/**
 * Valida CSRF token em mutations (POST/PUT/PATCH/DELETE).
 * Token vem no header X-CSRF-Token e é comparado ao cookie csrf_token.
 */
const requireCSRF = (req, res, next) => {
  const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
  if (SAFE_METHODS.includes(req.method)) return next();

  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = req.cookies?.['csrf_token'];

  if (!headerToken || !cookieToken || !validateCSRFToken(headerToken, cookieToken)) {
    return res.status(403).json({ error: 'Token CSRF inválido', code: 'CSRF_MISMATCH' });
  }
  next();
};

/**
 * Rate limiter simples em memória (sem Redis, apenas para demo).
 * Em produção usar express-rate-limit + Redis store.
 * @param {number} max — máximo de requests por janela
 * @param {number} windowMs — tamanho da janela em ms
 */
const rateLimiter = (max = 20, windowMs = 60_000) => {
  const hits = new Map();

  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();

    if (!hits.has(key)) hits.set(key, []);
    const timestamps = hits.get(key).filter((t) => now - t < windowMs);
    timestamps.push(now);
    hits.set(key, timestamps);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - timestamps.length));

    if (timestamps.length > max) {
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde um momento.',
        code:  'RATE_LIMITED',
      });
    }
    next();
  };
};

/**
 * Headers de segurança básicos (sem helmet para manter dependência zero).
 */
const securityHeaders = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options',            'nosniff');
  res.setHeader('X-Frame-Options',                   'DENY');
  res.setHeader('X-XSS-Protection',                  '1; mode=block');
  res.setHeader('Referrer-Policy',                   'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',                'geolocation=(), microphone=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.tailwindcss.com cdn.jsdelivr.net fonts.googleapis.com; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src fonts.gstatic.com; img-src 'self' data:; connect-src 'self'"
  );
  next();
};

module.exports = Object.freeze({
  requireAuth,
  optionalAuth,
  requireRole,
  requireCSRF,
  rateLimiter,
  securityHeaders,
  // Helpers exportados para testes
  extractBearer,
  buildUserFromPayload,
});
