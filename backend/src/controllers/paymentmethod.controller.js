const pool = require('../../db');

const getPaymentMethods = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, is_active, account_id FROM payment_methods ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching payment methods:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data metode pembayaran.' });
    }
};

const createPaymentMethod = async (req, res) => {
    const { name, is_active } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama metode pembayaran wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO payment_methods (name, is_active) VALUES ($1, $2) RETURNING *',
            [name.trim(), is_active]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating payment method:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Nama metode pembayaran sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat metode pembayaran baru.' });
    }
};

const updatePaymentMethod = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    if (!name?.trim()) {
        return res.status(400).json({ error: 'Nama metode pembayaran wajib diisi.' });
    }
    const isActiveBoolean = is_active === 'true' || is_active === true;

    try {
        const result = await pool.query(
            'UPDATE payment_methods SET name = $1, is_active = $2 WHERE id = $3 RETURNING *',
            [name.trim(), isActiveBoolean, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating payment method:', err.message);
        if (err.code === '23505') { // unique_violation
            return res.status(400).json({ error: 'Nama metode pembayaran sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui metode pembayaran.' });
    }
};

const deletePaymentMethod = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM payment_methods WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Metode pembayaran tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting payment method:', err.message);
        if (err.code === '23503') { // foreign_key_violation
            return res.status(400).json({ error: 'Gagal menghapus. Metode pembayaran ini masih terhubung dengan data transaksi atau akun.' });
        }
        res.status(500).json({ error: 'Gagal menghapus metode pembayaran.' });
    }
};

module.exports = { getPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod };