const bcrypt = require('bcryptjs');
const pool = require('../../db');
require('dotenv').config({ path: '../.env' }); // Pastikan path ke file .env benar

/**
 * Skrip untuk membuat pengguna admin baru dari baris perintah.
 *
 * Cara Penggunaan:
 * node scripts/create-admin.js <nama_lengkap> <email> <password>
 *
 * Contoh:
 * node scripts/create-admin.js "Admin Utama" "admin@kopkaka.com" "password123"
 */

const createAdmin = async () => {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error('Penggunaan: node scripts/create-admin.js "<nama_lengkap>" <email> <password>');
        process.exit(1);
    }

    const [name, email, password] = args;

    if (!email.includes('@')) {
        console.error('Error: Format email tidak valid.');
        process.exit(1);
    }

    if (password.length < 8) {
        console.error('Error: Password harus memiliki minimal 8 karakter.');
        process.exit(1);
    }

    const client = await pool.connect();

    try {
        // Periksa apakah email sudah ada
        const existingUser = await client.query('SELECT id FROM members WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            console.error(`Error: Pengguna dengan email "${email}" sudah ada.`);
            process.exit(1);
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Masukkan pengguna baru dengan role 'admin' dan status 'Active'
        const query = `
            INSERT INTO members (name, email, password, role, status, approval_date)
            VALUES ($1, $2, $3, 'admin', 'Active', NOW())
            RETURNING id, name, email, role, status;
        `;

        // --- LOGIKA BARU: Sinkronkan hak akses untuk peran 'admin' ---
        // Ini memastikan peran 'admin' selalu memiliki semua hak akses yang terdaftar di tabel 'permissions'.
        // 1. Hapus semua hak akses lama untuk peran 'admin'.
        await client.query("DELETE FROM role_permissions WHERE role_name = 'admin'");
        // 2. Sisipkan kembali semua hak akses yang ada saat ini.
        await client.query("INSERT INTO role_permissions (role_name, permission_key) SELECT 'admin', key FROM permissions");
        console.log('🔧 Hak akses untuk peran "admin" telah disinkronkan.');

        const result = await client.query(query, [name, email, hashedPassword]);
        const newUser = result.rows[0];

        console.log('✅ Pengguna admin berhasil dibuat:');
        console.log({
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            status: newUser.status,
        });

    } catch (error) {
        console.error('❌ Gagal membuat pengguna admin:', error.message);
    } finally {
        await client.release();
        await pool.end(); // Tutup koneksi pool setelah selesai
    }
};

createAdmin();