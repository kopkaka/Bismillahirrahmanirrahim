const { Router } = require('express');
const { getPositions, createPosition, updatePosition, deletePosition } = require('../controllers/position.controller.js');

const router = Router();

router.get('/positions', getPositions);
router.post('/positions', createPosition);
router.put('/positions/:id', updatePosition);
router.delete('/positions/:id', deletePosition);

module.exports = router;