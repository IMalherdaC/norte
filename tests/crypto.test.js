/**
 * @test core/security/crypto — usa assinaturas reais
 */
'use strict';

process.env.JWT_SECRET     = 'test-jwt-secret-longo-para-validar-256bits-ok';
process.env.ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

const cryptoSvc = require('../core/security/crypto');

describe('hashPassword / verifyPassword (Argon2id)', () => {
  test('gera hash e verifica corretamente', async () => {
    const hr = await cryptoSvc.hashPassword('minhaSenhaSegura123');
    expect(hr.ok).toBe(true);
    const vr = await cryptoSvc.verifyPassword('minhaSenhaSegura123', hr.value);
    expect(vr.ok).toBe(true);
    expect(vr.value).toBe(true);
  });

  test('rejeita senha incorreta', async () => {
    const hr = await cryptoSvc.hashPassword('senhaCorreta123');
    const vr = await cryptoSvc.verifyPassword('senhaErrada999', hr.value);
    expect(vr.ok).toBe(true);
    expect(vr.value).toBe(false);
  });
});

describe('AES-256-GCM encrypt / decrypt', () => {
  test('cifra e decifra campo sensível', () => {
    const plain  = '999.999.999-99';
    const encR   = cryptoSvc.encryptField(plain);
    expect(encR.ok).toBe(true);
    const decR   = cryptoSvc.decryptField(encR.value);
    expect(decR.ok).toBe(true);
    expect(decR.value).toBe(plain);
  });

  test('ciphertext diferente para mesmo plaintext (IV aleatório)', () => {
    expect(cryptoSvc.encryptField('mesmo').value).not.toBe(cryptoSvc.encryptField('mesmo').value);
  });
});

describe('JWT generateTokenPair', () => {
  test('retorna { accessToken, refreshToken }', () => {
    const r = cryptoSvc.generateTokenPair({ userId: 'u1', role: 'user', sessionId: 's1' });
    expect(r.ok).toBe(true);
    expect(r.value.accessToken).toBeDefined();
    expect(r.value.refreshToken).toBeDefined();
  });

  test('verifyToken valida access token', () => {
    const pair   = cryptoSvc.generateTokenPair({ userId: 'u1', role: 'user', sessionId: 's1' });
    const result = cryptoSvc.verifyToken(pair.value.accessToken, 'access');
    expect(result.ok).toBe(true);
    expect(result.value.sub).toBe('u1');
  });

  test('rejeita token inválido', () => {
    expect(cryptoSvc.verifyToken('token.invalido.aqui', 'access').ok).toBe(false);
  });
});

describe('TOTP 2FA', () => {
  test('generateTOTPSecret retorna { secret, otpauthUrl }', () => {
    const r = cryptoSvc.generateTOTPSecret('user@norte.app');
    expect(r.secret).toBeDefined();
    expect(r.otpauthUrl).toContain('otpauth://totp');
  });

  test('verifyTOTP valida código gerado pelo authenticator', () => {
    const { authenticator } = require('otplib');
    const r    = cryptoSvc.generateTOTPSecret('user@norte.app');
    const code = authenticator.generate(r.secret);
    expect(cryptoSvc.verifyTOTP(code, r.secret)).toBe(true);
  });

  test('verifyTOTP rejeita código inválido (retorna false)', () => {
    const r = cryptoSvc.generateTOTPSecret('user@norte.app');
    expect(cryptoSvc.verifyTOTP('000000', r.secret)).toBe(false);
  });
});

describe('Reset token', () => {
  test('generateResetToken retorna token, hashedToken e expiresAt', () => {
    const r = cryptoSvc.generateResetToken();
    expect(r.token).toBeDefined();
    expect(r.hashedToken).toBeDefined();
    expect(r.token).not.toBe(r.hashedToken);
    expect(new Date(r.expiresAt) > new Date()).toBe(true);
  });
});

describe('CSRF token', () => {
  test('gera e valida token CSRF', () => {
    const token = cryptoSvc.generateCSRFToken();
    expect(cryptoSvc.validateCSRFToken(token, token)).toBe(true);
    expect(cryptoSvc.validateCSRFToken('errado', token)).toBe(false);
  });
});
