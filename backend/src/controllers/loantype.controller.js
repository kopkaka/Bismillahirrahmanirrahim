const pool = require('../../db');

// GET semua tipe pinjaman
const getLoanTypes = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM loan_types ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// POST tipe pinjaman baru
const createLoanType = async (req, res) => {
    try {
        const { name, description } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ error: 'Nama tipe pinjaman wajib diisi.' });
        }
        const newLoanType = await pool.query(
            'INSERT INTO loan_types (name, description) VALUES ($1, $2) RETURNING *',
            [name.trim(), description]
        );
        res.status(201).json(newLoanType.rows[0]);
    } catch (err) {
        console.error('Error creating loan type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe pinjaman sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat tipe pinjaman baru.' });
    }
};

// PUT (update) tipe pinjaman
const updateLoanType = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        if (!name?.trim()) {
            return res.status(400).json({ error: 'Nama tipe pinjaman wajib diisi.' });
        }
        const updatedLoanType = await pool.query(
            'UPDATE loan_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
            [name.trim(), description, id]
        );
        if (updatedLoanType.rows.length === 0) {
            return res.status(404).json({ error: 'Tipe pinjaman tidak ditemukan.' });
        }
        res.json(updatedLoanType.rows[0]);
    } catch (err) {
        console.error('Error updating loan type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe pinjaman sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui tipe pinjaman.' });
    }
};

// DELETE tipe pinjaman
const deleteLoanType = async (req, res) => {
    try {
        const { id } = req.params;
        const deleteOp = await pool.query('DELETE FROM loan_types WHERE id = $1', [id]);
        if (deleteOp.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe pinjaman tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting loan type:', err.message);
        if (err.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Tipe pinjaman ini masih digunakan oleh tenor atau data pinjaman.' });
        }
        res.status(500).json({ error: 'Gagal menghapus tipe pinjaman.' });
    }
};

module.exports = { getLoanTypes, createLoanType, updateLoanType, deleteLoanType };