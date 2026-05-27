/**
 * @module server/routes/goals
 * @description Rotas REST para metas e sonhos (E06).
 */
'use strict';

const { Router }  = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const goalSvc     = require('../../finances/goals/goal.service');
const { validateGoal } = require('../../shared/validators');

const router = Router();
router.use(requireAuth);

const DEPS = () => ({
  goalRepo:   require('../../database/repositories/goal.repository'),
  walletRepo: require('../../database/repositories/wallet.repository'),
  emailSvc:   require('../../core/email/email.service'),
  userRepo:   require('../../database/repositories/user.repository'),
});

// ─── QUERIES ────────────────────────────────────────────────────────

/** GET /api/v1/goals */
router.get('/', async (req, res) => {
  const result = await goalSvc.listGoals(
    { userId: req.user.sub },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** GET /api/v1/goals/:id/simulation — simulação de aportes PMT */
router.get('/:id/simulation', async (req, res) => {
  const result = await goalSvc.getGoalSimulation(
    { goalId: req.params.id, userId: req.user.sub, annualRate: req.query.rate },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

// ─── COMMANDS ───────────────────────────────────────────────────────

/** POST /api/v1/goals */
router.post('/', async (req, res) => {
  const validated = validateGoal(req.body);
  if (!validated.ok) return res.status(422).json({ error: validated.error });

  const result = await goalSvc.createGoal(
    { userId: req.user.sub, ...validated.value },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ data: result.value });
});

/** PUT /api/v1/goals/:id */
router.put('/:id', async (req, res) => {
  const result = await goalSvc.updateGoal?.(
    { goalId: req.params.id, userId: req.user.sub, updates: req.body },
    DEPS()
  ) || { ok: false, error: 'Não implementado' };
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** POST /api/v1/goals/:id/contribute — registra aporte */
router.post('/:id/contribute', async (req, res) => {
  const { amount } = req.body;
  if (!amount || Number(amount) <= 0)
    return res.status(422).json({ error: 'Valor de aporte inválido' });

  const result = await goalSvc.contributeToGoal(
    { goalId: req.params.id, userId: req.user.sub, amount: Number(amount) },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** DELETE /api/v1/goals/:id */
router.delete('/:id', async (req, res) => {
  const deps  = DEPS();
  const goal  = deps.goalRepo.findGoal(req.params.id);
  if (!goal || goal.userId !== req.user.sub)
    return res.status(404).json({ error: 'Meta não encontrada' });
  deps.goalRepo.deleteGoal(req.params.id);
  res.json({ message: 'Meta removida.' });
});

module.exports = router;
