/**
 * @module ui/utils/app.js
 * @description Módulo JS funcional do frontend Norte.
 * Lógica de UI, estado, roteamento e integração com a API.
 * Paradigma 100% funcional — ZERO classes.
 */

'use strict';

// ─────────────────────────────────────────────
// ESTADO DA APLICAÇÃO (imutável via closures)
// ─────────────────────────────────────────────

/**
 * Store funcional simples inspirado em Redux.
 * Estado nunca é mutado diretamente — apenas via dispatch.
 * @param {object} initialState
 * @param {Function} reducer
 */
const createStore = (initialState, reducer) => {
  let state     = Object.freeze({ ...initialState });
  const listeners = [];

  const getState  = () => state;
  const subscribe = (fn) => { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); };
  const dispatch  = (action) => {
    state = Object.freeze(reducer(state, action));
    listeners.forEach((fn) => fn(state));
  };

  return Object.freeze({ getState, subscribe, dispatch });
};

// ─── Reducer puro ───
const appReducer = (state, action) => {
  switch (action.type) {
    case 'SET_PAGE':          return { ...state, activePage: action.payload };
    case 'TOGGLE_PRIVACY':    return { ...state, privacyMode: !state.privacyMode };
    case 'TOGGLE_DARK_MODE':  return { ...state, darkMode: !state.darkMode };
    case 'TOGGLE_MEI':        return { ...state, meiMode: !state.meiMode };
    case 'SET_TRANSACTIONS':  return { ...state, transactions: action.payload };
    case 'SET_WALLETS':       return { ...state, wallets: action.payload };
    case 'SET_BUDGETS':       return { ...state, budgets: action.payload };
    case 'SET_GOALS':         return { ...state, goals: action.payload };
    case 'SET_LOADING':       return { ...state, loading: action.payload };
    case 'SET_ERROR':         return { ...state, error: action.payload };
    default:                  return state;
  }
};

// ─── Estado inicial ───
const store = createStore(
  {
    activePage:   'dashboard',
    privacyMode:  false,
    darkMode:     localStorage.getItem('norte-theme') === 'dark',
    meiMode:      false,
    transactions: [],
    wallets:      [],
    budgets:      [],
    goals:        [],
    loading:      false,
    error:        null,
  },
  appReducer
);

// ─────────────────────────────────────────────
// API CLIENT (funcional)
// ─────────────────────────────────────────────

const BASE_URL = '/api/v1';

/**
 * Wrapper de fetch com tratamento de erros.
 * @param {string} endpoint
 * @param {RequestInit} options
 * @returns {Promise<{ ok: boolean, data?: any, error?: string }>}
 */
const apiFetch = async (endpoint, options = {}) => {
  const token = localStorage.getItem('norte-access-token');
  const defaultHeaders = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: { ...defaultHeaders, ...(options.headers || {}) },
    });

    // Token expirado — tentar refresh
    if (response.status === 401) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) return apiFetch(endpoint, options);
      window.location.href = '/auth';
      return { ok: false, error: 'Sessão expirada' };
    }

    const data = await response.json();
    return response.ok
      ? { ok: true, data }
      : { ok: false, error: data.message || 'Erro desconhecido' };
  } catch (err) {
    return { ok: false, error: 'Erro de conexão. Verifique sua internet.' };
  }
};

const apiGet    = (endpoint) => apiFetch(endpoint, { method: 'GET' });
const apiPost   = (endpoint, body) => apiFetch(endpoint, { method: 'POST',   body: JSON.stringify(body) });
const apiPut    = (endpoint, body) => apiFetch(endpoint, { method: 'PUT',    body: JSON.stringify(body) });
const apiDelete = (endpoint)       => apiFetch(endpoint, { method: 'DELETE' });

/**
 * Tenta renovar o access token via refresh token.
 * @returns {Promise<boolean>}
 */
const attemptTokenRefresh = async () => {
  const refreshToken = localStorage.getItem('norte-refresh-token');
  if (!refreshToken) return false;
  try {
    const res  = await fetch(`${BASE_URL}/auth/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const { accessToken, refreshToken: newRefresh } = await res.json();
    localStorage.setItem('norte-access-token',  accessToken);
    localStorage.setItem('norte-refresh-token', newRefresh);
    return true;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
// SERVIÇOS DE API
// ─────────────────────────────────────────────

const TransactionsAPI = Object.freeze({
  list:   (filters = {}) => apiGet(`/transactions?${new URLSearchParams(filters)}`),
  create: (data)         => apiPost('/transactions', data),
  update: (id, data)     => apiPut(`/transactions/${id}`, data),
  delete: (id)           => apiDelete(`/transactions/${id}`),
  undo:   (id, token)    => apiPost(`/transactions/${id}/undo`, { deletionToken: token }),
  import: (formData)     => fetch(`${BASE_URL}/transactions/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('norte-access-token')}` },
    body: formData,
  }).then((r) => r.json()),
});

const WalletsAPI = Object.freeze({
  list:    ()          => apiGet('/wallets'),
  create:  (data)      => apiPost('/wallets', data),
  archive: (id)        => apiPut(`/wallets/${id}/archive`, {}),
});

const BudgetsAPI = Object.freeze({
  getStatus:    (month)      => apiGet(`/budgets/status?month=${month}`),
  upsert:       (data)       => apiPost('/budgets', data),
  apply503020:  (netIncome, month) => apiPost('/budgets/apply-503020', { netIncome, month }),
  getProjection:(month)      => apiGet(`/budgets/projection?month=${month}`),
});

const GoalsAPI = Object.freeze({
  list:       ()               => apiGet('/goals'),
  create:     (data)           => apiPost('/goals', data),
  contribute: (id, amount)     => apiPost(`/goals/${id}/contribute`, { amount }),
  simulate:   (id, selicRate)  => apiGet(`/goals/${id}/simulation?selicRate=${selicRate || ''}`),
});

const ReportsAPI = Object.freeze({
  cashFlow:    (start, end)  => apiGet(`/reports/cashflow?startDate=${start}&endDate=${end}`),
  compare:     (month)       => apiGet(`/reports/comparison?month=${month}`),
  anomalies:   (month)       => apiGet(`/reports/anomalies?month=${month}`),
  patrimony:   (months = 12) => apiGet(`/reports/patrimony?months=${months}`),
  healthScore: ()            => apiGet('/reports/health-score'),
  exportData:  ()            => fetch(`${BASE_URL}/lgpd/export`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('norte-access-token')}` },
  }),
});

// ─────────────────────────────────────────────
// FORMATAÇÃO (funções puras)
// ─────────────────────────────────────────────

const formatBRL = (value, hide = false) => {
  if (hide) return 'R$\u00A0••••••';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

const formatDate = (isoDate) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(isoDate));

const formatMonth = (yearMonth) => {
  const [y, m] = yearMonth.split('-');
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(new Date(Number(y), Number(m) - 1));
};

const formatPercent = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1 }).format(value / 100);

// ─────────────────────────────────────────────
// RENDERIZAÇÃO REATIVA
// ─────────────────────────────────────────────

/**
 * Atualiza todos os elementos .balance-value com base no modo privacidade.
 */
const renderBalances = (privacyMode) => {
  document.querySelectorAll('.balance-value').forEach((el) => {
    const raw = el.dataset.value;
    if (raw != null) {
      el.textContent = formatBRL(Number(raw), privacyMode);
    }
  });
};

/**
 * Renderiza a lista de transações recentes no dashboard.
 * @param {object[]} transactions
 * @param {boolean} privacyMode
 */
const renderRecentTransactions = (transactions, privacyMode) => {
  const container = document.getElementById('recent-transactions');
  if (!container) return;

  if (!transactions.length) {
    container.innerHTML = `
      <li class="text-center py-8 text-sm" style="color:var(--text-muted);">
        <span class="text-3xl block mb-2">📭</span>
        Nenhum lançamento ainda. Adicione o primeiro!
      </li>`;
    return;
  }

  const items = transactions.slice(0, 5).map((tx) => {
    const isExpense  = tx.type === 'expense';
    const amountSign = isExpense ? '-' : '+';
    const amountColor= isExpense ? 'text-danger' : 'text-success';
    const amount     = formatBRL(tx.amount, privacyMode);

    return `
      <li class="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group"
          data-tx-id="${tx.id}">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
             style="background:${tx.categoryColor}20;">${tx.categoryIcon || '💰'}</div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium truncate" style="color:var(--text-main);">${tx.description}</p>
          <p class="text-xs" style="color:var(--text-muted);">${tx.categoryName} · ${formatDate(tx.date)}</p>
        </div>
        <div class="text-right flex-shrink-0">
          <p class="text-sm font-semibold ${amountColor}">${amountSign} ${amount}</p>
          ${tx.tags?.map((tag) => `<span class="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700" style="color:var(--text-muted);">${tag}</span>`).join('') || ''}
        </div>
      </li>`;
  }).join('');

  container.innerHTML = items;
};

/**
 * Renderiza barras de orçamento.
 * @param {object[]} budgets
 */
const renderBudgetBars = (budgets) => {
  const container = document.querySelector('.space-y-4[data-budgets]');
  if (!container) return;

  const getColor  = (status) => ({ ok: '#22C55E', warning: '#F59E0B', exceeded: '#EF4444' }[status] || '#6B7280');
  const getIcon   = (status) => ({ ok: '✅', warning: '⚠️', exceeded: '🔴' }[status] || '');
  const getMessage = (b) => {
    if (b.status === 'exceeded') return `🔴 Excedido em R$\u00A0${Math.abs(b.remainingAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}!`;
    if (b.status === 'warning')  return `⚠️ ${b.usagePercent}% — Atenção! R$\u00A0${b.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} restantes`;
    return `✅ ${b.usagePercent}% — R$\u00A0${b.remainingAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} disponíveis`;
  };

  container.innerHTML = budgets.map((b) => `
    <div>
      <div class="flex justify-between items-center mb-1.5">
        <div class="flex items-center gap-2">
          <span>${b.categoryIcon}</span>
          <span class="text-sm font-medium" style="color:var(--text-main);">${b.categoryName}</span>
        </div>
        <div class="text-right">
          <span class="text-sm font-semibold" style="color:var(--text-main);">${formatBRL(b.spentAmount)}</span>
          <span class="text-xs" style="color:var(--text-muted);"> / ${formatBRL(b.limitAmount)}</span>
        </div>
      </div>
      <div class="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div class="h-full rounded-full progress-bar" style="width:${Math.min(100, b.usagePercent)}%; background:${getColor(b.status)};"></div>
      </div>
      <p class="text-xs mt-1" style="color:${getColor(b.status)};">${getMessage(b)}</p>
    </div>`).join('');
};

// ─────────────────────────────────────────────
// GRÁFICO DE DONUT (Alocação de Investimentos)
// Canvas API puro — sem dependências externas
// ─────────────────────────────────────────────

/**
 * Desenha um gráfico donut em um elemento canvas.
 * @param {string} canvasId
 * @param {Array<{ label: string, value: number, color: string }>} data
 */
const drawDonutChart = (canvasId, data) => {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const W      = canvas.width;
  const H      = canvas.height;
  const cx     = W / 2, cy = H / 2;
  const outerR = Math.min(W, H) / 2 - 10;
  const innerR = outerR * 0.6;

  ctx.clearRect(0, 0, W, H);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  let startAngle = -Math.PI / 2;

  data.forEach(({ value, color }) => {
    const sweep = (value / total) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, outerR, startAngle, startAngle + sweep);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    startAngle += sweep;
  });

  // Buraco do donut
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-card') || '#fff';
  ctx.fill();

  // Total no centro
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-main') || '#000';
  ctx.font      = `bold ${Math.round(outerR * 0.22)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(formatBRL(total), cx, cy);
};

/**
 * Desenha um gráfico de linha para evolução patrimonial.
 * @param {string} canvasId
 * @param {{ labels: string[], datasets: Array<{ label, data, color }> }} chartData
 */
const drawLineChart = (canvasId, chartData) => {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.width;
  const H   = canvas.height;
  const PAD = 40;

  ctx.clearRect(0, 0, W, H);

  const allValues = chartData.datasets.flatMap((d) => d.data);
  const minVal    = Math.min(...allValues);
  const maxVal    = Math.max(...allValues);
  const range     = maxVal - minVal || 1;
  const cols      = chartData.labels.length - 1;

  const toX = (i)   => PAD + (i / cols) * (W - PAD * 2);
  const toY = (val) => H - PAD - ((val - minVal) / range) * (H - PAD * 2);

  // Grid lines
  ctx.strokeStyle = 'rgba(148,163,184,0.2)';
  ctx.lineWidth   = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD + (i / 4) * (H - PAD * 2);
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();
  }

  // Datasets
  chartData.datasets.forEach(({ data, color }) => {
    // Área preenchida
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(data[0]));
    data.forEach((val, i) => ctx.lineTo(toX(i), toY(val)));
    ctx.lineTo(toX(data.length - 1), H - PAD);
    ctx.lineTo(toX(0), H - PAD);
    ctx.closePath();
    ctx.fillStyle = `${color}18`;
    ctx.fill();

    // Linha
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(data[0]));
    data.forEach((val, i) => ctx.lineTo(toX(i), toY(val)));
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Pontos
    data.forEach((val, i) => {
      ctx.beginPath();
      ctx.arc(toX(i), toY(val), 4, 0, 2 * Math.PI);
      ctx.fillStyle   = color;
      ctx.fill();
    });
  });

  // Labels do eixo X
  ctx.fillStyle    = 'rgba(100,116,139,0.8)';
  ctx.font         = '11px Inter, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  chartData.labels.forEach((label, i) => {
    if (i % Math.ceil(chartData.labels.length / 6) === 0) {
      ctx.fillText(label, toX(i), H - PAD + 6);
    }
  });
};

// ─────────────────────────────────────────────
// INICIALIZAÇÃO DA APP
// ─────────────────────────────────────────────

const initApp = async () => {
  // Aplica tema salvo
  if (store.getState().darkMode) {
    document.documentElement.classList.add('dark');
  }

  // Subscribe ao store para re-renderizar
  store.subscribe((state) => {
    renderBalances(state.privacyMode);
  });

  // Carrega dados do dashboard
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Paralelo: wallets + budgets + health score
  const [walletsRes, budgetsRes] = await Promise.all([
    WalletsAPI.list(),
    BudgetsAPI.getStatus(currentMonth),
  ]);

  if (walletsRes.ok)  store.dispatch({ type: 'SET_WALLETS',  payload: walletsRes.data });
  if (budgetsRes.ok)  store.dispatch({ type: 'SET_BUDGETS',  payload: budgetsRes.data });
};

// Exporta para acesso no script inline do HTML
window.NorteApp = Object.freeze({
  store,
  TransactionsAPI,
  WalletsAPI,
  BudgetsAPI,
  GoalsAPI,
  ReportsAPI,
  formatBRL,
  formatDate,
  formatMonth,
  formatPercent,
  drawDonutChart,
  drawLineChart,
  renderRecentTransactions,
  renderBudgetBars,
});

// Inicia quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
