const pool = require('../../db');

/**
 * @desc    Get all suppliers
 * @route   GET /api/suppliers
 * @access  Private (Admin, Akunting)
 */
const getSuppliers = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, contact_person, phone FROM suppliers ORDER BY name ASC');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching suppliers:', error.message);
        res.status(500).json({ error: 'Gagal mengambil data supplier.' });
    }
};

/**
 * @desc    Get a single supplier by ID
 * @route   GET /api/suppliers/:id
 * @access  Private (Admin, Akunting)
 */
const getSupplierById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Supplier tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error fetching supplier by id:', error.message);
        res.status(500).json({ error: 'Gagal mengambil data supplier.' });
    }
};

/**
 * @desc    Create a new supplier
 * @route   POST /api/suppliers
 * @access  Private (Admin, Akunting)
 */
const createSupplier = async (req, res) => {
    const { name, contact_person, phone, address } = req.body;

    if (!name) {
        return res.status(400).json({ error: 'Nama supplier wajib diisi.' });
    }

    try {
        const query = `
            INSERT INTO suppliers (name, contact_person, phone, address)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const result = await pool.query(query, [name, contact_person, phone, address]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating supplier:', error.message);
        res.status(500).json({ error: 'Gagal membuat supplier baru.' });
    }
};

module.exports = { getSuppliers, getSupplierById, createSupplier };