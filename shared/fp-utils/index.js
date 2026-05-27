/**
 * @module shared/fp-utils
 * @description Utilitários de Programação Funcional Pura.
 * Todas as funções são puras, sem efeitos colaterais e imutáveis.
 * ZERO classes, ZERO mutação direta de estado.
 */

'use strict';

// ─────────────────────────────────────────────
// COMPOSIÇÃO DE FUNÇÕES
// ─────────────────────────────────────────────

/**
 * Compõe funções da direita para a esquerda.
 * compose(f, g, h)(x) === f(g(h(x)))
 * @param {...Function} fns
 * @returns {Function}
 */
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x);

/**
 * Compõe funções da esquerda para a direita (pipeline).
 * pipe(f, g, h)(x) === h(g(f(x)))
 * @param {...Function} fns
 * @returns {Function}
 */
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x);

/**
 * Versão assíncrona do pipe para pipelines com Promises.
 * @param {...Function} fns
 * @returns {Function}
 */
const pipeAsync = (...fns) => (x) =>
  fns.reduce((acc, fn) => acc.then(fn), Promise.resolve(x));

// ─────────────────────────────────────────────
// FUNÇÕES DE ORDEM SUPERIOR
// ─────────────────────────────────────────────

/**
 * Currying manual — transforma f(a, b) em f(a)(b).
 * @param {Function} fn
 * @returns {Function}
 */
const curry = (fn) => {
  const arity = fn.length;
  return function curried(...args) {
    if (args.length >= arity) return fn(...args);
    return (...moreArgs) => curried(...args, ...moreArgs);
  };
};

/**
 * Memoização com cache Map (funções puras).
 * @param {Function} fn
 * @returns {Function}
 */
const memoize = (fn) => {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
};

/**
 * Aplica fn apenas se o valor não for null/undefined (Maybe Monad).
 * @param {Function} fn
 * @returns {Function}
 */
const maybe = (fn) => (value) => (value == null ? null : fn(value));

// ─────────────────────────────────────────────
// RESULT / EITHER — Tratamento Funcional de Erros
// ─────────────────────────────────────────────

const Ok  = (value)          => Object.freeze({ ok: true,  value });
const Err = (error, details = null) => Object.freeze({ ok: false, error, details });
const isOk = (result)        => result.ok === true;

/**
 * Aplica fn ao valor se Ok, propaga Err caso contrário.
 */
const mapResult = curry((fn, result) =>
  isOk(result) ? Ok(fn(result.value)) : result
);

/**
 * Encadeia Results (flatMap).
 */
const chainResult = curry((fn, result) =>
  isOk(result) ? fn(result.value) : result
);

// ─────────────────────────────────────────────
// IMUTABILIDADE
// ─────────────────────────────────────────────

const deepFreeze = (obj) => {
  if (typeof obj !== 'object' || obj === null) return obj;
  Object.keys(obj).forEach((key) => deepFreeze(obj[key]));
  return Object.freeze(obj);
};

const update = (obj, updates) => Object.freeze({ ...obj, ...updates });

const omit = curry((key, obj) => {
  const { [key]: _, ...rest } = obj;
  return Object.freeze(rest);
});

const pick = curry((keys, obj) =>
  Object.freeze(
    keys.reduce((acc, k) => (k in obj ? { ...acc, [k]: obj[k] } : acc), {})
  )
);

// ─────────────────────────────────────────────
// ARRAYS IMUTÁVEIS
// ─────────────────────────────────────────────

const append   = curry((item, arr) => Object.freeze([...arr, item]));
const removeAt = curry((index, arr) =>
  Object.freeze([...arr.slice(0, index), ...arr.slice(index + 1)])
);
const updateAt = curry((index, fn, arr) =>
  Object.freeze(arr.map((item, i) => (i === index ? fn(item) : item)))
);
const groupBy  = curry((keyFn, arr) =>
  Object.freeze(
    arr.reduce((acc, item) => {
      const key = keyFn(item);
      return { ...acc, [key]: [...(acc[key] || []), item] };
    }, {})
  )
);
const unique  = (arr) => Object.freeze([...new Set(arr)]);
const flatten = (arr) => Object.freeze(arr.reduce((acc, a) => [...acc, ...a], []));

// ─────────────────────────────────────────────
// MATEMÁTICA FINANCEIRA
// ─────────────────────────────────────────────

const toMoney   = (value) => Math.round(value * 100) / 100;
const roundCents = (n) => Math.round(Number(n) * 100) / 100;
const sumValues = (values) => toMoney(values.reduce((acc, v) => acc + v, 0));
const percentOf = curry((a, b) => (b === 0 ? 0 : toMoney((a / b) * 100)));

/**
 * PMT — Pagamento periódico de anuidade (simulação de metas com Selic).
 * @param {number} rate    Taxa por período (ex: 0.005 = 0,5%/mês)
 * @param {number} periods Número de períodos
 * @param {number} pv      Valor presente
 * @param {number} fvTarget Valor futuro alvo
 */
const pmt = (rate, periods, pv, fvTarget = 0) => {
  if (rate === 0) return toMoney(-(pv + fvTarget) / periods);
  const pvFactor = Math.pow(1 + rate, periods);
  return toMoney((rate * (pv * pvFactor + fvTarget)) / (1 - pvFactor));
};

/**
 * FV — Valor futuro de um investimento.
 */
const fv = (rate, periods, payment, pv) => {
  if (rate === 0) return toMoney(pv + payment * periods);
  const pvFactor = Math.pow(1 + rate, periods);
  return toMoney(-(pv * pvFactor + payment * ((pvFactor - 1) / rate)));
};

// ─────────────────────────────────────────────
// FORMATAÇÃO BRASILEIRA
// ─────────────────────────────────────────────

const formatBRL = (value, hideSensitive = false) => {
  if (hideSensitive) return 'R$ ••••••';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDateBR  = (date)  => new Intl.DateTimeFormat('pt-BR').format(new Date(date));
const formatPercent = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1 }).format(value);

// ─────────────────────────────────────────────
// HASH — Deduplicação de importações OFX/CSV
// ─────────────────────────────────────────────

const hashString = (str) => {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const hashTransaction = ({ date, amount, description }) =>
  hashString(`${date}|${amount}|${description.toLowerCase().trim()}`);

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  compose, pipe, pipeAsync, curry, memoize, maybe,
  Ok, Err, isOk, mapResult, chainResult,
  deepFreeze, update, omit, pick,
  append, removeAt, updateAt, groupBy, unique, flatten,
  roundCents, sumValues, toMoney, percentOf, pmt, fv,
  formatBRL, formatDateBR, formatPercent,
  hashString, hashTransaction,
});
