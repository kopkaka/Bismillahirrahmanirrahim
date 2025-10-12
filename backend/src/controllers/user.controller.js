const pool = require('../../db');
const bcrypt = require('bcryptjs');
const { createNotification } = require('../utils/notification.util');

const getUsers = async (req, res) => {
    const { role, status: statusFilter } = req.query;
    try {
        let query = `
            SELECT id, name, email, role, status, cooperative_number
            FROM members 
        `;
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (role) {
            conditions.push(`role = $${paramIndex++}`);
            params.push(role);
        }
        if (statusFilter) {
            conditions.push(`status = $${paramIndex++}`);
            params.push(statusFilter);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY 
            CASE role 
                WHEN 'admin' THEN 1 
                WHEN 'manager' THEN 2 
                WHEN 'akunting' THEN 3 
                ELSE 4 
            END, 
            name ASC `;
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching all users:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengguna.' });
    }
};

/**
 * @desc    Create a new user (staff or member) by an admin.
 * @route   POST /api/admin/users
 * @access  Private (Admin)
 */
const createUser = async (req, res) => {
    const { name, email, password, role, status, company_id, position_id } = req.body;

    // --- Validation ---
    if (!name || !email || !password || !role || !status) {
        return res.status(400).json({ error: 'Nama, Email, Password, Role, dan Status wajib diisi.' });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Password harus minimal 8 karakter dan mengandung huruf besar, huruf kecil, angka, dan simbol.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check for existing email
        const existingUser = await client.query('SELECT id FROM members WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: 'Email sudah terdaftar.' });
        }

    // --- LOGIKA BARU ---
    // Jika role adalah staf (bukan member), pastikan statusnya 'Active'.
    let finalStatus = status;
    if (['admin', 'manager', 'akunting', 'kasir'].includes(role)) {
        finalStatus = 'Active';
    }
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user
        const query = `
            INSERT INTO members (name, email, password, role, status, company_id, position_id, registration_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING id, name, email, role, status;
        `;
        const values = [
            name, email, hashedPassword, role, status,
            company_id || null,
            position_id || null
        ];

        const newUserResult = await client.query(query, values);
        
        await client.query('COMMIT');

        // Optionally, create a notification for the new user
        createNotification(newUserResult.rows[0].id, `Selamat datang! Akun Anda telah dibuat oleh admin.`, 'profile').catch(err => console.error(err));

        res.status(201).json(newUserResult.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating user:', err.message);
        res.status(500).json({ error: 'Gagal membuat pengguna baru.' });
    } finally {
        client.release();
    }
};

const updateUser = async (req, res) => {
    const { id: targetUserId } = req.params;
    const { id: currentUserId } = req.user;
    const { name, phone, company_id, position_id, status, role: newRole, password } = req.body;
    const client = await pool.connect();

    if (!name || !status || !newRole) {
        return res.status(400).json({ error: 'Nama, Status, dan Role wajib diisi.' });
    }
    const validRoles = ['admin', 'manager', 'akunting', 'member', 'kasir'];
    if (!validRoles.includes(newRole)) {
        return res.status(400).json({ error: 'Role yang diberikan tidak valid.' });
    }

    // Tambahkan validasi password jika password baru diberikan saat update
    if (password) {
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            return res.status(400).json({ error: 'Password baru harus minimal 8 karakter dan mengandung huruf besar, huruf kecil, angka, dan simbol.' });
        }
    }

    try {
        await client.query('BEGIN');

        const userRes = await client.query('SELECT role, status FROM members WHERE id = $1 FOR UPDATE', [targetUserId]);
        if (userRes.rows.length === 0) {
            throw new Error('Pengguna tidak ditemukan.');
        }
        const { role: currentRole } = userRes.rows[0];

        if (parseInt(targetUserId, 10) === currentUserId) {
            if (status !== 'Active') {
                throw new Error('Anda tidak dapat mengubah status akun Anda sendiri menjadi tidak aktif.');
            }
            if (newRole !== currentRole) {
                throw new Error('Anda tidak dapat mengubah role Anda sendiri.');
            }
        }

        if (currentRole === 'admin' && newRole !== 'admin') {
            const adminCountRes = await client.query("SELECT COUNT(*) FROM members WHERE role = 'admin'");
            if (parseInt(adminCountRes.rows[0].count, 10) <= 1) {
                throw new Error('Tidak dapat mengubah role admin terakhir. Harus ada minimal satu admin.');
            }
        }

        // --- LOGIKA BARU ---
        // Jika role diubah menjadi staf, paksakan status menjadi 'Active'.
        let finalStatus = status;
        if (['admin', 'manager', 'akunting', 'kasir'].includes(newRole)) {
            finalStatus = 'Active';
        }
        let query;
        const values = [];

        // Jika ada password baru, hash dan sertakan dalam query UPDATE
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            query = `
                UPDATE members 
                SET name = $1, phone = $2, company_id = $3, position_id = $4, status = $5, role = $6, password = $7, updated_at = NOW()
                WHERE id = $8
                RETURNING id, name, email, role, status;
            `;
            values.push(name, phone || null, company_id || null, position_id || null, finalStatus, newRole, hashedPassword, targetUserId);
        } else {
            // Jika tidak ada password baru, jangan update kolom password
            query = `
            UPDATE members 
                SET name = $1, phone = $2, company_id = $3, position_id = $4, status = $5, role = $6, updated_at = NOW()
                WHERE id = $7
                RETURNING id, name, email, role, status;
            `;
            values.push(name, phone || null, company_id || null, position_id || null, finalStatus, newRole, targetUserId);
        }

        const result = await client.query(query, values);
        
        await client.query('COMMIT');
        res.json(result.rows[0]);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating user:', err.message);
        const isClientError = err.message.includes('Anda tidak dapat') || err.message.includes('admin terakhir') || err.message.includes('Pengguna tidak ditemukan');
        res.status(isClientError ? 403 : 500).json({ error: err.message || 'Gagal memperbarui data pengguna.' });
    } finally {
        client.release();
    }
};

const deleteUser = async (req, res) => {
    const { id: targetUserId } = req.params;
    const { id: currentUserId } = req.user;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (parseInt(targetUserId, 10) === currentUserId) throw new Error('Anda tidak dapat menghapus akun Anda sendiri.');

        const userRes = await client.query('SELECT role FROM members WHERE id = $1', [targetUserId]);
        if (userRes.rows.length === 0) throw new Error('Pengguna tidak ditemukan.');
        
        if (userRes.rows[0].role === 'admin') {
            const adminCountRes = await client.query("SELECT COUNT(*) FROM members WHERE role = 'admin'");
            if (parseInt(adminCountRes.rows[0].count, 10) <= 1) throw new Error('Tidak dapat menghapus admin terakhir. Harus ada minimal satu admin.');
        }

        const savingsCheck = await client.query('SELECT id FROM savings WHERE member_id = $1 LIMIT 1', [targetUserId]);
        if (savingsCheck.rows.length > 0) throw new Error('Tidak dapat menghapus pengguna yang memiliki riwayat simpanan. Ubah status menjadi "Inactive".');
        const loansCheck = await client.query('SELECT id FROM loans WHERE member_id = $1 LIMIT 1', [targetUserId]);
        if (loansCheck.rows.length > 0) throw new Error('Tidak dapat menghapus pengguna yang memiliki riwayat pinjaman. Ubah status menjadi "Inactive".');

        await client.query('DELETE FROM members WHERE id = $1', [targetUserId]);
        
        await client.query('COMMIT');
        res.status(204).send();
    } catch (err) { await client.query('ROLLBACK'); console.error('Error deleting user:', err.message); res.status(400).json({ error: err.message }); } finally { client.release(); }
};

module.exports = {
    getUsers,
    createUser,
    updateUser,
    deleteUser,
};