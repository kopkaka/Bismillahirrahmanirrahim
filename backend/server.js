const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

// --- Main API Router ---
const apiRouter = require('./src/routes/index.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Percayai proxy pertama (misalnya, dari Render).
// Ini diperlukan agar middleware seperti express-rate-limit dapat bekerja dengan benar
// di belakang reverse proxy.
app.set('trust proxy', 1);

// --- Middleware ---

// Konfigurasi CORS yang lebih aman untuk produksi
const allowedOrigins = [
    process.env.FRONTEND_URL, // URL Vercel Anda dari Environment Variable
    'http://127.0.0.1:5500',   // Untuk pengembangan lokal (Live Server)
    'http://localhost:5500'    // Variasi lain untuk pengembangan lokal
];

const corsOptions = {
    origin: function (origin, callback) {
        // Izinkan request tanpa origin (seperti dari Postman) atau dari origin yang ada di whitelist
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
};

app.use(cors(corsOptions));

app.use(express.json()); // Parses incoming JSON requests

// Serves uploaded files (e.g., KTP photos, logos) statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- API Routes ---
app.get('/', (req, res) => res.send('KOPKAKA API is running successfully!'));

// Mount the main API router. Semua rute API harus dikelola di dalam file ini.
app.use('/api', apiRouter);

// --- Server Startup ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});