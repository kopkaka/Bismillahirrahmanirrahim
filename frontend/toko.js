import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const pageTitle = document.querySelector('h1').textContent.toLowerCase();
    const cartItemCountElements = document.querySelectorAll('.cart-item-count'); // Ganti ke class selector
    
    // --- MODAL ELEMENTS ---
    const coopModal = document.getElementById('coop-number-modal');
    const coopNumberInput = document.getElementById('coop-number-input');
    const saveCoopNumberBtn = document.getElementById('save-coop-number-btn');
    const cancelCoopNumberBtn = document.getElementById('cancel-coop-number-btn');
    const coopNumberError = document.getElementById('coop-number-error');

    // --- ELECTRONICS MODAL ELEMENTS ---
    const electronicsModal = document.getElementById('electronics-installment-modal');
    const installmentTenorSelect = document.getElementById('installment-tenor-select');
    const submitInstallmentBtn = document.getElementById('submit-installment-btn');
    const closeInstallmentBtn = document.getElementById('close-installment-modal-btn');
    const cancelInstallmentBtn = document.getElementById('cancel-installment-modal-btn');
    const installmentError = document.getElementById('installment-error');

    let productToAdd = null; // Variable to hold the product when modal is shown
    
    let shopType = '';
    if (pageTitle.includes('sembako')) {
        shopType = 'sembako';
    } else if (pageTitle.includes('elektronik')) {
        shopType = 'elektronik';
    } else if (pageTitle.includes('aplikasi')) {
        shopType = 'aplikasi';
    }

    const formatCurrency = (amount) => {
        if (amount === null || amount === undefined) return 'Rp 0';
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    // --- FUNGSI KERANJANG ---

    const updateCartCount = () => {
        if (cartItemCountElements.length === 0) return; // Jangan lakukan apa-apa jika elemen tidak ada
        const cart = JSON.parse(localStorage.getItem('cart')) || [];
        // Hitung total item, bukan hanya jumlah produk unik
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

        cartItemCountElements.forEach(element => {
            element.textContent = totalItems > 9 ? '9+' : totalItems;
            if (totalItems > 0) {
                element.classList.remove('hidden');
            } else {
                element.classList.add('hidden');
            }
        });
    };

    const addToCart = (product) => {
        // Pemeriksaan keamanan untuk memastikan produk dengan stok 0 tidak bisa ditambahkan
        if (product.stock <= 0) {
            alert(`Maaf, stok untuk "${product.name}" sedang habis.`);
            return;
        }

        let cart = JSON.parse(localStorage.getItem('cart')) || [];
        const existingProductIndex = cart.findIndex(item => item.id === product.id);

        if (existingProductIndex > -1) {
            // Produk sudah ada, tambah kuantitasnya
            if (cart[existingProductIndex].quantity >= product.stock) {
                alert(`Maaf, Anda tidak bisa menambahkan lebih dari stok yang tersedia (${product.stock}) untuk produk "${product.name}".`);
                return;
            }
            cart[existingProductIndex].quantity += 1;
        } else {
            // Produk baru, tambahkan ke keranjang dengan kuantitas 1
            cart.push({ ...product, quantity: 1 });
        }

        localStorage.setItem('cart', JSON.stringify(cart));
        alert(`"${product.name}" telah ditambahkan ke keranjang!`);
        updateCartCount();
    };

    // --- MODAL FUNCTIONS ---
    const showCoopModal = (product) => {
        productToAdd = product;
        if (coopModal) {
            coopModal.classList.remove('hidden');
            // Gunakan timeout singkat untuk memungkinkan properti display berubah sebelum memulai transisi
            setTimeout(() => {
                const modalContent = coopModal.querySelector('[role="dialog"]');
                if (modalContent) {
                    modalContent.classList.remove('scale-95', 'opacity-0');
                    modalContent.classList.add('scale-100', 'opacity-100');
                }
            }, 10);
            coopNumberInput.focus();
        }
    };

    const hideCoopModal = () => {
        if (coopModal) {
            const modalContent = coopModal.querySelector('[role="dialog"]');
            if (modalContent) {
                modalContent.classList.remove('scale-100', 'opacity-100');
                modalContent.classList.add('scale-95', 'opacity-0');
            }
            // Tunggu transisi selesai sebelum menyembunyikan elemen
            setTimeout(() => {
                productToAdd = null;
                if (coopNumberError) coopNumberError.classList.add('hidden');
                coopModal.classList.add('hidden');
            }, 200); // Sesuaikan dengan durasi transisi di HTML
        }
    };

    // --- ELECTRONICS MODAL FUNCTIONS ---
    const showElectronicsModal = async (product) => {
        productToAdd = product;
        if (!electronicsModal) return;

        // Populate product info
        document.getElementById('installment-product-image').src = product.imageUrl;
        document.getElementById('installment-product-name').textContent = product.name;
        document.getElementById('installment-product-price').textContent = formatCurrency(product.price);

        // Fetch and populate tenor options
        installmentTenorSelect.innerHTML = '<option>Memuat tenor...</option>';
        installmentTenorSelect.disabled = true;
        document.getElementById('installment-monthly-payment').classList.add('hidden');

        try {
            // Endpoint baru untuk mengambil tenor kredit elektronik
            const response = await fetch(`${API_URL}/public/loan-terms/elektronik`);
            if (!response.ok) throw new Error('Gagal memuat pilihan cicilan.');
            const tenors = await response.json();

            if (tenors.length === 0) {
                installmentTenorSelect.innerHTML = '<option>Pilihan cicilan tidak tersedia.</option>';
                submitInstallmentBtn.disabled = true;
            } else {
                installmentTenorSelect.innerHTML = '<option value="">-- Pilih Tenor --</option>';
                tenors.forEach(term => {
                    const option = document.createElement('option');
                    option.value = term.id;
                    option.dataset.rate = term.interest_rate;
                    option.textContent = `${term.tenor_months} bulan (bunga ${term.interest_rate}%/tahun)`;
                    installmentTenorSelect.appendChild(option);
                });
                installmentTenorSelect.disabled = false;
                submitInstallmentBtn.disabled = false;
            }
        } catch (error) {
            console.error(error);
            installmentTenorSelect.innerHTML = `<option>${error.message}</option>`;
            submitInstallmentBtn.disabled = true;
        }

        electronicsModal.classList.remove('hidden');
        setTimeout(() => {
            electronicsModal.querySelector('[role="dialog"]').classList.remove('scale-95', 'opacity-0');
        }, 10);
    };

    const hideElectronicsModal = () => {
        if (electronicsModal) {
            const modalContent = electronicsModal.querySelector('[role="dialog"]');
            modalContent.classList.add('scale-95', 'opacity-0');
            setTimeout(() => {
                electronicsModal.classList.add('hidden');
                productToAdd = null;
                installmentError.classList.add('hidden');
            }, 200);
        }
    };


    const createProductCard = (product) => {
        let imageUrl = 'https://placehold.co/400x400?text=Produk';
        if (product.image_url) {
            // Check if it's an external URL or a local path
            imageUrl = product.image_url.startsWith('http') 
                ? product.image_url 
                : `${API_URL.replace('/api', '')}${product.image_url}`;
            // Simpan imageUrl ke objek produk untuk digunakan di modal
            product.imageUrl = imageUrl;
        }

        const isOutOfStock = product.stock <= 0;

        let buttonHtml;
        if (isOutOfStock) {
            buttonHtml = `<span class="text-sm font-semibold text-red-500">Stok Habis</span>`;
        } else if (product.shop_type === 'elektronik') {
            buttonHtml = `<button class="buy-electronic-btn bg-accent text-white px-4 py-2 rounded-lg font-semibold hover:bg-red-800 transition-colors text-sm" data-product-id="${product.id}">Beli dengan Cicilan</button>`;
        } else {
            buttonHtml = `<button 
                    class="add-to-cart-btn bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition-transform transform group-hover:scale-110 focus:outline-none focus:ring-2 focus:ring-green-400"
                    data-product-id="${product.id}"
                    data-product-name="${product.name}"
                    data-product-price="${product.price}"
                    data-product-stock="${product.stock}"
                    data-product-shop-type="${product.shop_type}"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.922.778h9.246a1 1 0 00.97-.743l1.455-5.433A1 1 0 0016.22 0H4.342a1 1 0 00-.97.743L3.07 2.175A.997.997 0 002.148 3H1a1 1 0 100 2h.382l1.438 5.752A3 3 0 007.14 13h5.72a3 3 0 002.92-2.248L17.62 5H7.14a1 1 0 00-.922-.778L5.915 3H4.78a1 1 0 00-.97.743L3.38 4.917l-.305-1.222H1a1 1 0 00-1-1H.5a1 1 0 000 2h.538l.305 1.222a2.99 2.99 0 002.764 2.356h9.246a3 3 0 002.92-2.248L18.38 3H19a1 1 0 100-2h-2.78a3 3 0 00-2.92-2.248L12.86 0H4.342A3 3 0 001.42 2.248L.382 6.752A1 1 0 001.304 8H1a1 1 0 100-2h.382l.305-1.222A1 1 0 002.609 4H3V1zM7 15a2 2 0 100 4 2 2 0 000-4zm8 0a2 2 0 100 4 2 2 0 000-4z" />
                    </svg>
                </button>`;
        }
        
        const stockBadgeHtml = isOutOfStock
            ? `<div class="absolute top-2 right-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-full shadow-lg">STOK HABIS</div>`
            : '';

        return `
            <div class="bg-white rounded-lg shadow-md overflow-hidden group transition-all duration-300 ${isOutOfStock ? 'opacity-60 cursor-not-allowed' : 'hover:shadow-xl hover:-translate-y-1'}">
                <div class="relative">
                    <img src="${imageUrl}" alt="${product.name}" class="w-full h-48 object-cover">
                    ${stockBadgeHtml}
                </div>
                <div class="p-4">
                    <h3 class="text-lg font-semibold text-gray-800 truncate" title="${product.name}">${product.name}</h3>
                    <p class="text-gray-500 text-sm mb-4 h-10">${product.description || ''}</p>
                    <div class="flex justify-between items-center">
                        <span class="text-xl font-bold text-accent">${formatCurrency(product.price)}</span>
                        ${buttonHtml}
                    </div>
                </div>
            </div>
        `;
    };

    const loadPublicProducts = async (type) => {
        if (!productGrid || !type) {
            console.error('Elemen #product-grid tidak ditemukan atau tipe toko tidak valid.');
            return;
        }

        productGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">Memuat produk...</p>';

        try {
            // Endpoint publik yang benar adalah /api/public/products
            const response = await fetch(`${API_URL}/public/products?shop=${type}`);
            if (!response.ok) {
                throw new Error('Gagal memuat produk dari server.');
            }
            const products = await response.json();

            if (products.length === 0) {
                productGrid.innerHTML = `<p class="col-span-full text-center text-gray-500">Belum ada produk yang tersedia di toko ini.</p>`;
                return;
            }

            productGrid.innerHTML = ''; // Kosongkan grid
            products.forEach(product => {
                productGrid.innerHTML += createProductCard(product);
            });

        } catch (error) {
            console.error('Error:', error);
            productGrid.innerHTML = `<p class="col-span-full text-center text-red-500">Terjadi kesalahan saat memuat produk.</p>`;
        }
    };

    if (shopType) {
        loadPublicProducts(shopType);
    }

    // Event delegation untuk tombol "Tambah ke Keranjang"
    productGrid.addEventListener('click', (e) => {
        // Cari elemen tombol terdekat yang diklik
        const button = e.target.closest('.add-to-cart-btn, .buy-electronic-btn');
        if (button) {
            const card = button.closest('.bg-white');
            const name = card.querySelector('h3').textContent;
            const priceText = card.querySelector('.text-accent').textContent;
            const price = parseFloat(priceText.replace(/[^0-9,-]+/g, "").replace(",", "."));
            const stock = parseInt(button.dataset.productStock || '1', 10); // Default to 1 for electronics
            const shopType = button.dataset.productShopType || 'elektronik';
            const imageUrl = card.querySelector('img').src;

            const product = {
                id: button.dataset.productId,
                name: name,
                price: price,
                stock: stock,
                shopType: shopType,
                imageUrl: imageUrl
            };

            const cooperativeNumber = localStorage.getItem('cooperative_number');

            if (!cooperativeNumber) {
                showCoopModal(product);
                return;
            }

            // Jika nomor koperasi sudah ada, lanjutkan ke logika spesifik toko
            if (product.shopType === 'elektronik') {
                showElectronicsModal(product);
            } else {
                addToCart(product);
            }
        }
    });

    productGrid.addEventListener('click', (e) => {
        if (e.target.closest('.buy-electronic-btn')) {
        }
    });

    // Event listener untuk tombol di dalam modal
    if (saveCoopNumberBtn) {
        saveCoopNumberBtn.addEventListener('click', async () => {
            const coopNumber = coopNumberInput.value.trim();
            if (coopNumber === '') {
                coopNumberError.textContent = 'Nomor Koperasi tidak boleh kosong.';
                coopNumberError.classList.remove('hidden');
                return;
            }
            
            // Tampilkan status loading pada tombol
            const originalButtonText = saveCoopNumberBtn.textContent;
            saveCoopNumberBtn.disabled = true;
            saveCoopNumberBtn.textContent = 'Memvalidasi...';
            coopNumberError.classList.add('hidden'); // Sembunyikan error lama

            try {
                // Panggil endpoint validasi di backend
                const response = await fetch(`${API_URL}/auth/validate-coop-number`, {
                    method: 'POST', // Pastikan rute ini menunjuk ke auth.controller.js yang baru
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ cooperativeNumber: coopNumber }),
                });

                const data = await response.json();

                if (!response.ok || !data.valid) {
                    throw new Error(data.error || 'Nomor Koperasi tidak valid atau tidak aktif.');
                }

                // Jika valid, simpan nomor dan nama pengguna
                localStorage.setItem('cooperative_number', data.user.cooperative_number);
                localStorage.setItem('cooperative_user_name', data.user.name);
                
                alert(`Selamat datang, ${data.user.name}!`);

                if (productToAdd) {
                    if (productToAdd.shopType === 'elektronik') {
                        showElectronicsModal(productToAdd);
                    } else {
                        addToCart(productToAdd);
                    }
                }
                hideCoopModal();
            } catch (error) {
                coopNumberError.textContent = error.message;
                coopNumberError.classList.remove('hidden');
            } finally {
                saveCoopNumberBtn.disabled = false;
                saveCoopNumberBtn.textContent = originalButtonText;
            }
        });
    }

    if (cancelCoopNumberBtn) {
        cancelCoopNumberBtn.addEventListener('click', hideCoopModal);
    }

    // --- ELECTRONICS MODAL EVENT LISTENERS ---
    if (electronicsModal) {
        closeInstallmentBtn.addEventListener('click', hideElectronicsModal);
        cancelInstallmentBtn.addEventListener('click', hideElectronicsModal);

        installmentTenorSelect.addEventListener('change', () => {
            const selectedOption = installmentTenorSelect.options[installmentTenorSelect.selectedIndex];
            const monthlyPaymentEl = document.getElementById('installment-monthly-payment');
            if (!selectedOption.value || !productToAdd) {
                monthlyPaymentEl.classList.add('hidden');
                return;
            }

            const price = productToAdd.price;
            const tenor = parseInt(selectedOption.textContent, 10); // e.g., "12 bulan..." -> 12
            const annualRate = parseFloat(selectedOption.dataset.rate);
            const monthlyRate = (annualRate / 100) / 12;

            // Simple interest calculation for estimation
            const totalInterest = price * monthlyRate * tenor;
            const totalPayment = price + totalInterest;
            const monthlyPayment = totalPayment / tenor;

            monthlyPaymentEl.querySelector('span').textContent = formatCurrency(monthlyPayment);
            monthlyPaymentEl.classList.remove('hidden');
        });

        submitInstallmentBtn.addEventListener('click', async () => {
            const loanTermId = installmentTenorSelect.value;
            if (!loanTermId || !productToAdd) {
                installmentError.textContent = 'Silakan pilih tenor pembayaran.';
                installmentError.classList.remove('hidden');
                return;
            }

            const payload = {
                loanTermId: loanTermId,
                amount: productToAdd.price,
                // Backend akan otomatis mengisi loan_type_id dari loan_term_id
            };

            submitInstallmentBtn.disabled = true;
            submitInstallmentBtn.textContent = 'Mengajukan...';
            installmentError.classList.add('hidden');

            try {
                // Menggunakan endpoint pengajuan pinjaman anggota
                const response = await fetch(`${API_URL}/member/loans`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) throw new Error('Gagal mengajukan kredit. Pastikan Anda tidak memiliki pinjaman aktif lain.');
                
                alert(`Pengajuan kredit untuk "${productToAdd.name}" berhasil! Admin akan segera memproses pengajuan Anda.`);
                hideElectronicsModal();
            } catch (error) { installmentError.textContent = error.message; installmentError.classList.remove('hidden'); } finally { submitInstallmentBtn.disabled = false; submitInstallmentBtn.textContent = 'Ajukan Sekarang'; }
        });
    }

    // Perbarui jumlah item di keranjang saat halaman dimuat
    updateCartCount();
});
