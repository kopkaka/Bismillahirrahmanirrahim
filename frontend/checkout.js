import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const checkoutSuccessEl = document.getElementById('checkout-success');
    const checkoutFailEl = document.getElementById('checkout-fail');

    // Elements for success case
    const orderIdEl = document.getElementById('order-id');
    const orderDateEl = document.getElementById('order-date');
    const orderMemberNameEl = document.getElementById('order-member-name');
    const orderCoopNumberEl = document.getElementById('order-coop-number');
    const orderItemsTableEl = document.getElementById('order-items-table');
    const orderTotalEl = document.getElementById('order-total');
    const qrcodeContainer = document.getElementById('qrcode-container');
    const printBtn = document.getElementById('print-btn');
    const finishBtn = document.getElementById('finish-btn');

    const formatCurrency = (amount) => {
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    const loadOrderData = async () => {
        const orderId = sessionStorage.getItem('checkoutOrderId');
        if (!orderId) {
            checkoutFailEl.classList.remove('hidden');
            checkoutSuccessEl.classList.add('hidden');
            return;
        }

        try {
            // Ambil detail pesanan lengkap dari backend menggunakan orderId
            const response = await fetch(`${API_URL}/public/sales/${orderId}`);
            const orderData = await response.json();
            if (!response.ok) throw new Error(orderData.error || 'Gagal memuat detail pesanan.');

            checkoutFailEl.classList.add('hidden');
            checkoutSuccessEl.classList.remove('hidden');

            // Isi detail pesanan
            orderIdEl.textContent = orderData.orderId;
            orderDateEl.textContent = new Date(orderData.timestamp).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
            orderMemberNameEl.textContent = orderData.user.name;
            orderCoopNumberEl.textContent = orderData.user.coopNumber;

            // Isi rincian barang
            orderItemsTableEl.innerHTML = '';
            orderData.items.forEach(item => {
                const row = document.createElement('tr');
                const itemSubtotal = item.price * item.quantity;
                row.innerHTML = `
                    <td class="py-2 text-left">${item.name}</td>
                    <td class="py-2 text-center">${item.quantity}</td>
                    <td class="py-2 text-right">${formatCurrency(itemSubtotal)}</td>
                `;
                orderItemsTableEl.appendChild(row);
            });

            // Isi total
            orderTotalEl.textContent = formatCurrency(orderData.total);

            // Buat QR Code dari seluruh objek data pesanan
            qrcodeContainer.innerHTML = ''; // Hapus QR code sebelumnya
            new QRCode(qrcodeContainer, {
                text: JSON.stringify(orderData),
                width: 200,
                height: 200,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });

        } catch (error) {
            console.error('Error loading order data:', error);
            checkoutFailEl.querySelector('p').textContent = error.message;
            checkoutFailEl.classList.remove('hidden');
            checkoutSuccessEl.classList.add('hidden');
        }
    };

    // Event Listeners
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }

    if (finishBtn) {
        finishBtn.addEventListener('click', () => {
            sessionStorage.removeItem('checkoutOrderId');
        });
    }

    // Initial load
    loadOrderData();
});