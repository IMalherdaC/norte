/**
 * @module server/routes/auth
 * @description Rotas de autenticação (E01).
 *
 * POST /api/v1/auth/register       — Cadastro e-mail/senha
 * POST /api/v1/auth/login          — Login e-mail/senha (+ TOTP opcional)
 * POST /api/v1/auth/google         — OAuth2 Google
 * POST /api/v1/auth/refresh        — Rotação de refresh token
 * POST /api/v1/auth/logout         — Encerra sessão atual
 * POST /api/v1/auth/logout-all     — Encerra TODAS as sessões
 * POST /api/v1/auth/forgot-password
 * POST /api/v1/auth/reset-password
 * POST /api/v1/auth/2fa/enable     — Inicia setup 2FA (retorna QR)
 * POST /api/v1/auth/2fa/confirm    — Confirma 2FA com primeiro código
 * POST /api/v1/auth/2fa/disable    — Desabilita 2FA
 * GET  /api/v1/auth/me             — Perfil do usuário autenticado
 * PUT  /api/v1/auth/me             — Atualiza perfil
 * POST /api/v1/auth/lgpd/export    — Solicita exportação LGPD
 * DELETE /api/v1/auth/lgpd/account — Solicita exclusão (30 dias)
 * POST /api/v1/auth/lgpd/cancel-deletion — Cancela exclusão
 */
'use strict';

const { Router } = require('express');
const authSvc    = require('../../core/auth/auth.service');
const { requireAuth, requireCSRF, rateLimiter } = require('../middleware/auth.middleware');
const { generateCSRFToken } = require('../../core/security/crypto');

const router = Router();

const DEPS = () => ({
  userRepo: require('../../database/repositories/user.repository'),
  emailSvc: require('../../core/email/email.service'),
});

// ─── Rate limiters ─────────────────────────────────────────────────────────
const authLimiter    = rateLimiter(10, 60_000);   // 10 req/min nas rotas de auth
const resetLimiter   = rateLimiter(3, 60_000);    // 3 req/min para reset

// ─── CSRF token (gera e seta cookie) ──────────────────────────────────────
router.get('/csrf', (_req, res) => {
  const token = generateCSRFToken();
  res.cookie('csrf_token', token, {
    httpOnly: false,    // precisa ser lido pelo JS do frontend
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   3600_000, // 1h
  });
  res.json({ csrfToken: token });
});

// ─── Cadastro ──────────────────────────────────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  const result = await authSvc.register({ email, password, name }, DEPS());
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ message: 'Conta criada! Confirme seu e-mail.', data: result.value });
});

// ─── Login ─────────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password, totpCode } = req.body;
  const deviceInfo = req.headers['user-agent'] || '';
  const ipAddress  = req.ip;

  const result = await authSvc.login(
    { email, password, totpCode, deviceInfo, ipAddress }, DEPS()
  );
  if (!result.ok) return res.status(401).json({ error: result.error });

  // 2FA pendente
  if (result.value.requiresTwoFactor)
    return res.json({ requiresTwoFactor: true });

  // Seta refresh token como cookie HttpOnly
  res.cookie('refresh_token', result.value.refreshToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   30 * 24 * 3600_000,
    path:     '/api/v1/auth/refresh',
  });

  res.json({
    accessToken: result.value.accessToken,
    user:        result.value.user,
  });
});

// ─── Google OAuth ──────────────────────────────────────────────────────────
router.post('/google', authLimiter, async (req, res) => {
  const { googleId, email, name, picture } = req.body;
  if (!googleId || !email) return res.status(400).json({ error: 'Dados OAuth inválidos' });

  const result = await authSvc.loginWithGoogle({ googleId, email, name, picture }, DEPS());
  if (!result.ok) return res.status(401).json({ error: result.error });

  res.cookie('refresh_token', result.value.refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 30 * 24 * 3600_000, path: '/api/v1/auth/refresh',
  });
  res.json({ accessToken: result.value.accessToken, user: result.value.user });
});

// ─── Refresh token ─────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.['refresh_token'] || req.body?.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token não encontrado' });

  const result = await authSvc.refreshTokens({ refreshToken }, DEPS());
  if (!result.ok) return res.status(401).json({ error: result.error });

  res.cookie('refresh_token', result.value.refreshToken, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict', maxAge: 30 * 24 * 3600_000, path: '/api/v1/auth/refresh',
  });
  res.json({ accessToken: result.value.accessToken });
});

// ─── Logout ────────────────────────────────────────────────────────────────
router.post('/logout', requireAuth, (req, res) => {
  const deps = DEPS();
  deps.userRepo.revokeSession(req.user.sessionId);
  res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
  res.json({ message: 'Sessão encerrada.' });
});

router.post('/logout-all', requireAuth, (req, res) => {
  const result = authSvc.revokeAllSessions({ userId: req.user.sub }, DEPS());
  res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh' });
  res.json(result.ok ? { message: result.value.message } : { error: result.error });
});

// ─── Reset de senha ────────────────────────────────────────────────────────
router.post('/forgot-password', resetLimiter, async (req, res) => {
  const result = await authSvc.requestPasswordReset({ email: req.body.email }, DEPS());
  res.json({ message: result.value?.message || 'Solicitação recebida.' });
});

router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  const result = await authSvc.resetPassword({ token, newPassword }, DEPS());
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: result.value.message });
});

// ─── 2FA ───────────────────────────────────────────────────────────────────
router.post('/2fa/enable', requireAuth, async (req, res) => {
  const result = await authSvc.enable2FA({ userId: req.user.sub }, DEPS());
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value }); // retorna { secret, otpauthUrl }
});

router.post('/2fa/confirm', requireAuth, async (req, res) => {
  const result = await authSvc.confirm2FA(
    { userId: req.user.sub, totpCode: req.body.totpCode }, DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: result.value.message });
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  const deps = DEPS();
  deps.userRepo.updateUser(req.user.sub, {
    twoFactorEnabled: false, twoFactorSecret: null,
  });
  res.json({ message: '2FA desabilitado.' });
});

// ─── Perfil ────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = DEPS().userRepo.findUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  // Nunca expõe campos sensíveis
  const { passwordHash, twoFactorSecret, ...safe } = user;
  res.json({ data: safe });
});

router.put('/me', requireAuth, (req, res) => {
  const ALLOWED = ['name', 'privacyMode', 'darkMode', 'isMEI'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => ALLOWED.includes(k))
  );
  if (!Object.keys(updates).length)
    return res.status(422).json({ error: 'Nenhum campo válido para atualizar' });

  DEPS().userRepo.updateUser(req.user.sub, updates);
  res.json({ message: 'Perfil atualizado.' });
});

// ─── LGPD ──────────────────────────────────────────────────────────────────
router.post('/lgpd/export', requireAuth, async (req, res) => {
  const result = await authSvc.requestDataExport({ userId: req.user.sub }, DEPS());
  res.json({ message: result.value?.message || result.error });
});

router.delete('/lgpd/account', requireAuth, async (req, res) => {
  const result = await authSvc.requestAccountDeletion({ userId: req.user.sub }, DEPS());
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: result.value.message });
});

router.post('/lgpd/cancel-deletion', requireAuth, (req, res) => {
  const result = authSvc.cancelAccountDeletion({ userId: req.user.sub }, DEPS());
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: result.value.message });
});

module.exports = router;
