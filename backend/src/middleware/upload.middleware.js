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
        if (['logo', 'partnerLogo'].includes(file.fieldname)) {
            uploadPath = path.join(uploadPath, 'logo');
        } else if (file.fieldname === 'productImage') {
            uploadPath = path.join(uploadPath, 'products');
        } else if (file.fieldname === 'testimonialPhoto') {
            uploadPath = path.join(uploadPath, 'testimonials');
        } else if (['ktp_photo', 'selfie_photo', 'kk_photo', 'proof', 'savingsFile', 'accountsFile'].includes(file.fieldname)) {
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
    const imageFields = ['logo', 'partnerLogo', 'productImage', 'testimonialPhoto', 'ktp_photo', 'selfie_photo', 'kk_photo', 'proof'];
    const excelFields = ['savingsFile', 'accountsFile'];

    if (imageFields.includes(file.fieldname) && !file.mimetype.startsWith('image/')) {
        return cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }

    if (excelFields.includes(file.fieldname) && !['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.mimetype)) {
        return cb(new Error('Hanya file Excel (.xlsx, .xls) yang diizinkan!'), false);
    }

    cb(null, true);
};

const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: 5 * 1024 * 1024 } }); // Batas 5MB

module.exports = upload;