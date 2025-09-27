const bcrypt = require('bcryptjs');
const { Pool } = require('pg'); // Gunakan Pool langsung untuk fleksibilitas
require('dotenv').config();

// Ambil argumen dari baris perintah, lewati 2 argumen pertama (node dan path skrip)
const args = process.argv.slice(2);

let adminData;

// Cek apakah argumen yang diperlukan (email, password, nama) diberikan
if (args.length >= 3) {
    console.log('Menggunakan data dari argumen baris perintah...');
    adminData = {
        email: args[0],
        password: args[1],
        name: args[2],
        cooperative_number: args[3] || `ADM-${Date.now().toString().slice(-6)}`, // Gunakan argumen ke-4 atau buat nomor acak
        role: 'admin',
        status: 'Active'
    };
} else {
    console.log('Argumen tidak lengkap. Menggunakan data dari file .env...');
    adminData = {
        name: process.env.ADMIN_NAME || 'Admin Utama',
        cooperative_number: process.env.ADMIN_COOP_NUMBER || 'ADM-001',
        email: process.env.ADMIN_EMAIL || 'admin@kopkaka.com',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        role: 'admin',
        status: 'Active'
    };
}

// --- Konfigurasi Database ---
// Prioritaskan DATABASE_URL dari environment Render, jika tidak ada, gunakan dari .env
const connectionConfig = process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Diperlukan untuk koneksi ke Render
    }
} : {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
};

const pool = new Pool(connectionConfig);

const createOrUpdateAdmin = async () => {
    let client;
    console.log('Mencoba koneksi ke database...');
    try {
        client = await pool.connect();
        console.log('Koneksi database berhasil. Mencoba membuat atau memperbarui pengguna admin...');
        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminData.password, salt);

        // Cek apakah admin dengan email atau Nomor Koperasi yang sama sudah ada
        const existingAdmin = await client.query("SELECT id FROM members WHERE email = $1 OR cooperative_number = $2", [adminData.email, adminData.cooperative_number]);

        if (existingAdmin.rows.length > 0) {
            // Jika sudah ada, UPDATE password dan datanya
            const adminId = existingAdmin.rows[0].id;
            console.log(`Pengguna admin dengan ID ${adminId} ditemukan. Memperbarui data...`);
            const updateQuery = `
                UPDATE members 
                SET name = $1, email = $2, password = $3, role = $4, status = $5, approval_date = NOW()
                WHERE id = $6
                RETURNING id, name, email, role;
            `;
            const updateValues = [
                adminData.name,
                adminData.email,
                hashedPassword,
                adminData.role,
                adminData.status,
                adminId
            ];
            const result = await client.query(updateQuery, updateValues);
            console.log('Pengguna admin berhasil diperbarui:');
            console.log(result.rows[0]);
        } else {
            // Jika belum ada, INSERT admin baru
            console.log('Pengguna admin tidak ditemukan. Membuat pengguna baru...');
            const insertQuery = `
                INSERT INTO members (name, cooperative_number, email, password, role, status, approval_date)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                RETURNING id, name, email, role;
            `;
            const insertValues = [
                adminData.name,
                adminData.cooperative_number,
                adminData.email,
                hashedPassword,
                adminData.role,
                adminData.status
            ];
            const result = await client.query(insertQuery, insertValues);
            console.log('Pengguna admin berhasil dibuat:');
            console.log(result.rows[0]);
        }

    } catch (error) {
        // Memberikan pesan error yang lebih spesifik jika otentikasi database gagal
        if (error.code === '28P01') {
            console.error('\nFATAL: Gagal koneksi ke database. Password otentikasi gagal.');
            console.error('Pastikan DB_USER dan DB_PASSWORD di file .env sudah benar.\n');
        } else if (error.code === 'ECONNREFUSED') {
            console.error('\nFATAL: Gagal koneksi ke database. Koneksi ditolak.');
            console.error('Pastikan host database dan port sudah benar. Di Render, pastikan variabel DATABASE_URL sudah di-set.\n');
        } else {
            console.error('Gagal membuat atau memperbarui pengguna admin:', error);
        }
    } finally {
        if (client) await client.release();
        await pool.end(); // Tutup semua koneksi di pool
        console.log('Proses selesai. Koneksi database ditutup.');
    }
};

createOrUpdateAdmin();