import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL CONFIG & ELEMENTS ---
    const MEMBER_API_URL = `${API_URL}/member`;
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const menuButton = document.getElementById('menu-button');
    const allLinks = document.querySelectorAll('.sidebar-link, .quick-link-btn, .profile-dropdown-link');
    const contentSections = document.querySelectorAll('.content-section');
    const sidebarLinks = document.querySelectorAll('.sidebar-link');

    // --- AUTH & USER INFO ---
    const token = localStorage.getItem('token');
    const userName = localStorage.getItem('user_name');
    const userRole = localStorage.getItem('user_role');

    // --- CHART INSTANCES ---
    let savingsChartInstance = null;
    let loansChartInstance = null;
    let transactionsChartInstance = null;
    let shuChartInstance = null;
    let cashFlowChartInstance = null;
    let memberGrowthChartInstance = null;
    let incomeStatementChartInstance = null;
    let balanceSheetChartInstance = null;

    let dashboardUpdateInterval = null; // Variabel untuk menyimpan interval update
    let notificationInterval = null; // Variabel untuk notifikasi
    let lastKnownNotificationTimestamp = null; // Untuk melacak notifikasi terakhir
    // --- AUTH CHECK ---
    const checkAuth = () => {
        if (!token || userRole !== 'member') {
            alert('Akses ditolak. Silakan masuk sebagai anggota.');
            localStorage.clear();
            window.location.href = 'login.html';
            return false;
        }
        document.getElementById('member-name-header').textContent = userName || 'Anggota';
        document.getElementById('member-name-welcome').textContent = userName || 'Anggota';
        // The profile icon will be loaded in loadProfileData
        return true;
    };

    // --- HELPER FUNCTIONS ---
    const formatCurrency = (amount) => {
        if (amount === null || amount === undefined) return 'Rp 0';
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const options = { day: '2-digit', month: 'short', year: 'numeric' };
        return new Date(dateString).toLocaleDateString('id-ID', options);
    };

    const formatRelativeTime = (dateString) => {
        if (!dateString) return '';
        const now = new Date();
        const past = new Date(dateString);
        const seconds = Math.floor((now - past) / 1000);
    
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + " tahun lalu";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + " bulan lalu";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + " hari lalu";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + " jam lalu";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + " menit lalu";
        return "Baru saja";
    };

    const apiFetch = async (endpoint, options = {}) => {
        // Improvement: Get the token just-in-time to ensure it's the most current one.
        const currentToken = localStorage.getItem('token');
        const headers = {
            'Authorization': `Bearer ${currentToken}`,
            ...options.headers
        };
    
        // Do not set Content-Type for FormData, browser will do it with the correct boundary.
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }
    
        const response = await fetch(endpoint, { ...options, headers });
    
        // Handle critical auth errors first (session expired, etc.)
        if (response.status === 401 || response.status === 403) {
            alert('Sesi Anda telah berakhir atau tidak valid. Silakan masuk kembali.');
            localStorage.clear();
            window.location.href = 'login.html';
            throw new Error('Unauthorized');
        }
    
        // Improvement: Automatically parse JSON and handle other errors generically.
        const responseData = await response.json().catch(() => {
            // If response is not JSON, use status text as the error.
            throw new Error(response.statusText || 'Terjadi kesalahan pada server.');
        });
    
        if (!response.ok) {
            // Throw an error with the message from the backend API.
            throw new Error(responseData.error || 'Terjadi kesalahan yang tidak diketahui.');
        }
    
        return responseData; // Return the parsed JSON data directly.
    };

    // --- REAL-TIME NOTIFICATIONS ---
    const showToastNotification = (message, link) => {
        const container = document.getElementById('toast-container');
        if (!container) return;
    
        const toastId = 'toast-' + Date.now();
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = 'bg-white shadow-lg rounded-lg p-4 flex items-start space-x-3 max-w-sm animate-fade-in-right cursor-pointer';
        toast.innerHTML = `
            <div class="flex-shrink-0">
                <svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <div class="flex-1">
                <p class="font-semibold text-gray-800">Notifikasi Baru</p>
                <p class="text-sm text-gray-600">${message}</p>
            </div>
            <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); document.getElementById('${toastId}').remove();">
                &times;
            </button>
        `;
    
        toast.addEventListener('click', () => {
            if (link) {
                // Temukan notifikasi di dropdown dan klik secara programatis untuk menandai sebagai terbaca
                const notifItem = document.querySelector(`.notification-item[data-link='${link}']`);
                if (notifItem) {
                    notifItem.click(); // Ini akan memicu handleNotificationClick
                } else {
                    // Fallback jika item tidak ditemukan di dropdown
                    switchContent(link);
                }
            }
            toast.remove();
        });
    
        container.appendChild(toast);
    
        setTimeout(() => {
            toast.remove();
        }, 7000); // Hilangkan toast setelah 7 detik
    };

    const loadAndRenderNotifications = async (isInitialLoad = false) => {
        const badge = document.getElementById('notification-badge');
        const list = document.getElementById('notification-list');
        if (!badge || !list) return;
    
        try {
            // 1. Dapatkan jumlah yang belum dibaca
            const { count } = await apiFetch(`${MEMBER_API_URL}/notifications/unread-count`);
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
    
            // 2. Dapatkan daftar notifikasi
            const notifications = await apiFetch(`${MEMBER_API_URL}/notifications`);
            list.innerHTML = ''; // Kosongkan daftar
    
            if (notifications.length === 0) {
                list.innerHTML = '<p class="text-center text-sm text-gray-500 p-4">Tidak ada notifikasi.</p>';
                return;
            }

            // 3. Render daftar notifikasi
            notifications.forEach(notif => {
                const notifElement = document.createElement('a');
                notifElement.href = '#';
                notifElement.className = `notification-item block p-3 hover:bg-gray-50 ${!notif.is_read ? 'bg-red-50' : ''}`;
                notifElement.dataset.id = notif.id;
                notifElement.dataset.link = notif.link;
                notifElement.dataset.isRead = notif.is_read;

                notifElement.innerHTML = `
                    <p class="text-sm text-gray-700">${notif.message}</p>
                    <p class="text-xs text-gray-400 mt-1">${formatRelativeTime(notif.created_at)}</p>
                `;
                list.appendChild(notifElement);
            });

            // 4. Logika untuk menampilkan toast notifikasi baru
            const latestNotification = notifications[0];
            if (isInitialLoad) {
                // Saat halaman pertama kali dimuat, hanya tetapkan waktu notifikasi terbaru sebagai patokan.
                // Jangan tampilkan toast.
                if (latestNotification) {
                    lastKnownNotificationTimestamp = latestNotification.created_at;
                }
            } else {
                // Untuk pemanggilan berikutnya (dari polling), periksa apakah ada notifikasi baru.
                if (latestNotification) {
                    const latestTimestamp = new Date(latestNotification.created_at).getTime();
                    const lastKnownTimestamp = lastKnownNotificationTimestamp ? new Date(lastKnownNotificationTimestamp).getTime() : 0;

                    // Tampilkan toast jika notifikasi ini baru (belum dibaca) DAN lebih baru dari yang terakhir kita lihat.
                    // Ini mencegah toast muncul lagi untuk notifikasi lama yang belum dibaca.
                    if (!latestNotification.is_read && latestTimestamp > lastKnownTimestamp) {
                        showToastNotification(latestNotification.message, latestNotification.link);
                    }
                    // Selalu perbarui patokan waktu ke notifikasi paling baru, terlepas dari status bacanya.
                    lastKnownNotificationTimestamp = latestNotification.created_at;
                }
            }
        } catch (error) {
            console.error('Error loading notifications:', error);
            list.innerHTML = '<p class="text-center text-sm text-red-500 p-4">Gagal memuat.</p>';
        }
    };

    const handleNotificationClick = async (e) => {
        const item = e.target.closest('.notification-item');
        if (!item) return;
    
        e.preventDefault();
        const { id, link, isRead } = item.dataset;
    
        document.getElementById('notification-dropdown').classList.add('hidden');
    
        if (isRead === 'false') {
            try { await apiFetch(`${MEMBER_API_URL}/notifications/${id}/read`, { method: 'PUT' }); } catch (error) { console.error('Gagal menandai notifikasi sebagai terbaca:', error); }
            loadAndRenderNotifications(); // Muat ulang daftar untuk memperbarui status & badge
        }
    
        if (link) { switchContent(link); }
    };

    const markAllNotificationsAsRead = async () => {
        const unreadItems = document.querySelectorAll('.notification-item[data-is-read="false"]');
        if (unreadItems.length === 0) {
            alert('Tidak ada notifikasi baru untuk ditandai.');
            return;
        }
    
        if (!confirm('Anda yakin ingin menandai semua notifikasi sebagai telah dibaca?')) return;
    
        const promises = Array.from(unreadItems).map(item => {
            const notifId = item.dataset.id;
            return apiFetch(`${MEMBER_API_URL}/notifications/${notifId}/read`, { method: 'PUT' });
        });
    
        try {
            await Promise.all(promises);
            loadAndRenderNotifications(); // Muat ulang daftar untuk memperbarui status & badge
        } catch (error) { console.error('Gagal menandai semua notifikasi sebagai terbaca:', error); alert('Terjadi kesalahan saat menandai notifikasi.'); }
    };

    // --- DASHBOARD: PUBLIC CHARTS (COPIED & ADAPTED FROM ADMIN.JS) ---

    const renderCashFlowChart = (data) => {
        const ctx = document.getElementById('cashflow-chart');
        if (!ctx) return;

        if (cashFlowChartInstance) {
            cashFlowChartInstance.destroy();
        }
    
        cashFlowChartInstance = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Kas Masuk', 'Kas Keluar'],
                datasets: [{
                    label: 'Arus Kas',
                    data: [data.inflow, data.outflow],
                    backgroundColor: [
                        'rgba(75, 192, 192, 0.6)', // Green for inflow
                        'rgba(255, 99, 132, 0.6)'  // Red for outflow
                    ],
                    borderColor: [
                        'rgba(75, 192, 192, 1)',
                        'rgba(255, 99, 132, 1)'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const label = context.label || '';
                                const value = context.parsed || 0;
                                return `${label}: ${formatCurrency(value)}`;
                            }
                        }
                    },
                    legend: {
                        position: 'top',
                    }
                }
            }
        });
    };

    const renderMemberGrowthChart = (data) => {
        const ctx = document.getElementById('member-growth-chart');
        if (!ctx) return;
    
        if (memberGrowthChartInstance) {
            memberGrowthChartInstance.destroy();
        }
    
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const labels = data.map(item => {
            const [year, month] = item.month.split('-');
            return `${monthNames[parseInt(month, 10) - 1]} '${year.slice(2)}`;
        });
        const counts = data.map(item => parseInt(item.new_members, 10));
    
        memberGrowthChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Anggota Baru',
                    data: counts,
                    fill: true,
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1,
                            callback: function(value) { if (Number.isInteger(value)) { return value; } }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    };

    const renderIncomeStatementChart = (data) => {
        const ctx = document.getElementById('income-statement-chart');
        if (!ctx) return;

        if (incomeStatementChartInstance) {
            incomeStatementChartInstance.destroy();
        }

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const labels = data.map(item => {
            const [year, month] = item.month.split('-');
            return `${monthNames[parseInt(month, 10) - 1]} '${year.slice(2)}`;
        });

        const revenueData = data.map(item => item.total_revenue);
        const expenseData = data.map(item => parseFloat(item.total_cogs) + parseFloat(item.total_expense));
        const netIncomeData = data.map(item => item.net_income);

        incomeStatementChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'Pendapatan',
                        data: revenueData,
                        backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    },
                    {
                        type: 'bar',
                        label: 'Beban (HPP + Biaya)',
                        data: expenseData,
                        backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    },
                    {
                        type: 'line',
                        label: 'Laba Bersih',
                        data: netIncomeData,
                        borderColor: 'rgba(153, 102, 255, 1)',
                        backgroundColor: 'rgba(153, 102, 255, 0.2)',
                        fill: false,
                        tension: 0.1,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: function(value) { return formatCurrency(value); } } } },
                plugins: {
                    tooltip: {
                        callbacks: { label: function(context) { const label = context.dataset.label || ''; const value = context.parsed.y || 0; return `${label}: ${formatCurrency(value)}`; } }
                    },
                    legend: { position: 'top' }
                }
            }
        });
    };

    const renderBalanceSheetChart = (data) => {
        const ctx = document.getElementById('balance-sheet-chart');
        if (!ctx) return;
    
        if (balanceSheetChartInstance) {
            balanceSheetChartInstance.destroy();
        }
    
        const { assets, liabilities, equity } = data;
    
        balanceSheetChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Posisi Keuangan'],
                datasets: [
                    {
                        label: 'Aset',
                        data: [assets],
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    },
                    {
                        label: 'Kewajiban',
                        data: [liabilities],
                        backgroundColor: 'rgba(255, 99, 132, 0.6)',
                    },
                    {
                        label: 'Ekuitas',
                        data: [equity],
                        backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, ticks: { callback: function(value) { return formatCurrency(value); } } }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) { const label = context.dataset.label || ''; const value = context.parsed.y || 0; return `${label}: ${formatCurrency(value)}`; }
                        }
                    },
                    legend: { position: 'top' }
                }
            }
        });
    };

    const setupIncomeStatementChartFilter = (useAdminEndpoint = false) => {
        const yearSelect = document.getElementById('income-statement-year-filter');
        const chartTitle = document.getElementById('income-statement-chart-title');
        if (!yearSelect) return;

        const loadDataForYear = async (year) => {
            const ctx = document.getElementById('income-statement-chart');
            if (!ctx) return;

            if (incomeStatementChartInstance) incomeStatementChartInstance.destroy();
            const context = ctx.getContext('2d');
            context.clearRect(0, 0, ctx.width, ctx.height);
            context.font = "16px Inter, sans-serif";
            context.fillStyle = "grey";
            context.textAlign = "center";
            context.fillText("Memuat data...", ctx.width / 2, ctx.height / 2);

            try {
                // Note: The member endpoint doesn't exist. This relies on the admin endpoint being accessible.
                const endpoint = useAdminEndpoint ? `${API_URL}/admin/income-statement-summary` : `${MEMBER_API_URL}/dashboard/income-statement-summary`;
                const data = await apiFetch(`${endpoint}?year=${year}`);
                renderIncomeStatementChart(data);
                if (chartTitle) chartTitle.textContent = `Ringkasan Laba Rugi (${year})`;
            } catch (error) {
                console.error('Error loading income statement chart:', error);
                context.clearRect(0, 0, ctx.width, ctx.height);
                context.fillStyle = "red";
                context.fillText(error.message, ctx.width / 2, ctx.height / 2);
            }
        };
    
        if (yearSelect.dataset.listenerAttached) {
            loadDataForYear(yearSelect.value);
            return;
        }
        yearSelect.dataset.listenerAttached = 'true';
    
        const currentYear = new Date().getFullYear();
        yearSelect.innerHTML = '';
        for (let i = currentYear; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
    
        yearSelect.addEventListener('change', () => {
            loadDataForYear(yearSelect.value);
        });
    
        loadDataForYear(currentYear);
    };

    const setupDashboardFilters = () => {
        const applyBtn = document.getElementById('apply-cf-chart-filter');
        const startDateInput = document.getElementById('cf-chart-start-date');
        const endDateInput = document.getElementById('cf-chart-end-date');
        const chartTitle = document.getElementById('cashflow-chart-title');

        if (!applyBtn) return;

        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);
        startDateInput.value = thirtyDaysAgo.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];

        applyBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!startDate || !endDate) {
                alert('Silakan pilih tanggal mulai dan tanggal akhir.');
                return;
            }

            const originalText = applyBtn.textContent;
            applyBtn.disabled = true;
            applyBtn.textContent = 'Memuat...';

            try {
                const data = await apiFetch(`${API_URL}/admin/cashflow-summary?startDate=${startDate}&endDate=${endDate}`);
                renderCashFlowChart(data);
                chartTitle.textContent = `Arus Kas (${formatDate(startDate)} - ${formatDate(endDate)})`;
            } catch (error) {
                alert(`Error: ${error.message}`);
            } finally {
                applyBtn.disabled = false;
                applyBtn.textContent = originalText;
            }
        });
    };

    const loadPublicDashboardCharts = async () => {
        try {
            // Muat data untuk grafik arus kas
            const cashFlowData = await apiFetch(`${API_URL}/admin/cashflow-summary`);
            renderCashFlowChart(cashFlowData);

            // Muat data untuk grafik pertumbuhan anggota
            const memberGrowthData = await apiFetch(`${API_URL}/admin/member-growth`);
            renderMemberGrowthChart(memberGrowthData);

            // Muat data untuk grafik neraca
            const balanceSheetData = await apiFetch(`${API_URL}/admin/balance-sheet-summary`);
            renderBalanceSheetChart(balanceSheetData);

            // Setup filter untuk grafik laba rugi (yang akan memuat datanya sendiri)
            // Pass true to indicate this is for the public/member view, using the admin endpoint
            setupIncomeStatementChartFilter(true);

        } catch (error) {
            console.error('Error loading public dashboard charts:', error.message);
        }
    };

    // --- FUNGSI PEMBUATAN KARTU ANGGOTA ---
    const createVirtualCardHTML = (profile) => {
        // Menentukan URL foto, dengan fallback jika tidak ada foto selfie
        let photoUrl = 'https://i.pravatar.cc/150?u=' + encodeURIComponent(profile.email);
        if (profile.selfie_photo_path) {
            const webPath = profile.selfie_photo_path.replace(/\\/g, '/');
            photoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
        }

        // Menggunakan kelas .virtual-card dan .card-logo untuk gaya modern
        return `
            <div class="virtual-card card-enter-animation text-white rounded-xl shadow-lg p-6 flex flex-col justify-between h-full">
                <div>
                    <div class="flex justify-between items-start">
                        <h3 class="text-xl font-bold">KARTU ANGGOTA</h3>
                        <img src="logo/logo.png" alt="Logo" class="card-logo opacity-90">
                    </div>
                    <div class="mt-6 flex items-center space-x-4">
                        <img src="${photoUrl}" alt="Foto Profil" class="w-16 h-16 rounded-full object-cover border-2 border-white/50">
                        <div>
                            <p class="text-lg font-semibold">${profile.name}</p>
                            <p class="text-sm opacity-80">${profile.cooperative_number || 'N/A'}</p>
                        </div>
                    </div>
                </div>
                <div class="mt-6 text-right">
                    <p class="text-xs opacity-70">Anggota Sejak</p>
                    <p class="font-semibold">${formatDate(profile.approval_date)}</p>
                </div>
            </div>
        `;
    };

    // --- DASHBOARD: MEMBER-SPECIFIC DATA ---
    const loadMemberCard = async () => {
        const cardContainer = document.getElementById('member-card-container');
        if (!cardContainer) return;

        cardContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-md text-center"><p class="text-gray-500">Memuat kartu anggota...</p></div>`;
        try {
            const profile = await apiFetch(`${MEMBER_API_URL}/profile`);
            const cardHTML = createVirtualCardHTML(profile); // Memanggil fungsi baru
            cardContainer.innerHTML = cardHTML;

        } catch (error) {
            console.error('Error loading member card:', error);
            cardContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-md text-center"><p class="text-red-500">${error.message}</p></div>`;
        }
    };

    /**
     * Helper function to render announcement content.
     * Detects YouTube links and replaces them with an embedded video player.
     * @param {string} content - The text content of the announcement.
     * @returns {string} - HTML string with the rendered content.
     */
    const renderAnnouncementContent = (content) => {
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = content.match(youtubeRegex);

        if (match && match[1]) {
            const videoId = match[1];
            const videoEmbed = `
                <div class="relative w-full pt-[56.25%] my-2 rounded-lg overflow-hidden shadow-md"> <!-- 16:9 Aspect Ratio -->
                    <iframe class="absolute top-0 left-0 w-full h-full" src="https://www.youtube.com/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
            `;
            // Replace the URL with the video embed, keeping other text if any
            return content.replace(youtubeRegex, videoEmbed);
        }
        return `<p>${content}</p>`; // Return as plain text if no YouTube link is found
    };

    const loadAnnouncements = async () => {
        const announcementsContainer = document.getElementById('announcements-container');
        if (!announcementsContainer) return;

        announcementsContainer.innerHTML = `<p class="text-sm text-gray-500">Memuat pengumuman...</p>`;

        try {
            const announcements = await apiFetch(`${MEMBER_API_URL}/announcements`);

            if (announcements.length === 0) {
                announcementsContainer.innerHTML = `<p class="text-sm text-gray-500">Tidak ada pengumuman baru.</p>`;
                return;
            }

            announcementsContainer.innerHTML = ''; // Clear loading message
            announcements.forEach(announcement => {
                const announcementElement = document.createElement('div');
                announcementElement.className = 'bg-red-50 border-l-4 border-red-500 p-4 mb-3 rounded-r-lg';
                const renderedContent = renderAnnouncementContent(announcement.content);
                announcementElement.innerHTML = `
                    <div class="flex">
                        <div class="flex-shrink-0">
                            <svg class="h-5 w-5 text-red-500" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>
                        </div>
                        <div class="ml-3 flex-1">
                            <h3 class="text-sm font-semibold text-red-800">${announcement.title}</h3>
                            <div class="mt-2 text-sm text-red-700">${renderedContent}</div>
                            <p class="mt-2 text-xs text-red-600">${formatDate(announcement.created_at)}</p>
                        </div>
                    </div>
                `;
                announcementsContainer.appendChild(announcementElement);
            });
        } catch (error) {
            console.error('Error loading announcements:', error);
            announcementsContainer.innerHTML = `<p class="text-sm text-red-500">${error.message}</p>`;
        }
    };

    const renderSavingsChart = (data) => {
        const ctx = document.getElementById('savings-chart');
        if (!ctx) return;
        if (savingsChartInstance) savingsChartInstance.destroy();
        const labels = data.map(item => new Date(item.month).toLocaleString('id-ID', { month: 'short', year: '2-digit' }));
        const amounts = data.map(item => parseFloat(item.total));
        savingsChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Simpanan',
                    data: amounts,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `Total: ${formatCurrency(context.parsed.y)}` } } }
            }
        });
    };

    const renderLoansChart = (data) => {
        const ctx = document.getElementById('loans-chart');
        if (!ctx) return;
        if (loansChartInstance) loansChartInstance.destroy();
        const labels = data.map(item => new Date(item.month).toLocaleString('id-ID', { month: 'short', year: '2-digit' }));
        const amounts = data.map(item => parseFloat(item.total));
        loansChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Pinjaman',
                    data: amounts,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `Total: ${formatCurrency(context.parsed.y)}` } } }
            }
        });
    };

    const renderTransactionsChart = (data) => {
        const ctx = document.getElementById('transactions-chart');
        if (!ctx) return;
        if (transactionsChartInstance) transactionsChartInstance.destroy();
        const labels = data.map(item => new Date(item.month).toLocaleString('id-ID', { month: 'short', year: '2-digit' }));
        const amounts = data.map(item => parseFloat(item.total));
        transactionsChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Transaksi Toko',
                    data: amounts,
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.2)',
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `Total: ${formatCurrency(context.parsed.y)}` } } }
            }
        });
    };

    const renderShuChart = (data) => {
        const ctx = document.getElementById('shu-chart');
        if (!ctx) return;
        if (shuChartInstance) shuChartInstance.destroy();
        const labels = data.map(item => item.year);
        const amounts = data.map(item => parseFloat(item.total_shu_amount));
        shuChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total SHU Diterima',
                    data: amounts,
                    backgroundColor: 'rgba(153, 102, 255, 0.6)',
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => `Total: ${formatCurrency(context.parsed.y)}` } } }
            }
        });
    };

    const loadDashboardData = async () => {
        try {
            // 1. Ambil statistik umum anggota
            const stats = await apiFetch(`${MEMBER_API_URL}/stats`);

            document.getElementById('total-savings').textContent = formatCurrency(stats.totalSavings);
            document.getElementById('active-loan').textContent = formatCurrency(stats.activeLoan);
            document.getElementById('last-shu').textContent = formatCurrency(stats.lastSHU);
            document.getElementById('plafon-card-amount').textContent = formatCurrency(stats.maxLoanAmount);
            document.getElementById('max-loan-info').textContent = formatCurrency(stats.maxLoanAmount);

            // 2. Muat data untuk kartu anggota
            loadMemberCard();

            // 3. Muat pengumuman
            loadAnnouncements();

            // 4. Muat data untuk grafik spesifik anggota
            loadMemberChartData();

            // 5. Muat data untuk grafik transparansi publik
            loadPublicDashboardCharts();
            setupDashboardFilters();

        } catch (error) {
            console.error('Error loading dashboard data:', error);
            // Handle UI error state if needed
        }
    };

    const loadMemberChartData = async () => {
        const chartContainers = {
            savings: document.getElementById('savings-chart')?.parentElement,
            loans: document.getElementById('loans-chart')?.parentElement,
            transactions: document.getElementById('transactions-chart')?.parentElement,
            shu: document.getElementById('shu-chart')?.parentElement
        };
    
        const endpoints = [
            { key: 'savings', url: `${MEMBER_API_URL}/chart-data/savings`, renderer: renderSavingsChart, name: 'Simpanan' },
            { key: 'loans', url: `${MEMBER_API_URL}/chart-data/loans`, renderer: renderLoansChart, name: 'Pinjaman' },
            { key: 'transactions', url: `${MEMBER_API_URL}/chart-data/transactions`, renderer: renderTransactionsChart, name: 'Transaksi Toko' },
            { key: 'shu', url: `${MEMBER_API_URL}/chart-data/shu`, renderer: renderShuChart, name: 'SHU' }
        ];
    
        endpoints.forEach(async (endpoint) => {
            const container = chartContainers[endpoint.key];
            if (!container) return;
            try {
                const data = await apiFetch(endpoint.url);
                endpoint.renderer(data);
            } catch (error) { console.error(`Error loading ${endpoint.name} chart data:`, error); container.innerHTML = `<p class="text-sm text-red-500 text-center p-4">${error.message}</p>`; }
        });
    };

    const generateAmortizationForModal = (plafon, tenor, annualInterestRate) => {
        const monthlyInterestRate = (annualInterestRate / 100) / 12;
        const pokokPerBulan = plafon / tenor;
        let sisaPinjaman = plafon;
        let totalCicilan = 0;
        let tableHtml = `<table class="min-w-full text-xs">
            <thead class="bg-gray-50 sticky top-0"><tr class="text-left">
                <th class="p-2">Bln</th><th class="p-2 text-right">Pokok</th><th class="p-2 text-right">Bunga</th><th class="p-2 text-right">Total</th>
            </tr></thead><tbody class="divide-y">`;

        for (let i = 1; i <= tenor; i++) {
            const bungaBulanIni = sisaPinjaman * monthlyInterestRate;
            const cicilanBulanIni = pokokPerBulan + bungaBulanIni;
            sisaPinjaman -= pokokPerBulan;
            totalCicilan += cicilanBulanIni;
            tableHtml += `<tr>
                <td class="p-2">${i}</td>
                <td class="p-2 text-right">${formatCurrency(pokokPerBulan)}</td>
                <td class="p-2 text-right">${formatCurrency(bungaBulanIni)}</td>
                <td class="p-2 text-right font-semibold">${formatCurrency(cicilanBulanIni)}</td>
            </tr>`;
        }
        tableHtml += `</tbody></table>`;
        return {
            tableHtml,
            totalRepayment: totalCicilan
        };
    };

    const generateAndPrintCommitmentPDF = async (loanData, signatureDataUrl) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        const { summary, installments } = loanData;

        // --- Header ---
        const logoImg = new Image();
        logoImg.src = 'logo/logo.png';
        await new Promise(resolve => logoImg.onload = resolve);
        doc.addImage(logoImg, 'PNG', 15, 15, 20, 20);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('Surat Pernyataan & Komitmen Pinjaman', 40, 22);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text('Koperasi Karya Kagum Abadi', 40, 28);
        doc.setLineWidth(0.5);
        doc.line(15, 35, 195, 35);

        // --- Member Details ---
        let yPos = 45;
        doc.setFontSize(11);
        doc.text('Saya yang bertanda tangan di bawah ini:', 15, yPos);
        yPos += 7;
        doc.text('Nama', 15, yPos);
        doc.text(`: ${summary.memberName}`, 55, yPos);
        yPos += 7;
        doc.text('No. Anggota', 15, yPos);
        doc.text(`: ${summary.cooperativeNumber || 'N/A'}`, 55, yPos);

        // --- Loan Details ---
        yPos += 10;
        doc.text('Dengan ini menyatakan bahwa saya mengajukan pinjaman kepada KOPKAKA dengan rincian sebagai berikut:', 15, yPos);
        yPos += 7;
        doc.setFont('helvetica', 'bold');
        doc.text('Jumlah Pinjaman', 15, yPos);
        doc.text(`: ${formatCurrency(summary.amount)}`, 55, yPos);
        yPos += 7;
        doc.setFont('helvetica', 'normal');
        doc.text('Produk Pinjaman', 15, yPos);
        doc.text(`: ${summary.loanTypeName} - ${summary.tenor} bulan`, 55, yPos);
        yPos += 7;
        doc.setFont('helvetica', 'bold');
        doc.text('Total Pengembalian', 15, yPos);
        const totalRepayment = installments.reduce((sum, inst) => sum + parseFloat(inst.amount), 0);
        doc.text(`: ${formatCurrency(totalRepayment)}`, 55, yPos);

        // --- Amortization Table ---
        yPos += 10;
        doc.setFont('helvetica', 'bold');
        doc.text('Estimasi Jadwal Angsuran:', 15, yPos);
        yPos += 2;

        const tableBody = installments.map(inst => [
            inst.installmentNumber,
            formatCurrency(inst.principal),
            formatCurrency(inst.interest),
            formatCurrency(inst.amount)
        ]);

        doc.autoTable({
            startY: yPos,
            head: [['Bulan', 'Pokok', 'Bunga', 'Total']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [127, 29, 29] }, // KOPKAKA Red
            styles: { fontSize: 9 },
            columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }
        });

        yPos = doc.lastAutoTable.finalY + 10;

        // --- Closing Statements & Signature ---
        doc.setFontSize(10);
        doc.text('Saya telah membaca, memahami, dan setuju untuk mematuhi semua syarat dan ketentuan pinjaman yang berlaku di KOPKAKA. Saya bersedia untuk melunasi pinjaman sesuai dengan jadwal angsuran yang telah ditetapkan.', 15, yPos, { maxWidth: 180 });
        yPos += 15;
        doc.text('Surat pernyataan ini saya buat dengan sadar dan tanpa ada paksaan dari pihak manapun.', 15, yPos);
        yPos += 15;
        doc.text(`Bandung, ${formatDate(summary.startDate)}`, 140, yPos);
        yPos += 7;
        doc.text('Hormat saya,', 140, yPos);
        yPos += 5;
        doc.addImage(signatureDataUrl, 'PNG', 140, yPos, 50, 25);
        yPos += 30;
        doc.setLineWidth(0.2);
        doc.line(140, yPos, 190, yPos);
        doc.text(summary.memberName, 140, yPos + 5);

        // --- Save the PDF ---
        doc.save(`Surat_Komitmen_Pinjaman_${summary.memberName}.pdf`);
    };

    // Fungsi ini diekspos ke window agar bisa dipanggil dari toko.js
    window.showLoanCommitmentModalFromToko = async (loanData, tenor, interestRate) => {
        const modal = document.getElementById('loan-commitment-modal');
        const form = document.getElementById('loan-application-form'); // Kita tetap gunakan form ini untuk data
        if (!modal || !form) return;

        const signaturePadEl = document.getElementById('member-signature-pad');
        const signaturePad = new SignaturePad(signaturePadEl, { backgroundColor: 'rgb(249, 250, 251)' });

        // Isi data dari `loanData` ke dalam form (tersembunyi) untuk konsistensi
        // Ini juga akan digunakan saat submit dari modal komitmen
        document.getElementById('loan-term-id').value = loanData.loan_term_id;
        document.getElementById('loan-amount').value = loanData.amount;
        document.getElementById('bank-name').value = loanData.bank_name;
        document.getElementById('bank-account-number').value = loanData.bank_account_number;

        // Generate amortization table and total repayment
        const { tableHtml, totalRepayment } = generateAmortizationForModal(parseFloat(loanData.amount), tenor, interestRate);

        // Isi data ke dalam modal surat komitmen
        try {
            const profile = await apiFetch(`${MEMBER_API_URL}/profile`);
            document.getElementById('commitment-member-name-text').textContent = `: ${profile.name}`;
            document.getElementById('commitment-coop-number-text').textContent = `: ${profile.cooperative_number || 'N/A'}`;
            document.getElementById('commitment-signature-name-text').textContent = profile.name;
        } catch (error) {
            console.error("Gagal memuat profil untuk surat komitmen:", error);
            alert("Gagal memuat data anggota. Silakan coba lagi.");
            return;
        }
        
        // Ambil teks dari dropdown tenor di modal kredit
        const creditTenorSelect = document.getElementById('credit-loan-term-select');
        const selectedOptionText = creditTenorSelect.options[creditTenorSelect.selectedIndex].text;

        document.getElementById('commitment-loan-amount-text').textContent = `: ${formatCurrency(loanData.amount)}`;
        document.getElementById('commitment-loan-term-text').textContent = `: ${selectedOptionText}`;
        document.getElementById('commitment-total-repayment-text').textContent = `: ${formatCurrency(totalRepayment)}`;
        document.getElementById('commitment-amortization-table-container').innerHTML = tableHtml;
        document.getElementById('commitment-current-date').textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

        // Tampilkan modal
        signaturePad.clear();
        modal.classList.remove('hidden');
    };
    
    // --- FUNGSI UNTUK MODAL SURAT KOMITMEN PINJAMAN ---
    const setupLoanCommitmentModal = () => {
        const modal = document.getElementById('loan-commitment-modal');
        const form = document.getElementById('loan-application-form');
        if (!modal || !form) return;

        const signaturePadEl = document.getElementById('member-signature-pad');
        const signaturePad = new SignaturePad(signaturePadEl, { backgroundColor: 'rgb(249, 250, 251)' });

        document.getElementById('clear-member-signature-btn')?.addEventListener('click', () => signaturePad.clear());
        document.getElementById('cancel-commitment-btn')?.addEventListener('click', () => modal.classList.add('hidden'));

        form.addEventListener('submit', async (e) => {
            e.preventDefault(); // Mencegah submit form standar

            // Ambil data dari form dan validasi
            const loan_term_id = document.getElementById('loan-term-id').value;
            const amount = document.getElementById('loan-amount').value;
            const bank_name = document.getElementById('bank-name').value;
            const bank_account_number = document.getElementById('bank-account-number').value;
            const selectedOption = document.getElementById('loan-term-id').options[document.getElementById('loan-term-id').selectedIndex];

            const maxLoanAmountText = document.getElementById('max-loan-info').textContent;
            const maxLoanAmount = parseFloat(maxLoanAmountText.replace(/[^0-9,]+/g, "").replace(",", "."));

            if (!loan_term_id || !amount || parseFloat(amount) <= 0 || !bank_name.trim() || !bank_account_number.trim()) {
                alert('Harap lengkapi semua field: Produk Pinjaman, Jumlah, Nama Bank, dan Nomor Rekening.');
                return;
            }
            if (parseFloat(amount) > maxLoanAmount) {
                alert(`Jumlah pinjaman melebihi plafon maksimal Anda (${formatCurrency(maxLoanAmount)}).`);
                return;
            }

            // Generate amortization table and total repayment
            const tenor = parseInt(selectedOption.dataset.tenor, 10);
            const interestRate = parseFloat(selectedOption.dataset.interest);
            const { tableHtml, totalRepayment } = generateAmortizationForModal(parseFloat(amount), tenor, interestRate);

            // Isi data ke dalam modal surat komitmen
            try {
                // Ambil data profil terbaru untuk memastikan nama dan no. anggota akurat
                const profile = await apiFetch(`${MEMBER_API_URL}/profile`);
                document.getElementById('commitment-member-name-text').textContent = `: ${profile.name}`;
                document.getElementById('commitment-coop-number-text').textContent = `: ${profile.cooperative_number || 'N/A'}`;
                document.getElementById('commitment-signature-name-text').textContent = profile.name;
            } catch (error) {
                console.error("Gagal memuat profil untuk surat komitmen:", error);
                alert("Gagal memuat data anggota untuk surat komitmen. Silakan coba lagi.");
            }
            document.getElementById('commitment-loan-amount-text').textContent = formatCurrency(amount);
            document.getElementById('commitment-loan-term-text').textContent = selectedOption.text;
            document.getElementById('commitment-total-repayment-text').textContent = formatCurrency(totalRepayment);

            // Sisipkan tabel angsuran ke dalam modal
            const amortizationContainer = document.getElementById('commitment-amortization-table-container');
            amortizationContainer.innerHTML = tableHtml;

            document.getElementById('commitment-current-date').textContent = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });

            // Tampilkan modal
            signaturePad.clear();
            modal.classList.remove('hidden');
        });

        document.getElementById('confirm-commitment-and-submit-btn')?.addEventListener('click', async () => {
            if (signaturePad.isEmpty()) {
                alert('Tanda tangan tidak boleh kosong.');
                return;
            }

            const submitBtn = document.getElementById('confirm-commitment-and-submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';

            const formData = new FormData();
            formData.append('loan_term_id', document.getElementById('loan-term-id').value);
            formData.append('amount', document.getElementById('loan-amount').value);
            formData.append('bank_name', document.getElementById('bank-name').value);
            formData.append('bank_account_number', document.getElementById('bank-account-number').value);

            // Konversi tanda tangan ke file Blob dan tambahkan ke FormData
            const signatureDataURL = signaturePad.toDataURL('image/png');
            const blob = await (await fetch(signatureDataURL)).blob();
            formData.append('commitment_signature', blob, 'signature.png');

            try {
                const newLoan = await apiFetch(`${MEMBER_API_URL}/loans`, { method: 'POST', body: formData });
                
                alert('Pengajuan pinjaman berhasil dikirim. Bukti pengajuan dalam format PDF akan diunduh.');
                
                // Generate and download the PDF instead of printing the window
                const loanDetailsForPDF = await apiFetch(`${MEMBER_API_URL}/loans/${newLoan.id}/details`);
                await generateAndPrintCommitmentPDF(loanDetailsForPDF, signatureDataURL);

                modal.classList.add('hidden');
                form.reset();
                loadPendingApplications();
                loadLoanPaymentSection();

            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Setuju & Ajukan Pinjaman';
            }
        });
    };

    const setupLoanApplicationForm = () => {
        const form = document.getElementById('loan-application-form');
        if (!form) return;
    
        // Logika submit form sekarang ditangani oleh setupLoanCommitmentModal
        // Kita hanya perlu memastikan listener tidak ditambahkan berulang kali.
        if (form.dataset.commitmentListenerAttached) return;
        form.dataset.commitmentListenerAttached = 'true';

        // Panggil fungsi setup modal komitmen
        setupLoanCommitmentModal();
    };

    const loadLoanPaymentSection = async () => {
        const appContainer = document.getElementById('loan-application-container');
        const paymentContainer = document.getElementById('loan-payment-container');
        const loanSummaryEl = document.getElementById('active-loan-summary');
        const loanTabContent = document.getElementById('application-loan-tab');
    
        if (!appContainer || !paymentContainer || !loanSummaryEl || !loanTabContent) return;
    
        // Reset and show loading state
        appContainer.classList.add('hidden');
        paymentContainer.classList.add('hidden');
        loanSummaryEl.innerHTML = '<p class="text-gray-500">Memeriksa pinjaman aktif...</p>';
    
        try {
            // Endpoint ini perlu dibuat di backend
            const activeLoan = await apiFetch(`${MEMBER_API_URL}/active-loan-for-payment`);

            // Hapus pesan status sebelumnya jika ada
            const existingStatusMessage = loanTabContent.querySelector('.status-message-container');
            if (existingStatusMessage) {
                existingStatusMessage.remove();
            }
    
            if (activeLoan && activeLoan.status === 'Approved') {
                // Member memiliki pinjaman aktif, tampilkan form pembayaran
                paymentContainer.classList.remove('hidden');
                appContainer.classList.add('hidden');
                
                // Isi ringkasan pinjaman
                loanSummaryEl.innerHTML = `
                    <p class="text-sm text-blue-700">Sisa Pokok Pinjaman Anda</p>
                    <p class="text-2xl font-bold text-blue-800">${formatCurrency(activeLoan.remainingPrincipal)}</p>
                    <p class="text-sm text-blue-700 mt-2">Angsuran Berikutnya (ke-${activeLoan.nextInstallment.number})</p>
                    <p class="text-xl font-semibold text-blue-800">${formatCurrency(activeLoan.nextInstallment.amount)}</p>
                `;
                
                // Isi field form
                document.getElementById('payment-loan-id').value = activeLoan.loanId;
                document.getElementById('payment-installment-number').value = activeLoan.nextInstallment.number;
                document.getElementById('payment-amount').value = formatCurrency(activeLoan.nextInstallment.amount);
                document.getElementById('payment-date').valueAsDate = new Date();
            } else if (activeLoan && (activeLoan.status === 'Pending' || activeLoan.status === 'Approved by Accounting')) {
                // Jika ada pinjaman yang sedang diproses, sembunyikan kedua form dan tampilkan pesan status
                appContainer.classList.add('hidden');
                paymentContainer.classList.add('hidden');
                loanTabContent.insertAdjacentHTML('afterbegin', `<div class="status-message-container bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg text-center"><p class="text-yellow-800">Anda memiliki pengajuan pinjaman yang sedang diproses dengan status <strong>${activeLoan.status}</strong>.</p><p class="text-sm text-yellow-700 mt-1">Anda dapat mengajukan pinjaman baru setelah pengajuan saat ini selesai diproses.</p></div>`);
            } else {
                // Tidak ada pinjaman aktif atau pending, tampilkan form pengajuan
                appContainer.classList.remove('hidden');
                paymentContainer.classList.add('hidden');
            }
    
        } catch (error) {
            // Jika terjadi error (misal: 404 Not Found), asumsikan tidak ada pinjaman aktif
            console.warn('Tidak dapat mengambil pinjaman aktif, menampilkan form pengajuan.', error.message);
            appContainer.classList.remove('hidden');
            paymentContainer.classList.add('hidden');
        }
    };

    const setupLoanPaymentForm = () => {
        const form = document.getElementById('loan-payment-form');
        if (!form) return;
    
        if (form.dataset.listenerAttached) return;
        form.dataset.listenerAttached = 'true';
    
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const formData = new FormData(form);
            
            formData.append('loanId', document.getElementById('payment-loan-id').value);
            formData.append('installmentNumber', document.getElementById('payment-installment-number').value);
            
            if (!document.getElementById('payment-proof').files[0]) {
                alert('Harap lampirkan bukti pembayaran.');
                return;
            }
    
            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';
    
            try {
                await apiFetch(`${MEMBER_API_URL}/loan-payment`, { method: 'POST', body: formData });
                alert('Bukti pembayaran berhasil dikirim dan sedang menunggu verifikasi oleh admin.');
                loadLoanPaymentSection(); // Muat ulang bagian ini
    
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Kirim Bukti Pembayaran';
            }
        });
    };

    const loadAvailableVoluntarySavings = async () => {
        const displayEl = document.getElementById('available-voluntary-savings');
        if (!displayEl) return;
        displayEl.textContent = 'Memuat...';
        try {
            // Endpoint ini perlu dibuat di backend untuk menghitung saldo simpanan sukarela
            const { availableBalance } = await apiFetch(`${MEMBER_API_URL}/savings/voluntary-balance`);
            displayEl.textContent = formatCurrency(availableBalance);
        } catch (error) {
            console.error('Error loading voluntary savings balance:', error);
            displayEl.textContent = 'Error';
        }
    };

    const setupWithdrawalForm = () => {
        const form = document.getElementById('withdrawal-form');
        if (!form) return;

        if (form.dataset.listenerAttached) return;
        form.dataset.listenerAttached = 'true';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const amount = document.getElementById('withdrawal-amount').value;
            const description = document.getElementById('withdrawal-description').value;
            const bank_name = document.getElementById('withdrawal-bank-name').value;
            const bank_account_number = document.getElementById('withdrawal-bank-account-number').value;

            if (!amount || parseFloat(amount) <= 0 || !description.trim() || !bank_name.trim() || !bank_account_number.trim()) {
                alert('Harap lengkapi semua field: Jumlah, Keterangan, Nama Bank, dan Nomor Rekening.');
                return;
            }

            if (!confirm(`Anda yakin ingin mengajukan penarikan sebesar ${formatCurrency(amount)}?`)) {
                return;
            }

            // Menambahkan elemen untuk menampilkan pesan error
            const errorDisplay = form.querySelector('.form-error-message');
            if (!errorDisplay) { // Buat elemen jika belum ada
                form.insertAdjacentHTML('beforeend', '<p class="form-error-message text-red-600 text-sm mt-2 hidden"></p>');
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengajukan...';

            try {
                // Endpoint ini akan kita buat di backend
                await apiFetch(`${MEMBER_API_URL}/savings/withdrawal`, {
                    method: 'POST',
                    body: JSON.stringify({ amount, description, bank_name, bank_account_number }),
                });
                alert('Pengajuan penarikan berhasil dikirim dan menunggu persetujuan admin.');
                form.reset();
                loadPendingApplications(); // Muat ulang tabel pengajuan
                loadAvailableVoluntarySavings(); // Muat ulang saldo
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ajukan Penarikan';
            }
        });
    };

    const setupVoluntarySavingForm = () => {
        const form = document.getElementById('saving-application-form');
        if (!form) return;
    
        if (form.dataset.listenerAttached) return;
        form.dataset.listenerAttached = 'true';
    
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
    
            const formData = new FormData(form);
            
            const amount = formData.get('amount');
            const description = formData.get('description');
    
            if (!amount || parseFloat(amount) <= 0 || !description.trim()) {
                alert('Harap isi jumlah setoran dan keterangan dengan benar.');
                return;
            }
    
            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';
    
            try {
                await apiFetch(`${MEMBER_API_URL}/savings`, {
                    method: 'POST',
                    body: formData,
                });
    
                alert('Pengajuan simpanan sukarela berhasil dikirim dan sedang menunggu persetujuan.');
                
                form.reset();
                loadPendingApplications(); // Reload the pending applications list

                // Automatically switch to the "Pengajuan Tertunda" tab to show the new status
                const pendingTabButton = document.querySelector('.application-tab-btn[data-target="application-pending-tab"]');
                if (pendingTabButton) {
                    pendingTabButton.click();
                }
                // Scroll to the pending applications table
                const pendingTable = document.getElementById('pending-applications-section');
                pendingTable?.scrollIntoView({ behavior: 'smooth' });
    
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ajukan Setoran';
            }
        });
    };

    const loadPendingApplications = async () => {
        const tableBody = document.getElementById('applications-table-body');
        if (!tableBody) return;
        const colspan = 5; // Updated colspan
        try {
            const applications = await apiFetch(`${MEMBER_API_URL}/applications`);
            if (applications.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Tidak ada pengajuan yang sedang diproses.</td></tr>`;
                return;
            }
            tableBody.innerHTML = '';
            applications.forEach(app => {
                const statusClasses = {
                    'Pending': 'bg-yellow-100 text-yellow-800',
                    'Approved by Accounting': 'bg-cyan-100 text-cyan-800',
                    'Rejected': 'bg-red-100 text-red-800',
                };
                const statusClass = statusClasses[app.status] || 'bg-gray-100 text-gray-800';

                let actionButtons = '-';
                if (app.type === 'Pinjaman') {
                    actionButtons = `<button class="view-pending-loan-details-btn text-blue-600 hover:underline text-xs" data-id="${app.id}">Lihat Detail</button>`;
                    if (app.status === 'Pending') {
                        actionButtons += `<button class="cancel-loan-application-btn text-red-600 hover:underline text-xs ml-2" data-id="${app.id}">Batalkan</button>`;
                    }
                }

                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(app.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-900">${app.type}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(app.amount)}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${app.status}</span></td>
                    <td class="px-6 py-4 text-sm text-center">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error(error);
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const showPendingLoanDetails = async (loanId) => {
        const modal = document.getElementById('loan-commitment-modal');
        if (!modal) return;

        // Reset dan tampilkan modal dengan status loading
        modal.classList.remove('hidden');
        const printableArea = document.getElementById('printable-commitment-area');
        printableArea.style.opacity = 0.5;

        // Sembunyikan tombol aksi utama dan canvas tanda tangan
        document.getElementById('confirm-commitment-and-submit-btn').classList.add('hidden');
        document.getElementById('cancel-commitment-btn').textContent = 'Tutup'; // Ubah tombol batal menjadi tutup
        document.getElementById('member-signature-pad').parentElement.classList.add('hidden');
        document.getElementById('clear-member-signature-btn').classList.add('hidden');

        try {
            // Endpoint baru untuk mengambil detail pinjaman pending
            const loan = await apiFetch(`${MEMBER_API_URL}/loans/${loanId}/details`);
            const { summary, installments } = loan;

            // Isi data ke dalam modal
            document.getElementById('commitment-member-name-text').textContent = `: ${summary.memberName}`;
            document.getElementById('commitment-coop-number-text').textContent = `: ${summary.cooperativeNumber || 'N/A'}`;
            document.getElementById('commitment-loan-amount-text').textContent = formatCurrency(summary.amount);
            document.getElementById('commitment-loan-term-text').textContent = `${summary.loanTypeName} - ${summary.tenor} bulan`;
            
            const totalRepayment = installments.reduce((sum, inst) => sum + parseFloat(inst.amount), 0);
            document.getElementById('commitment-total-repayment-text').textContent = formatCurrency(totalRepayment);

            const amortizationContainer = document.getElementById('commitment-amortization-table-container');
            amortizationContainer.innerHTML = generateAmortizationForModal(parseFloat(summary.amount), summary.tenor, summary.interestRate).tableHtml;

            document.getElementById('commitment-current-date').textContent = formatDate(summary.startDate);
            document.getElementById('commitment-signature-name-text').textContent = summary.memberName;

            // Tampilkan gambar tanda tangan yang sudah ada
            const signatureImageContainer = document.getElementById('member-signature-pad').parentElement;
            signatureImageContainer.classList.remove('hidden');
            signatureImageContainer.innerHTML = `<img src="${API_URL.replace('/api', '')}/${summary.commitment_signature_path.replace(/\\/g, '/')}" alt="Tanda Tangan" class="w-full h-40 object-contain bg-gray-50 rounded-md">`;

            // Tampilkan tombol cetak
            document.getElementById('confirm-commitment-and-submit-btn').textContent = 'Cetak PDF';
            document.getElementById('confirm-commitment-and-submit-btn').classList.remove('hidden');
            document.getElementById('confirm-commitment-and-submit-btn').onclick = () => window.print();

            printableArea.style.opacity = 1;

        } catch (error) {
            console.error("Gagal memuat detail pengajuan:", error);
            alert("Gagal memuat detail pengajuan. Silakan coba lagi.");
            modal.classList.add('hidden');
        }
    };

    const generateAmortization = (plafon, tenor, annualInterestRate) => {
        const amortizationTableBody = document.getElementById('amortization-preview-table-body');
        const amortizationTableFooter = document.getElementById('amortization-preview-table-footer');
        const amortizationSection = document.getElementById('amortization-preview-section');

        if (!amortizationTableBody || !amortizationTableFooter || !amortizationSection) return;

        amortizationTableBody.innerHTML = '';
        amortizationTableFooter.innerHTML = '';

        if (plafon <= 0 || tenor <= 0 || isNaN(plafon) || isNaN(tenor) || isNaN(annualInterestRate)) {
            amortizationSection.classList.add('hidden');
            return;
        }

        amortizationSection.classList.remove('hidden');

        const monthlyInterestRate = (annualInterestRate / 100) / 12;
        const pokokPerBulan = plafon / tenor;
        
        let sisaPinjaman = plafon;
        let totalPokok = 0, totalBunga = 0, totalCicilan = 0;

        for (let i = 1; i <= tenor; i++) {
            const bungaBulanIni = sisaPinjaman * monthlyInterestRate;
            const cicilanBulanIni = pokokPerBulan + bungaBulanIni;
            sisaPinjaman -= pokokPerBulan;

            totalPokok += pokokPerBulan;
            totalBunga += bungaBulanIni;
            totalCicilan += cicilanBulanIni;

            const row = `
                <tr>
                    <td class="px-4 py-2 text-sm text-gray-500">${i}</td>
                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(pokokPerBulan)}</td>
                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(bungaBulanIni)}</td>
                    <td class="px-4 py-2 text-sm font-semibold text-gray-800 text-right">${formatCurrency(cicilanBulanIni)}</td>
                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(sisaPinjaman < 1 ? 0 : sisaPinjaman)}</td>
                </tr>
            `;
            amortizationTableBody.innerHTML += row;
        }

        const footerRow = `
            <tr class="bg-gray-50 font-bold">
                <td class="px-4 py-2 text-left text-xs uppercase">Total</td>
                <td class="px-4 py-2 text-sm text-right">${formatCurrency(totalPokok)}</td>
                <td class="px-4 py-2 text-sm text-right">${formatCurrency(totalBunga)}</td>
                <td class="px-4 py-2 text-sm text-right">${formatCurrency(totalCicilan)}</td>
                <td></td>
            </tr>
        `;
        amortizationTableFooter.innerHTML = footerRow;
    };

    const renderAmortizationPreview = () => {
        const loanAmountInput = document.getElementById('loan-amount');
        const loanTermSelect = document.getElementById('loan-term-id');
        const amortizationSection = document.getElementById('amortization-preview-section');
        if (!loanAmountInput || !loanTermSelect || !amortizationSection) return;
        const amount = parseFloat(loanAmountInput.value);
        const selectedOption = loanTermSelect.options[loanTermSelect.selectedIndex];
        if (!selectedOption || !selectedOption.value || !amount || amount <= 0) return amortizationSection.classList.add('hidden');
        const tenor = parseInt(selectedOption.dataset.tenor, 10);
        const interestRate = parseFloat(selectedOption.dataset.interest);
        generateAmortization(amount, tenor, interestRate);
    };

    // --- PAGE-SPECIFIC LOADERS ---
    const loadSavingsData = async () => {
        const tableBody = document.getElementById('savings-table-body');
        const tableFooter = document.getElementById('savings-table-footer'); // Tambahkan ini
        const totalSummaryEl = document.getElementById('savings-total-summary');

        if (!tableBody || !totalSummaryEl || !tableFooter) return; // Tambahkan tableFooter ke pengecekan

        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat riwayat simpanan...</td></tr>`;
        tableFooter.innerHTML = ''; // Kosongkan footer saat memuat
        totalSummaryEl.textContent = 'Memuat...';

        try {
            const savings = await apiFetch(`${MEMBER_API_URL}/savings`);
            
            if (savings.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Anda belum memiliki riwayat simpanan.</td></tr>`;
                totalSummaryEl.textContent = formatCurrency(0);
                return;
            }

            tableBody.innerHTML = ''; // Clear loading message
            let totalApprovedSavings = 0;

            savings.forEach(saving => {
                const isWithdrawal = saving.savingTypeName === 'Penarikan Simpanan Sukarela';
                const displayAmount = isWithdrawal ? -saving.amount : saving.amount;
                const amountClass = isWithdrawal ? 'text-red-600' : 'text-gray-500';

                if (saving.status === 'Approved') {
                    // Kurangi total jika ini adalah penarikan, tambahkan jika setoran
                    totalApprovedSavings += parseFloat(displayAmount);
                }

                const statusClasses = { 'Approved': 'bg-green-100 text-green-800', 'Pending': 'bg-yellow-100 text-yellow-800', 'Rejected': 'bg-red-100 text-red-800' };
                const statusClass = statusClasses[saving.status] || 'bg-gray-100 text-gray-800';

                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(saving.date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${saving.savingTypeName}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm ${amountClass} text-right">${formatCurrency(displayAmount)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${saving.status}</span></td>
                    <td class="px-6 py-4 text-sm text-gray-500">${saving.description || '-'}</td>
                `;
            });

            // Tambahkan baris total di footer tabel
            tableFooter.innerHTML = `
                <tr class="bg-gray-50 font-bold">
                    <td class="px-6 py-3 text-left text-sm text-gray-800" colspan="2">Total Akumulasi Simpanan (Approved)</td>
                    <td class="px-6 py-3 text-right text-sm text-gray-800">${formatCurrency(totalApprovedSavings)}</td>
                    <td colspan="2"></td>
                </tr>
            `;
            totalSummaryEl.textContent = formatCurrency(totalApprovedSavings);

        } catch (error) {
            console.error('Error loading savings data:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
            totalSummaryEl.textContent = 'Error';
        }
    };
    const loadLoansData = async () => {
        const tableBody = document.getElementById('loans-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Memuat riwayat pinjaman...</td></tr>`;

        try {
            const loans = await apiFetch(`${MEMBER_API_URL}/loans`);

            if (loans.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Anda belum memiliki riwayat pinjaman.</td></tr>`;
                return;
            }

            tableBody.innerHTML = ''; // Clear loading message

            loans.forEach(loan => {
                const statusClasses = { 'Approved': 'bg-green-100 text-green-800', 'Pending': 'bg-yellow-100 text-yellow-800', 'Rejected': 'bg-red-100 text-red-800', 'Lunas': 'bg-blue-100 text-blue-800', 'Approved by Accounting': 'bg-cyan-100 text-cyan-800' };
                const statusClass = statusClasses[loan.status] || 'bg-gray-100 text-gray-800';

                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(loan.date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">${formatCurrency(loan.amount)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">${loan.tenorMonths} bulan</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-red-600 font-semibold text-right">${formatCurrency(loan.remainingPrincipal)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${loan.status}</span></td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <button class="view-loan-details-btn text-blue-600 hover:text-blue-900" data-loan-id="${loan.id}">Detail</button>
                    </td>
                `;
            });

        } catch (error) {
            console.error('Error loading loans data:', error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const showLoanDetailsModal = async (loanId) => {
        const modal = document.getElementById('loan-details-modal');
        const summarySection = document.getElementById('loan-summary-section');
        const installmentsTableBody = document.getElementById('loan-installments-table-body');

        if (!modal || !summarySection || !installmentsTableBody) return;

        modal.classList.remove('hidden');
        summarySection.innerHTML = '<p class="text-gray-500 col-span-full text-center">Memuat ringkasan...</p>';
        installmentsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat jadwal angsuran...</td></tr>`;

        try {
            const { summary, installments } = await apiFetch(`${MEMBER_API_URL}/loans/${loanId}/details`);

            const renderSummaryDetail = (label, value) => `<div class="p-2"><p class="text-xs text-gray-500">${label}</p><p class="font-semibold text-gray-800">${value}</p></div>`;
            summarySection.innerHTML = `
                ${renderSummaryDetail('Jumlah Pinjaman', formatCurrency(summary.amount))}
                ${renderSummaryDetail('Angsuran/Bulan (Awal)', formatCurrency(summary.monthlyInstallment))}
                ${renderSummaryDetail('Tenor', `${summary.tenor} bulan`)}
                ${renderSummaryDetail('Total Terbayar', formatCurrency(summary.totalPaid))}
            `;

            if (installments.length === 0) {
                installmentsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Jadwal angsuran tidak tersedia.</td></tr>`;
                return;
            }
            
            installmentsTableBody.innerHTML = '';
            installments.forEach(inst => {
                const statusClass = inst.status === 'Lunas' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
                const row = installmentsTableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500">${inst.installmentNumber}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(inst.dueDate)}</td>
                    <td class="px-6 py-4 text-sm text-gray-900 text-right">${formatCurrency(inst.amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(inst.paymentDate)}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${inst.status}</span></td>
                `;
            });

        } catch (error) {
            console.error('Error loading loan details:', error);
            summarySection.innerHTML = `<p class="text-red-500 col-span-full text-center">${error.message}</p>`;
            installmentsTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Gagal memuat jadwal.</td></tr>`;
        }
    };

    const loadShuHistoryData = async () => {
        const tableBody = document.getElementById('shu-history-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat riwayat SHU...</td></tr>`;

        try {
            const shuHistory = await apiFetch(`${MEMBER_API_URL}/shu-history`);

            if (shuHistory.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Anda belum memiliki riwayat penerimaan SHU.</td></tr>`;
                return;
            }

            tableBody.innerHTML = ''; // Clear loading message

            shuHistory.forEach(shu => {
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${shu.year}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${formatCurrency(shu.shu_from_services)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${formatCurrency(shu.shu_from_capital)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-800 text-right">${formatCurrency(shu.total_shu_amount)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(shu.distribution_date)}</td>
                `;
            });

        } catch (error) { console.error('Error loading SHU history data:', error); tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`; }
    };
    const loadApplicationData = async () => {
        const loanTermSelect = document.getElementById('loan-term-id');
        if (!loanTermSelect) return;

        loanTermSelect.innerHTML = '<option value="">Memuat produk pinjaman...</option>';
        loanTermSelect.disabled = true;

        try {
            // Endpoint ini bersifat publik dan tidak memerlukan otentikasi
            const response = await fetch(`${API_URL}/public/loan-terms`);
            if (!response.ok) throw new Error('Gagal memuat produk pinjaman.');
            
            const loanTerms = await response.json();

            if (loanTerms.length === 0) {
                loanTermSelect.innerHTML = '<option value="">Tidak ada produk pinjaman tersedia.</option>';
                return;
            }

            loanTermSelect.innerHTML = '<option value="">-- Pilih Produk Pinjaman --</option>';
            loanTerms.forEach(term => {
                const option = document.createElement('option');
                option.value = term.id;
                // INILAH BAGIAN PENTING: Menambahkan data-tenor dan data-interest
                option.dataset.tenor = term.tenor_months;
                option.dataset.interest = term.interest_rate;
                option.textContent = `${term.loan_type_name} - ${term.tenor_months} bulan (${term.interest_rate}% bunga/tahun)`;
                loanTermSelect.appendChild(option);
            });

        } catch (error) { console.error('Error loading loan terms:', error); loanTermSelect.innerHTML = '<option value="">Gagal memuat data.</option>'; } finally { loanTermSelect.disabled = false; }
    };

    const loadProfileData = async () => {
        const photoSection = document.getElementById('profile-photo-section');
        const detailsContainer = document.getElementById('profile-details');
        const heirContainer = document.getElementById('heir-details');
        const resignationContainer = document.getElementById('resignation-status-container');
        const headerProfileIcon = document.getElementById('header-profile-icon');
    
        if (!detailsContainer || !heirContainer || !photoSection || !resignationContainer) return;
    
        // Set loading states
        photoSection.innerHTML = '<p class="text-gray-500">Memuat foto...</p>';
        detailsContainer.innerHTML = '<p class="text-center text-gray-500">Memuat data profil...</p>';
        heirContainer.innerHTML = '<p class="text-center text-gray-500">Memuat data ahli waris...</p>';
        resignationContainer.innerHTML = '<p class="text-center text-gray-500">Memuat status...</p>';
    
        try {
            const profile = await apiFetch(`${MEMBER_API_URL}/profile`);
    
            // --- Render Photo Section ---
            let photoUrl = 'https://i.pravatar.cc/150?u=' + encodeURIComponent(profile.email);
            if (profile.selfie_photo_path) {
                const webPath = profile.selfie_photo_path.replace(/\\/g, '/');
                photoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
            }
            if(headerProfileIcon) headerProfileIcon.src = photoUrl; // Update header icon
    
            photoSection.innerHTML = `
                <div class="relative">
                    <!-- Badge untuk status keanggotaan -->
                    <span class="absolute -top-2 -right-2 px-2 py-1 text-xs font-semibold rounded-full bg-green-500 text-white shadow-md">${profile.status}</span>
                </div>
                <img id="profile-page-photo" src="${photoUrl}" alt="Foto Profil" class="w-32 h-32 rounded-full object-cover border-4 border-gray-200">
                <div>
                    <h4 class="text-lg font-semibold text-gray-700">Foto Profil</h4>
                    <p class="text-sm text-gray-500 mb-3">Gunakan foto yang jelas untuk kartu anggota virtual Anda. (Format: JPG/PNG, Maks: 1MB)</p>
                    <input type="file" id="photo-upload-input" class="hidden" accept="image/png, image/jpeg">
                    <button id="trigger-photo-upload-btn" class="px-4 py-2 bg-red-100 text-red-800 text-sm font-semibold rounded-md hover:bg-red-200">
                        Ganti Foto
                    </button>
                    <button id="save-photo-btn" class="hidden ml-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700">
                        Simpan Foto
                    </button>
                    <button id="cancel-photo-upload-btn" class="hidden ml-2 px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-md hover:bg-gray-300">
                        Batal
                    </button>
                    <div id="photo-upload-feedback" class="mt-2 text-sm"></div>
                </div>
            `;
            setupPhotoUpload(photoUrl);
    
            // --- Render Personal & Heir Details ---
            const renderDetail = (label, value) => `<div class="py-2 sm:grid sm:grid-cols-3 sm:gap-4"><dt class="text-sm font-medium text-gray-500">${label}</dt><dd class="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">${value || '-'}</dd></div>`;
            const fullAddress = [profile.address_detail, profile.address_village, profile.address_district, profile.address_city, profile.address_province].filter(Boolean).join(', ');
    
            detailsContainer.innerHTML = `
                <dl class="divide-y divide-gray-200">
                    ${renderDetail('Nama Lengkap', profile.name)}
                    ${renderDetail('Nomor Koperasi', profile.cooperative_number)}
                    ${renderDetail('Nomor KTP', profile.ktp_number)}
                    ${renderDetail('Email', profile.email)}
                    ${renderDetail('No. Telepon', profile.phone)}
                    ${renderDetail('Perusahaan', profile.company_name)}
                    ${renderDetail('Jabatan', profile.position_name)}
                    ${renderDetail('Alamat Lengkap', fullAddress)}
                    ${renderDetail('Tanggal Bergabung', formatDate(profile.approval_date))}
                </dl>
            `;
    
            heirContainer.innerHTML = `
                <dl class="divide-y divide-gray-200">
                    ${renderDetail('Nama Ahli Waris', profile.heir_name)}
                    ${renderDetail('Hubungan', profile.heir_relationship)}
                    ${renderDetail('No. Kartu Keluarga', profile.heir_kk_number)}
                    ${renderDetail('No. Telepon', profile.heir_phone)}
                </dl>
            `;
    
            // Tampilkan FAB Simpanan Wajib hanya untuk anggota individual (company_id null)
            const mandatorySavingFab = document.getElementById('mandatory-saving-fab');
            if (mandatorySavingFab) {
                // Asumsi anggota individual memiliki company_id null
                mandatorySavingFab.classList.toggle('hidden', profile.company_id !== null);
            }

            // --- Render Resignation Section ---
            if (profile.status === 'Active') {
                resignationContainer.innerHTML = `
                    <h4 class="text-lg font-semibold text-gray-800">Pengunduran Diri</h4>
                    <p class="text-sm text-gray-600 mt-2">Jika Anda ingin mengundurkan diri dari keanggotaan koperasi, Anda dapat mengajukan permintaan di sini. Pastikan Anda tidak memiliki pinjaman yang masih aktif.</p>
                    <button id="request-resignation-btn" class="mt-4 px-5 py-2 bg-red-600 text-white text-sm font-semibold rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500">
                        Ajukan Pengunduran Diri
                    </button>
                `;
                document.getElementById('request-resignation-btn').addEventListener('click', handleRequestResignation);
            } else if (profile.status === 'Pending Resignation') {
                resignationContainer.innerHTML = `
                    <div class="bg-yellow-50 border-l-4 border-yellow-400 p-4">
                        <div class="flex">
                            <div class="flex-shrink-0"><svg class="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 3.01-1.742 3.01H4.42c-1.53 0-2.493-1.676-1.743-3.01l5.58-9.92zM10 13a1 1 0 110-2 1 1 0 010 2zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" /></svg></div>
                            <div class="ml-3">
                                <p class="text-sm text-yellow-700">
                                    Permintaan pengunduran diri Anda sedang diproses oleh admin.
                                    <button id="cancel-resignation-btn" class="ml-2 font-semibold underline text-yellow-800 hover:text-yellow-900">Batalkan Permintaan</button>
                                </p>
                            </div>
                        </div>
                    </div>
                `;
                document.getElementById('cancel-resignation-btn').addEventListener('click', handleCancelResignation);
            } else {
                resignationContainer.innerHTML = `<p class="text-sm text-gray-500">Status keanggotaan Anda saat ini: <strong>${profile.status}</strong>.</p>`;
            }
    
        } catch (error) {
            console.error('Error loading profile data:', error);
            detailsContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            heirContainer.innerHTML = '';
            photoSection.innerHTML = '';
            resignationContainer.innerHTML = '';
        }
    };

    const setupPhotoUpload = (originalPhotoUrl) => {
        const triggerBtn = document.getElementById('trigger-photo-upload-btn');
        const saveBtn = document.getElementById('save-photo-btn');
        const cancelBtn = document.getElementById('cancel-photo-upload-btn');
        const fileInput = document.getElementById('photo-upload-input');
        const profileImg = document.getElementById('profile-page-photo');
        const feedbackEl = document.getElementById('photo-upload-feedback');
    
        if (!triggerBtn) return;
    
        triggerBtn.addEventListener('click', () => fileInput.click());
    
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (file) {
                if (file.size > 1 * 1024 * 1024) { // 1MB limit
                    feedbackEl.textContent = 'Ukuran file terlalu besar (Maks 1MB).';
                    feedbackEl.className = 'mt-2 text-sm text-red-600';
                    fileInput.value = ''; // Clear the input
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = (e) => { profileImg.src = e.target.result; };
                reader.readAsDataURL(file);
    
                triggerBtn.classList.add('hidden');
                saveBtn.classList.remove('hidden');
                cancelBtn.classList.remove('hidden');
                feedbackEl.textContent = '';
            }
        });
    
        cancelBtn.addEventListener('click', () => {
            profileImg.src = originalPhotoUrl;
            fileInput.value = '';
            triggerBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            feedbackEl.textContent = '';
        });
    
        saveBtn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) return;
    
            saveBtn.disabled = true;
            saveBtn.textContent = 'Mengunggah...';
            feedbackEl.textContent = '';
            feedbackEl.className = 'mt-2 text-sm';
    
            const formData = new FormData();
            formData.append('selfie_photo', file);
    
            try {
                await apiFetch(`${MEMBER_API_URL}/profile/photo`, {
                    method: 'PUT',
                    body: formData
                });
    
                feedbackEl.textContent = 'Foto profil berhasil diperbarui!';
                feedbackEl.className = 'mt-2 text-sm text-green-600';
                
                // Reload profile to get the new URL and update everything
                setTimeout(() => {
                    loadProfileData();
                    loadMemberCard(); // Reload the virtual card on the dashboard too
                }, 1500);
    
            } catch (error) {
                feedbackEl.textContent = `Error: ${error.message}`;
                feedbackEl.className = 'mt-2 text-sm text-red-600';
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Simpan Foto';
            }
        });
    };

    const handleRequestResignation = async () => {
        if (!confirm('Anda yakin ingin mengajukan pengunduran diri? Proses ini tidak dapat dibatalkan setelah disetujui oleh admin.')) return;
    
        try {
            const result = await apiFetch(`${MEMBER_API_URL}/request-resignation`, { method: 'POST' });
            alert(result.message);
            loadProfileData(); // Refresh the profile section
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };
    
    const handleCancelResignation = async () => {
        if (!confirm('Anda yakin ingin membatalkan permintaan pengunduran diri Anda?')) return;
    
        try {
            const result = await apiFetch(`${MEMBER_API_URL}/cancel-resignation`, { method: 'POST' });
            alert(result.message);
            loadProfileData(); // Refresh the profile section
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };

    const setupVoluntarySavingModalForm = () => {
        const modal = document.getElementById('voluntary-saving-modal');
        const form = document.getElementById('voluntary-saving-modal-form');
        if (!modal || !form) return;

        // Prevent adding listener multiple times
        if (form.dataset.listenerAttached) return;
        form.dataset.listenerAttached = 'true';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const formData = new FormData(form);

            const amount = formData.get('amount');
            const description = formData.get('description');

            if (!amount || parseFloat(amount) <= 0 || !description.trim()) {
                alert('Harap isi jumlah setoran dan keterangan dengan benar.');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';

            try {
                await apiFetch(`${MEMBER_API_URL}/savings`, {
                    method: 'POST',
                    body: formData,
                });

                alert('Pengajuan simpanan sukarela berhasil dikirim dan sedang menunggu persetujuan.');
                
                form.reset();
                modal.classList.add('hidden');
                loadPendingApplications(); // Reload the pending applications list
                switchContent('savings'); // Pindah ke halaman riwayat simpanan

            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ajukan Setoran';
            }
        });
    };

    const setupMandatorySavingModal = async () => {
        const fabButton = document.getElementById('mandatory-saving-fab');
        const modal = document.getElementById('mandatory-saving-modal');
        const closeBtn = document.getElementById('close-mandatory-saving-modal');
        const cancelBtn = document.getElementById('cancel-mandatory-saving-modal');
        const amountDisplay = document.getElementById('mandatory-saving-amount-display');
        const amountInput = document.getElementById('mandatory-saving-amount-input');
        const form = document.getElementById('mandatory-saving-form');

        if (!fabButton || !modal || !form) return;

        // Fetch mandatory saving amount (e.g., Rp 100.000)
        // This value should ideally come from a settings endpoint or a fixed value in the backend
        const mandatoryAmount = 100000; // Contoh: Rp 100.000
        amountDisplay.textContent = formatCurrency(mandatoryAmount);
        amountInput.value = mandatoryAmount;

        fabButton.addEventListener('click', () => {
            form.reset();
            modal.classList.remove('hidden');
        });

        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        cancelBtn.addEventListener('click', () => modal.classList.add('hidden'));

        if (form.dataset.listenerAttached) return;
        form.dataset.listenerAttached = 'true';

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            const formData = new FormData(form);

            const amount = formData.get('amount');
            const description = formData.get('description');

            if (!amount || parseFloat(amount) <= 0) {
                alert('Jumlah setoran wajib tidak boleh kosong atau nol.');
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengirim...';

            try {
                await apiFetch(`${MEMBER_API_URL}/mandatory-saving`, {
                    method: 'POST',
                    body: formData,
                });

                alert('Pengajuan simpanan wajib berhasil dikirim dan sedang menunggu persetujuan.');
                form.reset();
                modal.classList.add('hidden');
                loadPendingApplications(); // Muat ulang daftar pengajuan
                switchContent('savings'); // Pindah ke halaman riwayat simpanan

            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Ajukan Simpanan';
            }
        });
    };

    // --- NAVIGATION ---
    const switchContent = (targetId) => {
        // Hentikan interval pembaruan otomatis dasbor setiap kali berpindah halaman
        if (dashboardUpdateInterval) {
            clearInterval(dashboardUpdateInterval);
            dashboardUpdateInterval = null;
        }
        // JANGAN hentikan interval notifikasi, biarkan berjalan di semua halaman

        contentSections.forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(`${targetId}-content`);
        if (targetSection) {
            targetSection.classList.add('active');
        }

        sidebarLinks.forEach(link => {
            link.classList.toggle('active', link.dataset.target === targetId);
        });

        // Load data for the activated section
        switch (targetId) {
            case 'dashboard':
                loadDashboardData();
                // Mulai pembaruan otomatis setiap 30 detik saat di dasbor
                dashboardUpdateInterval = setInterval(loadDashboardData, 30000);
                break;
            case 'savings':
                loadSavingsData();
                break;
            case 'loans':
                loadLoansData();
                break;
            case 'shu-history':
                loadShuHistoryData();
                break;
            case 'application':
                loadApplicationData();
                setupLoanApplicationForm();
                setupVoluntarySavingForm(); // Pastikan form simpanan di tab juga di-setup
                setupWithdrawalForm(); // Pastikan form penarikan di tab juga di-setup
                loadLoanPaymentSection(); // Tentukan form mana yang akan ditampilkan
                loadAvailableVoluntarySavings(); // Muat saldo untuk penarikan
        setupMandatorySavingModal(); // Setup modal simpanan wajib
                loadPendingApplications();
                break;
            case 'transactions':
                loadTransactionsData();
                break;
            case 'profile':
                loadProfileData();
                break;
            case 'reports':
                // Fungsi-fungsi ini akan ditambahkan di bawah
                setupMemberIncomeStatementReport();
                setupMemberBalanceSheetReport();
                setupMemberCashFlowReport();
                setupReportTabs();
                // Secara otomatis tampilkan laporan laba rugi saat halaman dibuka
                if (document.getElementById('member-generate-is-report-btn')) {
                    document.getElementById('member-generate-is-report-btn').click();
                }
                break;
        }

        // Close sidebar on mobile after navigation
        if (window.innerWidth < 768 && !sidebar.classList.contains('-translate-x-full')) {
            toggleMenu();
        }
    };

    allLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.target;
            if (targetId) {
                switchContent(targetId);
            }
        });
    });

    // --- MOBILE MENU ---
    const toggleMenu = () => {
        sidebar.classList.toggle('-translate-x-full');
        sidebarOverlay.classList.toggle('hidden');
    };
    if (menuButton) menuButton.addEventListener('click', toggleMenu);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleMenu);

    // --- DROPDOWNS (Profile & Notifications) ---
    const setupDropdowns = () => {
        const profileBtn = document.getElementById('profile-dropdown-btn');
        const profileDropdown = document.getElementById('profile-dropdown');
        const notifBtn = document.getElementById('notification-bell-btn');
        const notifDropdown = document.getElementById('notification-dropdown');

        document.addEventListener('click', (e) => {
            // Close profile dropdown if click is outside
            if (profileBtn && !profileBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
                profileDropdown.classList.add('hidden');
            }
            // Close notification dropdown if click is outside
            if (notifBtn && !notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
                notifDropdown.classList.add('hidden');
            }
        });

        profileBtn?.addEventListener('click', () => profileDropdown.classList.toggle('hidden'));
        notifBtn?.addEventListener('click', () => notifDropdown.classList.toggle('hidden'));
    };

    const setupAmortizationPreviewListeners = () => {
        const loanAmountInput = document.getElementById('loan-amount');
        const loanTermSelect = document.getElementById('loan-term-id');

        if (loanAmountInput && loanTermSelect) {
            // Prevent adding multiple listeners
            if (loanAmountInput.dataset.listenerAttached) return;
            loanAmountInput.dataset.listenerAttached = 'true';

            loanAmountInput.addEventListener('input', renderAmortizationPreview);
            loanTermSelect.addEventListener('change', renderAmortizationPreview);
        }
    };

    const setupLoanPageListeners = () => {
        const tableBody = document.getElementById('loans-table-body');
        if (tableBody) {
            tableBody.addEventListener('click', (e) => {
                const button = e.target.closest('.view-loan-details-btn');
                if (button) {
                    const loanId = button.dataset.loanId;
                    showLoanDetailsModal(loanId);
                }
            });
        }
    
        const closeModalBtn = document.getElementById('close-loan-details-modal-btn');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                document.getElementById('loan-details-modal').classList.add('hidden');
            });
        }
    };

    const setupChangePasswordModal = () => {
        const modal = document.getElementById('change-password-modal');
        const form = document.getElementById('change-password-form');
        const openBtn = document.getElementById('change-password-btn');
        const closeBtn = document.getElementById('close-change-password-modal');
        const cancelBtn = document.getElementById('cancel-change-password-modal');
        const errorEl = document.getElementById('change-password-error');
    
        if (!modal || !form || !openBtn) return;
    
        openBtn.addEventListener('click', (e) => {
            e.preventDefault();
            form.reset();
            errorEl.classList.add('hidden');
            modal.classList.remove('hidden');
        });
    
        const closeModal = () => modal.classList.add('hidden');
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
    
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            errorEl.classList.add('hidden');
    
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-new-password').value;
    
            if (newPassword !== confirmPassword) {
                errorEl.textContent = 'Password baru dan konfirmasi tidak cocok.';
                errorEl.classList.remove('hidden');
                return;
            }
    
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan...';
    
            try {
                const result = await apiFetch(`${MEMBER_API_URL}/change-password`, {
                    method: 'PUT',
                    body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
                });
    
                alert(result.message || 'Password berhasil diubah.');
                closeModal();
    
            } catch (error) {
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Simpan Password';
            }
        });
    };

    // --- LOGOUT ---
    const setupLogout = () => {
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
            logoutButton.addEventListener('click', (e) => {
                e.preventDefault();
                if (confirm('Anda yakin ingin keluar?')) {
                    localStorage.clear();
                    window.location.href = 'login.html';
                }
            });
        }
    };

    const initializeHeader = async () => {
        try {
            const profile = await apiFetch(`${MEMBER_API_URL}/profile`);
            const iconEl = document.getElementById('header-profile-icon');
            if (!iconEl) return;
    
            if (profile.selfie_photo_path) {
                const webPath = profile.selfie_photo_path.replace(/\\/g, '/');
                const photoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                iconEl.src = photoUrl;
            } else {
                // Fallback ke avatar generik jika tidak ada foto
                iconEl.src = 'https://i.pravatar.cc/150?u=' + encodeURIComponent(profile.email);
            }
        } catch (error) {
            console.error('Gagal memuat foto profil untuk header:', error);
        }
    };

    // --- FUNGSI UNTUK HALAMAN LAPORAN ANGGOTA ---

    const setupReportTabs = () => {
        const tabBtns = document.querySelectorAll('.member-report-tab-btn');
        const tabContents = document.querySelectorAll('.member-report-tab-content');

        if (!tabBtns.length) return;

        tabBtns.forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                const targetId = btn.dataset.target;

                tabBtns.forEach(b => {
                    b.classList.remove('border-red-500', 'text-red-600');
                    b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
                });
                btn.classList.add('border-red-500', 'text-red-600');
                btn.classList.remove('border-transparent', 'text-gray-500');

                tabContents.forEach(content => {
                    content.classList.toggle('hidden', content.id !== targetId);
                });

                // Trigger the generate button for the newly shown tab
                const generateBtnId = `member-generate-${targetId.split('-')[2]}-report-btn`;
                const generateBtn = document.getElementById(generateBtnId);
                if (generateBtn) {
                    generateBtn.click();
                }
            });
        });
    };

    const setupMemberIncomeStatementReport = () => {
        const generateBtn = document.getElementById('member-generate-is-report-btn');
        const previewContainer = document.getElementById('member-is-report-preview');
        const startDateInput = document.getElementById('member-is-start-date');
        const endDateInput = document.getElementById('member-is-end-date');
    
        if (!generateBtn) return;
    
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    
        const renderReport = (data) => {
            const { revenue, cogs, grossProfit, expense, netIncome } = data;
            const renderSection = (title, items, total) => {
                if (items.length === 0 && total === 0) return '';
                let itemsHtml = items.map(item => `<tr class="text-sm"><td class="py-1 px-4 pl-8">${item.number} - ${item.name}</td><td class="py-1 px-4 text-right">${formatCurrency(item.total)}</td><td class="py-1 px-4"></td></tr>`).join('');
                return `<tr class="font-semibold text-sm"><td class="py-2 px-4">${title}</td><td class="py-2 px-4"></td><td class="py-2 px-4 text-right">${formatCurrency(total)}</td></tr>${itemsHtml}`;
            };
    
            previewContainer.innerHTML = `
                <table class="w-full"><tbody>
                    ${renderSection('Pendapatan', revenue.items, revenue.total)}
                    ${renderSection('Beban Pokok Penjualan (HPP)', cogs.items, cogs.total)}
                    <tr class="font-bold text-sm border-t-2 border-gray-300"><td class="py-2 px-4">Laba Kotor</td><td></td><td class="py-2 px-4 text-right">${formatCurrency(grossProfit)}</td></tr>
                    ${renderSection('Biaya Operasional', expense.items, expense.total)}
                    <tr class="font-bold text-md bg-gray-100 border-t-2 border-gray-300"><td class="py-2 px-4">Laba Bersih</td><td></td><td class="py-2 px-4 text-right">${formatCurrency(netIncome)}</td></tr>
                </tbody></table>`;
        };
    
        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
            if (!startDate || !endDate) { alert('Silakan pilih periode tanggal.'); return; }
    
            generateBtn.disabled = true; generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
    
            try {
                const reportData = await apiFetch(`${API_URL}/admin/reports/income-statement?startDate=${startDate}&endDate=${endDate}`);
                renderReport(reportData);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false; generateBtn.textContent = 'Tampilkan';
            }
        });
    };

    const setupMemberBalanceSheetReport = () => {
        const generateBtn = document.getElementById('member-generate-bs-report-btn');
        const previewContainer = document.getElementById('member-bs-report-preview');
        const dateInput = document.getElementById('member-bs-date');
    
        if (!generateBtn) return;
    
        dateInput.value = new Date().toISOString().split('T')[0];
    
        const renderReport = (data) => {
            const { assets, liabilities, equity } = data;
            const renderSection = (items) => items.map(item => `<tr class="text-sm"><td class="py-1 px-4 pl-8">${item.number} - ${item.name}</td><td class="py-1 px-4 text-right">${formatCurrency(item.ending_balance)}</td></tr>`).join('');
    
            previewContainer.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div><table class="w-full"><thead><tr class="border-b-2"><th class="py-2 px-4 text-left font-bold">Aktiva</th><th class="py-2 px-4 text-right font-bold">Saldo Akhir</th></tr></thead><tbody>${renderSection(assets.items)}</tbody><tfoot class="border-t-2 font-bold"><tr class="bg-gray-100"><td class="py-2 px-4">Total Aktiva</td><td class="py-2 px-4 text-right">${formatCurrency(assets.ending_total)}</td></tr></tfoot></table></div>
                    <div><table class="w-full"><thead><tr class="border-b-2"><th class="py-2 px-4 text-left font-bold">Kewajiban dan Ekuitas</th><th class="py-2 px-4 text-right font-bold">Saldo Akhir</th></tr></thead><tbody>
                        <tr class="font-semibold text-sm"><td class="py-2 px-4" colspan="2">Kewajiban</td></tr>${renderSection(liabilities.items)}
                        <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Total Kewajiban</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.ending_total)}</td></tr>
                        <tr class="font-semibold text-sm"><td class="py-2 px-4" colspan="2">Ekuitas</td></tr>${renderSection(equity.items)}
                        <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Total Ekuitas</td><td class="py-2 px-4 text-right">${formatCurrency(equity.ending_total)}</td></tr>
                    </tbody><tfoot class="border-t-2 font-bold"><tr class="bg-gray-100"><td class="py-2 px-4">Total Kewajiban dan Ekuitas</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.ending_total + equity.ending_total)}</td></tr></tfoot></table></div>
                </div>`;
        };
    
        generateBtn.addEventListener('click', async () => {
            const asOfDate = dateInput.value;
            if (!asOfDate) { alert('Silakan pilih tanggal.'); return; }
    
            generateBtn.disabled = true; generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
    
            try {
                const reportData = await apiFetch(`${API_URL}/admin/reports/balance-sheet?asOfDate=${asOfDate}`);
                renderReport(reportData);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false; generateBtn.textContent = 'Tampilkan';
            }
        });
    };

    const setupMemberCashFlowReport = () => {
        const generateBtn = document.getElementById('member-generate-cf-report-btn');
        const previewContainer = document.getElementById('member-cf-report-preview');
        const startDateInput = document.getElementById('member-cf-start-date');
        const endDateInput = document.getElementById('member-cf-end-date');

        if (!generateBtn) return;

        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];

        const renderReport = (data) => {
            const { summary, operating, financing } = data;
            const renderSubSection = (items, isOutflow = false) => Object.entries(items).filter(([key, value]) => key !== 'total' && value > 0).map(([key, value]) => {
                const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                return `<tr class="text-sm"><td class="py-1 px-4 pl-8">${label}</td><td class="py-1 px-4 text-right">${isOutflow ? `(${formatCurrency(value)})` : formatCurrency(value)}</td></tr>`;
            }).join('');

            previewContainer.innerHTML = `
                <table class="w-full"><tbody>
                    <tr class="font-semibold text-sm"><td class="py-2 px-4" colspan="2">Arus Kas dari Aktivitas Operasi</td></tr>
                    ${renderSubSection({ 'Penerimaan dari Penjualan': operating.inflows.fromSales, 'Penerimaan Bunga Pinjaman': operating.inflows.fromInterest })}
                    ${renderSubSection({ 'Pembayaran ke Supplier': operating.outflows.toSuppliers, 'Pembayaran Beban Operasional': operating.outflows.forExpenses }, true)}
                    <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Arus Kas Bersih dari Aktivitas Operasi</td><td class="py-2 px-4 text-right">${formatCurrency(operating.net)}</td></tr>
                    <tr class="font-semibold text-sm pt-4"><td class="py-2 px-4" colspan="2">Arus Kas dari Aktivitas Pendanaan</td></tr>
                    ${renderSubSection({ 'Setoran Simpanan Anggota': financing.inflows.fromSavings, 'Penerimaan Pokok Pinjaman': financing.inflows.fromLoanRepayments })}
                    ${renderSubSection({ 'Pencairan Pinjaman ke Anggota': financing.outflows.forLoanDisbursements, 'Pengembalian Simpanan (Resign)': financing.outflows.forResignations }, true)}
                    <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Arus Kas Bersih dari Aktivitas Pendanaan</td><td class="py-2 px-4 text-right">${formatCurrency(financing.net)}</td></tr>
                    <tr class="font-bold text-md bg-gray-50 border-y-2"><td class="py-2 px-4">Kenaikan (Penurunan) Bersih Kas</td><td class="py-2 px-4 text-right">${formatCurrency(summary.netCashFlow)}</td></tr>
                    <tr class="text-sm"><td class="py-2 px-4">Saldo Kas Awal Periode</td><td class="py-2 px-4 text-right">${formatCurrency(summary.beginningCash)}</td></tr>
                    <tr class="font-semibold text-sm bg-gray-50 border-t"><td class="py-2 px-4">Saldo Kas Akhir Periode</td><td class="py-2 px-4 text-right">${formatCurrency(summary.endingCash)}</td></tr>
                </tbody></table>`;
        };

        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
            if (!startDate || !endDate) { alert('Silakan pilih periode tanggal.'); return; }

            generateBtn.disabled = true; generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';

            try {
                const reportData = await apiFetch(`${API_URL}/admin/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`);
                renderReport(reportData);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false; generateBtn.textContent = 'Tampilkan';
            }
        });
    };

    const loadTransactionsData = async () => {
        const tableBody = document.getElementById('transactions-table-body');
        if (!tableBody) return;
    
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat riwayat transaksi...</td></tr>`;
    
        try {
            const transactions = await apiFetch(`${MEMBER_API_URL}/sales`);
    
            if (transactions.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Anda belum memiliki riwayat transaksi toko.</td></tr>`;
                return;
            }
    
            tableBody.innerHTML = '';
            transactions.forEach(tx => {
                const statusClasses = {
                    'Menunggu Pengambilan': 'bg-yellow-100 text-yellow-800',
                    'Selesai': 'bg-green-100 text-green-800',
                    'Dibatalkan': 'bg-red-100 text-red-800'
                };
                const statusClass = statusClasses[tx.status] || 'bg-gray-100 text-gray-800';
                
                // Tambahkan tombol aksi berdasarkan status pesanan
                let actionButtons = `<button class="show-qr-btn text-blue-600 hover:underline" data-order-id="${tx.order_id}">Tampilkan QR</button>`;
                if (tx.status === 'Menunggu Pengambilan') {
                    actionButtons += `
                        <button class="cancel-order-btn text-red-600 hover:underline ml-2" data-order-id="${tx.order_id}">Batalkan</button>
                    `;
                }

                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm font-mono text-gray-700">${tx.order_id}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(tx.sale_date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-800 font-semibold text-right">${formatCurrency(tx.total_amount)}</td>
                    <td class="px-6 py-4 text-center"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${tx.status}</span></td>
                    <td class="px-6 py-4 text-center text-sm font-medium">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error('Error loading transactions data:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };
    
    const showQRCodeModal = async (orderId) => {
        const modal = document.getElementById('qr-code-modal');
        const canvas = document.getElementById('qr-code-canvas');
        const titleEl = document.getElementById('qr-modal-title');
        const orderIdEl = document.getElementById('qr-modal-order-id');
    
        if (!modal || !canvas || !titleEl || !orderIdEl) return;
    
        modal.classList.remove('hidden');
        titleEl.textContent = 'Memuat Barcode...';
        orderIdEl.textContent = '';
        // Clear previous QR code
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    
        try {
            // Fetch full order details to be embedded in the QR code
            const orderDetails = await apiFetch(`${MEMBER_API_URL}/sales/${orderId}`);
            const qrData = JSON.stringify(orderDetails);
    
            QRCode.toCanvas(canvas, qrData, { width: 256 }, function (error) {
                if (error) throw error;
                titleEl.textContent = 'Barcode Pesanan';
                orderIdEl.textContent = orderId;
            });
    
        } catch (error) { console.error('Error generating QR Code:', error); titleEl.textContent = 'Error'; orderIdEl.textContent = error.message; }
    };

    const setupApplicationTabs = () => {
        const tabBtns = document.querySelectorAll('.application-tab-btn');
        const tabContents = document.querySelectorAll('.application-tab-content');

        if (!tabBtns.length) return;

        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.dataset.target;

                // Update button styles
                tabBtns.forEach(b => {
                    b.classList.remove('border-red-500', 'text-red-600');
                    b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
                });
                btn.classList.add('border-red-500', 'text-red-600');
                btn.classList.remove('border-transparent', 'text-gray-500');

                // Update content visibility
                tabContents.forEach(content => {
                    content.classList.toggle('hidden', content.id !== targetId);
                });
            });
        });
    };
    
    const setupQuickAccessButtons = () => {
        const addSavingBtn = document.getElementById('add-voluntary-saving-btn');
        const withdrawSavingBtn = document.getElementById('withdraw-savings-btn');

        const handleQuickAccessClick = (targetTabId, targetFormId) => {
            // 1. Beralih ke konten "Pengajuan Baru"
            switchContent('application');

            // 2. Aktifkan tab "Setoran" secara manual
            document.querySelectorAll('.application-tab-btn').forEach(btn => {
                const isTargetTab = btn.dataset.target === targetTabId;
                btn.classList.toggle('border-red-500', isTargetTab);
                btn.classList.toggle('text-red-600', isTargetTab);
                btn.classList.toggle('border-transparent', !isTargetTab);
                btn.classList.toggle('text-gray-500', !isTargetTab);
            });
            document.querySelectorAll('.application-tab-content').forEach(content => {
                content.classList.toggle('hidden', content.id !== targetTabId);
            });

            // 3. Gulir ke formulir yang relevan
            const formElement = document.getElementById(targetFormId);
            formElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        };

        addSavingBtn?.addEventListener('click', () => handleQuickAccessClick('application-saving-tab', 'saving-application-form'));
        withdrawSavingBtn?.addEventListener('click', () => handleQuickAccessClick('application-saving-tab', 'withdrawal-form'));
    };

    // --- CLOCK WIDGET ---
    const startClock = () => {
        const timeEl = document.getElementById('clock-time');
        const dateEl = document.getElementById('clock-date');

        if (!timeEl || !dateEl) return;

        const updateClock = () => {
            const now = new Date();
            const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
            const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

            timeEl.textContent = now.toLocaleTimeString('id-ID', timeOptions).replace(/\./g, ':');
            dateEl.textContent = now.toLocaleDateString('id-ID', dateOptions);
        };

        updateClock(); // Initial call
        setInterval(updateClock, 1000); // Update every second
    };

    // --- INITIALIZATION ---
    const initializeApp = () => {
        if (!checkAuth()) return;

        initializeHeader();
        setupDropdowns();
        setupLogout();
        setupLoanPageListeners(); 
        setupWithdrawalForm();
        setupLoanPaymentForm();
        setupChangePasswordModal();
        setupQuickAccessButtons();
        setupMandatorySavingModal(); // Panggil setup untuk modal simpanan wajib
        setupVoluntarySavingModalForm(); // Tambahkan setup untuk form modal
        setupApplicationTabs();
        startClock(); // Mulai jam
        
        const setupTransactionPageListeners = () => {
            const tableBody = document.getElementById('transactions-table-body');
            if (tableBody) {
                tableBody.addEventListener('click', (e) => {
                    if (e.target.matches('.show-qr-btn')) {
                        const orderId = e.target.dataset.orderId;
                        showQRCodeModal(orderId);
                    } else if (e.target.matches('.cancel-order-btn')) {
                        const orderId = e.target.dataset.orderId;
                        if (confirm(`Anda yakin ingin membatalkan pesanan #${orderId}? Stok barang akan dikembalikan.`)) {
                            apiFetch(`${API_URL}/sales/${orderId}/cancel`, { method: 'POST' }) // FIX: Use the general /api/sales endpoint
                                .then(() => {
                                    alert('Pesanan berhasil dibatalkan.');
                                    loadTransactionsData(); // Muat ulang daftar transaksi
                                }).catch(err => alert(`Gagal membatalkan: ${err.message}`));
                        }
                    }
                });
            }
        
            const modal = document.getElementById('qr-code-modal');
            const closeBtn = document.getElementById('close-qr-code-modal-btn');
            if (modal && closeBtn) {
                closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
                modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
            }
        };
        setupTransactionPageListeners();
        setupAmortizationPreviewListeners();
        
        // Tambahkan event listener untuk tombol pembatalan pengajuan
        const applicationsTableBody = document.getElementById('applications-table-body');
        if (applicationsTableBody) {
            applicationsTableBody.addEventListener('click', async (e) => {
                const target = e.target;
                if (target.matches('.cancel-loan-application-btn')) {
                    const loanId = target.dataset.id;
                    if (confirm('Anda yakin ingin membatalkan pengajuan pinjaman ini?')) {
                        try {
                            // FIX: Corrected the endpoint to match the backend route for cancellation. The backend uses /applications/:id/cancel
                            await apiFetch(`${MEMBER_API_URL}/applications/${loanId}/cancel`, { method: 'DELETE' });
                            alert('Pengajuan pinjaman berhasil dibatalkan.');
                            loadPendingApplications(); // Reload the list
                        } catch (error) {
                            alert(`Gagal membatalkan: ${error.message}`);
                        }
                    }
                } else if (target.matches('.view-pending-loan-details-btn')) {
                    const loanId = target.dataset.id;
                    if (loanId) {
                        showPendingLoanDetails(loanId);
                    }
                }
            });
        }

        // NOTE: Tombol dengan ID 'mark-all-read-btn' tidak ada di HTML Anda,
        // namun fungsi ini ditambahkan untuk mencegah error jika tombol tersebut ditambahkan nanti.
        // Setup event handler untuk tombol "Tandai Semua Dibaca"
        const markAllReadBtn = document.getElementById('mark-all-read-btn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', markAllNotificationsAsRead);
        }
        
        // Setup event handler untuk klik notifikasi
        const notificationList = document.getElementById('notification-list');
        if (notificationList) {
            notificationList.addEventListener('click', handleNotificationClick);
        }

        // Muat notifikasi pertama kali dan mulai polling
        loadAndRenderNotifications(true); // true untuk muat awal
        notificationInterval = setInterval(loadAndRenderNotifications, 15000); // Periksa setiap 15 detik

        switchContent('dashboard'); // Load initial content
    };

    initializeApp();
});