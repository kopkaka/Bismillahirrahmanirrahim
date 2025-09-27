import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('login-form');
    const errorMessage = document.getElementById('error-message');
    const emailInput = document.getElementById('email');
    const rememberMeCheckbox = document.getElementById('remember-me');

    // --- Fitur "Ingat Saya" (Remember Me) ---
    // Saat halaman dimuat, periksa apakah ada email yang tersimpan
    const savedEmail = localStorage.getItem('remembered_email');
    if (savedEmail) {
        emailInput.value = savedEmail;
        rememberMeCheckbox.checked = true;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.classList.add('hidden');
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;

        const email = emailInput.value;
        const password = document.getElementById('password').value;

        // Ubah teks tombol menjadi loading
        submitButton.disabled = true;
        submitButton.textContent = 'Memproses...';

        try {
            const response = await fetch(`${API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Login gagal. Periksa kembali email dan password Anda.');
            }

            // --- Logika "Ingat Saya" ---
            if (rememberMeCheckbox.checked) {
                // Jika dicentang, simpan email
                localStorage.setItem('remembered_email', email);
            } else {
                // Jika tidak, hapus email yang tersimpan
                localStorage.removeItem('remembered_email');
            }

            // Simpan token dan info pengguna
            localStorage.setItem('token', data.token);
            localStorage.setItem('user_name', data.user.name);
            localStorage.setItem('user_role', data.user.role);

            // Arahkan pengguna berdasarkan peran (role)
            if (data.user.role === 'admin' || data.user.role === 'akunting' || data.user.role === 'manager') {
                window.location.href = 'admin.html';
            } else {
                window.location.href = 'anggota.html';
            }

        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.classList.remove('hidden');
        } finally {
            // Kembalikan tombol ke keadaan semula
            submitButton.disabled = false;
            submitButton.textContent = originalButtonText;
        }
    });
});