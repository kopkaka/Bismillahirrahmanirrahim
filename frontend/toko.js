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
    const creditModal = document.getElementById('credit-application-modal');
    const creditForm = document.getElementById('credit-application-form');
    const categoryNav = document.getElementById('category-navigation');

    // --- ELEMEN SIDEBAR KATEGORI MOBILE ---
    const categorySidebar = document.getElementById('category-sidebar');
    const openCategorySidebarBtn = document.getElementById('open-category-sidebar-btn');
    const closeCategorySidebarBtn = document.getElementById('close-category-sidebar-btn');
    const categorySidebarOverlay = document.getElementById('category-sidebar-overlay');
    let allProducts = []; // To store all fetched products

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
            // Tombol untuk cicilan elektronik dihapus sesuai permintaan
            buttonHtml = '';
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
            <div class="card-product bg-white rounded-lg shadow-md overflow-hidden group transition-all duration-300 flex flex-col ${isOutOfStock ? 'opacity-60' : 'hover:shadow-xl'}">
                <div class="relative">
                    <img src="${imageUrl}" alt="${product.name}" class="w-full h-40 object-cover">
                    ${stockBadgeHtml}
                </div>
                <div class="p-4 flex-grow flex flex-col">
                    <h3 class="text-lg font-semibold text-gray-800 truncate" title="${product.name}">${product.name}</h3>
                    <div class="mt-auto pt-4">
                        <span class="text-xl font-bold text-accent">${formatCurrency(product.price)}</span>
                    </div>
                </div>
            </div>
        `;
    };

    const handleCategoryDisplay = () => {
        const params = new URLSearchParams(window.location.search);
        const category = params.get('category');

        // Hapus kelas 'active' dari semua link kategori
        if (categoryNav) {
            categoryNav.querySelectorAll('.category-link').forEach(l => l.classList.remove('active'));
        }

        if (category && categoryNav) {
            // Jika ada kategori di URL, tampilkan produknya
            const activeLink = categoryNav.querySelector(`.category-link[data-category="${category}"]`);
            if (activeLink) {
                activeLink.classList.add('active');
            }
            filterProductsByCategory(category);
        } else {
            // Jika tidak ada kategori di URL, tampilkan semua produk
            filterProductsByCategory('all');
        }
    };
    const displayProducts = (productsToDisplay, category) => {
        if (!productGrid) return;
        productGrid.innerHTML = ''; // Kosongkan grid
        if (productsToDisplay.length === 0) {
            productGrid.innerHTML = `<p class="col-span-full text-center text-gray-500">Tidak ada produk yang ditemukan untuk kategori ini.</p>`;
            return;
        }
        productsToDisplay.forEach(product => {
            productGrid.innerHTML += createProductCard(product);
        });
    };

    const filterProductsByCategory = (category) => {
        const categoryKeywords = {
            tv_audio: ['tv', 'led', 'audio', 'soundbar', 'speaker'],
            kulkas: ['kulkas', 'freezer', 'refrigerator'],
            ac: ['ac', 'air conditioner', 'pendingin'],
            mesin_cuci: ['mesin cuci', 'washing machine'],
            handphone: ['handphone', 'smartphone', 'iphone', 'samsung', 'oppo', 'vivo', 'xiaomi'],
            komputer: ['laptop', 'komputer', 'pc', 'notebook']
        };

        if (category === 'all') {
            displayProducts(allProducts, 'all');
            return;
        }

        const keywords = categoryKeywords[category] || [];
        const filtered = allProducts.filter(product => {
            const productName = product.name.toLowerCase();
            return keywords.some(keyword => productName.includes(keyword));
        });

        displayProducts(filtered, category);
    };

    const loadPublicProducts = async (type) => {
        if (!productGrid || !type) {
            // console.error('Elemen #product-grid tidak ditemukan atau tipe toko tidak valid.');
            return;
        }

        displayProducts([]); // Clear grid and show loading/empty message
        productGrid.innerHTML = '<p class="col-span-full text-center text-gray-500">Memuat produk...</p>'; // Loading message

        try {
            // Endpoint publik yang benar adalah /api/public/products
            const response = await fetch(`${API_URL}/public/products?shop=${type}`);
            if (!response.ok) {
                throw new Error('Gagal memuat produk dari server.');
            }
            allProducts = await response.json();

            if (allProducts.length === 0) {
                productGrid.innerHTML = `<p class="col-span-full text-center text-gray-500">Belum ada produk yang tersedia di toko ini.</p>`;
                return;
            }

            handleCategoryDisplay(); // Tampilkan konten berdasarkan URL saat halaman dimuat
        } catch (error) {
            console.error('Error:', error);
            productGrid.innerHTML = `<p class="col-span-full text-center text-red-500">Terjadi kesalahan saat memuat produk.</p>`;
        }
    };

    // Perbarui jumlah item di keranjang saat halaman dimuat
    updateCartCount();

    if (shopType) {
        loadPublicProducts(shopType);
    }

    if (categoryNav) {
        categoryNav.addEventListener('click', (e) => {
            e.preventDefault();
            const link = e.target.closest('.category-link');
            if (!link) return;

            const category = link.dataset.category;
            const url = new URL(window.location);
            url.searchParams.set('category', category);

            // Gunakan history.pushState untuk mengubah URL tanpa memuat ulang halaman
            history.pushState({ category: category }, '', url);

            // Tampilkan produk berdasarkan kategori yang baru dipilih
            handleCategoryDisplay();
        });
    }

    // Tambahkan event listener untuk tombol back/forward browser
    window.addEventListener('popstate', handleCategoryDisplay);

    // --- FUNGSI SIDEBAR KATEGORI MOBILE ---
    const openCategorySidebar = () => {
        if (categorySidebar && categorySidebarOverlay) {
            categorySidebar.classList.remove('-translate-x-full');
            categorySidebar.classList.add('translate-x-0');
            categorySidebarOverlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // Mencegah scroll di background
        }
    };

    const closeCategorySidebar = () => {
        if (categorySidebar && categorySidebarOverlay) {
            categorySidebar.classList.remove('translate-x-0');
            categorySidebar.classList.add('-translate-x-full');
            categorySidebarOverlay.classList.add('hidden');
            document.body.style.overflow = ''; // Mengizinkan scroll kembali
        }
    };

    // Event Listeners untuk Sidebar Kategori
    openCategorySidebarBtn?.addEventListener('click', openCategorySidebar);
    closeCategorySidebarBtn?.addEventListener('click', closeCategorySidebar);
    categorySidebarOverlay?.addEventListener('click', closeCategorySidebar);
});
