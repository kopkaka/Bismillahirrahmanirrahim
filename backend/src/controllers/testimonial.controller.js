const pool = require('../../db');
const fs = require('fs');
const path = require('path');

/**
 * @desc    Get all testimonials for the admin panel
 * @route   GET /api/admin/testimonials
 * @access  Private (Admin with manageTestimonials permission)
 */
const getTestimonials = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching testimonials:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

/**
 * @desc    Get all testimonials for the public landing page
 * @route   GET /api/public/testimonials
 * @access  Public
 */
const getPublicTestimonials = async (req, res) => {
    try {
        // Hanya ambil testimoni yang relevan, mungkin bisa ditambahkan kolom is_featured di masa depan
        const result = await pool.query('SELECT name, division, text, photo_url FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public testimonials:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

/**
 * @desc    Get a single testimonial by ID
 * @route   GET /api/admin/testimonials/:id
 * @access  Private (Admin with manageTestimonials permission)
 */
const getTestimonialById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM testimonials WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Testimoni tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching testimonial by ID:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

/**
 * @desc    Create a new testimonial
 * @route   POST /api/admin/testimonials
 * @access  Private (Admin with manageTestimonials permission)
 */
const createTestimonial = async (req, res) => {
    const { name, division, text } = req.body;
    const photoPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    if (!name || !text) {
        return res.status(400).json({ error: 'Nama dan teks testimoni wajib diisi.' });
    }

    try {
        const query = `
            INSERT INTO testimonials (name, division, text, photo_url)
            VALUES ($1, $2, $3, $4)
            RETURNING *;
        `;
        const result = await pool.query(query, [name, division, text, photoPath]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating testimonial:', err.message);
        res.status(500).json({ error: 'Gagal membuat testimoni.' });
    }
};

/**
 * @desc    Update an existing testimonial
 * @route   PUT /api/admin/testimonials/:id
 * @access  Private (Admin with manageTestimonials permission)
 */
const updateTestimonial = async (req, res) => {
    const { id } = req.params;
    const { name, division, text } = req.body;
    const newPhotoPath = req.file ? req.file.path.replace(/\\/g, '/') : null;

    if (!name || !text) {
        return res.status(400).json({ error: 'Nama dan teks testimoni wajib diisi.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Dapatkan path foto lama jika ada foto baru yang diunggah
        let oldPhotoPath = null;
        if (newPhotoPath) {
            const oldData = await client.query('SELECT photo_url FROM testimonials WHERE id = $1', [id]);
            if (oldData.rows.length > 0) {
                oldPhotoPath = oldData.rows[0].photo_url;
            }
        }

        const query = `
            UPDATE testimonials
            SET name = $1, division = $2, text = $3, photo_url = COALESCE($4, photo_url)
            WHERE id = $5
            RETURNING *;
        `;
        const result = await client.query(query, [name, division, text, newPhotoPath, id]);

        if (result.rows.length === 0) {
            throw new Error('Testimoni tidak ditemukan.');
        }

        await client.query('COMMIT');

        // Hapus file foto lama jika ada yang baru
        if (oldPhotoPath) {
            const fullOldPath = path.resolve(process.cwd(), oldPhotoPath);
            fs.unlink(fullOldPath, (err) => {
                if (err) console.error(`Gagal menghapus file foto lama: ${fullOldPath}`, err);
            });
        }

        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating testimonial:', err.message);
        res.status(err.message.includes('tidak ditemukan') ? 404 : 500).json({ error: err.message || 'Gagal memperbarui testimoni.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Delete a testimonial
 * @route   DELETE /api/admin/testimonials/:id
 * @access  Private (Admin with manageTestimonials permission)
 */
const deleteTestimonial = async (req, res) => {
    const { id } = req.params;
    try {
        const deleteRes = await pool.query('DELETE FROM testimonials WHERE id = $1 RETURNING photo_url', [id]);
        if (deleteRes.rowCount === 0) {
            return res.status(404).json({ error: 'Testimoni tidak ditemukan.' });
        }
        const { photo_url } = deleteRes.rows[0];
        if (photo_url) {
            const fullPath = path.resolve(process.cwd(), photo_url);
            fs.unlink(fullPath, (err) => { if (err) console.error(`Gagal menghapus file foto: ${fullPath}`, err); });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting testimonial:', err.message);
        res.status(500).json({ error: 'Gagal menghapus testimoni.' });
    }
};

module.exports = {
    getTestimonials,
    getPublicTestimonials,
    getTestimonialById,
    createTestimonial,
    updateTestimonial,
    deleteTestimonial,
};