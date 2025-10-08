import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const cartItemsContainer = document.getElementById('cart-items-container');
    const cartEmptyMessage = document.getElementById('cart-empty-message');
    const summarySubtotal = document.getElementById('summary-subtotal');
    const summaryTotal = document.getElementById('summary-total');
    const checkoutBtn = document.getElementById('checkout-btn');

    const formatCurrency = (amount) => {
        if (amount === null || amount === undefined) return 'Rp 0';
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    const getCart = () => JSON.parse(localStorage.getItem('cart')) || [];
    const saveCart = (cart) => localStorage.setItem('cart', JSON.stringify(cart));

    const renderCart = () => {
        const cart = getCart();
        cartItemsContainer.innerHTML = ''; // Clear previous content

        if (cart.length === 0) {
            cartItemsContainer.appendChild(cartEmptyMessage);
            cartEmptyMessage.classList.remove('hidden');
            checkoutBtn.disabled = true;
            updateSummary(0);
            return;
        }

        cartEmptyMessage.classList.add('hidden');
        checkoutBtn.disabled = false;

        let subtotal = 0;

        cart.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'p-4 flex items-center justify-between';
            itemElement.dataset.productId = item.id;

            const itemSubtotal = item.price * item.quantity;
            subtotal += itemSubtotal;

            itemElement.innerHTML = `
                <div class="flex items-center gap-4">
                    <div>
                        <p class="font-semibold text-gray-800">${item.name}</p>
                        <p class="text-sm text-gray-500">${formatCurrency(item.price)}</p>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="flex items-center border rounded-md">
                        <button class="update-quantity-btn px-2 py-1 text-gray-600 hover:bg-gray-100" data-action="decrease">-</button>
                        <input type="number" value="${item.quantity}" class="quantity-input w-12 text-center border-l border-r" min="1">
                        <button class="update-quantity-btn px-2 py-1 text-gray-600 hover:bg-gray-100" data-action="increase">+</button>
                    </div>
                    <p class="font-semibold w-24 text-right">${formatCurrency(itemSubtotal)}</p>
                    <button class="remove-item-btn text-gray-400 hover:text-red-500">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
            `;
            cartItemsContainer.appendChild(itemElement);
        });

        updateSummary(subtotal);
    };

    const updateSummary = (subtotal) => {
        summarySubtotal.textContent = formatCurrency(subtotal);
        summaryTotal.textContent = formatCurrency(subtotal); // Untuk saat ini, total sama dengan subtotal
    };

    const updateItemQuantity = (productId, newQuantity) => {
        let cart = getCart();
        const productIndex = cart.findIndex(item => item.id === productId);

        if (productIndex > -1) {
            if (newQuantity > 0) {
                cart[productIndex].quantity = newQuantity;
            } else {
                // Jika kuantitas 0 atau kurang, hapus item
                cart.splice(productIndex, 1);
            }
            saveCart(cart);
            renderCart();
        }
    };

    const removeItem = (productId) => {
        let cart = getCart();
        cart = cart.filter(item => item.id !== productId);
        saveCart(cart);
        renderCart();
    };

    // Event Delegation untuk aksi di keranjang
    cartItemsContainer.addEventListener('click', (e) => {
        const target = e.target;
        const itemElement = target.closest('.p-4');
        if (!itemElement) return;
        const productId = itemElement.dataset.productId;

        // Handle tombol update kuantitas (+/-)
        if (target.matches('.update-quantity-btn')) {
            const action = target.dataset.action;
            const input = itemElement.querySelector('.quantity-input');
            let currentQuantity = parseInt(input.value, 10);
            if (action === 'increase') {
                currentQuantity++;
            } else if (action === 'decrease') {
                currentQuantity--;
            }
            updateItemQuantity(productId, currentQuantity);
        }

        // Handle tombol hapus
        if (target.closest('.remove-item-btn')) {
            if (confirm('Anda yakin ingin menghapus item ini dari keranjang?')) {
                removeItem(productId);
            }
        }
    });

    // Handle perubahan input kuantitas secara manual
    cartItemsContainer.addEventListener('change', (e) => {
        if (e.target.matches('.quantity-input')) {
            const itemElement = e.target.closest('.p-4');
            const productId = itemElement.dataset.productId;
            const newQuantity = parseInt(e.target.value, 10);
            updateItemQuantity(productId, newQuantity);
        }
    });

    // Handle checkout button click
    if (checkoutBtn) {
        checkoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            const cart = getCart();
            const coopNumber = localStorage.getItem('cooperative_number');

            if (cart.length === 0) {
                alert('Keranjang Anda kosong.');
                return;
            }

            if (!coopNumber) {
                alert('Sesi Anda telah berakhir. Silakan kembali ke toko untuk memasukkan Nomor Koperasi Anda lagi.');
                window.location.href = 'toko-sembako.html'; // Redirect to a store page
                return;
            }

            const originalButtonText = checkoutBtn.textContent;
            checkoutBtn.disabled = true;
            checkoutBtn.textContent = 'Memproses...';

            try {
                // 1. Dapatkan token dari localStorage
                const token = localStorage.getItem('token');
                if (!token) throw new Error('Sesi tidak valid. Silakan login kembali.');

                // 2. Siapkan payload untuk membuat pesanan
                const shopType = cart.length > 0 ? cart[0].shopType : null;
                if (!shopType) throw new Error('Tipe toko tidak terdefinisi di keranjang.');

                const orderPayload = {
                    items: cart.map(item => ({ productId: item.id, quantity: item.quantity })),
                    // Metode pembayaran akan ditentukan oleh kasir, jadi kita kirim null.
                    paymentMethod: null, 
                    shopType: shopType
                };

                // 3. Panggil API untuk membuat pesanan
                const response = await fetch(`${API_URL}/admin/member/sales`, { // FIX: Menggunakan endpoint admin yang benar
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(orderPayload)
                });

                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Gagal memproses checkout.');

                // 4. Simpan HANYA orderId dan redirect ke halaman checkout
                sessionStorage.setItem('checkoutOrderId', result.orderId);
                saveCart([]); // Kosongkan keranjang setelah berhasil
                window.location.href = 'checkout.html';

            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
                checkoutBtn.disabled = false;
                checkoutBtn.textContent = originalButtonText;
            }
        });
    }

    // Render keranjang saat halaman dimuat
    renderCart();
});