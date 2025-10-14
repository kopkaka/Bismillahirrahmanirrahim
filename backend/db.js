require('dotenv').config();
const { Pool } = require('pg');

// Konfigurasi yang fleksibel untuk development dan production (Render)
const isProduction = process.env.NODE_ENV === 'production';

const connectionConfig = isProduction
  ? {
      // Konfigurasi untuk produksi (Render)
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false,
      },
    }
  : {
      // Konfigurasi untuk development (lokal)
      host: process.env.PGHOST,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      port: process.env.PGPORT,
    };

// Buat pool dengan konfigurasi yang sesuai
const pool = new Pool(connectionConfig);

module.exports = pool;