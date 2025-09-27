const pool = require('../../db');
const fs = require('fs');
const path = require('path');

// @desc    Get all partners for admin
// @route   GET /api/admin/partners
const getPartners = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM partners ORDER BY display_order, name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @desc    Get a single partner by ID
// @route   GET /api/admin/partners/:id
const getPartnerById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM partners WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Mitra tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @desc    Create a new partner
// @route   POST /api/admin/partners
const createPartner = async (req, res) => {
    const { name, website_url } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Logo wajib diunggah.' });
    const logo_url = req.file.path.replace(/\\/g, '/');

    try {
        const result = await pool.query(
            'INSERT INTO partners (name, website_url, logo_url) VALUES ($1, $2, $3) RETURNING *',
            [name, website_url, logo_url]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// @desc    Update a partner
// @route   PUT /api/admin/partners/:id
const updatePartner = async (req, res) => {
    const { id } = req.params;
    const { name, website_url } = req.body;
    let logo_url;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldPartnerRes = await client.query('SELECT logo_url FROM partners WHERE id = $1', [id]);
        const oldLogoPath = oldPartnerRes.rows[0]?.logo_url;

        if (req.file) {
            logo_url = req.file.path.replace(/\\/g, '/');
            if (oldLogoPath) {
                // FIX: Construct the absolute path from the project root directory, handling leading slashes.
                const fullOldPath = path.resolve(process.cwd(), oldLogoPath.startsWith('/') ? oldLogoPath.substring(1) : oldLogoPath);
                fs.unlink(fullOldPath, err => {
                    // If the file doesn't exist, it's not a critical error, so we only log other errors.
                    if (err && err.code !== 'ENOENT') {
                        console.error("Gagal hapus logo lama:", err);
                    }
                });
            }
        } else {
            logo_url = oldLogoPath;
        }

        const result = await client.query(
            'UPDATE partners SET name = $1, website_url = $2, logo_url = $3 WHERE id = $4 RETURNING *',
            [name, website_url, logo_url, id]
        );
        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// @desc    Delete a partner
// @route   DELETE /api/admin/partners/:id
const deletePartner = async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldPartnerRes = await client.query('SELECT logo_url FROM partners WHERE id = $1', [id]);
        const logoPath = oldPartnerRes.rows[0]?.logo_url;

        await client.query('DELETE FROM partners WHERE id = $1', [id]);
        await client.query('COMMIT');

        if (logoPath) {
            // FIX: Construct the absolute path from the project root directory, handling leading slashes.
            const fullPath = path.resolve(process.cwd(), logoPath.startsWith('/') ? logoPath.substring(1) : logoPath);
            fs.unlink(fullPath, err => {
                if (err && err.code !== 'ENOENT') {
                    console.error("Gagal hapus file logo:", err);
                }
            });
        }
        res.status(204).send();
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

module.exports = { getPartners, createPartner, updatePartner, deletePartner, getPartnerById };