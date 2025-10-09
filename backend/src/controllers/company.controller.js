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
        const logoPath = logoFile ? logoFile.path.replace(/\\/g, '/') : oldLogoPath;

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

module.exports = { getCompanyInfo, updateCompanyInfo };