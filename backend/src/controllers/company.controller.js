const pool = require('../../db');

// Get company info
const getCompanyInfo = async (req, res) => {
    try {
        const result = await pool.query('SELECT name, address, phone, logo_url FROM company_info WHERE id = 1');
        if (result.rows.length === 0) {
            // Provide default if not found, to prevent errors on a fresh DB
            return res.json({ name: 'Koperasi Anda', address: '', phone: '', logo_url: null });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// Update company info
const updateCompanyInfo = async (req, res) => {
    const { name, address, phone } = req.body;
    const logoFile = req.file; // Ambil file logo dari multer

    if (!name) {
        return res.status(400).json({ error: 'Nama perusahaan wajib diisi.' });
    }
    try {
        // Ambil path logo lama jika ada, untuk dihapus nanti (opsional, tapi praktik yang baik)
        const oldInfo = await pool.query('SELECT logo_url FROM company_info WHERE id = 1');
        const oldLogoPath = oldInfo.rows[0]?.logo_url;

        // Tentukan path logo baru, atau gunakan yang lama jika tidak ada file baru yang diunggah
        // FIX: Pastikan logoPath tidak undefined jika oldLogoPath juga tidak ada
        const logoPath = logoFile ? logoFile.path.replace(/\\/g, '/') : (oldLogoPath || null);

        // Use UPSERT (INSERT ... ON CONFLICT) to handle both creation (if table is empty) and update.
        const result = await pool.query(
            `INSERT INTO company_info (id, name, address, phone, logo_url)
             VALUES (1, $1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE
             SET name = $1, address = $2, phone = $3, logo_url = $4
             RETURNING name, address, phone, logo_url`,
            [name, address, phone, logoPath]
        );
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getCompanies = async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const offset = (page - 1) * limit;

    const baseQuery = 'SELECT id, name, address, phone, contract_number, document_url FROM companies';
    const countQuery = 'SELECT COUNT(*) FROM companies';

    try {
        const dataResult = await pool.query(`${baseQuery} ORDER BY name ASC LIMIT $1 OFFSET $2`, [limit, offset]);
        const countResult = await pool.query(countQuery);

        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        res.json({
            data: dataResult.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                limit
            }
        });
    } catch (err) {
        console.error('Error fetching companies:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

const getCompanyById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM companies WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching company with ID ${id}:`, err);
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

const createCompany = async (req, res) => {
    const { name, address, phone, contract_number } = req.body;
    const document_url = req.file ? req.file.path.replace(/\\/g, '/') : null;
    try {
        const result = await pool.query(
            'INSERT INTO companies (name, address, phone, contract_number, document_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, address, phone, contract_number, document_url]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating company:', err);
        res.status(500).json({ error: 'Gagal membuat perusahaan baru.' });
    }
};

const updateCompany = async (req, res) => {
    const { id } = req.params;
    const { name, address, phone, contract_number } = req.body;
    const document_url = req.file ? req.file.path.replace(/\\/g, '/') : req.body.document_url;
    try {
        const result = await pool.query(
            'UPDATE companies SET name = $1, address = $2, phone = $3, contract_number = $4, document_url = $5 WHERE id = $6 RETURNING *',
            [name, address, phone, contract_number, document_url, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating company:', err);
        res.status(500).json({ error: 'Gagal memperbarui perusahaan.' });
    }
};

const deleteCompany = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM companies WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Perusahaan tidak ditemukan.' });
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting company:', err);
        if (err.code === '23503') {
            return res.status(400).json({ error: 'Gagal menghapus. Perusahaan ini masih terhubung dengan data anggota.' });
        }
        res.status(500).json({ error: 'Gagal menghapus perusahaan.' });
    }
};

module.exports = { getCompanyInfo, updateCompanyInfo, getCompanies, getCompanyById, createCompany, updateCompany, deleteCompany };