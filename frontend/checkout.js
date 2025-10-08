import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const successContainer = document.getElementById('checkout-success');
    const failContainer = document.getElementById('checkout-fail');
    const printBtn = document.getElementById('print-btn');

    const formatCurrency = (amount) => {
        if (amount === null || amount === undefined) return 'Rp 0';
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    const loadOrderDetails = async () => {
        const orderId = sessionStorage.getItem('checkoutOrderId');

        if (!orderId) {
            successContainer.classList.add('hidden');
            failContainer.classList.remove('hidden');
            return;
        }

        try {
            // Menggunakan endpoint baru yang lebih sesuai untuk publik
            const response = await fetch(`${API_URL}/public/sales/${orderId}`);
            const orderDetails = await response.json();

            if (!response.ok) {
                throw new Error(orderDetails.error || 'Gagal memuat detail pesanan.');
            }

            // Validasi data yang diterima
            if (!orderDetails.orderId || !orderDetails.user || !orderDetails.items) {
                throw new Error('Data pesanan tidak lengkap.');
            }

            // Tampilkan data ke elemen HTML
            document.getElementById('order-id').textContent = orderDetails.orderId;
            document.getElementById('order-date').textContent = formatDate(orderDetails.timestamp);
            document.getElementById('order-member-name').textContent = orderDetails.user.name;
            document.getElementById('order-coop-number').textContent = orderDetails.user.coopNumber;
            document.getElementById('order-total').textContent = formatCurrency(orderDetails.total);

            const itemsTableBody = document.getElementById('order-items-table');
            itemsTableBody.innerHTML = '';
            orderDetails.items.forEach(item => {
                const row = `
                    <tr>
                        <td class="py-2 text-left">${item.name}</td>
                        <td class="py-2 text-center">${item.quantity}</td>
                        <td class="py-2 text-right">${formatCurrency(item.price * item.quantity)}</td>
                    </tr>
                `;
                itemsTableBody.innerHTML += row;
            });

            // Generate QR Code
            const qrcodeContainer = document.getElementById('qrcode-container');
            qrcodeContainer.innerHTML = ''; // Hapus QR code sebelumnya
            new QRCode(qrcodeContainer, {
                text: JSON.stringify({ orderId: orderDetails.orderId }), // Hanya sertakan orderId di QR
                width: 180,
                height: 180,
                colorDark: "#7f1d1d", // Warna merah KOPKAKA
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });

            successContainer.classList.remove('hidden');
            failContainer.classList.add('hidden');

            // Hapus orderId dari session storage setelah berhasil ditampilkan
            // agar halaman tidak bisa di-refresh dengan data yang sama.
            sessionStorage.removeItem('checkoutOrderId');

        } catch (error) {
            console.error('Error loading order details:', error);
            successContainer.classList.add('hidden');
            failContainer.classList.remove('hidden');
            failContainer.querySelector('p').textContent = error.message;
        }
    };

    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    loadOrderDetails();
});