/**
 * @test fp-utils
 */
'use strict';

const fp = require('../shared/fp-utils');

describe('pipe / compose', () => {
  const add10  = x => x + 10;
  const double = x => x * 2;

  test('pipe aplica funções da esquerda para a direita', () => {
    expect(fp.pipe(add10, double)(5)).toBe(30);  // (5+10)*2
  });

  test('compose aplica funções da direita para a esquerda', () => {
    expect(fp.compose(add10, double)(5)).toBe(20); // double(5)=10, add10(10)=20
  });

  test('pipe com um único argumento é identidade', () => {
    expect(fp.pipe(x => x)(42)).toBe(42);
  });
});

describe('curry', () => {
  test('curried function funciona parcialmente', () => {
    const add = fp.curry((a, b) => a + b);
    expect(add(2)(3)).toBe(5);
    expect(add(2, 3)).toBe(5);
  });
});

describe('memoize', () => {
  test('retorna resultado em cache na segunda chamada', () => {
    let calls = 0;
    const fn  = fp.memoize((n) => { calls++; return n * 2; });
    expect(fn(4)).toBe(8);
    expect(fn(4)).toBe(8);
    expect(calls).toBe(1); // só uma execução real
  });
});

describe('Result monad', () => {
  test('Ok wraps valor', () => {
    const r = fp.Ok(42);
    expect(fp.isOk(r)).toBe(true);
    expect(r.value).toBe(42);
  });

  test('Err wraps erro', () => {
    const r = fp.Err('falhou');
    expect(fp.isOk(r)).toBe(false);
    expect(r.error).toBe('falhou');
  });
});

describe('groupBy', () => {
  test('agrupa corretamente por chave', () => {
    const items = [
      { cat: 'A', v: 1 }, { cat: 'B', v: 2 }, { cat: 'A', v: 3 },
    ];
    const grouped = fp.groupBy(x => x.cat)(items);
    expect(grouped.A).toHaveLength(2);
    expect(grouped.B).toHaveLength(1);
  });
});

describe('formatBRL', () => {
  test('formata valor em reais', () => {
    expect(fp.formatBRL(1234.56)).toContain('1.234,56');
  });

  test('modo privacidade oculta valor', () => {
    expect(fp.formatBRL(999, true)).toBe('R$ ••••••');
  });
});

describe('toMoney', () => {
  test('arredonda para 2 casas decimais', () => {
    expect(fp.toMoney(12.345)).toBe(12.35);
    expect(fp.toMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe('PMT financeiro', () => {
  test('calcula parcela mensal para meta de R$10.000 em 12 meses', () => {
    const selic   = 0.105;
    const monthly = Math.pow(1 + selic, 1 / 12) - 1;
    const payment = Math.abs(fp.pmt(monthly, 12, 0, -10000));
    expect(payment).toBeGreaterThan(780);
    expect(payment).toBeLessThan(820);
  });

  test('pmt com taxa 0 divide igualmente', () => {
    const p = fp.pmt(0, 12, 0, -1200);
    expect(Math.abs(p)).toBeCloseTo(100, 1);
  });
});

describe('hashTransaction (deduplicação)', () => {
  test('mesmo hash para mesma transação independente de case', () => {
    const h1 = fp.hashTransaction({ date: '2026-05-21', amount: 45.90, description: 'iFood' });
    const h2 = fp.hashTransaction({ date: '2026-05-21', amount: 45.90, description: 'IFOOD' });
    expect(h1).toBe(h2);
  });

  test('hash diferente para transações distintas', () => {
    const h1 = fp.hashTransaction({ date: '2026-05-21', amount: 45.90, description: 'iFood' });
    const h2 = fp.hashTransaction({ date: '2026-05-21', amount: 50.00, description: 'iFood' });
    expect(h1).not.toBe(h2);
  });
});
