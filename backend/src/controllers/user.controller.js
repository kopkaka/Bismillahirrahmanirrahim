const pool = require('../../db');
const bcrypt = require('bcryptjs');

// @desc    Get all users (members, admin, etc.)
// @route   GET /api/admin/users
const getUsers = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name, email, role, status FROM members ORDER BY name');
        res.json(result.rows);
    } catch (err) {
        console.error('Error getting users:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengguna.' });
    }
};

// @desc    Create a new user (staff)
// @route   POST /api/admin/users
const createUser = async (req, res) => {
    const { name, email, password, role, status, phone, company_id, position_id } = req.body;

    if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'Nama, email, password, dan role wajib diisi.' });
    }

    if (password.length < 8) {
        return res.status(400).json({ error: 'Password harus minimal 8 karakter.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existingUser = await client.query('SELECT id FROM members WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email sudah terdaftar.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const query = `
            INSERT INTO members (name, email, password, role, status, phone, company_id, position_id, registration_date, approval_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING id, name, email, role, status;
        `;
        const values = [
            name, email, hashedPassword, role, status || 'Active', phone || null,
            company_id || null, position_id || null
        ];

        const result = await client.query(query, values);

        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating user:', err.message);
        res.status(500).json({ error: 'Gagal membuat pengguna baru.' });
    } finally {
        client.release();
    }
};

// @desc    Update a user
// @route   PUT /api/admin/users/:id
const updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, phone, company_id, position_id, status, role, password } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const fields = [];
        const values = [];
        let queryIndex = 1;

        if (name) { fields.push(`name = $${queryIndex++}`); values.push(name); }
        if (phone) { fields.push(`phone = $${queryIndex++}`); values.push(phone); }
        if (company_id) { fields.push(`company_id = $${queryIndex++}`); values.push(company_id); }
        if (position_id) { fields.push(`position_id = $${queryIndex++}`); values.push(position_id); }
        if (status) { fields.push(`status = $${queryIndex++}`); values.push(status); }
        if (role) { fields.push(`role = $${queryIndex++}`); values.push(role); }

        if (password) {
            if (password.length < 8) throw new Error('Password baru harus minimal 8 karakter.');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            fields.push(`password = $${queryIndex++}`);
            values.push(hashedPassword);
        }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Tidak ada data untuk diperbarui.' });
        }

        const query = `UPDATE members SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${queryIndex} RETURNING id, name, email, role, status`;
        values.push(id);

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating user:', err.message);
        res.status(500).json({ error: err.message || 'Gagal memperbarui pengguna.' });
    } finally {
        client.release();
    }
};

// @desc    Delete a user
// @route   DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM members WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting user:', err.message);
        res.status(500).json({ error: 'Gagal menghapus pengguna.' });
    }
};


module.exports = {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
};

