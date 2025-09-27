const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create the destination directory if it doesn't exist
const partnerLogoDir = 'uploads/partners/';
if (!fs.existsSync(partnerLogoDir)) {
    fs.mkdirSync(partnerLogoDir, { recursive: true });
}

// Konfigurasi penyimpanan untuk logo mitra
const partnerLogoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, partnerLogoDir);
    },
    filename: (req, file, cb) => {
        cb(null, `partner-${Date.now()}${path.extname(file.originalname)}`);
    }
});

// Filter file untuk hanya menerima gambar
const imageFileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Hanya file gambar yang diizinkan!'), false);
    }
};

const uploadPartnerLogo = multer({ storage: partnerLogoStorage, fileFilter: imageFileFilter });

module.exports = { uploadPartnerLogo };