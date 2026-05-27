/**
 * @module core/auth/auth.service
 * @description Serviço de autenticação — funções puras + injeção de dependências.
 *
 * Fluxos cobertos:
 *  - Cadastro com e-mail/senha (Argon2id)
 *  - Login com suporte a 2FA (TOTP)
 *  - Google OAuth2 (upsert de usuário)
 *  - Refresh token rotativo (JWT curta duração)
 *  - Reset de senha (token de uso único, 30 min)
 *  - Encerramento global de sessões
 *  - LGPD: exportação e exclusão com carência de 30 dias
 *
 * ZERO classes. ZERO herança. Dependency Inversion via parâmetros.
 */
'use strict';

const { v4: uuidv4 }  = require('uuid');
const {
  hashPassword, verifyPassword, generateTokenPair, verifyToken,
  generateTOTPSecret, verifyTOTP, generateResetToken, validateResetToken,
  encryptField, decryptField,
} = require('../security/crypto');
const { validateAuthCredentials, isEmail }   = require('../../shared/validators');
const { Ok, Err }                            = require('../../shared');
const { eventBus, EVENTS }                   = require('../events/event-bus');

// ─────────────────────────────────────────────
// HELPERS PUROS
// ─────────────────────────────────────────────

/**
 * Cria registro de usuário imutável.
 * @param {{ email, passwordHash, name, provider, googleId }} data
 * @returns {object}
 */
const createUserRecord = ({ email, passwordHash, name, provider = 'email', googleId = null }) =>
  Object.freeze({
    id:                 uuidv4(),
    email:              email.toLowerCase().trim(),
    passwordHash:       passwordHash || null,
    name:               name?.trim() || '',
    provider,
    googleId:           googleId || null,
    isVerified:         provider !== 'email', // OAuth já é verificado
    isMEI:              false,
    twoFactorEnabled:   false,
    twoFactorSecret:    null,
    privacyMode:        false,
    darkMode:           false,
    loginAttempts:      0,
    lockedUntil:        null,
    deletionScheduledAt: null,
    createdAt:          new Date().toISOString(),
    updatedAt:          new Date().toISOString(),
  });

/**
 * Cria registro de sessão.
 */
const createSessionRecord = ({ userId, deviceInfo = '', ipAddress = '' }) =>
  Object.freeze({
    id:          uuidv4(),
    userId,
    deviceInfo:  deviceInfo.slice(0, 200),
    ipAddress:   ipAddress.slice(0, 45),
    revokedAt:   null,
    createdAt:   new Date().toISOString(),
    expiresAt:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

// ─────────────────────────────────────────────
// SERVIÇOS
// ─────────────────────────────────────────────

/**
 * Cadastro com e-mail + senha.
 * @param {{ email, password, name }} input
 * @param {{ userRepo, emailSvc }} deps
 */
const register = async ({ email, password, name }, { userRepo, emailSvc }) => {
  const validated = validateAuthCredentials({ email, password });
  if (!validated.ok) return validated;

  const existing = userRepo.findUserByEmail(email.toLowerCase());
  if (existing)    return Err('E-mail já cadastrado');

  const hashResult = await hashPassword(password);
  if (!hashResult.ok) return hashResult;

  const user = createUserRecord({ email, passwordHash: hashResult.value, name });
  userRepo.saveUser(user);

  await eventBus.emit(EVENTS.USER_REGISTERED, { userId: user.id, email: user.email, name: user.name });

  return Ok(Object.freeze({ id: user.id, email: user.email, name: user.name }));
};

/**
 * Login com e-mail + senha (+ TOTP opcional).
 * @param {{ email, password, totpCode, deviceInfo, ipAddress }} input
 * @param {{ userRepo }} deps
 * @returns {{ accessToken, refreshToken, requiresTwoFactor }}
 */
const login = async ({ email, password, totpCode, deviceInfo = '', ipAddress = '' },
  { userRepo }) => {
  const user = userRepo.findUserByEmail(email?.toLowerCase());
  if (!user) return Err('Credenciais inválidas');

  // Proteção brute-force
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date())
    return Err(`Conta bloqueada até ${new Date(user.lockedUntil).toLocaleString('pt-BR')}`);

  if (user.provider !== 'email')
    return Err(`Use o login com ${user.provider} para esta conta`);

  const verifyResult = await verifyPassword(password, user.passwordHash);
  if (!verifyResult.ok || !verifyResult.value) {
    userRepo.incrementLoginAttempt(user.id);
    // Bloqueia após 5 tentativas por 15 min
    if ((user.loginAttempts || 0) >= 4) {
      userRepo.updateUser(user.id, {
        lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      });
    }
    return Err('Credenciais inválidas');
  }

  // 2FA
  if (user.twoFactorEnabled) {
    if (!totpCode) return Ok(Object.freeze({ requiresTwoFactor: true }));
    const valid = verifyTOTP(totpCode, user.twoFactorSecret);
    if (!valid) return Err('Código 2FA inválido ou expirado');
  }

  userRepo.resetLoginAttempt(user.id);

  const session = createSessionRecord({ userId: user.id, deviceInfo, ipAddress });
  userRepo.saveSession(session);

  const tokenResult = generateTokenPair({
    userId: user.id, role: user.role || 'user', sessionId: session.id,
  });
  if (!tokenResult.ok) return tokenResult;

  return Ok(Object.freeze({
    accessToken:  tokenResult.value.accessToken,
    refreshToken: tokenResult.value.refreshToken,
    user: Object.freeze({ id: user.id, email: user.email, name: user.name }),
  }));
};

/**
 * Upsert via Google OAuth2.
 * @param {{ googleId, email, name, picture }} profile
 * @param {{ userRepo }} deps
 */
const loginWithGoogle = async ({ googleId, email, name, picture }, { userRepo }) => {
  let user = userRepo.findUserByGoogleId(googleId)
          || userRepo.findUserByEmail(email.toLowerCase());

  if (!user) {
    user = createUserRecord({ email, name, provider: 'google', googleId });
    userRepo.saveUser({ ...user, avatarUrl: picture });
    await eventBus.emit(EVENTS.USER_REGISTERED, { userId: user.id, email: user.email, name: user.name });
  } else if (user.provider !== 'google') {
    // Vincula conta existente ao Google
    userRepo.updateUser(user.id, { googleId, provider: 'google', isVerified: true });
  }

  const session = createSessionRecord({ userId: user.id, deviceInfo: 'Google OAuth' });
  userRepo.saveSession(session);

  const tokenResult = generateTokenPair({
    userId: user.id, role: user.role || 'user', sessionId: session.id,
  });
  if (!tokenResult.ok) return tokenResult;

  return Ok(Object.freeze({
    accessToken:  tokenResult.value.accessToken,
    refreshToken: tokenResult.value.refreshToken,
    user: Object.freeze({ id: user.id, email: user.email, name: user.name }),
  }));
};

/**
 * Rotaciona refresh token.
 * @param {{ refreshToken }} input
 * @param {{ userRepo }} deps
 */
const refreshTokens = async ({ refreshToken }, { userRepo }) => {
  const decoded = verifyToken(refreshToken, 'refresh');
  if (!decoded.ok) return Err('Refresh token inválido ou expirado');

  const { sub: userId, sid: sessionId } = decoded.value;
  const session = userRepo.findSessionById(sessionId);
  if (!session || session.revokedAt) return Err('Sessão encerrada');

  const user = userRepo.findUserById(userId);
  if (!user) return Err('Usuário não encontrado');

  // Rotação: revoga sessão antiga e cria nova
  userRepo.revokeSession(sessionId);
  const newSession = createSessionRecord({ userId: user.id });
  userRepo.saveSession(newSession);

  const tokenResult = generateTokenPair({
    userId: user.id, role: user.role || 'user', sessionId: newSession.id,
  });
  return tokenResult.ok
    ? Ok(Object.freeze({ accessToken: tokenResult.value.accessToken, refreshToken: tokenResult.value.refreshToken }))
    : tokenResult;
};

/**
 * Solicita reset de senha — gera token de uso único (30 min).
 */
const requestPasswordReset = async ({ email }, { userRepo, emailSvc }) => {
  const user = userRepo.findUserByEmail(email?.toLowerCase());
  // Responde OK mesmo se e-mail não existe (evita enumeração de usuários)
  if (!user || user.provider !== 'email')
    return Ok({ message: 'Se o e-mail estiver cadastrado, você receberá um link em instantes.' });

  const { token, hashedToken, expiresAt } = generateResetToken();
  userRepo.saveResetToken({ userId: user.id, hashedToken, expiresAt });

  const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth.html?reset=${token}`;
  await eventBus.emit(EVENTS.USER_PASSWORD_RESET, { email: user.email, name: user.name, resetLink });

  return Ok({ message: 'Se o e-mail estiver cadastrado, você receberá um link em instantes.' });
};

/**
 * Confirma novo password com token de uso único.
 */
const resetPassword = async ({ token, newPassword }, { userRepo }) => {
  if (!newPassword || newPassword.length < 10)
    return Err('Nova senha deve ter ao menos 10 caracteres');

  const resetEntry = userRepo.findResetTokenByHash(
    require('crypto').createHash('sha256').update(token).digest('hex')
  );
  if (!resetEntry) return Err('Token inválido ou já utilizado');
  if (new Date(resetEntry.expiresAt) < new Date()) return Err('Token expirado');

  const hashResult = await hashPassword(newPassword);
  if (!hashResult.ok) return hashResult;

  userRepo.updateUser(resetEntry.userId, { passwordHash: hashResult.value });
  userRepo.deleteResetToken(resetEntry.hashedToken);
  userRepo.revokeAllSessions(resetEntry.userId); // encerra todas as sessões

  return Ok({ message: 'Senha alterada com sucesso. Faça login novamente.' });
};

/**
 * Habilita 2FA — retorna secret e QR URL.
 */
const enable2FA = async ({ userId }, { userRepo }) => {
  const user = userRepo.findUserById(userId);
  if (!user) return Err('Usuário não encontrado');

  const { secret, otpauthUrl } = generateTOTPSecret(user.email);
  // Armazena cifrado
  const encResult = encryptField(secret);
  if (!encResult.ok) return encResult;

  userRepo.updateUser(userId, {
    twoFactorSecret:  encResult.value,
    twoFactorEnabled: false, // só ativa após confirmação
  });

  return Ok(Object.freeze({ secret, otpauthUrl }));
};

/**
 * Confirma 2FA com o primeiro código válido.
 */
const confirm2FA = async ({ userId, totpCode }, { userRepo }) => {
  const user = userRepo.findUserById(userId);
  if (!user || !user.twoFactorSecret) return Err('2FA não iniciado');

  const decResult = decryptField(user.twoFactorSecret);
  if (!decResult.ok) return Err('Erro ao recuperar segredo 2FA');

  const valid = verifyTOTP(totpCode, decResult.value);
  if (!valid) return Err('Código inválido — tente novamente');

  userRepo.updateUser(userId, { twoFactorEnabled: true });
  await eventBus.emit(EVENTS.USER_2FA_ENABLED, { userId, email: user.email });

  return Ok({ message: '2FA ativado com sucesso.' });
};

/**
 * Encerra todas as sessões ativas (logout global).
 */
const revokeAllSessions = ({ userId }, { userRepo }) => {
  userRepo.revokeAllSessions(userId);
  return Ok({ message: 'Todas as sessões foram encerradas.' });
};

/**
 * Solicita exportação LGPD — gera ZIP com todos os dados do usuário.
 */
const requestDataExport = async ({ userId }, { userRepo }) => {
  const user = userRepo.findUserById(userId);
  if (!user) return Err('Usuário não encontrado');
  await eventBus.emit(EVENTS.LGPD_EXPORT_REQUESTED, { userId, email: user.email });
  return Ok({ message: 'Exportação solicitada. Você receberá o arquivo por e-mail em breve.' });
};

/**
 * Solicita exclusão de conta — carência de 30 dias (LGPD).
 */
const requestAccountDeletion = async ({ userId }, { userRepo }) => {
  const user = userRepo.findUserById(userId);
  if (!user) return Err('Usuário não encontrado');

  const deletionDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  userRepo.updateUser(userId, { deletionScheduledAt: deletionDate });
  userRepo.revokeAllSessions(userId);

  await eventBus.emit(EVENTS.LGPD_DELETE_REQUESTED, { userId, email: user.email });
  return Ok({ message: `Conta marcada para exclusão em 30 dias (${new Date(deletionDate).toLocaleDateString('pt-BR')}).` });
};

/**
 * Cancela solicitação de exclusão (dentro dos 30 dias de carência).
 */
const cancelAccountDeletion = ({ userId }, { userRepo }) => {
  const user = userRepo.findUserById(userId);
  if (!user?.deletionScheduledAt) return Err('Nenhuma solicitação de exclusão pendente');
  userRepo.updateUser(userId, { deletionScheduledAt: null });
  return Ok({ message: 'Exclusão cancelada com sucesso.' });
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  // Funções puras
  createUserRecord,
  createSessionRecord,
  // Serviços com I/O
  register,
  login,
  loginWithGoogle,
  refreshTokens,
  requestPasswordReset,
  resetPassword,
  enable2FA,
  confirm2FA,
  revokeAllSessions,
  requestDataExport,
  requestAccountDeletion,
  cancelAccountDeletion,
});
