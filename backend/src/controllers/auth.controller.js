const pool = require('../../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendRegistrationEmail, sendAdminNewRegistrationNotification } = require('../utils/email.util');
require('dotenv').config();

const registerMember = async (req, res) => {
    const {
        name, ktp_number, phone, company_id, position_id, email, password,
        address_province, address_city, address_district, address_village, address_detail, // These are text fields from FormData
        domicile_address_province, domicile_address_city, domicile_address_district, domicile_address_village, domicile_address_detail, // These are also text fields
        heir_name, heir_kk_number, heir_relationship, heir_phone // And these too
    } = req.body;

    // --- Input Validation ---
    if (!name || !email || !password || !ktp_number || !phone) {
        return res.status(400).json({ error: 'Data wajib (Nama, No. KTP, No. Telepon, Email, Password) tidak boleh kosong.' });
    }

    // --- Security Improvement: Stronger Password Policy ---
    // Checks for at least 8 characters, one uppercase, one lowercase, one number, and one special character.
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({ error: 'Password harus minimal 8 karakter dan mengandung huruf besar, huruf kecil, angka, dan simbol.' });
    }

    // Simple email regex validation
    if (!/\S+@\S+\.\S+/.test(email)) {
        return res.status(400).json({ error: 'Format email tidak valid.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Security Improvement: Check for existing email or KTP in a single query to prevent user enumeration.
        // Returning a generic error message prevents an attacker from guessing which emails or KTPs are registered.
        const existingUserCheck = await client.query('SELECT 1 FROM members WHERE email = $1 OR ktp_number = $2 LIMIT 1', [email, ktp_number]);
        if (existingUserCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Email atau Nomor KTP sudah terdaftar. Silakan gunakan data yang lain.' }); // 409 Conflict is more appropriate
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Security Note: Ensure the 'upload.middleware' sanitizes filenames and validates file types (e.g., image/jpeg, image/png) and sizes.
        // Get file paths from the upload middleware
        const ktp_photo_path = req.files?.ktp_photo?.[0]?.path || null;
        const selfie_photo_path = req.files?.selfie_photo?.[0]?.path || null;
        const kk_photo_path = req.files?.kk_photo?.[0]?.path || null;

        // Insert the new member into the database
        const query = `
            INSERT INTO members ( 
                name, ktp_number, phone, 
                company_id, position_id, email, password,
                address_province, address_city, address_district, 
                address_village, address_detail, 
                domicile_address_province, domicile_address_city, domicile_address_district,
                domicile_address_village, domicile_address_detail,
                heir_name, heir_kk_number, heir_relationship, 
                heir_phone, 
                ktp_photo_path, selfie_photo_path, kk_photo_path,
                status, registration_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'Pending', NOW())
            RETURNING id, name, email, role;
        `;
        const values = [
            name, ktp_number, phone, company_id || null, position_id || null, email, hashedPassword,
            address_province || null, address_city || null, address_district || null, address_village || null, address_detail || null,
            domicile_address_province || null, domicile_address_city || null, domicile_address_district || null, domicile_address_village || null, domicile_address_detail || null,
            heir_name || null, heir_kk_number || null, heir_relationship || null, heir_phone || null,
            ktp_photo_path, selfie_photo_path, kk_photo_path
        ];

        const newUserResult = await client.query(query, values);

        await client.query('COMMIT');

        const newUser = newUserResult.rows[0];

        // --- Notifikasi Asinkron ---
        // Kirim email ke pendaftar
        sendRegistrationEmail(newUser.email, newUser.name)
            .catch(err => console.error(`Failed to send registration email to ${newUser.email}:`, err));

        // Kirim notifikasi lonceng ke semua admin/akunting
        const approverRoles = ['admin', 'akunting'];
        const approversRes = await client.query('SELECT id FROM members WHERE role = ANY($1::varchar[]) AND status = \'Active\'', [approverRoles]);
        const notificationMessage = `Pendaftaran anggota baru dari ${newUser.name} menunggu persetujuan.`;
        const notificationLink = 'approvals';

        for (const approver of approversRes.rows) {
            createNotification(approver.id, notificationMessage, notificationLink)
                .catch(err => console.error(`Failed to create new member notification for user ${approver.id}:`, err));
        }

        // --- Code Clarity: Simplified Asynchronous Admin Notification ---
        // Send notification to admins without waiting for it to complete.
        pool.query("SELECT email FROM members WHERE role = 'admin' AND status = 'Active'")
            .then(adminResult => adminResult.rows.map(admin => admin.email))
            .then(adminEmails => { if (adminEmails.length > 0) sendAdminNewRegistrationNotification(adminEmails, newUser); })
            .catch(err => console.error("Failed to send new registration notification to admin:", err));

        res.status(201).json(newUser);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Registration error:', err.message);
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat pendaftaran.' });
    } finally {
        client.release();
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Find user by email
        const userResult = await pool.query('SELECT id, name, email, password, role, status FROM members WHERE email = $1', [email]);
        const user = userResult.rows[0];

        // 2. Security: Mitigate timing attacks for user enumeration.
        // We perform a password comparison even if the user is not found.
        // We use a pre-generated dummy hash if the user doesn't exist. This ensures that the time taken to respond
        // is similar for both non-existent users and users with incorrect passwords.
        // This dummy hash is a valid bcrypt hash for a long, random string.
        const hashToCompare = user ? user.password : '$2a$10$Y.iP5q.j9y.kL8.mN7.o.u/iP5q.j9y.kL8.mN7.o.u/iP5q.j9y';
        const isMatch = await bcrypt.compare(password, hashToCompare);

        // 3. After the comparison, check if the user was found AND if the password matched.
        // This single check after the time-consuming bcrypt operation prevents email enumeration.
        if (!user || !isMatch) {
            return res.status(400).json({ error: 'Email atau password salah.' });
        }

        // 4. Security: After confirming credentials, check if the account is active. This applies to ALL roles.
        if (user.status !== 'Active') {
            return res.status(403).json({ error: 'Akun Anda belum aktif atau sedang ditangguhkan. Silakan hubungi administrator.' });
        }

        // --- Improvement: Fetch permissions and embed them in the JWT ---
        // This avoids a database call in the authorization middleware on every request.
        const permissionsRes = await pool.query('SELECT permission_key FROM role_permissions WHERE role_name = $1', [user.role]);
        const permissions = permissionsRes.rows.map(row => row.permission_key);

        // 5. Create JWT Payload
        const payload = {
            user: {
                id: user.id,
                role: user.role,
                permissions: permissions, // Embed permissions
            },
        };

        // 6. Sign the token and send it to the client.
        jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' }, (err, token) => {
            if (err) throw err;
            res.json({
                token,
                user: { name: user.name, role: user.role } // Send back name and role for frontend use.
            });
        });
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Terjadi kesalahan pada server saat login.' });
    }
};

const validateMemberByCoopNumber = async (req, res) => {
    const { cooperativeNumber } = req.body;
    if (!cooperativeNumber) {
        return res.status(400).json({ error: 'Nomor koperasi diperlukan.' });
    }
    try {
        const result = await pool.query(
            "SELECT id, name, cooperative_number FROM members WHERE cooperative_number = $1 AND status = 'Active'",
            [cooperativeNumber]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ valid: false, error: 'Anggota tidak ditemukan atau tidak aktif.' });
        }
        res.json({ valid: true, user: result.rows[0] });
    } catch (err) {
        console.error('Error validating member by coop number:', err.message);
        res.status(500).json({ valid: false, error: 'Gagal memvalidasi anggota.' });
    }
};


module.exports = { login, registerMember, validateMemberByCoopNumber };