import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', async () => {
    const resetContainer = document.getElementById('reset-container');
    const messageContainer = document.getElementById('message-container');
    const loadingMessage = document.getElementById('loading-message');
    const form = document.getElementById('reset-password-form');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const feedbackMessage = document.getElementById('feedback-message');
    const submitButton = form.querySelector('button[type="submit"]');

    // 1. Dapatkan token dari URL
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
        loadingMessage.textContent = 'Token reset tidak ditemukan. Silakan coba lagi dari email Anda.';
        return;
    }

    // 2. Validasi token ke backend
    try {
        const response = await fetch(`${API_URL}/auth/reset/${token}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Token tidak valid atau kedaluwarsa.');
        }

        // Jika token valid, tampilkan form reset
        messageContainer.classList.add('hidden');
        resetContainer.classList.remove('hidden');

    } catch (error) {
        loadingMessage.textContent = error.message;
        loadingMessage.classList.add('text-red-600');
        return;
    }

    // 3. Handle submit form reset password
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        feedbackMessage.classList.add('hidden');

        if (password !== confirmPassword) {
            feedbackMessage.textContent = 'Password dan konfirmasi password tidak cocok.';
            feedbackMessage.className = 'text-sm text-center text-red-600';
            return;
        }

        if (password.length < 8) {
            feedbackMessage.textContent = 'Password harus minimal 8 karakter.';
            feedbackMessage.className = 'text-sm text-center text-red-600';
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Menyimpan...';

        try {
            const response = await fetch(`${API_URL}/auth/reset/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            });

            const data = await response.json();
            feedbackMessage.textContent = data.message;
            feedbackMessage.className = 'text-sm text-center p-3 rounded-md';
            feedbackMessage.classList.add(response.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');

            if (response.ok) {
                submitButton.textContent = 'Berhasil!';
                setTimeout(() => { window.location.href = 'login.html'; }, 3000);
            } else {
                submitButton.disabled = false;
                submitButton.textContent = 'Simpan Password Baru';
            }
        } catch (error) {
            feedbackMessage.textContent = 'Gagal terhubung ke server.';
            feedbackMessage.className = 'text-sm text-center p-3 rounded-md bg-red-100 text-red-800';
            submitButton.disabled = false;
            submitButton.textContent = 'Simpan Password Baru';
        }
    });
});