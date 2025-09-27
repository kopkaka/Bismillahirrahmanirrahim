const pool = require('../../db');

// Get all positions
const getPositions = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM positions ORDER BY name ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Create a new position
const createPosition = async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO positions (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating position:', error.message);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nama jabatan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat jabatan baru.' });
    }
};

// Update a position
const updatePosition = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama jabatan wajib diisi.' });
    }
    try {
        const result = await pool.query('UPDATE positions SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating position:', error.message);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nama jabatan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui jabatan.' });
    }
};

// Delete a position
const deletePosition = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM positions WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Jabatan tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting position:', error.message);
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Jabatan ini masih digunakan oleh anggota.' });
        }
        res.status(500).json({ error: 'Gagal menghapus jabatan.' });
    }
};

module.exports = { getPositions, createPosition, updatePosition, deletePosition };