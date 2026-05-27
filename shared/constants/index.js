/**
 * @module shared/constants
 * @description Constantes imutáveis do domínio Norte.
 * Contexto brasileiro: PIX, MEI, Selic, categorias padrão.
 */

'use strict';

const { deepFreeze } = require('../fp-utils');

// ─────────────────────────────────────────────
// CATEGORIAS PADRÃO (Árvore 2 Níveis)
// ─────────────────────────────────────────────

const DEFAULT_CATEGORIES = deepFreeze([
  // DESPESAS
  {
    id: 'cat_food',
    name: 'Alimentação',
    type: 'expense',
    icon: '🍽️',
    color: '#F97316',
    subcategories: [
      { id: 'cat_food_restaurant', name: 'Restaurante', icon: '🍴' },
      { id: 'cat_food_grocery',    name: 'Mercado',     icon: '🛒' },
      { id: 'cat_food_delivery',   name: 'Delivery',    icon: '🛵' },
      { id: 'cat_food_bakery',     name: 'Padaria',     icon: '🥖' },
      { id: 'cat_food_snack',      name: 'Lanches',     icon: '🍔' },
    ],
  },
  {
    id: 'cat_transport',
    name: 'Transporte',
    type: 'expense',
    icon: '🚗',
    color: '#3B82F6',
    subcategories: [
      { id: 'cat_transport_uber',  name: 'Uber/99',     icon: '🚕' },
      { id: 'cat_transport_fuel',  name: 'Combustível', icon: '⛽' },
      { id: 'cat_transport_bus',   name: 'Ônibus/Metrô',icon: '🚌' },
      { id: 'cat_transport_maint', name: 'Manutenção',  icon: '🔧' },
      { id: 'cat_transport_park',  name: 'Estacionamento', icon: '🅿️' },
    ],
  },
  {
    id: 'cat_housing',
    name: 'Moradia',
    type: 'expense',
    icon: '🏠',
    color: '#8B5CF6',
    subcategories: [
      { id: 'cat_housing_rent',    name: 'Aluguel',     icon: '🏘️' },
      { id: 'cat_housing_condo',   name: 'Condomínio',  icon: '🏢' },
      { id: 'cat_housing_electric',name: 'Energia',     icon: '💡' },
      { id: 'cat_housing_water',   name: 'Água',        icon: '💧' },
      { id: 'cat_housing_internet',name: 'Internet/TV', icon: '📡' },
    ],
  },
  {
    id: 'cat_health',
    name: 'Saúde',
    type: 'expense',
    icon: '❤️',
    color: '#EF4444',
    subcategories: [
      { id: 'cat_health_plan',     name: 'Plano de Saúde', icon: '🏥' },
      { id: 'cat_health_medicine', name: 'Farmácia',   icon: '💊' },
      { id: 'cat_health_doctor',   name: 'Consultas',  icon: '👨‍⚕️' },
      { id: 'cat_health_gym',      name: 'Academia',   icon: '🏋️' },
    ],
  },
  {
    id: 'cat_education',
    name: 'Educação',
    type: 'expense',
    icon: '📚',
    color: '#10B981',
    subcategories: [
      { id: 'cat_edu_tuition',  name: 'Mensalidade',  icon: '🏫' },
      { id: 'cat_edu_course',   name: 'Cursos',       icon: '🎓' },
      { id: 'cat_edu_books',    name: 'Livros',       icon: '📖' },
    ],
  },
  {
    id: 'cat_leisure',
    name: 'Lazer',
    type: 'expense',
    icon: '🎮',
    color: '#EC4899',
    subcategories: [
      { id: 'cat_leisure_streaming', name: 'Streaming',  icon: '📺' },
      { id: 'cat_leisure_cinema',    name: 'Cinema/Teatro', icon: '🎬' },
      { id: 'cat_leisure_travel',    name: 'Viagens',    icon: '✈️' },
      { id: 'cat_leisure_games',     name: 'Jogos',      icon: '🕹️' },
    ],
  },
  {
    id: 'cat_personal',
    name: 'Pessoal',
    type: 'expense',
    icon: '👤',
    color: '#F59E0B',
    subcategories: [
      { id: 'cat_personal_beauty', name: 'Beleza/Higiene', icon: '💄' },
      { id: 'cat_personal_cloth',  name: 'Roupas',     icon: '👕' },
      { id: 'cat_personal_pet',    name: 'Pet',        icon: '🐾' },
    ],
  },
  {
    id: 'cat_finance',
    name: 'Financeiro',
    type: 'expense',
    icon: '💳',
    color: '#6B7280',
    subcategories: [
      { id: 'cat_finance_tax',  name: 'Impostos/Taxas', icon: '📋' },
      { id: 'cat_finance_ins',  name: 'Seguros',     icon: '🛡️' },
      { id: 'cat_finance_fee',  name: 'Tarifas Bancárias', icon: '🏦' },
      { id: 'cat_finance_debt', name: 'Dívidas',     icon: '📉' },
    ],
  },
  // RECEITAS
  {
    id: 'cat_income',
    name: 'Receitas',
    type: 'income',
    icon: '💰',
    color: '#22C55E',
    subcategories: [
      { id: 'cat_income_salary',   name: 'Salário',     icon: '💵' },
      { id: 'cat_income_freelance',name: 'Freelance',   icon: '💻' },
      { id: 'cat_income_invest',   name: 'Rendimentos', icon: '📈' },
      { id: 'cat_income_rental',   name: 'Aluguel Recebido', icon: '🏠' },
      { id: 'cat_income_bonus',    name: 'Bônus/13°',   icon: '🎁' },
      { id: 'cat_income_other',    name: 'Outros',      icon: '➕' },
    ],
  },
  // MEI/PJ
  {
    id: 'cat_mei',
    name: 'MEI/PJ',
    type: 'pj',
    icon: '🏢',
    color: '#0EA5E9',
    subcategories: [
      { id: 'cat_mei_revenue',   name: 'Receita PJ',      icon: '💼' },
      { id: 'cat_mei_das',       name: 'DAS (Imposto MEI)', icon: '📋' },
      { id: 'cat_mei_equipment', name: 'Equipamentos',    icon: '🖥️' },
      { id: 'cat_mei_service',   name: 'Serviços PJ',     icon: '🔧' },
    ],
  },
]);

// ─────────────────────────────────────────────
// MÉTODO 50/30/20
// ─────────────────────────────────────────────

const BUDGET_5030_20 = deepFreeze({
  needs:  { percentage: 0.50, label: 'Necessidades',    color: '#3B82F6' },
  wants:  { percentage: 0.30, label: 'Desejos',         color: '#F97316' },
  invest: { percentage: 0.20, label: 'Investir/Poupar', color: '#22C55E' },
});

// ─────────────────────────────────────────────
// TIPOS DE PAGAMENTO (tags de lançamento)
// ─────────────────────────────────────────────

const PAYMENT_TAGS = deepFreeze([
  { id: 'pix',     label: 'PIX',            icon: '⚡' },
  { id: 'debit',   label: 'Débito',         icon: '💳' },
  { id: 'credit',  label: 'Crédito',        icon: '💳' },
  { id: 'cash',    label: 'Dinheiro',       icon: '💵' },
  { id: 'ted',     label: 'TED/DOC',        icon: '🏦' },
  { id: 'boleto',  label: 'Boleto',         icon: '📄' },
  { id: 'voucher', label: 'Vale-refeição',  icon: '🎫' },
]);

// ─────────────────────────────────────────────
// SEGURANÇA E JWT
// ─────────────────────────────────────────────

const SECURITY = deepFreeze({
  JWT_ACCESS_EXPIRY:  '15m',           // 15 minutos (curto, conforme requisito)
  JWT_REFRESH_EXPIRY: '30d',           // 30 dias (refresh rotativo)
  PASSWORD_MIN_LENGTH: 10,
  RESET_LINK_EXPIRY_MINUTES: 30,
  ARGON2_MEMORY_COST: 65536,           // 64 MB
  ARGON2_TIME_COST:   3,
  ARGON2_PARALLELISM: 4,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_MINUTES:    15,
});

// ─────────────────────────────────────────────
// ALERTAS DE ORÇAMENTO
// ─────────────────────────────────────────────

const BUDGET_THRESHOLDS = deepFreeze({
  WARNING:  0.80,   // 80% — alerta amarelo
  EXCEEDED: 1.00,   // 100% — alerta vermelho
});

// ─────────────────────────────────────────────
// IMPOSTOS MEI (2025)
// ─────────────────────────────────────────────

const MEI_TAX_RATES = deepFreeze({
  COMMERCE_INDUSTRY: { rate: 0.06, label: 'Comércio/Indústria (6%)' },
  SERVICE:           { rate: 0.11, label: 'Serviços (11%)' },
  MIXED:             { rate: 0.11, label: 'Comércio + Serviços (11%)' },
  DAS_FIXED: {
    inss: 75.90,    // valor fixo INSS (2025)
    icms: 1.00,     // opcional
    iss:  5.00,     // opcional
  },
});

// ─────────────────────────────────────────────
// CORES DO SISTEMA
// ─────────────────────────────────────────────

const COLORS = deepFreeze({
  success:  '#22C55E',
  warning:  '#F59E0B',
  danger:   '#EF4444',
  info:     '#3B82F6',
  primary:  '#6366F1',
  neutral:  '#6B7280',
  income:   '#22C55E',
  expense:  '#EF4444',
  transfer: '#3B82F6',
});

// ─────────────────────────────────────────────
// TIPOS DE INVESTIMENTO
// ─────────────────────────────────────────────

const INVESTMENT_TYPES = deepFreeze([
  { id: 'tesouro_direto', label: 'Tesouro Direto',   class: 'fixed_income', icon: '🏛️' },
  { id: 'cdb',            label: 'CDB',               class: 'fixed_income', icon: '🏦' },
  { id: 'lci_lca',        label: 'LCI/LCA',           class: 'fixed_income', icon: '🌱' },
  { id: 'cri_cra',        label: 'CRI/CRA',           class: 'fixed_income', icon: '📜' },
  { id: 'debenture',      label: 'Debêntures',        class: 'fixed_income', icon: '📋' },
  { id: 'acoes',          label: 'Ações',             class: 'variable',     icon: '📈' },
  { id: 'fii',            label: 'Fundos Imobiliários (FII)', class: 'variable', icon: '🏢' },
  { id: 'etf',            label: 'ETF',               class: 'variable',     icon: '📊' },
  { id: 'cripto',         label: 'Criptomoedas',      class: 'variable',     icon: '₿' },
  { id: 'prev_privada',   label: 'Previdência Privada', class: 'pension',    icon: '🏖️' },
  { id: 'poupanca',       label: 'Poupança',          class: 'fixed_income', icon: '🐖' },
]);

module.exports = Object.freeze({
  DEFAULT_CATEGORIES,
  BUDGET_5030_20,
  PAYMENT_TAGS,
  SECURITY,
  BUDGET_THRESHOLDS,
  MEI_TAX_RATES,
  COLORS,
  INVESTMENT_TYPES,
});
