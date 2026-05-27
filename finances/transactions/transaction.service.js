/**
 * @module finances/transactions/transaction.service
 * @description Serviço de Lançamentos Financeiros (O Core do Norte).
 *
 * CQRS:
 *   COMMANDS: createTransaction, updateTransaction, deleteTransaction,
 *             splitTransaction, importTransactions
 *   QUERIES:  listTransactions, getTransaction, searchTransactions
 *
 * Funcionalidades:
 *   - 3 tipos: Receita (income), Despesa (expense), Transferência (transfer)
 *   - Recorrência: mensal/semanal/personalizada
 *   - Parcelamentos (installments) no cartão
 *   - Divisão de lançamento (split) entre categorias
 *   - Soft Delete com desfazer em 5s
 *   - Importação OFX/CSV/PDF com deduplicação por hash
 *   - Anexo de comprovantes
 *
 * PARADIGMA: 100% Funcional. ZERO classes.
 */

'use strict';

const { v4: uuidv4 }    = require('uuid');
const {
  Ok, Err, isOk,
  pipe, update, deepFreeze,
  sumValues, toMoney,
  hashTransaction,
  groupBy,
} = require('../../shared/fp-utils');
const { validateTransaction } = require('../../shared/validators');
const { emitEvent, EVENTS }   = require('../../core/events/event-bus');

// ─────────────────────────────────────────────
// FACTORIES
// ─────────────────────────────────────────────

/**
 * Cria um objeto de transação imutável.
 * @param {object} data
 * @returns {Readonly<object>}
 */
const createTransactionRecord = (data) =>
  deepFreeze({
    id:              uuidv4(),
    userId:          data.userId,
    walletId:        data.walletId,
    targetWalletId:  data.targetWalletId || null,   // para transferências
    categoryId:      data.categoryId,
    type:            data.type,                      // income | expense | transfer
    amount:          toMoney(Number(data.amount)),
    description:     data.description || '',
    date:            data.date,
    tags:            data.tags || [],                // PIX | Débito | Crédito | etc.
    paymentMethod:   data.paymentMethod || null,
    // Recorrência
    isRecurring:     data.isRecurring || false,
    recurringConfig: data.recurringConfig || null,   // { frequency, endDate }
    recurringGroupId:data.recurringGroupId || null,
    // Parcelamento
    isInstallment:   data.isInstallment || false,
    installmentNumber: data.installmentNumber || null,
    totalInstallments: data.totalInstallments || null,
    installmentGroupId: data.installmentGroupId || null,
    // Split
    isSplit:         data.isSplit || false,
    splitGroupId:    data.splitGroupId || null,
    // MEI
    entityType:      data.entityType || 'pf',        // 'pf' | 'pj'
    // Comprovante
    attachmentUrl:   data.attachmentUrl || null,
    // Hash para deduplicação
    deduplicationHash: hashTransaction({
      date: data.date,
      amount: data.amount,
      description: data.description || '',
    }),
    // Soft delete
    deletedAt:       null,
    deletionToken:   null,   // token de 5s para desfazer
    // Auditoria
    importSource:    data.importSource || null,  // 'ofx' | 'csv' | 'pdf' | null
    createdAt:       new Date().toISOString(),
    updatedAt:       new Date().toISOString(),
  });

// ─────────────────────────────────────────────
// COMMANDS
// ─────────────────────────────────────────────

/**
 * Cria uma transação simples.
 * Se for transferência, cria dois registros vinculados (débito + crédito).
 *
 * @param {object} input
 * @param {{ findWalletById, saveTransaction, updateWalletBalance }} deps
 * @returns {Promise<Result>}
 */
const createTransaction = async (input, deps) => {
  // 1. Valida
  const validated = validateTransaction(input);
  if (!isOk(validated)) return validated;
  const data = validated.value;

  // 2. Verifica carteira origem
  const wallet = await deps.findWalletById(data.walletId);
  if (!wallet) return Err('Conta não encontrada');
  if (wallet.isArchived) return Err('Não é possível lançar em uma conta arquivada');

  // 3. Transferência: cria dois registros vinculados
  if (data.type === 'transfer') {
    return createTransfer(data, deps);
  }

  // 4. Cria o registro
  const tx = createTransactionRecord(data);

  // 5. ACID: salva transação E atualiza saldo em uma operação
  const balanceDelta = data.type === 'income' ? data.amount : -data.amount;
  await deps.saveTransactionWithBalanceUpdate(tx, data.walletId, balanceDelta);

  emitEvent(EVENTS.TRANSACTION_CREATED, { transactionId: tx.id, userId: data.userId, type: data.type });

  return Ok(tx);
};

/**
 * Cria uma transferência entre contas (2 lançamentos vinculados).
 * @param {object} data
 * @param {object} deps
 * @returns {Promise<Result>}
 */
const createTransfer = async (data, deps) => {
  if (!data.targetWalletId) return Err('Conta destino é obrigatória para transferências');

  const targetWallet = await deps.findWalletById(data.targetWalletId);
  if (!targetWallet) return Err('Conta destino não encontrada');

  const transferGroupId = uuidv4();

  // Lançamento de saída (débito na origem)
  const outTx = createTransactionRecord(update(data, {
    type: 'transfer_out',
    recurringGroupId: transferGroupId,
    description: `Transferência para ${targetWallet.name}`,
  }));

  // Lançamento de entrada (crédito no destino)
  const inTx = createTransactionRecord(update(data, {
    type: 'transfer_in',
    walletId: data.targetWalletId,
    targetWalletId: data.walletId,
    recurringGroupId: transferGroupId,
    description: `Transferência de ${(await deps.findWalletById(data.walletId)).name}`,
  }));

  // ACID: persiste ambos e atualiza os dois saldos
  await deps.saveTransferPair(outTx, inTx, data.walletId, data.targetWalletId, data.amount);

  return Ok(Object.freeze({ outTransaction: outTx, inTransaction: inTx }));
};

/**
 * Cria transações recorrentes (gera N lançamentos futuros).
 *
 * @param {object} input — com `recurringConfig: { frequency, occurrences }`
 * @param {object} deps
 * @returns {Promise<Result>}
 */
const createRecurringTransactions = async (input, deps) => {
  const validated = validateTransaction(input);
  if (!isOk(validated)) return validated;
  const data = validated.value;

  const { frequency = 'monthly', occurrences = 12 } = data.recurringConfig || {};
  const recurringGroupId = uuidv4();

  // Gera as datas das ocorrências
  const dates = generateRecurringDates(data.date, frequency, occurrences);

  const transactions = dates.map((date, i) =>
    createTransactionRecord(update(data, {
      date,
      recurringGroupId,
      recurringConfig: update(data.recurringConfig, { occurrence: i + 1, total: occurrences }),
    }))
  );

  await deps.saveBatchTransactions(transactions, data.walletId, data.type, data.amount);

  emitEvent(EVENTS.TRANSACTION_CREATED, {
    recurringGroupId,
    count: transactions.length,
    userId: data.userId,
  });

  return Ok(Object.freeze({ recurringGroupId, transactions }));
};

/**
 * Cria parcelamentos no cartão (N lançamentos mensais).
 *
 * @param {object} input — com `totalInstallments`
 * @param {object} deps
 * @returns {Promise<Result>}
 */
const createInstallments = async (input, deps) => {
  const validated = validateTransaction(input);
  if (!isOk(validated)) return validated;
  const data = validated.value;

  if (!data.totalInstallments || data.totalInstallments < 2) {
    return Err('Número de parcelas deve ser ≥ 2');
  }

  const installmentGroupId = uuidv4();
  const installmentAmount  = toMoney(data.amount / data.totalInstallments);

  const transactions = Array.from({ length: data.totalInstallments }, (_, i) => {
    const date = addMonths(data.date, i);
    return createTransactionRecord(update(data, {
      date,
      amount: installmentAmount,
      isInstallment:    true,
      installmentNumber:i + 1,
      totalInstallments:data.totalInstallments,
      installmentGroupId,
      description: `${data.description} (${i + 1}/${data.totalInstallments})`,
    }));
  });

  await deps.saveBatchTransactions(transactions, data.walletId, 'expense', 0); // não altera saldo agora

  return Ok(Object.freeze({ installmentGroupId, transactions }));
};

/**
 * Divide um lançamento entre múltiplas categorias.
 * Exemplo: nota de mercado → Alimentação R$80 + Higiene R$20
 *
 * @param {{ originalTxId: string, splits: Array<{categoryId, amount, description}> }} input
 * @param {{ findTransaction, saveTransaction, deleteSoftTransaction }} deps
 * @returns {Promise<Result>}
 */
const splitTransaction = async ({ originalTxId, splits }, deps) => {
  const original = await deps.findTransaction(originalTxId);
  if (!original) return Err('Lançamento original não encontrado');

  const totalSplit = sumValues(splits.map((s) => s.amount));
  if (Math.abs(totalSplit - original.amount) > 0.01) {
    return Err(`A soma das divisões (${totalSplit}) deve ser igual ao valor original (${original.amount})`);
  }

  const splitGroupId = uuidv4();

  const splitTxs = splits.map((s) =>
    createTransactionRecord(update(original, {
      id:          uuidv4(), // novo ID para cada split
      categoryId:  s.categoryId,
      amount:      toMoney(s.amount),
      description: s.description || original.description,
      isSplit:     true,
      splitGroupId,
    }))
  );

  await deps.replaceSplitTransaction(originalTxId, splitTxs);

  return Ok(Object.freeze({ splitGroupId, splits: splitTxs }));
};

/**
 * Soft Delete — marca o lançamento como deletado mas preserva no banco.
 * Gera um deletionToken válido por 5 segundos para "Desfazer".
 *
 * @param {string} transactionId
 * @param {{ findTransaction, softDeleteTransaction }} deps
 * @returns {Promise<Result>}
 */
const softDeleteTransaction = async (transactionId, deps) => {
  const tx = await deps.findTransaction(transactionId);
  if (!tx) return Err('Lançamento não encontrado');

  const deletionToken = require('crypto').randomBytes(8).toString('hex');
  const deletedAt     = new Date().toISOString();

  await deps.softDeleteTransaction(transactionId, { deletedAt, deletionToken });

  emitEvent(EVENTS.TRANSACTION_DELETED, { transactionId, userId: tx.userId });

  // Retorna o token para o frontend exibir "Desfazer (5s)"
  return Ok(Object.freeze({ deletionToken, message: 'Lançamento removido. Toque em Desfazer para restaurar.' }));
};

/**
 * Restaura um lançamento deletado (Desfazer).
 * @param {string} transactionId
 * @param {string} deletionToken
 * @param {{ findTransaction, restoreTransaction }} deps
 * @returns {Promise<Result>}
 */
const undoDeleteTransaction = async (transactionId, deletionToken, deps) => {
  const tx = await deps.findTransaction(transactionId, { includeDeleted: true });
  if (!tx || !tx.deletedAt) return Err('Lançamento não encontrado ou já excluído definitivamente');
  if (tx.deletionToken !== deletionToken) return Err('Token de desfazer inválido');

  // Verifica janela de 5 segundos
  const deletedMs = new Date(tx.deletedAt).getTime();
  if (Date.now() - deletedMs > 5000) {
    return Err('Tempo de desfazer expirado (5 segundos)');
  }

  await deps.restoreTransaction(transactionId);
  return Ok({ message: 'Lançamento restaurado com sucesso.' });
};

/**
 * Importa transações via OFX, CSV ou PDF.
 * Deduplica por hash (data+valor+descrição).
 *
 * @param {object[]} rawTransactions — pré-processadas pelo parser
 * @param {{ userId, walletId, source: 'ofx'|'csv'|'pdf' }} meta
 * @param {{ findHashesByUserId, saveBatchTransactions }} deps
 * @returns {Promise<Result>}
 */
const importTransactions = async (rawTransactions, meta, deps) => {
  // 1. Gera hashes de todas as transações de entrada
  const withHashes = rawTransactions.map((tx) => ({
    ...tx,
    deduplicationHash: hashTransaction({
      date: tx.date,
      amount: tx.amount,
      description: tx.description || '',
    }),
  }));

  // 2. Busca hashes já existentes no banco para esse usuário
  const existingHashes = new Set(await deps.findHashesByUserId(meta.userId));

  // 3. Filtra duplicatas
  const { unique: uniqueTxs, duplicates } = withHashes.reduce(
    (acc, tx) => ({
      unique:     existingHashes.has(tx.deduplicationHash)
        ? acc.unique
        : [...acc.unique, tx],
      duplicates: existingHashes.has(tx.deduplicationHash)
        ? [...acc.duplicates, tx]
        : acc.duplicates,
    }),
    { unique: [], duplicates: [] }
  );

  // 4. Cria registros para os únicos
  const records = uniqueTxs.map((tx) =>
    createTransactionRecord({ ...tx, userId: meta.userId, walletId: meta.walletId, importSource: meta.source })
  );

  if (records.length > 0) {
    await deps.saveBatchTransactions(records, meta.walletId, null, 0);
  }

  emitEvent(EVENTS.IMPORT_COMPLETED, {
    userId:     meta.userId,
    imported:   records.length,
    duplicates: duplicates.length,
    source:     meta.source,
  });

  if (duplicates.length > 0) {
    emitEvent(EVENTS.IMPORT_DUPLICATES_FOUND, { userId: meta.userId, count: duplicates.length });
  }

  return Ok(Object.freeze({
    imported:   records.length,
    duplicates: duplicates.length,
    message:    `${records.length} lançamento(s) importado(s). ${duplicates.length} duplicata(s) ignorada(s).`,
  }));
};

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

/**
 * Lista transações com filtros combinados e paginação.
 *
 * @param {{ userId, walletId?, categoryId?, type?, startDate?, endDate?,
 *           search?, tags?, minAmount?, maxAmount?,
 *           entityType?, page?, limit? }} filters
 * @param {{ queryTransactions }} deps
 * @returns {Promise<Result>}
 */
const listTransactions = async (filters, deps) => {
  const page  = Math.max(1, filters.page  || 1);
  const limit = Math.min(100, filters.limit || 50);
  const skip  = (page - 1) * limit;

  const result = await deps.queryTransactions({
    ...filters,
    deletedAt: null,  // excluir soft-deleted por padrão
    skip,
    limit,
  });

  return Ok(Object.freeze({
    transactions: result.items,
    total:        result.total,
    page,
    limit,
    totalPages:   Math.ceil(result.total / limit),
    hasNext:      page * limit < result.total,
  }));
};

/**
 * Busca uma transação por ID.
 * @param {string} transactionId
 * @param {string} userId — para garantir que pertence ao usuário
 * @param {{ findTransaction }} deps
 * @returns {Promise<Result>}
 */
const getTransaction = async (transactionId, userId, deps) => {
  const tx = await deps.findTransaction(transactionId);
  if (!tx) return Err('Lançamento não encontrado');
  if (tx.userId !== userId) return Err('Acesso negado');
  return Ok(tx);
};

// ─────────────────────────────────────────────
// HELPERS INTERNOS (funções puras)
// ─────────────────────────────────────────────

/**
 * Gera array de datas para transações recorrentes.
 * @param {string} startDate — ISO date
 * @param {'daily'|'weekly'|'monthly'} frequency
 * @param {number} occurrences
 * @returns {string[]}
 */
const generateRecurringDates = (startDate, frequency, occurrences) => {
  const start = new Date(startDate);
  return Array.from({ length: occurrences }, (_, i) => {
    const date = new Date(start);
    if (frequency === 'daily')        date.setDate(date.getDate() + i);
    else if (frequency === 'weekly')  date.setDate(date.getDate() + i * 7);
    else                              date.setMonth(date.getMonth() + i);
    return date.toISOString().split('T')[0];
  });
};

/**
 * Adiciona N meses a uma data ISO.
 * @param {string} isoDate
 * @param {number} months
 * @returns {string}
 */
const addMonths = (isoDate, months) => {
  const date = new Date(isoDate);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split('T')[0];
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// FUNÇÕES PURAS — CONSTRUTORES TESTÁVEIS
// (sem side-effects, exportadas para testes unitários)
// ─────────────────────────────────────────────

/**
 * Constrói array de parcelas (pure — sem persistência).
 */
const buildInstallments = ({ userId, walletId, categoryId, totalAmount, installments, description, date, tags = [], entityType = 'pf' }) => {
  if (installments > 72) return Err('Máximo de 72 parcelas');
  if (installments < 2)  return Err('Mínimo de 2 parcelas');
  if (totalAmount <= 0)  return Err('Valor inválido');

  const base    = toMoney(Math.floor((totalAmount / installments) * 100) / 100);
  const last    = toMoney(totalAmount - base * (installments - 1));
  const groupId = uuidv4();
  const now     = new Date().toISOString();

  const result = Array.from({ length: installments }, (_, i) => {
    const amount  = i === 0 ? toMoney(totalAmount - base * (installments - 1)) : base;
    const iDate   = addMonths(date, i);
    const tx      = createTransactionRecord({
      userId, walletId, categoryId, type: 'expense',
      amount, description: `${description} (${i + 1}/${installments})`,
      date: iDate, tags, entityType,
    });
    return Object.freeze({
      ...tx,
      isInstallment: true,
      installmentNumber: i + 1,
      totalInstallments: installments,
      installmentGroupId: groupId,
    });
  });
  return Ok(result);
};

/**
 * Constrói lista de transações recorrentes (pure — sem persistência).
 */
const buildRecurringTransactions = ({ userId, walletId, categoryId, amount, description, date, frequency, occurrences, tags = [], entityType = 'pf' }) => {
  if (occurrences > 120) return Err('Máximo de 120 ocorrências');
  if (!['daily', 'weekly', 'monthly'].includes(frequency)) return Err('Frequência inválida');

  const dates   = generateRecurringDates(date, frequency, occurrences);
  const groupId = uuidv4();

  const result = dates.map((d, i) => {
    const tx = createTransactionRecord({
      userId, walletId, categoryId, type: 'expense',
      amount, description, date: d, tags, entityType,
    });
    return Object.freeze({
      ...tx,
      isRecurring: true,
      recurringGroupId: groupId,
      recurringConfig: Object.freeze({ frequency, occurrences, index: i }),
    });
  });
  return Ok(result);
};

/**
 * Constrói par de transferência (débito + crédito) — pure.
 */
const buildTransferPair = ({ userId, fromWalletId, toWalletId, categoryId, amount, description, date, tags = [], entityType = 'pf' }) => {
  if (!fromWalletId || !toWalletId) return Err('Carteiras obrigatórias');
  if (fromWalletId === toWalletId)  return Err('Carteiras de origem e destino devem ser diferentes');
  if (amount <= 0)                  return Err('Valor inválido');

  const outTx = createTransactionRecord({
    userId, walletId: fromWalletId, targetWalletId: toWalletId,
    categoryId, type: 'transfer_out', amount, description, date, tags, entityType,
  });
  const inTx = createTransactionRecord({
    userId, walletId: toWalletId, targetWalletId: fromWalletId,
    categoryId, type: 'transfer_in', amount, description, date, tags, entityType,
  });
  return Ok(Object.freeze({ outTx, inTx }));
};

/**
 * Constrói splits de um lançamento — pure.
 */
const buildSplits = (originalTx, splits) => {
  const totalSplit = toMoney(splits.reduce((s, sp) => s + sp.amount, 0));
  if (Math.abs(totalSplit - originalTx.amount) > 0.01) {
    return Err(`Soma dos splits (${totalSplit}) difere do valor original (${originalTx.amount})`);
  }
  const groupId = uuidv4();
  const result  = splits.map((sp) => {
    const tx = createTransactionRecord({
      userId: originalTx.userId, walletId: originalTx.walletId,
      categoryId: sp.categoryId, type: originalTx.type,
      amount: sp.amount, description: sp.description || originalTx.description,
      date: originalTx.date, tags: originalTx.tags,
    });
    return Object.freeze({ ...tx, isSplit: true, splitGroupId: groupId });
  });
  return Ok(result);
};

/**
 * Verifica se o undo ainda está dentro do prazo de 5 segundos.
 */
const canUndo = (deletedAt) => {
  const elapsed = Date.now() - new Date(deletedAt).getTime();
  return elapsed <= 5000;
};

/**
 * Filtra duplicatas de uma lista de transações importadas.
 */
const filterDuplicates = (incoming, existingHashes) => {
  const set = new Set(existingHashes);
  return incoming.reduce((acc, tx) => {
    if (set.has(tx.deduplicationHash)) {
      return { ...acc, duplicates: [...acc.duplicates, tx] };
    }
    return { ...acc, new: [...acc.new, tx] };
  }, { new: [], duplicates: [] });
};

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = Object.freeze({
  // Commands (com side-effects)
  createTransaction,
  createRecurringTransactions,
  createInstallments,
  splitTransaction,
  softDeleteTransaction,
  undoDeleteTransaction,
  importTransactions,
  // Queries
  listTransactions,
  getTransaction,
  // Pure builders (testáveis sem banco)
  buildInstallments,
  buildRecurringTransactions,
  buildTransferPair,
  buildSplits,
  canUndo,
  filterDuplicates,
  // Helpers
  generateRecurringDates,
  addMonths,
  createTransactionRecord,
});
