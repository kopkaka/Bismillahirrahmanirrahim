const pool = require('../../db');

/**
 * @desc    Get all positions for public dropdowns
 * @route   GET /api/public/positions
 * @access  Public
 */
const getPositions = async (req, res) => {
    try {
        // Query sederhana untuk mengambil semua jabatan, diurutkan berdasarkan nama
        const result = await pool.query('SELECT id, name FROM positions ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching positions:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data jabatan.' });
    }
};

/**
 * @desc    Create a new position
 * @route   POST /api/admin/positions
 * @access  Private/Admin
 */
const createPosition = async (req, res) => {
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
    }
    try {
        const result = await pool.query('INSERT INTO positions (name) VALUES ($1) RETURNING *', [name]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating position:', err);
        res.status(500).json({ error: 'Gagal membuat jabatan baru.' });
    }
};

/**
 * @desc    Update a position
 * @route   PUT /api/admin/positions/:id
 * @access  Private/Admin
 */
const updatePosition = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    try {
        const result = await pool.query('UPDATE positions SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating position:', err);
        res.status(500).json({ error: 'Gagal memperbarui jabatan.' });
    }
};

const deletePosition = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM positions WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting position:', err);
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Jabatan ini masih terhubung dengan data anggota.' });
        }
        res.status(500).json({ error: 'Gagal menghapus jabatan.' });
    }
};

module.exports = {
    getPositions,
    createPosition,
    updatePosition,
    deletePosition,
};