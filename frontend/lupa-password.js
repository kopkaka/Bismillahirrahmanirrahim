import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('forgot-password-form');
    const emailInput = document.getElementById('email');
    const feedbackMessage = document.getElementById('feedback-message');
    const submitButton = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value;
        submitButton.disabled = true;
        submitButton.textContent = 'Mengirim...';
        feedbackMessage.classList.add('hidden');

        try {
            const response = await fetch(`${API_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            feedbackMessage.textContent = data.message;
            feedbackMessage.className = 'text-sm text-center p-3 rounded-md';
            feedbackMessage.classList.add(response.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
            feedbackMessage.classList.remove('hidden');

        } catch (error) {
            feedbackMessage.textContent = 'Gagal terhubung ke server. Silakan coba lagi nanti.';
            feedbackMessage.className = 'text-sm text-center p-3 rounded-md bg-red-100 text-red-800';
            feedbackMessage.classList.remove('hidden');
        } finally {
            // Wait a bit before re-enabling the button so the user can read the message
            setTimeout(() => {
                submitButton.disabled = false;
                submitButton.textContent = 'Kirim Tautan Reset';
            }, 2000);
        }
    });
});