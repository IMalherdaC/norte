/**
 * @module server/routes/wallets
 * @description Rotas REST para contas, carteiras e cartões (E02).
 * CQRS: GET = queries, POST/PUT/DELETE = commands.
 */
'use strict';

const { Router }  = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const walletSvc   = require('../../finances/wallets/wallet.service');
const { validateWallet } = require('../../shared/validators');
const { Ok, Err } = require('../../shared');

const router = Router();
router.use(requireAuth);

// ─── QUERIES ───────────────────────────────────────────────────────

/** GET /api/v1/wallets — lista carteiras do usuário */
router.get('/', async (req, res) => {
  const result = await walletSvc.listWallets(
    { userId: req.user.sub, includeArchived: req.query.archived === 'true' },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** GET /api/v1/wallets/balance — saldo consolidado */
router.get('/balance', async (req, res) => {
  const result = await walletSvc.getConsolidatedBalance(
    { userId: req.user.sub, privacyMode: req.user.privacyMode },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** GET /api/v1/wallets/:id */
router.get('/:id', async (req, res) => {
  const result = await walletSvc.getWallet(
    { walletId: req.params.id, userId: req.user.sub },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ data: result.value });
});

// ─── COMMANDS ──────────────────────────────────────────────────────

/** POST /api/v1/wallets — cria conta/carteira */
router.post('/', async (req, res) => {
  const validated = validateWallet(req.body);
  if (!validated.ok) return res.status(422).json({ error: validated.error });

  const result = await walletSvc.createWallet(
    { userId: req.user.sub, ...validated.value },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ data: result.value });
});

/** PUT /api/v1/wallets/:id — atualiza dados da carteira */
router.put('/:id', async (req, res) => {
  const result = await walletSvc.updateWallet(
    { walletId: req.params.id, userId: req.user.sub, updates: req.body },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** POST /api/v1/wallets/:id/archive — arquiva carteira */
router.post('/:id/archive', async (req, res) => {
  const result = await walletSvc.archiveWallet(
    { walletId: req.params.id, userId: req.user.sub },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** POST /api/v1/wallets/:id/unarchive — restaura carteira */
router.post('/:id/unarchive', async (req, res) => {
  const result = await walletSvc.unarchiveWallet(
    { walletId: req.params.id, userId: req.user.sub },
    { walletRepo: require('../../database/repositories/wallet.repository') }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** DELETE /api/v1/wallets/:id — remove carteira (sem lançamentos) */
router.delete('/:id', async (req, res) => {
  const result = await walletSvc.deleteWallet(
    { walletId: req.params.id, userId: req.user.sub },
    {
      walletRepo: require('../../database/repositories/wallet.repository'),
      txRepo:     require('../../database/repositories/transaction.repository'),
    }
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: 'Carteira removida com sucesso.' });
});

module.exports = router;
