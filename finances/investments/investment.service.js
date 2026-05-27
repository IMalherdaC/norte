/**
 * @module finances/investments/investment.service
 * @description Serviço funcional puro para gestão de posições de investimentos (E07).
 *
 * Paradigma: funções puras + injeção de dependência.
 * ZERO classes. ZERO mutação de estado global.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { Ok, Err, groupBy, roundCents } = require('../../shared');
const { execute, queryOne, queryAll, withTransaction } = require('../../database/connection');

// ─────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────

const ASSET_CLASSES = Object.freeze([
  'fixed_income', 'variable', 'fii', 'crypto', 'pension', 'other',
]);

// ─────────────────────────────────────────────
// FUNÇÕES PURAS — CÁLCULOS
// ─────────────────────────────────────────────

/**
 * Calcula o valor atual de uma posição.
 * - Renda variável: quantity * currentPrice
 * - Demais: currentValue direto
 * @param {{ assetClass, quantity, currentPrice, currentValue }} pos
 * @returns {number}
 */
const calcPositionCurrentValue = (pos) =>
  pos.assetClass === 'variable'
    ? roundCents(pos.quantity * pos.currentPrice)
    : roundCents(pos.currentValue);

/**
 * Calcula rentabilidade absoluta e percentual de uma posição.
 * @param {{ quantity, avgPrice, assetClass, currentPrice, currentValue }} pos
 * @returns {{ invested: number, current: number, returnAbs: number, returnPct: number }}
 */
const calcPositionReturn = (pos) => {
  const invested = roundCents(pos.quantity * pos.avgPrice);
  const current  = calcPositionCurrentValue(pos);
  const returnAbs = roundCents(current - invested);
  const returnPct = invested > 0 ? roundCents((returnAbs / invested) * 100) : 0;
  return Object.freeze({ invested, current, returnAbs, returnPct });
};

/**
 * Agrega posições por classe de ativo para gráfico de alocação.
 * @param {Array} positions
 * @returns {Array<{ assetClass, totalValue, percentage }>}
 */
const buildAllocationData = (positions) => {
  const totalPatrimony = positions.reduce(
    (sum, p) => sum + calcPositionCurrentValue(p), 0
  );
  const grouped = groupBy(positions, (p) => p.assetClass);

  return Object.entries(grouped).map(([assetClass, items]) => {
    const totalValue = items.reduce((s, p) => s + calcPositionCurrentValue(p), 0);
    const percentage = totalPatrimony > 0
      ? roundCents((totalValue / totalPatrimony) * 100)
      : 0;
    return Object.freeze({ assetClass, totalValue: roundCents(totalValue), percentage });
  });
};

/**
 * Calcula score de diversificação (0–100).
 * Penaliza concentração excessiva em uma única classe (Herfindahl-Hirschman adaptado).
 * @param {Array} allocationData
 * @returns {number}
 */
const calcDiversificationScore = (allocationData) => {
  if (!allocationData.length) return 0;
  const hhi = allocationData.reduce(
    (sum, a) => sum + (a.percentage / 100) ** 2, 0
  );
  // HHI perfeito = 1/n, HHI máximo = 1 (concentrado)
  const maxHHI  = 1;
  const idealHHI = 1 / Math.max(allocationData.length, 1);
  const score   = Math.max(0, Math.min(100,
    (1 - (hhi - idealHHI) / (maxHHI - idealHHI)) * 100
  ));
  return Math.round(score);
};

/**
 * Gera série histórica simulada de evolução patrimonial.
 * Em produção, este dado viria de snapshots mensais armazenados.
 * @param {Array} positions
 * @param {number} months — 12, 24 ou 36
 * @returns {Array<{ month: string, totalValue: number, contributions: number, returns: number }>}
 */
const buildEvolutionSeries = (positions, months = 12) => {
  const currentTotal = positions.reduce((s, p) => s + calcPositionCurrentValue(p), 0);
  const now = new Date();

  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - (months - 1 - i));
    const month = d.toISOString().slice(0, 7); // YYYY-MM

    // Interpolação linear simples + ruído pequeno para demo
    const progress     = (i + 1) / months;
    const contributions = roundCents(currentTotal * 0.75 * progress);
    const returns       = roundCents(currentTotal * 0.25 * progress);
    const totalValue    = roundCents(contributions + returns);

    return Object.freeze({ month, totalValue, contributions, returns });
  });
};

// ─────────────────────────────────────────────
// REPOSITÓRIO INLINE (sem ORM, ACID)
// ─────────────────────────────────────────────

const ensureTable = () => {
  execute(`
    CREATE TABLE IF NOT EXISTS investments (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      ticker        TEXT NOT NULL,
      asset_class   TEXT NOT NULL,
      quantity      REAL NOT NULL DEFAULT 0,
      avg_price     REAL NOT NULL DEFAULT 0,
      current_price REAL NOT NULL DEFAULT 0,
      current_value REAL NOT NULL DEFAULT 0,
      purchase_date TEXT,
      entity_type   TEXT NOT NULL DEFAULT 'pf',
      notes         TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    )
  `);
};

const mapRow = (row) => row ? Object.freeze({
  id:           row.id,
  userId:       row.user_id,
  ticker:       row.ticker,
  assetClass:   row.asset_class,
  quantity:     row.quantity,
  avgPrice:     row.avg_price,
  currentPrice: row.current_price,
  currentValue: row.current_value,
  purchaseDate: row.purchase_date,
  entityType:   row.entity_type,
  notes:        row.notes,
  createdAt:    row.created_at,
  updatedAt:    row.updated_at,
}) : null;

// ─────────────────────────────────────────────
// SERVIÇOS (funções assíncronas com injeção)
// ─────────────────────────────────────────────

/**
 * Lista posições do usuário com cálculos de retorno embutidos.
 */
const listPositions = async ({ userId, entityType = 'all' }) => {
  try {
    ensureTable();
    const rows = entityType === 'all'
      ? queryAll('SELECT * FROM investments WHERE user_id = ? ORDER BY asset_class, ticker', [userId])
      : queryAll('SELECT * FROM investments WHERE user_id = ? AND entity_type = ? ORDER BY asset_class, ticker', [userId, entityType]);

    const positions = rows.map(mapRow).map((p) => {
      const ret = calcPositionReturn(p);
      return Object.freeze({ ...p, ...ret });
    });

    return Ok(positions);
  } catch (e) {
    return Err('Falha ao listar posições', e.message);
  }
};

/**
 * Adiciona nova posição manual.
 */
const addPosition = async ({ userId, ticker, assetClass, quantity = 1, avgPrice = 0,
  currentPrice = 0, currentValue = 0, purchaseDate, entityType = 'pf', notes = '' }) => {
  if (!ticker?.trim())              return Err('Nome ou ticker obrigatório');
  if (!ASSET_CLASSES.includes(assetClass)) return Err('Classe de ativo inválida');
  if (quantity < 0)                 return Err('Quantidade não pode ser negativa');

  ensureTable();
  const now = new Date().toISOString();
  const id  = uuidv4();

  execute(
    `INSERT INTO investments(id, user_id, ticker, asset_class, quantity, avg_price,
       current_price, current_value, purchase_date, entity_type, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, userId, ticker.toUpperCase(), assetClass, quantity, avgPrice,
     currentPrice, currentValue, purchaseDate || null, entityType, notes, now, now]
  );

  const row = queryOne('SELECT * FROM investments WHERE id = ?', [id]);
  return Ok(mapRow(row));
};

/**
 * Atualiza posição existente (cotação, quantidade, notas).
 */
const updatePosition = async ({ positionId, userId, updates }) => {
  ensureTable();
  const existing = queryOne('SELECT * FROM investments WHERE id = ? AND user_id = ?', [positionId, userId]);
  if (!existing) return Err('Posição não encontrada');

  const now = new Date().toISOString();
  const allowed = ['ticker', 'quantity', 'avg_price', 'current_price', 'current_value', 'notes', 'entity_type'];

  const sets   = [];
  const params = [];

  // Mapeia camelCase → snake_case
  const fieldMap = {
    ticker: 'ticker', quantity: 'quantity', avgPrice: 'avg_price',
    currentPrice: 'current_price', currentValue: 'current_value',
    notes: 'notes', entityType: 'entity_type',
  };

  Object.entries(updates).forEach(([k, v]) => {
    const col = fieldMap[k];
    if (col && allowed.includes(col)) { sets.push(`${col} = ?`); params.push(v); }
  });

  if (!sets.length) return Err('Nenhum campo válido para atualizar');

  sets.push('updated_at = ?');
  params.push(now, positionId);

  execute(`UPDATE investments SET ${sets.join(', ')} WHERE id = ?`, params);

  const row = queryOne('SELECT * FROM investments WHERE id = ?', [positionId]);
  const pos = mapRow(row);
  return Ok(Object.freeze({ ...pos, ...calcPositionReturn(pos) }));
};

/**
 * Remove posição.
 */
const removePosition = async ({ positionId, userId }) => {
  ensureTable();
  const existing = queryOne('SELECT id FROM investments WHERE id = ? AND user_id = ?', [positionId, userId]);
  if (!existing) return Err('Posição não encontrada');
  execute('DELETE FROM investments WHERE id = ?', [positionId]);
  return Ok({ deleted: true });
};

/**
 * Retorna dados para gráfico de alocação (pizza/donut).
 */
const getAllocationChart = async ({ userId }) => {
  const result = await listPositions({ userId });
  if (!result.ok) return result;
  const data  = buildAllocationData(result.value);
  const score = calcDiversificationScore(data);
  return Ok(Object.freeze({ allocation: data, diversificationScore: score }));
};

/**
 * Retorna série de evolução patrimonial.
 */
const getPatrimonyEvolution = async ({ userId, months = 12 }) => {
  const result = await listPositions({ userId });
  if (!result.ok) return result;
  const series = buildEvolutionSeries(result.value, months);
  return Ok(series);
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  // Funções puras (testáveis isoladamente)
  calcPositionCurrentValue,
  calcPositionReturn,
  buildAllocationData,
  calcDiversificationScore,
  buildEvolutionSeries,
  // Serviços (com I/O)
  listPositions,
  addPosition,
  updatePosition,
  removePosition,
  getAllocationChart,
  getPatrimonyEvolution,
});
