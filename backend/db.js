const { Pool } = require('pg');
require('dotenv').config();

// Konfigurasi yang fleksibel untuk development dan production (Render)
const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = {
  // Gunakan DATABASE_URL di produksi (Render)
  connectionString: process.env.DATABASE_URL,
  // Di produksi, koneksi ke Render memerlukan SSL
  // Di development, kita tidak perlu SSL
  ...(isProduction && {
    ssl: {
      rejectUnauthorized: false,
    },
  }),
};

// Jika tidak di produksi, gunakan konfigurasi lokal dari .env
const pool = isProduction
  ? new Pool(connectionConfig)
  : new Pool(); // Pool() tanpa argumen akan otomatis membaca variabel PG* dari .env

module.exports = pool;