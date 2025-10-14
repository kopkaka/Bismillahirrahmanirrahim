const pool = require('../../db');

/**
 * @desc    Get ALL announcements for admin management (including drafts)
 * @route   GET /api/admin/announcements/all
 * @access  Private (Admin)
 */
const getAllAnnouncements = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all announcements for admin:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Get all announcements
 * @route   GET /api/admin/announcements
 * @access  Private (Admin)
 */
const getAnnouncements = async (req, res) => {
    try {
        // FIX: Only fetch published announcements for general view (both admin and member)
        // Admin can see drafts on the specific "Manage Announcements" page.
        const query = `
            SELECT * FROM announcements 
            WHERE is_published = TRUE 
            ORDER BY created_at DESC LIMIT 5`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching announcements:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Get a single announcement by ID
 * @route   GET /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const getAnnouncementById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching announcement by id [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

/**
 * @desc    Update an announcement
 * @route   PUT /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const updateAnnouncement = async (req, res) => {
    const { id } = req.params;
    const { title, content, is_published } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Judul dan isi pengumuman wajib diisi.' });
    }
    try {
        const query = `UPDATE announcements SET title = $1, content = $2, is_published = $3, updated_at = NOW() WHERE id = $4 RETURNING *;`;
        const result = await pool.query(query, [title, content, is_published === 'true' || is_published === true, id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating announcement [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal memperbarui pengumuman.' });
    }
};

/**
 * @desc    Delete an announcement
 * @route   DELETE /api/admin/announcements/:id
 * @access  Private (Admin)
 */
const deleteAnnouncement = async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
        if (deleteOp.rowCount === 0) return res.status(404).json({ error: 'Pengumuman tidak ditemukan.' });
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting announcement [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal menghapus pengumuman.' });
    }
};

/**
 * @desc    Create a new announcement
 * @route   POST /api/admin/announcements
 * @access  Private (Admin)
 */
const createAnnouncement = async (req, res) => {
    const { title, content, is_published } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Judul dan isi pengumuman wajib diisi.' });
    }
    try {
        const query = `
            INSERT INTO announcements (title, content, is_published) 
            VALUES ($1, $2, $3) 
            RETURNING *;
        `;
        const result = await pool.query(query, [title, content, is_published === 'true' || is_published === true]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating announcement:', err.message);
        res.status(500).json({ error: 'Gagal membuat pengumuman baru.' });
    }
};

module.exports = {
    getAllAnnouncements, // For admin management page
    getAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
};