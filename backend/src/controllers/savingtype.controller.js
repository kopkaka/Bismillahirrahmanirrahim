const pool = require('../../db');

// GET semua tipe simpanan
const getSavingTypes = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM saving_types ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching saving types:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tipe simpanan.' });
    }
};

// POST tipe simpanan baru
const createSavingType = async (req, res) => {
    const { name, description } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama tipe simpanan wajib diisi.' });
    }
    try {
        const newSavingType = await pool.query(
            'INSERT INTO saving_types (name, description) VALUES ($1, $2) RETURNING *',
            [name.trim(), description]
        );
        res.status(201).json(newSavingType.rows[0]);
    } catch (err) {
        console.error('Error creating saving type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe simpanan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat tipe simpanan baru.' });
    }
};

// PUT (update) tipe simpanan
const updateSavingType = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama tipe simpanan wajib diisi.' });
    }
    try {
        const updatedSavingType = await pool.query(
            'UPDATE saving_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
            [name.trim(), description, id]
        );
        if (updatedSavingType.rows.length === 0) {
            return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        }
        res.json(updatedSavingType.rows[0]);
    } catch (err) {
        console.error('Error updating saving type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe simpanan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui tipe simpanan.' });
    }
};

// DELETE tipe simpanan
const deleteSavingType = async (req, res) => {
    try {
        const { id } = req.params;
        const deleteOp = await pool.query('DELETE FROM saving_types WHERE id = $1', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting saving type:', err.message);
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Tipe simpanan ini masih digunakan oleh data simpanan.' });
        }
        res.status(500).json({ error: 'Gagal menghapus tipe simpanan.' });
    }
};

module.exports = { getSavingTypes, createSavingType, updateSavingType, deleteSavingType };