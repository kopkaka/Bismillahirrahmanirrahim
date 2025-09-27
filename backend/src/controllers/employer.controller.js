const pool = require('../../db');

// Get all employer companies
const getEmployers = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, address, phone, contract_number, document_url FROM companies ORDER BY name ASC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

// Get a single employer by ID
const getEmployerById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM companies WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

// Create a new employer company
const createEmployer = async (req, res) => {
    const { name, address, phone } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama perusahaan wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO companies (name, address, phone) VALUES ($1, $2, $3) RETURNING *',
            [name, address, phone]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating employer:', error.message);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nama perusahaan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal membuat perusahaan baru.' });
    }
};

// Update an employer company
const updateEmployer = async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, contract_number, document_url } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama perusahaan wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'UPDATE companies SET name = $1, address = $2, phone = $3 WHERE id = $4 RETURNING *',
            [name, address, phone, contract_number, document_url, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating employer:', error.message);
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Nama perusahaan sudah ada.' });
        }
        res.status(500).json({ error: 'Gagal memperbarui perusahaan.' });
    }
};

// Delete an employer company
const deleteEmployer = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM companies WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting employer:', error.message);
        if (error.code === '23503') { // Foreign key violation
            return res.status(400).json({ error: 'Gagal menghapus. Perusahaan ini masih terhubung dengan data anggota.' });
        }
        res.status(500).json({ error: 'Gagal menghapus perusahaan.' });
    }
};

module.exports = { getEmployers, getEmployerById, createEmployer, updateEmployer, deleteEmployer };