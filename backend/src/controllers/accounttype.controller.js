const pool = require('../../db');

// GET semua tipe akun
const getAccountTypes = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM account_types ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching account types:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tipe akun.' });
    }
};

// POST tipe akun baru
const createAccountType = async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama tipe akun wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO account_types (name) VALUES ($1) RETURNING *',
            [name.trim()]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating account type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe akun sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat tipe akun baru.' });
    }
};

// PUT (update) tipe akun
const updateAccountType = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama tipe akun wajib diisi.' });
    }
    try {
        const result = await pool.query('UPDATE account_types SET name = $1 WHERE id = $2 RETURNING *', [name.trim(), id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe akun tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating account type:', err.message);
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Nama tipe akun sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui tipe akun.' });
    }
};

// DELETE tipe akun
const deleteAccountType = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM account_types WHERE id = $1', [id]);
        if (result.rowCount === 0) { return res.status(404).json({ error: 'Tipe akun tidak ditemukan.' }); }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting account type:', err.message);
        if (err.code === '23503') { return res.status(400).json({ error: 'Gagal menghapus. Tipe akun ini masih digunakan oleh salah satu akun di COA.' }); }
        res.status(500).json({ error: 'Gagal menghapus tipe akun.' });
    }
};

module.exports = { getAccountTypes, createAccountType, updateAccountType, deleteAccountType };