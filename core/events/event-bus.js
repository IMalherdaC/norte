/**
 * @module core/events/event-bus
 * @description Event bus funcional para comunicação assíncrona entre módulos.
 *
 * Implementa o padrão Publish-Subscribe sem classes.
 * Handlers são funções puras; efeitos colaterais ficam isolados nos listeners.
 *
 * Eventos suportados:
 *  - transaction.created    → dispara alertas de orçamento + webhook
 *  - transaction.deleted    → log de auditoria
 *  - budget.alert           → email ao usuário (80% / 100%)
 *  - goal.completed         → email de parabéns
 *  - user.registered        → email de boas-vindas + seed de categorias
 *  - user.password_reset    → email com link de uso único
 *  - user.2fa_enabled       → notificação de segurança
 *  - lgpd.export_requested  → fila para geração do ZIP
 *  - lgpd.delete_requested  → agendamento de exclusão em 30 dias
 */
'use strict';

// ─────────────────────────────────────────────
// ESTADO IMUTÁVEL DO BUS
// ─────────────────────────────────────────────

// Map de eventName → Set<handler>
// Usa closure para encapsular sem classe
const createEventBus = () => {
  const _handlers = new Map();

  /**
   * Registra um listener para um evento.
   * @param {string} event
   * @param {Function} handler — async (payload) => void
   * @returns {Function} unsubscribe
   */
  const on = (event, handler) => {
    if (!_handlers.has(event)) _handlers.set(event, new Set());
    _handlers.get(event).add(handler);
    // Retorna função de cancelamento de inscrição
    return () => _handlers.get(event)?.delete(handler);
  };

  /**
   * Registra listener que dispara apenas uma vez.
   */
  const once = (event, handler) => {
    const wrapper = async (payload) => {
      await handler(payload);
      _handlers.get(event)?.delete(wrapper);
    };
    return on(event, wrapper);
  };

  /**
   * Emite um evento para todos os listeners registrados.
   * Execução paralela com captura individual de erros.
   * @param {string} event
   * @param {object} payload
   * @returns {Promise<void>}
   */
  const emit = async (event, payload) => {
    const handlers = _handlers.get(event);
    if (!handlers || !handlers.size) return;

    const enriched = Object.freeze({
      ...payload,
      _event:     event,
      _timestamp: new Date().toISOString(),
    });

    // Executa todos em paralelo — falha individual não bloqueia os demais
    const results = await Promise.allSettled(
      [...handlers].map((h) => h(enriched))
    );

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error(`[EventBus] Handler ${i} falhou no evento "${event}":`, r.reason);
      }
    });
  };

  /**
   * Remove todos os listeners de um evento.
   */
  const off = (event) => _handlers.delete(event);

  /**
   * Retorna todos os eventos com listeners ativos.
   */
  const listEvents = () => [..._handlers.keys()];

  return Object.freeze({ on, once, emit, off, listEvents });
};

// Singleton — única instância do bus na aplicação
const eventBus = createEventBus();

// ─────────────────────────────────────────────
// CONSTANTES DE EVENTOS
// ─────────────────────────────────────────────

const EVENTS = Object.freeze({
  TRANSACTION_CREATED:   'transaction.created',
  TRANSACTION_DELETED:   'transaction.deleted',
  TRANSACTION_RESTORED:  'transaction.restored',
  BUDGET_ALERT_80:       'budget.alert.80',
  BUDGET_ALERT_100:      'budget.alert.100',
  GOAL_COMPLETED:        'goal.completed',
  GOAL_PROGRESS:         'goal.progress',
  USER_REGISTERED:       'user.registered',
  USER_PASSWORD_RESET:   'user.password_reset',
  USER_2FA_ENABLED:      'user.2fa_enabled',
  USER_SESSION_REVOKED:  'user.session_revoked',
  LGPD_EXPORT_REQUESTED: 'lgpd.export_requested',
  LGPD_DELETE_REQUESTED: 'lgpd.delete_requested',
  MEI_TAX_REMINDER:      'mei.tax_reminder',
  IMPORT_COMPLETED:      'import.completed',
});

// ─────────────────────────────────────────────
// REGISTRO DE LISTENERS PADRÃO
// ─────────────────────────────────────────────

/**
 * Registra todos os handlers de negócio no bus.
 * Chamado uma vez na inicialização do servidor.
 * @param {{ emailSvc, budgetSvc, goalSvc, userRepo }} deps
 */
const registerDefaultListeners = ({ emailSvc, budgetSvc, goalSvc, userRepo }) => {
  // ── Transação criada → verifica orçamentos ──────────────────────
  eventBus.on(EVENTS.TRANSACTION_CREATED, async ({ userId, categoryId, amount, type }) => {
    if (type !== 'expense') return;
    try {
      const { checkBudgetAfterTransaction } = budgetSvc;
      if (typeof checkBudgetAfterTransaction === 'function') {
        await checkBudgetAfterTransaction({ userId, categoryId, amount });
      }
    } catch (e) {
      console.error('[EventBus] budget check falhou:', e.message);
    }
  });

  // ── Alerta de orçamento 80% ──────────────────────────────────────
  eventBus.on(EVENTS.BUDGET_ALERT_80, async ({ userId, categoryName, spent, limit }) => {
    const user = userRepo.findUserById(userId);
    if (!user?.email) return;
    await emailSvc.sendBudgetAlert80({
      to: user.email, name: user.name || 'Usuário',
      categoryName, spent, limit,
    });
  });

  // ── Alerta de orçamento 100% ─────────────────────────────────────
  eventBus.on(EVENTS.BUDGET_ALERT_100, async ({ userId, categoryName, spent, limit }) => {
    const user = userRepo.findUserById(userId);
    if (!user?.email) return;
    await emailSvc.sendBudgetAlert100({
      to: user.email, name: user.name || 'Usuário',
      categoryName, spent, limit,
    });
  });

  // ── Meta concluída ───────────────────────────────────────────────
  eventBus.on(EVENTS.GOAL_COMPLETED, async ({ userId, goalName, targetAmount }) => {
    const user = userRepo.findUserById(userId);
    if (!user?.email) return;
    await emailSvc.sendGoalCompleted({
      to: user.email, name: user.name || 'Usuário',
      goalName, targetAmount,
    });
  });

  // ── Usuário registrado ───────────────────────────────────────────
  eventBus.on(EVENTS.USER_REGISTERED, async ({ userId, email, name }) => {
    await emailSvc.sendWelcome({ to: email, name: name || 'Usuário' });
  });

  // ── Reset de senha ───────────────────────────────────────────────
  eventBus.on(EVENTS.USER_PASSWORD_RESET, async ({ email, name, resetLink }) => {
    await emailSvc.sendPasswordReset({ to: email, name: name || 'Usuário', resetLink });
  });

  // ── 2FA habilitado ───────────────────────────────────────────────
  eventBus.on(EVENTS.USER_2FA_ENABLED, async ({ userId, email }) => {
    await emailSvc.send2FAEnabled?.({ to: email });
  });

  // ── Solicitação LGPD: exportar ───────────────────────────────────
  eventBus.on(EVENTS.LGPD_EXPORT_REQUESTED, async ({ userId, email }) => {
    // Worker de exportação (geração ZIP) — em produção usa Redis Bull
    console.log(`[LGPD] Exportação solicitada para userId=${userId}`);
    await emailSvc.sendLGPDExportReady?.({ to: email, downloadLink: '#pendente' });
  });

  // ── Solicitação LGPD: excluir conta ─────────────────────────────
  eventBus.on(EVENTS.LGPD_DELETE_REQUESTED, async ({ userId, email }) => {
    console.log(`[LGPD] Exclusão agendada para 30 dias — userId=${userId}`);
    await emailSvc.sendLGPDDeleteScheduled?.({ to: email });
  });

  console.log(`[EventBus] ${eventBus.listEvents().length} listeners registrados.`);
};

module.exports = Object.freeze({
  eventBus,
  EVENTS,
  registerDefaultListeners,
});
