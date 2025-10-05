const { Router } = require('express');
const { getPositions, createPosition, updatePosition, deletePosition } = require('../controllers/position.controller.js');

const router = Router();

router.get('/', getPositions);
router.post('/', createPosition);
router.put('/:id', updatePosition);
router.delete('/:id', deletePosition);

module.exports = router;