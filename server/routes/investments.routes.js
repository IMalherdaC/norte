/**
 * @module server/routes/investments
 * @description Rotas REST para posições de investimentos (E07).
 */
'use strict';

const { Router }  = require('express');
const { requireAuth } = require('../middleware/auth.middleware');
const investSvc   = require('../../finances/investments/investment.service');

const router = Router();
router.use(requireAuth);

const DEPS = () => ({
  investRepo: require('../../database/repositories/wallet.repository'), // reutiliza conn
});

/** GET /api/v1/investments — lista posições */
router.get('/', async (req, res) => {
  const result = await investSvc.listPositions(
    { userId: req.user.sub, entityType: req.query.entityType || 'all' },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** GET /api/v1/investments/allocation — gráfico de alocação */
router.get('/allocation', async (req, res) => {
  const result = await investSvc.getAllocationChart(
    { userId: req.user.sub },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** GET /api/v1/investments/evolution — evolução patrimonial */
router.get('/evolution', async (req, res) => {
  const months  = Number(req.query.months) || 12;
  const result  = await investSvc.getPatrimonyEvolution(
    { userId: req.user.sub, months },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** POST /api/v1/investments — adiciona posição manual */
router.post('/', async (req, res) => {
  const result = await investSvc.addPosition(
    { userId: req.user.sub, ...req.body },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.status(201).json({ data: result.value });
});

/** PUT /api/v1/investments/:id — atualiza posição */
router.put('/:id', async (req, res) => {
  const result = await investSvc.updatePosition(
    { positionId: req.params.id, userId: req.user.sub, updates: req.body },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ data: result.value });
});

/** DELETE /api/v1/investments/:id */
router.delete('/:id', async (req, res) => {
  const result = await investSvc.removePosition(
    { positionId: req.params.id, userId: req.user.sub },
    DEPS()
  );
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ message: 'Posição removida.' });
});

module.exports = router;
