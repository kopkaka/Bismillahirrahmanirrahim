const nodemailer = require('nodemailer');
require('dotenv').config();

// Konfigurasi transporter Nodemailer yang fleksibel
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: (process.env.EMAIL_PORT === '465'), // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    // Opsi TLS ini penting untuk Gmail dan banyak provider lain
    tls: {
        // Jangan gagal pada sertifikat self-signed (berguna untuk beberapa setup lokal)
        rejectUnauthorized: process.env.NODE_ENV === 'production'
    }
});

const sendRegistrationEmail = async (to, name) => {
    // Fungsi ini "fire and forget". Error akan di-log tetapi tidak akan menghentikan alur program.
    const mailOptions = {
        from: `"Koperasi Karya Kagum Abadi" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Pendaftaran Anggota KOPKAKA Berhasil',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #B91C1C;">Selamat Datang di KOPKAKA, ${name}!</h2>
                <p>Terima kasih telah mendaftar sebagai calon anggota Koperasi Karya Kagum Abadi (KOPKAKA).</p>
                <p>Pendaftaran Anda telah kami terima dan saat ini sedang dalam proses peninjauan oleh administrator kami.</p>
                <p>Anda akan menerima email pemberitahuan selanjutnya setelah pendaftaran Anda disetujui. Setelah disetujui, Anda dapat masuk ke akun Anda menggunakan email dan password yang telah Anda daftarkan.</p>
                <br>
                <p>Terima kasih atas kesabaran Anda.</p>
                <br>
                <p>Hormat kami,</p>
                <p><strong>Tim KOPKAKA</strong></p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Registration email sent to ${to}`);
    } catch (error) {
        console.error(`Failed to send registration email to ${to}:`, error);
    }
};

const sendApprovalEmail = async (to, name) => {
    // Fungsi ini "fire and forget". Error akan di-log tetapi tidak akan menghentikan alur program.
    const mailOptions = {
        from: `"Koperasi Karya Kagum Abadi" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Pendaftaran Anggota KOPKAKA Disetujui!',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #16A34A;">Selamat, ${name}! Akun Anda Telah Aktif.</h2>
                <p>Kami dengan senang hati memberitahukan bahwa pendaftaran Anda sebagai anggota Koperasi Karya Kagum Abadi (KOPKAKA) telah disetujui.</p>
                <p>Anda sekarang dapat masuk ke akun Anda menggunakan email dan password yang telah Anda daftarkan sebelumnya.</p>
                <p style="text-align: center; margin: 20px 0;">
                    <a href="http://127.0.0.1:5500/login.html" style="background-color: #B91C1C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Masuk ke Akun Anda</a>
                </p>
                <p>Jika Anda memiliki pertanyaan, jangan ragu untuk menghubungi kami.</p>
                <br>
                <p>Hormat kami,</p>
                <p><strong>Tim KOPKAKA</strong></p>
            </div>
        `,
    };
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Approval email sent to ${to}`);
    } catch (error) {
        console.error(`Failed to send approval email to ${to}:`, error);
    }
};

const sendAdminNewRegistrationNotification = async (adminEmails, newMember) => {
    // Fungsi ini "fire and forget". Error akan di-log tetapi tidak akan menghentikan alur program.
    if (!adminEmails || adminEmails.length === 0) {
        console.log("No admin emails found to send notification.");
        return;
    }

    const mailOptions = {
        from: `"Notifikasi Sistem KOPKAKA" <${process.env.EMAIL_USER}>`,
        to: adminEmails.join(', '), // Kirim ke semua admin
        subject: 'Pendaftaran Anggota Baru Menunggu Persetujuan',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #B91C1C;">Pendaftaran Anggota Baru</h2>
                <p>Halo Admin,</p>
                <p>Seorang anggota baru telah mendaftar dan menunggu persetujuan Anda. Detail pendaftar:</p>
                <ul>
                    <li><strong>Nama:</strong> ${newMember.name}</li>
                    <li><strong>Email:</strong> ${newMember.email}</li>
                </ul>
                <p>Silakan masuk ke panel admin untuk meninjau dan memproses pendaftaran ini.</p>
                <p style="text-align: center; margin: 20px 0;"><a href="http://127.0.0.1:5500/admin.html" style="background-color: #B91C1C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Buka Panel Admin</a></p>
                <p>Terima kasih.</p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Admin notification sent for new member ${newMember.email}`);
    } catch (error) {
        console.error(`Failed to send admin notification for ${newMember.email}:`, error);
    }
};

const sendPasswordResetEmail = async (to, name, resetUrl) => {
    const mailOptions = {
        from: `"Koperasi Karya Kagum Abadi" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Permintaan Reset Password Akun KOPKAKA Anda',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #B91C1C;">Reset Password Anda, ${name}</h2>
                <p>Kami menerima permintaan untuk mereset password akun KOPKAKA Anda. Klik tombol di bawah ini untuk melanjutkan.</p>
                <p>Tautan ini hanya berlaku selama <strong>10 menit</strong>.</p>
                <p style="text-align: center; margin: 20px 0;">
                    <a href="${resetUrl}" style="background-color: #B91C1C; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Password</a>
                </p>
                <p>Jika Anda tidak merasa meminta reset password, silakan abaikan email ini.</p>
                <br>
                <p>Hormat kami,</p>
                <p><strong>Tim KOPKAKA</strong></p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Password reset email sent to ${to}`);
    } catch (error) {
        console.error(`Failed to send password reset email to ${to}:`, error);
        // Di produksi, Anda mungkin ingin melempar error ini agar bisa ditangani lebih lanjut
    }
};

const sendPasswordResetConfirmationEmail = async (to, name) => {
    const mailOptions = {
        from: `"Koperasi Karya Kagum Abadi" <${process.env.EMAIL_USER}>`,
        to: to,
        subject: 'Password Akun KOPKAKA Anda Telah Diubah',
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <h2 style="color: #16A34A;">Password Berhasil Diubah</h2>
                <p>Halo ${name},</p>
                <p>Ini adalah konfirmasi bahwa password untuk akun KOPKAKA Anda telah berhasil diubah.</p>
                <p>Jika Anda tidak melakukan perubahan ini, segera hubungi administrator kami.</p>
                <br>
                <p>Hormat kami,</p>
                <p><strong>Tim KOPKAKA</strong></p>
            </div>
        `,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Password reset confirmation email sent to ${to}`);
    } catch (error) {
        console.error(`Failed to send password reset confirmation email to ${to}:`, error);
    }
};

module.exports = {
    sendRegistrationEmail,
    sendApprovalEmail,
    sendAdminNewRegistrationNotification,
    sendPasswordResetEmail,
    sendPasswordResetConfirmationEmail,
};