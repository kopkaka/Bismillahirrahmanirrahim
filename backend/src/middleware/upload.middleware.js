const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Fungsi untuk memastikan direktori ada
const ensureDir = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Konfigurasi penyimpanan Multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = 'uploads/';
        // Bedakan tujuan berdasarkan nama field
        if (file.fieldname === 'logo' || file.fieldname === 'partnerLogo') { // Ditambahkan partnerLogo
            uploadPath = path.join(uploadPath, 'logo');
        } else if (file.fieldname === 'productImage') {
            uploadPath = path.join(uploadPath, 'products');
        } else if (file.fieldname === 'testimonialPhoto') {
            uploadPath = path.join(uploadPath, 'testimonials');
        } else { // Default untuk unggahan lain seperti KTP, selfie, dll.
            // Default untuk unggahan lain seperti KTP, dll.
            uploadPath = path.join(uploadPath, 'documents');
        }
        ensureDir(uploadPath);
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        // Buat nama file unik untuk menghindari konflik
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Filter file untuk hanya menerima gambar
const fileFilter = (req, file, cb) => {
    // Hanya terima gambar untuk field-field tertentu
    if (['logo', 'partnerLogo', 'productImage', 'testimonialPhoto'].includes(file.fieldname) && !file.mimetype.startsWith('image/')) {
        return cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
    if (['ktp_photo', 'selfie_photo', 'kk_photo', 'proof'].includes(file.fieldname) && !file.mimetype.startsWith('image/')) {
        return cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
    cb(null, true);
};

const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }); // Batas 5MB

module.exports = upload;