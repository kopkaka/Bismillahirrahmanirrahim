const pool = require('../../db');

// Get company info
const getCompanyInfo = async (req, res) => {
    try {
        const result = await pool.query('SELECT name, address, phone FROM company_info WHERE id = 1');
        if (result.rows.length === 0) {
            // Provide default if not found, to prevent errors on a fresh DB
            return res.json({ name: 'Koperasi Anda', address: '', phone: '' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update company info
const updateCompanyInfo = async (req, res) => {
    const { name, address, phone } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama perusahaan wajib diisi.' });
    }
    try {
        // Use UPSERT (INSERT ... ON CONFLICT) to handle both creation (if table is empty) and update.
        const result = await pool.query(
            `INSERT INTO company_info (id, name, address, phone)
             VALUES (1, $1, $2, $3)
             ON CONFLICT (id) DO UPDATE
             SET name = $1, address = $2, phone = $3
             RETURNING name, address, phone`,
            [name, address, phone]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { getCompanyInfo, updateCompanyInfo };