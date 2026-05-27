/**
 * @module core/security/crypto
 * @description Funções de segurança criptográfica.
 * - Hash de senhas: bcryptjs (puro JS, sem compilação nativa)
 * - Criptografia simétrica: AES-256-GCM
 * - Tokens JWT
 * - TOTP: 2FA compatível com Google Authenticator/Authy
 */

'use strict';

const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { totp } = require('otplib');
const { Ok, Err, SECURITY } = require('../../shared');

// ─────────────────────────────────────────────
// BCRYPT — Hash de senhas (puro JS, sem compilação)
// ─────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

/**
 * Faz o hash da senha com bcrypt.
 */
const hashPassword = async (password) => {
  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    return Ok(hash);
  } catch (e) {
    return Err('Falha ao processar senha', e.message);
  }
};

/**
 * Verifica a senha contra o hash armazenado.
 */
const verifyPassword = async (password, hash) => {
  try {
    const valid = await bcrypt.compare(password, hash);
    return Ok(valid);
  } catch (e) {
    return Err('Falha na verificação de senha', e.message);
  }
};

// ─────────────────────────────────────────────
// AES-256-GCM — Criptografia de campos sensíveis
// ─────────────────────────────────────────────

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_LENGTH = 16;
const AES_TAG_LENGTH = 16;

const getEncryptionKey = () => {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY inválida — deve ter 32 bytes (64 hex chars)');
  }
  return Buffer.from(keyHex, 'hex');
};

const encryptField = (plaintext) => {
  try {
    const key = getEncryptionKey();
    const iv  = crypto.randomBytes(AES_IV_LENGTH);
    const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, {
      authTagLength: AES_TAG_LENGTH,
    });
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const result = [
      iv.toString('base64'),
      tag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
    return Ok(result);
  } catch (e) {
    return Err('Falha na criptografia', e.message);
  }
};

const decryptField = (ciphertext) => {
  try {
    const key = getEncryptionKey();
    const [ivB64, tagB64, encB64] = ciphertext.split(':');
    const iv        = Buffer.from(ivB64, 'base64');
    const tag       = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encB64, 'base64');
    const decipher  = crypto.createDecipheriv(AES_ALGORITHM, key, iv, {
      authTagLength: AES_TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    return Ok(decrypted.toString('utf8'));
  } catch (e) {
    return Err('Falha na descriptografia — dado corrompido ou chave inválida');
  }
};

// ─────────────────────────────────────────────
// JWT
// ─────────────────────────────────────────────

const generateTokenPair = (payload) => {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET não configurado');

    const accessToken = jwt.sign(
      { sub: payload.userId, role: payload.role, sid: payload.sessionId, type: 'access' },
      secret,
      { expiresIn: SECURITY.JWT_ACCESS_EXPIRY, issuer: 'norte-app' }
    );

    const refreshToken = jwt.sign(
      { sub: payload.userId, sid: payload.sessionId, type: 'refresh' },
      secret,
      { expiresIn: SECURITY.JWT_REFRESH_EXPIRY, issuer: 'norte-app' }
    );

    return Ok(Object.freeze({ accessToken, refreshToken }));
  } catch (e) {
    return Err('Falha ao gerar tokens', e.message);
  }
};

const verifyToken = (token, expectedType = 'access') => {
  try {
    const secret = process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret, { issuer: 'norte-app' });
    if (decoded.type !== expectedType) {
      return Err('Tipo de token inválido');
    }
    return Ok(Object.freeze(decoded));
  } catch (e) {
    if (e.name === 'TokenExpiredError') return Err('Token expirado');
    if (e.name === 'JsonWebTokenError') return Err('Token inválido');
    return Err('Falha na verificação do token');
  }
};

// ─────────────────────────────────────────────
// TOTP — 2FA
// ─────────────────────────────────────────────

totp.options = Object.freeze({
  digits:    6,
  step:      30,
  window:    1,
  algorithm: 'SHA1',
});

const generateTOTPSecret = (userEmail = '') => {
  const { authenticator } = require('otplib');
  const secret = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(userEmail || 'user', 'Norte Finanças', secret);
  return { secret, otpauthUrl };
};

const getTOTPUri = (secret, userEmail) =>
  totp.keyuri(userEmail, 'Norte Finanças', secret);

const verifyTOTP = (token, secret) => {
  try {
    const { authenticator } = require('otplib');
    const valid = authenticator.verify({ token, secret });
    return valid;
  } catch (e) {
    return false;
  }
};

// ─────────────────────────────────────────────
// TOKENS DE USO ÚNICO
// ─────────────────────────────────────────────

const generateResetToken = () => {
  const token       = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt   = new Date(Date.now() + SECURITY.RESET_LINK_EXPIRY_MINUTES * 60 * 1000);
  return Object.freeze({ token, hashedToken, expiresAt });
};

const validateResetToken = (rawToken, storedHash, expiresAt) => {
  if (new Date() > new Date(expiresAt)) return Err('Link de recuperação expirado');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  if (hash !== storedHash) return Err('Link de recuperação inválido');
  return Ok(true);
};

// ─────────────────────────────────────────────
// CSRF
// ─────────────────────────────────────────────

const generateCSRFToken = () => crypto.randomBytes(32).toString('hex');

const validateCSRFToken = (provided, expected) => {
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
};

module.exports = Object.freeze({
  hashPassword,
  verifyPassword,
  encryptField,
  decryptField,
  generateTokenPair,
  verifyToken,
  generateTOTPSecret,
  getTOTPUri,
  verifyTOTP,
  generateResetToken,
  validateResetToken,
  generateCSRFToken,
  validateCSRFToken,
});
