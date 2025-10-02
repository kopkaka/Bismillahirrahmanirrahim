// File: config.js
 
 // Karena ini adalah proyek JavaScript vanilla (tanpa build tool),
 // kita tidak bisa menggunakan process.env langsung di browser.
 // Sebagai gantinya, kita deteksi lingkungan berdasarkan hostname.
 
 const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
 
 // Selalu gunakan URL backend produksi.
 const API_URL = 'https://kopkaka-5i8e.onrender.com/api';
 
 // Export variabel agar bisa diimpor di file lain
 export { API_URL };
