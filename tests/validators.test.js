/**
 * @test shared/validators — usa assinaturas reais
 */
'use strict';

const v = require('../shared/validators');

describe('isEmail', () => {
  test('aceita e-mail válido', () => expect(v.isEmail('user@norte.app').ok).toBe(true));
  test('rejeita e-mail sem @',  () => expect(v.isEmail('invalido').ok).toBe(false));
  test('rejeita e-mail sem domínio', () => expect(v.isEmail('user@').ok).toBe(false));
  // validators retorna o valor como foi passado (não normaliza case — comportamento real)
  test('aceita e-mail em maiúsculas', () => {
    const r = v.isEmail('USER@NORTE.APP');
    expect(r.ok).toBe(true);
  });
});

describe('validateAuthCredentials — senha ≥ 10 chars', () => {
  test('aceita credenciais válidas (10+ chars)', () => {
    const r = v.validateAuthCredentials({ email: 'user@norte.app', password: 'minhasenha123' });
    expect(r.ok).toBe(true);
  });
  test('rejeita senha curta (< 10 chars)', () => {
    const r = v.validateAuthCredentials({ email: 'user@norte.app', password: '123456' });
    expect(r.ok).toBe(false);
  });
  test('rejeita e-mail inválido', () => {
    const r = v.validateAuthCredentials({ email: 'invalido', password: 'senha12345' });
    expect(r.ok).toBe(false);
  });
});

describe('isCPF', () => {
  test('aceita CPF válido', ()        => expect(v.isCPF('529.982.247-25').ok).toBe(true));
  test('rejeita sequências iguais', () => expect(v.isCPF('111.111.111-11').ok).toBe(false));
  test('rejeita CPF inválido',      () => expect(v.isCPF('000.000.000-00').ok).toBe(false));
  test('aceita CPF sem formatação', () => expect(v.isCPF('52998224725').ok).toBe(true));
});

describe('sanitizeText', () => {
  test('escapa tags HTML', () => {
    const clean = v.sanitizeText('<script>alert(1)</script>');
    expect(clean).not.toContain('<script>');
    expect(clean).toContain('&lt;');
  });
  test('escapa aspas duplas', () => {
    const clean = v.sanitizeText('"test"');
    expect(clean).toContain('&quot;');
  });
  test('preserva texto normal', () => {
    expect(v.sanitizeText('Café com leite')).toBe('Café com leite');
  });
});

describe('validateTransaction', () => {
  test('aceita lançamento válido', () => {
    const r = v.validateTransaction({
      amount: 45.90, type: 'expense', walletId: 'w1', categoryId: 'c1', date: '2026-05-21',
    });
    expect(r.ok).toBe(true);
  });
  test('rejeita valor negativo', () => {
    const r = v.validateTransaction({ amount: -10, type: 'expense', walletId: 'w1', categoryId: 'c1', date: '2026-05-21' });
    expect(r.ok).toBe(false);
  });
  test('rejeita tipo inválido', () => {
    const r = v.validateTransaction({ amount: 10, type: 'invalido', walletId: 'w1', categoryId: 'c1', date: '2026-05-21' });
    expect(r.ok).toBe(false);
  });
});
