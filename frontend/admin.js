import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- KONFIGURASI & ELEMEN GLOBAL ---
    const ADMIN_API_URL = `${API_URL}/admin`; // URL untuk endpoint admin
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const menuButton = document.getElementById('menu-button');    
    const allLinks = document.querySelectorAll('.sidebar-link, .settings-card-link, .accounting-card-link, .report-card-link');
    const contentSections = document.querySelectorAll('.content-section');
    const sidebarLinks = document.querySelectorAll('.sidebar-link');

    // --- AUTH & ROLE CHECK ---
    const token = localStorage.getItem('token');
    const userName = localStorage.getItem('user_name');
    const userRole = localStorage.getItem('user_role');
    let userPermissions = new Set();

    let html5QrCode = null; // Definisikan di scope global

    let cashFlowChartInstance = null;
    let memberGrowthChartInstance = null;
    let incomeStatementChartInstance = null;
    let balanceSheetChartInstance = null;
    let notificationInterval = null; // Variabel untuk polling notifikasi
    let lastKnownNotificationTimestamp = null; // Untuk melacak notifikasi terakhir

    let directCashierProducts = [];
    let directCart = [];
    const applyUIPermissions = () => {
        const hasPerm = (key) => userPermissions.has(key);

        // Hide sidebar links based on permissions
        if (!hasPerm('viewUsahaKoperasi')) document.querySelector('.sidebar-link[data-target="usaha-koperasi"]')?.remove();
        if (!hasPerm('viewAccounting')) document.querySelector('.sidebar-link[data-target="accounting"]')?.remove();
        if (!hasPerm('viewReports')) document.querySelector('.sidebar-link[data-target="reports"]')?.remove();
        if (!hasPerm('viewSettings')) document.querySelector('.sidebar-link[data-target="settings"]')?.parentElement.remove();
    };

    const checkAdminAuth = async () => {
        if (!token || !['admin', 'akunting', 'manager'].includes(userRole)) {
            alert('Akses ditolak. Silakan masuk sebagai staf.');
            localStorage.clear();
            window.location.href = 'login.html';
        }
        document.getElementById('user-name-header').textContent = userName || 'Pengguna';

        try {
            const permissionsArray = await apiFetch(`${API_URL}/member/permissions`);
            userPermissions = new Set(permissionsArray);
            applyUIPermissions();
        } catch (error) {
            console.error(error);
            alert('Gagal memuat hak akses, beberapa menu mungkin tidak terlihat atau tidak berfungsi.');
        }
    };


    // --- HELPER FUNCTIONS ---
    const formatCurrency = (amount) => {
        if (amount === null || amount === undefined) return 'Rp 0';
        return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
    };
    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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
        interval = seconds / 86400; if (interval > 1) return Math.floor(interval) + " hari lalu"; interval = seconds / 3600; if (interval > 1) return Math.floor(interval) + " jam lalu"; interval = seconds / 60; if (interval > 1) return Math.floor(interval) + " menit lalu";
        return "Baru saja";
    };

    const apiFetch = async (endpoint, options = {}) => {
        const currentToken = localStorage.getItem('token');
        const headers = { 'Authorization': `Bearer ${currentToken}`, ...options.headers };

        // Do not set Content-Type for FormData, browser will do it with boundary
        if (!(options.body instanceof FormData)) {
            headers['Content-Type'] = 'application/json';
        }
        
        const response = await fetch(endpoint, { ...options, headers });

        // Handle critical auth errors first (session expired, etc.)
        if (response.status === 401 || response.status === 403) { // Unauthorized or Forbidden
            alert('Sesi Anda telah berakhir atau tidak valid. Silakan masuk kembali.');
            localStorage.clear();
            window.location.href = 'login.html';
            throw new Error('Unauthorized'); // Stop further execution
        }

        // Handle 204 No Content response for successful DELETE requests
        if (response.status === 204) {
            return; // Return nothing, indicating success without a body
        }

        // Automatically parse JSON and handle other errors generically.
        const responseData = await response.json().catch(() => {
            throw new Error(`Gagal memproses respons dari server. Status: ${response.status}`);
        });

        if (!response.ok) {
            // Throw an error with the message from the backend API.
            throw new Error(responseData.error || 'Terjadi kesalahan yang tidak diketahui.');
        }

        return responseData; // Return the parsed JSON data directly.
    };

    // Generic Dropdown Populator
    const populateDropdown = async (selectElement, endpoint, valueKey, textKey, defaultText) => {
        try {
            // Admin panel dropdowns should fetch from admin-specific, protected endpoints.
            const result = await apiFetch(`${ADMIN_API_URL}/${endpoint}`);

            // Handle both paginated ({data: []}) and non-paginated ([]) responses
            const items = Array.isArray(result) ? result : result.data;

            if (!Array.isArray(items)) {
                console.error('Invalid data structure for dropdown:', result);
                throw new Error(`Format data tidak valid untuk ${defaultText}`);
            }

            selectElement.innerHTML = `<option value="">-- Pilih ${defaultText} --</option>`;
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item[valueKey];
                // If textKey is a function, use it to generate the text
                if (typeof textKey === 'function') {
                    option.textContent = textKey(item);
                } else {
                    option.textContent = item[textKey];
                }
                selectElement.appendChild(option);
            });
        } catch (error) {
            console.error(error);
            selectElement.innerHTML = `<option value="">Gagal memuat data</option>`;
        }
    };

    const renderPagination = (containerId, pagination, loadDataFunction) => {
        const container = document.getElementById(containerId);
        if (!container) return;
    
        const { totalItems, totalPages, currentPage, limit } = pagination;
    
        if (totalItems === 0) {
            container.innerHTML = '';
            return;
        }
    
        const startItem = (currentPage - 1) * limit + 1;
        const endItem = Math.min(currentPage * limit, totalItems);
    
        container.innerHTML = `
            <div>
                Menampilkan <span class="font-semibold">${startItem}</span> - <span class="font-semibold">${endItem}</span> dari <span class="font-semibold">${totalItems}</span> hasil
            </div>
            <div class="flex items-center space-x-2">
                <button data-page="${currentPage - 1}" class="pagination-btn bg-white border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage === 1 ? 'disabled' : ''}>
                    Sebelumnya
                </button>
                <span class="px-2">Halaman ${currentPage} dari ${totalPages}</span>
                <button data-page="${currentPage + 1}" class="pagination-btn bg-white border border-gray-300 rounded-md px-3 py-1 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${currentPage >= totalPages ? 'disabled' : ''}>
                    Berikutnya
                </button>
            </div>
        `;
    
        container.querySelectorAll('.pagination-btn:not([disabled])').forEach(button => {
            button.addEventListener('click', () => loadDataFunction(parseInt(button.dataset.page, 10)));
        });
    };

    // --- FUNGSI NOTIFIKASI REAL-TIME ---
    const showToastNotification = (message, link) => {
        const container = document.getElementById('toast-container');
        if (!container) return;
    
        const toastId = 'toast-' + Date.now();
        const toast = document.createElement('div');
        toast.id = toastId;
        toast.className = 'bg-white shadow-lg rounded-lg p-4 flex items-start space-x-3 max-w-sm animate-fade-in-right cursor-pointer';
        toast.innerHTML = `
            <div class="flex-shrink-0">
                <svg class="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            </div>
            <div class="flex-1">
                <p class="font-semibold text-gray-800">Notifikasi Baru</p>
                <p class="text-sm text-gray-600">${message}</p>
            </div>
            <button class="text-gray-400 hover:text-gray-600" onclick="event.stopPropagation(); document.getElementById('${toastId}').remove();">&times;</button>
        `;
    
        toast.addEventListener('click', () => {
            if (link) {
                const notifItem = document.querySelector(`.notification-item[data-link='${link}']`);
                if (notifItem) notifItem.click();
                else switchContent(link);
            }
            toast.remove();
        });
    
        container.appendChild(toast);
        setTimeout(() => { toast.remove(); }, 7000);
    };

    const loadAndRenderNotifications = async (isInitialLoad = false) => {
        const badge = document.getElementById('notification-badge');
        const list = document.getElementById('notification-list');
        if (!badge || !list) return;
    
        try {
            // Menggunakan endpoint yang sama dengan member, karena sudah berbasis user ID
            const { count } = await apiFetch(`${API_URL}/member/notifications/unread-count`);
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
    
            const notifications = await apiFetch(`${API_URL}/member/notifications`);
            list.innerHTML = '';
    
            if (notifications.length === 0) {
                list.innerHTML = '<p class="text-center text-sm text-gray-500 p-4">Tidak ada notifikasi.</p>';
                return;
            }

            notifications.forEach(notif => {
                const notifElement = document.createElement('a');
                notifElement.href = '#';
                notifElement.className = `notification-item block p-3 hover:bg-gray-50 ${!notif.is_read ? 'bg-blue-50' : ''}`;
                notifElement.dataset.id = notif.id;
                notifElement.dataset.link = notif.link;
                notifElement.dataset.isRead = notif.is_read;
                notifElement.innerHTML = `<p class="text-sm text-gray-700">${notif.message}</p><p class="text-xs text-gray-400 mt-1">${formatRelativeTime(notif.created_at)}</p>`;
                list.appendChild(notifElement);
            });

            const latestNotification = notifications[0];
            if (isInitialLoad) {
                if (latestNotification) lastKnownNotificationTimestamp = latestNotification.created_at;
            } else {
                if (latestNotification) {
                    const latestTimestamp = new Date(latestNotification.created_at).getTime();
                    const lastKnownTimestamp = lastKnownNotificationTimestamp ? new Date(lastKnownNotificationTimestamp).getTime() : 0;

                    if (!latestNotification.is_read && latestTimestamp > lastKnownTimestamp) {
                        showToastNotification(latestNotification.message, latestNotification.link);
                    }
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
            try { await apiFetch(`${API_URL}/member/notifications/${id}/read`, { method: 'PUT' }); } catch (error) { console.error('Gagal menandai notifikasi sebagai terbaca:', error); }
            loadAndRenderNotifications();
        }
    
        if (link) switchContent(link);
    };

    const setupNotificationSystem = () => {
        const notifBtn = document.getElementById('notification-bell-btn');
        const notifDropdown = document.getElementById('notification-dropdown');
        const notifList = document.getElementById('notification-list');

        if (!notifBtn || !notifDropdown || !notifList) return;

        notifBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifDropdown.classList.toggle('hidden');
        });
        notifList.addEventListener('click', handleNotificationClick);

        // Muat notifikasi pertama kali dan mulai polling
        loadAndRenderNotifications(true); // true untuk muat awal
        notificationInterval = setInterval(() => loadAndRenderNotifications(false), 15000); // Periksa setiap 15 detik
    };

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
    
        // The backend provides data for the last 12 months, sorted.
        // We just need to format it.
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
                            stepSize: 1, // Only show whole numbers for member counts
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
        const expenseData = data.map(item => parseFloat(item.total_cogs) + parseFloat(item.total_expense)); // Total expense is COGS + operational expense
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
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
                    },
                    {
                        type: 'bar',
                        label: 'Beban (HPP + Biaya)',
                        data: expenseData,
                        backgroundColor: 'rgba(255, 159, 64, 0.6)',
                        borderColor: 'rgba(255, 159, 64, 1)',
                        borderWidth: 1
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
                onHover: (event, chartElement) => {
                    // Change cursor to pointer on hover over a bar
                    event.native.target.style.cursor = chartElement[0] ? 'pointer' : 'default';
                },
                onClick: (event, elements) => {
                    if (elements.length === 0) return; // Exit if click is not on a bar

                   const elementIndex = elements[0].index;
                   const clickedMonthData = data[elementIndex];
                   if (!clickedMonthData) return;

                   const [year, month] = clickedMonthData.month.split('-');
                   const startDate = new Date(year, parseInt(month, 10) - 1, 1).toISOString().split('T')[0];
                   const endDate = new Date(year, parseInt(month, 10), 0).toISOString().split('T')[0];

                   // Pass filters via URL parameters (or a shared state object)
                   const params = { startDate, endDate };
                   switchContent('general-journal', params);
                },
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
                        backgroundColor: 'rgba(54, 162, 235, 0.6)', // Blue
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Kewajiban',
                        data: [liabilities],
                        backgroundColor: 'rgba(255, 99, 132, 0.6)', // Red
                        borderColor: 'rgba(255, 99, 132, 1)',
                        borderWidth: 1
                    },
                    {
                        label: 'Ekuitas',
                        data: [equity],
                        backgroundColor: 'rgba(75, 192, 192, 0.6)', // Green
                        borderColor: 'rgba(75, 192, 192, 1)',
                        borderWidth: 1
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

    const setupIncomeStatementChartFilter = () => {
        const yearSelect = document.getElementById('income-statement-year-filter');
        const chartTitle = document.getElementById('income-statement-chart-title');
        if (!yearSelect) return;
    
        const loadDataForYear = async (year) => {
            const ctx = document.getElementById('income-statement-chart');
            if (!ctx) return;
    
            // Show loading state
            if (incomeStatementChartInstance) incomeStatementChartInstance.destroy();
            const context = ctx.getContext('2d');
            context.clearRect(0, 0, ctx.width, ctx.height);
            context.font = "16px Inter, sans-serif";
            context.fillStyle = "grey";
            context.textAlign = "center";
            context.fillText("Memuat data...", ctx.width / 2, ctx.height / 2);
    
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/income-statement-summary?year=${year}`);
                renderIncomeStatementChart(data);
                if (chartTitle) chartTitle.textContent = `Ringkasan Laba Rugi (${year})`;
            } catch (error) {
                console.error(error);
                context.clearRect(0, 0, ctx.width, ctx.height);
                context.fillStyle = "red";
                context.fillText(error.message, ctx.width / 2, ctx.height / 2);
            }
        };
    
        // Prevent adding listeners multiple times if the dashboard is revisited
        if (yearSelect.dataset.listenerAttached) {
            // If already attached, just reload data for the currently selected year
            loadDataForYear(yearSelect.value);
            return;
        }
        yearSelect.dataset.listenerAttached = 'true';
    
        const currentYear = new Date().getFullYear();
        yearSelect.innerHTML = ''; // Clear existing options
        for (let i = currentYear; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
    
        yearSelect.addEventListener('change', () => {
            loadDataForYear(yearSelect.value);
        });
    
        // Initial load
        loadDataForYear(currentYear);
    };

    const setupDashboardFilters = () => {
        const applyBtn = document.getElementById('apply-cf-chart-filter');
        const startDateInput = document.getElementById('cf-chart-start-date');
        const endDateInput = document.getElementById('cf-chart-end-date');
        const chartTitle = document.getElementById('cashflow-chart-title');

        if (!applyBtn) return;

        // Set default dates for the filter inputs to last 30 days
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
                const data = await apiFetch(`${ADMIN_API_URL}/cashflow-summary?startDate=${startDate}&endDate=${endDate}`);
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

    // --- FUNGSI UNTUK MENU MOBILE ---
    const toggleMenu = () => {
        sidebar.classList.toggle('-translate-x-full');
        sidebarOverlay.classList.toggle('hidden');
    };
    if (menuButton) menuButton.addEventListener('click', toggleMenu);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleMenu);

    // --- FUNGSI UNTUK DASHBOARD ---
    const loadDashboardData = async () => {
        try {
            // 1. Ambil statistik umum (simpanan, pinjaman, pendaftar baru)
            const stats = await apiFetch(`${ADMIN_API_URL}/stats`); // Pastikan endpoint ini benar

            document.getElementById('total-savings').textContent = formatCurrency(stats.totalSavings);
            document.getElementById('total-loans').textContent = formatCurrency(stats.totalActiveLoans);
            document.getElementById('pending-members-count').textContent = stats.pendingMembers || 0;
            document.getElementById('total-members').textContent = stats.totalMembers || 0;

            // Muat data untuk grafik arus kas (default 30 hari terakhir)
            const cashFlowData = await apiFetch(`${ADMIN_API_URL}/cashflow-summary`);
            renderCashFlowChart(cashFlowData);

            // Muat data untuk grafik pertumbuhan anggota
            const memberGrowthData = await apiFetch(`${ADMIN_API_URL}/member-growth`);
            renderMemberGrowthChart(memberGrowthData);

            // Muat data untuk grafik neraca
            const balanceSheetData = await apiFetch(`${ADMIN_API_URL}/balance-sheet-summary`);
            renderBalanceSheetChart(balanceSheetData);

            setupIncomeStatementChartFilter(); // Panggil fungsi filter untuk grafik laba rugi di dasbor

        } catch (error) {
            console.error('Error loading dashboard data:', error);
            document.getElementById('total-members').textContent = 'N/A';
            // Anda bisa menambahkan pesan error di area grafik jika diperlukan
        }
    };

    // --- FUNGSI UNTUK ANGGOTA ---
    let currentMemberFilters = {};
    const loadMembers = async (page = 1) => {
        const tableBody = document.getElementById('members-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-gray-500">Memuat data anggota...</td></tr>`;

        try {
            const filters = { ...currentMemberFilters, page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            
            const { data: members, pagination } = await apiFetch(`${ADMIN_API_URL}/members?${queryParams}`);

            // Saring daftar untuk hanya menampilkan pengguna dengan peran 'member'
            const memberOnlyList = members.filter(user => user.role === 'member');

            tableBody.innerHTML = '';
            if (memberOnlyList.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-gray-500">Tidak ada anggota yang cocok dengan filter.</td></tr>`;
                renderPagination('members-pagination-controls', { totalItems: 0 }, loadMembers);
                return;
            }

            const offset = (pagination.currentPage - 1) * pagination.limit;

            memberOnlyList.forEach((member, index) => {
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500">${offset + index + 1}</td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${member.name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${member.cooperative_number || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${member.ktp_number || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${member.company_name || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${member.position_name || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(member.total_savings)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(member.total_loans)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(member.approval_date)}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">
                        <button class="details-member-btn text-indigo-600 hover:text-indigo-900" data-id="${member.id}">Detail</button>
                    </td>
                `;
            });

            // Render pagination controls
            renderPagination('members-pagination-controls', pagination, loadMembers);
        } catch (error) {
            console.error('Error loading members:', error);
            tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };
    const membersTableBody = document.getElementById('members-table-body');
    if(membersTableBody) {
        membersTableBody.addEventListener('click', (e) => {
            if (e.target.matches('.details-member-btn')) {
                showMemberDetails(e.target.dataset.id);
            }
            // could add edit/delete later here
        });
    }

    // --- EVENT LISTENERS UNTUK FILTER ANGGOTA ---
    const membersFilterForm = document.getElementById('members-filter-form');
    if (membersFilterForm) {
        const companySelect = document.getElementById('members-filter-company');
        populateDropdown(companySelect, 'employers', 'id', 'name', 'Semua Perusahaan');

        membersFilterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            currentMemberFilters = {
                search: document.getElementById('members-filter-search').value,
                companyId: document.getElementById('members-filter-company').value,
            };
            Object.keys(currentMemberFilters).forEach(key => !currentMemberFilters[key] && delete currentMemberFilters[key]);
            loadMembers(1);
        });

        document.getElementById('members-filter-reset-btn').addEventListener('click', () => {
            membersFilterForm.reset();
            currentMemberFilters = {};
            loadMembers(1);
        });
    }

    // --- FUNGSI UNTUK SIMPANAN ---
    let currentSavingsFilters = {};
    const loadSavings = async (page = 1) => {
        const tableBody = document.getElementById('savings-table-body');
        const tableFooter = tableBody.nextElementSibling; // Asumsikan <tfoot> adalah sibling setelah <tbody>
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">Memuat data simpanan...</td></tr>`;
        try {
            const filters = { ...currentSavingsFilters, page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            const { data: savings, pagination } = await apiFetch(`${ADMIN_API_URL}/savings?${queryParams}`);

            tableBody.innerHTML = '';
            if (savings.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">Tidak ada data simpanan ditemukan.</td></tr>`;
                if(tableFooter) tableFooter.innerHTML = '';
                renderPagination('savings-pagination-controls', { totalItems: 0 }, loadSavings);
                return;
            }
            
            let totalAmountOnPage = 0;
            let approvedTotal = 0;

            savings.forEach(saving => {
                const row = tableBody.insertRow();
                const isWithdrawal = saving.savingTypeName === 'Penarikan Simpanan Sukarela';
                const displayAmount = isWithdrawal ? -saving.amount : saving.amount;
                const amountClass = isWithdrawal ? 'text-red-600' : 'text-gray-500';
                const statusClass = saving.status === 'Approved' ? 'bg-green-100 text-green-800' : (saving.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800');
                
                totalAmountOnPage += parseFloat(displayAmount);
                if (saving.status === 'Approved') {
                    approvedTotal += parseFloat(displayAmount);
                }

                let adminActions = '';
                if (userRole === 'admin') {
                    if (saving.status === 'Pending') adminActions += `<button class="edit-saving-btn text-indigo-600 hover:text-indigo-900" data-id="${saving.id}">Ubah</button>`;
                    adminActions += `<button class="delete-saving-btn text-red-600 hover:text-red-900" data-id="${saving.id}">Hapus</button>`;
                }

                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${saving.memberName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${saving.savingTypeName}</td>
                    <td class="px-6 py-4 text-sm ${amountClass} text-right">${formatCurrency(displayAmount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(saving.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${saving.description || '-'}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${saving.status}</span></td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">${adminActions}</td>
                `;
            });
            
            if (tableFooter) {
                tableFooter.innerHTML = `
                    <tr class="bg-gray-100 font-bold">
                        <td class="px-6 py-3 text-left text-sm text-gray-800" colspan="2">Total di Halaman Ini</td>
                        <td class="px-6 py-3 text-right text-sm text-gray-800">${formatCurrency(totalAmountOnPage)}</td>
                        <td colspan="4"></td>
                    </tr>
                `;
            }

            renderPagination('savings-pagination-controls', pagination, loadSavings);

        } catch (error) {
            console.error('Error loading savings:', error);
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    // Tambahkan event listener untuk aksi di tabel simpanan (Hapus)
    const savingsTableBody = document.getElementById('savings-table-body');
    if (savingsTableBody) {
        savingsTableBody.addEventListener('click', async (e) => {
            const button = e.target;
            if (button.matches('.delete-saving-btn')) {
                const savingId = button.dataset.id;
                if (confirm('Anda yakin ingin menghapus data simpanan ini? Tindakan ini tidak dapat dibatalkan.')) {
                    try {
                        await apiFetch(`${ADMIN_API_URL}/savings/${savingId}`, { method: 'DELETE' });
                        alert('Data simpanan berhasil dihapus.');
                        loadSavings(1); // Muat ulang daftar simpanan dari halaman pertama
                    } catch (error) {
                        alert(`Terjadi kesalahan: ${error.message}`);
                        console.error('Error deleting saving:', error);
                    }
                }
            }
        });
    }

    // --- FUNGSI UNTUK PINJAMAN ---
    let currentLoansFilters = {};
    const loadLoans = async (page = 1) => {
        const tableBody = document.getElementById('loans-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-gray-500">Memuat data pinjaman...</td></tr>`;
        try {
            const filters = { ...currentLoansFilters, page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            // Diasumsikan endpoint /api/loans sudah ada dan melakukan join yang diperlukan
            const { data: loans, pagination } = await apiFetch(`${ADMIN_API_URL}/loans?${queryParams}`);

            tableBody.innerHTML = '';
            if (loans.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-gray-500">Tidak ada data pinjaman ditemukan.</td></tr>`;
                renderPagination('loans-pagination-controls', { totalItems: 0 }, loadLoans);
                return;
            }

            loans.forEach(loan => {
                const row = tableBody.insertRow();
                // Diasumsikan backend mengembalikan field-field ini dari join atau kalkulasi
                const monthlyInstallment = loan.monthlyInstallment || 0;
                const totalPayment = loan.totalPayment || 0;
                const statusClass = loan.status === 'Approved' ? 'bg-green-100 text-green-800' : (loan.status === 'Rejected' ? 'bg-red-100 text-red-800' : (loan.status === 'Lunas' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'));
                const adminActions = userRole === 'admin' && loan.status === 'Pending'
                    ? `<button class="edit-loan-btn text-indigo-600 hover:text-indigo-900" data-id="${loan.id}">Ubah</button>
                       <button class="delete-loan-btn text-red-600 hover:text-red-900" data-id="${loan.id}">Hapus</button>`
                    : '';
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${loan.memberName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${loan.loanTypeName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(loan.amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-center">${loan.tenorMonths} bulan</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(monthlyInstallment)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(totalPayment)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(loan.date)}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${loan.status}</span></td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2 whitespace-nowrap">
                        <button class="details-loan-btn text-blue-600 hover:text-blue-900" data-id="${loan.id}">Detail</button>${adminActions}
                    </td>
                `;
            });

            renderPagination('loans-pagination-controls', pagination, loadLoans);
        } catch (error) {
            console.error('Error loading loans:', error);
            tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    // --- EVENT LISTENERS UNTUK FILTER PINJAMAN ---
    const loansFilterForm = document.getElementById('loans-filter-form');
    if (loansFilterForm) {
        loansFilterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            currentLoansFilters = {
                status: document.getElementById('loans-filter-status').value,
                startDate: document.getElementById('loans-filter-start-date').value,
                endDate: document.getElementById('loans-filter-end-date').value,
                search: document.getElementById('loans-filter-search').value,
            };
            // Hapus filter kosong
            Object.keys(currentLoansFilters).forEach(key => !currentLoansFilters[key] && delete currentLoansFilters[key]);
            loadLoans(1);
        });

        document.getElementById('loans-filter-reset-btn').addEventListener('click', () => {
            loansFilterForm.reset();
            currentLoansFilters = {};
            loadLoans(1);
        });
    }

    // --- FUNGSI UNTUK KARTU PIUTANG ---
    let currentReceivablesFilters = {};
    const loadReceivablesLedger = async (page = 1) => {
        const tableBody = document.getElementById('receivables-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Memuat data piutang...</td></tr>`;
        try {
            // Filter untuk pinjaman aktif yang mewakili piutang
            const filters = { ...currentReceivablesFilters, status: 'Approved', page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            
            // Menggunakan endpoint /api/loans yang sudah ada
            const { data: loans, pagination } = await apiFetch(`${ADMIN_API_URL}/loans?${queryParams}`);

            tableBody.innerHTML = '';
            if (loans.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Tidak ada piutang pinjaman aktif ditemukan.</td></tr>`;
                renderPagination('receivables-pagination-controls', { totalItems: 0 }, loadReceivablesLedger);
                return;
            }

            loans.forEach(loan => {
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${loan.memberName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${loan.cooperativeNumber || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(loan.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(loan.amount)}</td>
                    <td class="px-6 py-4 text-sm font-semibold text-gray-800 text-right">${formatCurrency(loan.remainingPrincipal)}</td>
                    <td class="px-6 py-4 text-sm font-medium">
                        <button class="details-loan-btn text-blue-600 hover:text-blue-900" data-id="${loan.id}">Lihat Rincian</button>
                    </td>
                `;
            });

            renderPagination('receivables-pagination-controls', pagination, loadReceivablesLedger);
        } catch (error) {
            console.error('Error loading receivables ledger:', error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    // --- EVENT LISTENERS UNTUK FILTER KARTU PIUTANG ---
    const receivablesFilterForm = document.getElementById('receivables-filter-form');
    if (receivablesFilterForm) {
        receivablesFilterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            currentReceivablesFilters = {
                search: document.getElementById('receivables-filter-search').value,
            };
            Object.keys(currentReceivablesFilters).forEach(key => !currentReceivablesFilters[key] && delete currentReceivablesFilters[key]);
            loadReceivablesLedger(1);
        });

        document.getElementById('receivables-filter-reset-btn').addEventListener('click', () => {
            receivablesFilterForm.reset();
            currentReceivablesFilters = {};
            loadReceivablesLedger(1);
        });
    }

    const loansTableBody = document.getElementById('loans-table-body');
    if (loansTableBody) {
        loansTableBody.addEventListener('click', async (e) => {
            const button = e.target;
            const loanId = button.dataset.id;

            if (button.matches('.details-loan-btn')) {
                showAdminLoanDetailsModal(loanId);
            }

            if (button.matches('.edit-loan-btn')) {
                showEditLoanModal(loanId);
            }

            if (button.matches('.delete-loan-btn')) {
                if (confirm('Anda yakin ingin menghapus pengajuan pinjaman ini? Tindakan ini tidak dapat dibatalkan.')) {
                    try {
                        await apiFetch(`${ADMIN_API_URL}/loans/${loanId}`, {
                            method: 'DELETE',
                        });
                        
                        alert('Pengajuan pinjaman berhasil dihapus.');
                        loadLoans(); // Reload the list
                    } catch (error) {
                        alert(`Terjadi kesalahan: ${error.message}`);
                        console.error('Error deleting loan:', error);
                    }
                }
            }
        });
    }

    const receivablesTableBody = document.getElementById('receivables-table-body');
    if (receivablesTableBody) {
        receivablesTableBody.addEventListener('click', async (e) => {
            const button = e.target;
            const loanId = button.dataset.id;

            if (button.matches('.details-loan-btn')) {
                showAdminLoanDetailsModal(loanId);
            }
        });
    }

    // --- FUNGSI UNTUK MODAL UBAH PINJAMAN ---
    const loanEditModal = document.getElementById('loan-edit-modal');
    const loanEditForm = document.getElementById('loan-edit-form');
    if (loanEditModal) {
        document.getElementById('close-loan-edit-modal').addEventListener('click', () => loanEditModal.classList.add('hidden'));
        document.getElementById('cancel-loan-edit-modal').addEventListener('click', () => loanEditModal.classList.add('hidden'));

        loanEditForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loanId = document.getElementById('loan-edit-id-input').value;
            const loan_term_id = document.getElementById('loan-edit-term-select').value;
            const amount = document.getElementById('loan-edit-amount-input').value;

            try {
                await apiFetch(`${ADMIN_API_URL}/loans/${loanId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ loan_term_id, amount }),
                });

                alert('Pengajuan pinjaman berhasil diperbarui.');
                loanEditModal.classList.add('hidden');
                loadLoans(); // Muat ulang daftar pinjaman
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
                console.error('Error updating loan:', error);
            }
        });
    }

    const showEditLoanModal = async (loanId) => {
        loanEditForm.reset();
        loanEditModal.classList.remove('hidden');
        try {
            const loan = await apiFetch(`${ADMIN_API_URL}/loans/${loanId}`);

            document.getElementById('loan-edit-id-input').value = loan.id;
            document.getElementById('loan-edit-member-name').textContent = loan.member_name;
            document.getElementById('loan-edit-amount-input').value = loan.amount;

            const termSelect = document.getElementById('loan-edit-term-select');
            await populateDropdown(termSelect, 'loanterms', 'id', 
                (item) => `${item.loan_type_name} - ${item.tenor_months} bulan (${item.interest_rate}%)`, 
                'Produk Pinjaman');
            termSelect.value = loan.loan_term_id;
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
            loanEditModal.classList.add('hidden');
        }
    };

    // --- FUNGSI UNTUK MODAL DETAIL PINJAMAN (ADMIN) ---
    const adminLoanDetailsModal = document.getElementById('admin-loan-details-modal');
    if (adminLoanDetailsModal) {
        document.getElementById('close-admin-loan-details-modal-btn').addEventListener('click', () => {
            adminLoanDetailsModal.classList.add('hidden');
        });

        adminLoanDetailsModal.addEventListener('click', async (e) => {
            if (!e.target.matches('.pay-installment-btn')) return;
    
            const button = e.target;
            const { loanId, installmentNumber } = button.dataset;
    
            if (!confirm(`Anda yakin ingin mencatat pembayaran untuk angsuran ke-${installmentNumber}?`)) {
                return;
            }
    
            button.disabled = true;
            button.textContent = 'Memproses...';
    
            try {
                const result = await apiFetch(`${ADMIN_API_URL}/loans/payment`, {
                    method: 'POST',
                    body: JSON.stringify({ loanId, installmentNumber }),
                });
    
                alert(result.message);
    
                // Refresh the modal content to show the updated status
                showAdminLoanDetailsModal(loanId);
    
                // If the loan is now 'Lunas', refresh the main loans list as well
                if (result.loanStatus === 'Lunas') {
                    loadLoans();
                }
    
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
                button.disabled = false;
                button.textContent = 'Bayar';
            }
        });

        // Event listener untuk tombol Batalkan Pembayaran
        adminLoanDetailsModal.addEventListener('click', async (e) => {
            if (!e.target.matches('.cancel-installment-btn')) return;

            const button = e.target;
            const { paymentId, loanId } = button.dataset;

            if (!confirm('Anda yakin ingin membatalkan pembayaran ini? Stok akan dikembalikan dan jurnal akan dihapus.')) {
                return;
            }

            button.disabled = true;
            button.textContent = 'Membatalkan...';

            try {
                await apiFetch(`${ADMIN_API_URL}/loan-payments/${paymentId}`, { method: 'DELETE' });
                alert('Pembayaran berhasil dibatalkan.');
                showAdminLoanDetailsModal(loanId); // Refresh modal
                loadLoans(); // Refresh daftar pinjaman utama
            } catch (error) { alert(`Gagal membatalkan: ${error.message}`); button.disabled = false; button.textContent = 'Batalkan'; }
        });
    }

    const showAdminLoanDetailsModal = async (loanId) => {
        if (!adminLoanDetailsModal) return;
        
        const titleEl = document.getElementById('admin-loan-details-modal-title');
        const summarySection = document.getElementById('admin-loan-summary-section');
        const installmentsTableBody = document.getElementById('admin-loan-installments-table-body');

        adminLoanDetailsModal.classList.remove('hidden');
        titleEl.textContent = 'Memuat Detail Pinjaman...';
        summarySection.innerHTML = `<p class="text-gray-500 col-span-full text-center">Memuat ringkasan...</p>`;
        installmentsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Memuat jadwal angsuran...</td></tr>`;

        try {
            const { summary, installments } = await apiFetch(`${ADMIN_API_URL}/loans/${loanId}/details`);

            titleEl.textContent = `Detail Pinjaman - ${summary.memberName}`;

            const isLoanPayable = summary.status === 'Approved';

            // Populate summary
            const renderSummaryDetail = (label, value) => `<div class="p-2"><p class="text-xs text-gray-500">${label}</p><p class="font-semibold text-gray-800">${value}</p></div>`;
            summarySection.innerHTML = `
                ${renderSummaryDetail('Jumlah Pinjaman', formatCurrency(summary.amount))}
                ${renderSummaryDetail('Angsuran/Bulan (Awal)', formatCurrency(summary.monthlyInstallment))}
                ${renderSummaryDetail('Tenor', `${summary.tenor_months} bulan`)}
                ${renderSummaryDetail('Total Terbayar', formatCurrency(summary.totalPaid))}
            `;

            // Populate installments table
            if (installments.length === 0) {
                installmentsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Jadwal angsuran tidak tersedia.</td></tr>`;
                return;
            }
            
            installmentsTableBody.innerHTML = '';
            installments.forEach(inst => {
                const statusClass = inst.status === 'Lunas' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';

                let actionButton = '';
                if (inst.status === 'Lunas' && userRole === 'admin') {
                    // Tombol Batalkan untuk admin jika sudah lunas
                    actionButton = `<button class="cancel-installment-btn text-sm bg-red-600 text-white py-1 px-3 rounded-md hover:bg-red-700" data-payment-id="${inst.paymentId}" data-loan-id="${summary.id}">Batalkan</button>`;
                } else if (inst.status !== 'Lunas' && isLoanPayable && ['admin', 'akunting'].includes(userRole)) {
                    // Tombol Bayar jika belum lunas
                    actionButton = `<button class="pay-installment-btn text-sm bg-green-600 text-white py-1 px-3 rounded-md hover:bg-green-700" data-loan-id="${summary.id}" data-installment-number="${inst.installmentNumber}">Bayar</button>`;
                } else if (inst.status !== 'Lunas') {
                    actionButton = `-`;
                }

                const row = installmentsTableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500 text-center">${inst.installmentNumber}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(inst.dueDate)}</td>
                    <td class="px-6 py-4 text-sm text-gray-900 text-right">${formatCurrency(inst.amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(inst.paymentDate)}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${inst.status}</span></td>
                    <td class="px-6 py-4 text-sm font-medium">${actionButton}</td>
                `;
            });

        } catch (error) {
            console.error('Error loading loan details for admin:', error);
            titleEl.textContent = 'Gagal Memuat Data';
            summarySection.innerHTML = `<p class="text-red-500 col-span-full text-center">${error.message}</p>`;
            installmentsTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Gagal memuat jadwal angsuran.</td></tr>`;
        }
    };

    // --- FUNGSI UNTUK PERSETUJUAN ---
    const approvalTabBtns = document.querySelectorAll('.approval-tab-btn');
    const approvalTabContents = document.querySelectorAll('.approval-tab-content');
    const pendingMembersTableBody = document.getElementById('pending-members-table-body');

    const renderPendingMembers = async () => {
        if (!pendingMembersTableBody) return;
        
        try { // Menggunakan endpoint admin yang baru
            const { data: pendingMembers } = await apiFetch(`${ADMIN_API_URL}/members?status=Pending`);
            
            pendingMembersTableBody.innerHTML = ''; // Kosongkan tabel

            if (!pendingMembers || !Array.isArray(pendingMembers) || pendingMembers.length === 0) {
                pendingMembersTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Tidak ada pendaftaran baru.</td></tr>`;
                return;
            }

            pendingMembers.forEach(member => {
                const row = document.createElement('tr');
                // cooperative_number akan kosong untuk pendaftar baru
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${member.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${member.cooperative_number || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${member.ktp_number || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${member.company_name || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(member.registration_date).toLocaleDateString('id-ID')}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button class="details-member-btn text-blue-600 hover:text-blue-900" data-id="${member.id}">Detail</button>
                        <button class="approve-member-btn text-green-600 hover:text-green-900" data-id="${member.id}">Setujui</button>
                        <button class="reject-member-btn text-red-600 hover:text-red-900" data-id="${member.id}">Tolak</button>
                    </td>
                `;
                pendingMembersTableBody.appendChild(row);
            });
        } catch (error) {
            console.error('Error fetching pending members:', error);
            pendingMembersTableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const loadPendingResignations = async () => {
        const tableBody = document.getElementById('pending-resignations-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Memuat permintaan pengunduran diri...</td></tr>`;

        try {
            // Endpoint ini perlu dibuat di backend.
            // Endpoint harus mengambil anggota dengan status 'Pending Resignation' dan melakukan join untuk mendapatkan total simpanan.
            const resignations = await apiFetch(`${ADMIN_API_URL}/pending-resignations`);
            if (!Array.isArray(resignations)) throw new Error('Format data tidak sesuai.');

            tableBody.innerHTML = ''; // Kosongkan tabel

            if (!resignations || resignations.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Tidak ada permintaan pengunduran diri.</td></tr>`;
                return;
            }

            resignations.forEach(member => {
                const row = tableBody.insertRow();
                // Backend harus mengembalikan: name, cooperative_number, approval_date, total_savings, request_date (dari updated_at)
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${member.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${member.cooperative_number || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(member.approval_date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${formatCurrency(member.total_savings)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(member.request_date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <button class="process-resignation-btn text-green-600 hover:text-green-900" data-id="${member.id}">Proses</button>
                        <button class="details-member-btn text-blue-600 hover:text-blue-900" data-id="${member.id}">Detail</button>
                    </td>
                `;
            });
        } catch (error) {
            console.error('Error fetching pending resignations:', error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const loadResignationHistory = async () => {
        const tableBody = document.getElementById('resignation-history-table-body');
        if (!tableBody) return;
    
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat riwayat...</td></tr>`;
    
        try {
            // Use the admin members endpoint with a status filter
            const { data: inactiveMembers } = await apiFetch(`${ADMIN_API_URL}/members?status=Inactive`);
    
            tableBody.innerHTML = '';
    
            if (!inactiveMembers || !Array.isArray(inactiveMembers) || inactiveMembers.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada riwayat pengunduran diri.</td></tr>`;
                return;
            }
    
            inactiveMembers.forEach(member => {
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${member.name}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${member.cooperative_number || '-'}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(member.approval_date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(member.resignation_date)}</td>
                    <td class="px-6 py-4 whitespace-nowrap text-sm font-medium"><button class="details-member-btn text-blue-600 hover:text-blue-900" data-id="${member.id}">Detail</button></td>
                `;
            });
        } catch (error) { console.error('Error fetching resignation history:', error); tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`; }
    };

    const handleMemberApproval = async (e) => {
        const button = e.target;
        const memberId = button.dataset.id;

        if (button.matches('.details-member-btn')) {
            showMemberDetails(memberId);
            return;
        }

        if (button.matches('.approve-member-btn, .reject-member-btn')) {
            const isApproved = button.matches('.approve-member-btn');
            const newStatus = isApproved ? 'Active' : 'Rejected';

            if (!confirm(`Anda yakin ingin ${isApproved ? 'menyetujui' : 'menolak'} pendaftaran ini?`)) {
                return;
            }

            try {
                const updatedMember = await apiFetch(`${ADMIN_API_URL}/members/${memberId}/status`, {
                    method: 'PUT',
                    body: JSON.stringify({ status: newStatus }),
                });
                alert(`Status anggota "${updatedMember.name}" berhasil diubah menjadi "${newStatus}".`);
                renderPendingMembers();

            } catch (error) {
                console.error('Error handling member approval:', error);
                alert(`Terjadi kesalahan: ${error.message}`);
            }
        }
    };

    if (pendingMembersTableBody) {
        pendingMembersTableBody.addEventListener('click', handleMemberApproval);
    }

    // Tambahkan event listener untuk tabel pengunduran diri
    const pendingResignationsTableBody = document.getElementById('pending-resignations-table-body');
    if (pendingResignationsTableBody) {
        pendingResignationsTableBody.addEventListener('click', (e) => {
            const button = e.target;
            const memberId = button.dataset.id;

            if (button.matches('.process-resignation-btn')) {
                showResignationModal(memberId);
            }

            if (button.matches('.details-member-btn')) {
                showMemberDetails(memberId);
            }
        });
    }

    // Tambahkan event listener untuk tabel riwayat pengunduran diri
    const resignationHistoryTableBody = document.getElementById('resignation-history-table-body');
    if (resignationHistoryTableBody) {
        resignationHistoryTableBody.addEventListener('click', (e) => {
            const button = e.target;
            const memberId = button.dataset.id;

            if (button.matches('.details-member-btn')) {
                showMemberDetails(memberId);
            }
        });
    }

    const showResignationModal = async (memberId) => {
        const modal = document.getElementById('resignation-modal');
        if (!modal) return;

        // Reset and show modal
        modal.classList.remove('hidden');
        document.getElementById('resignation-modal-title').textContent = 'Proses Pengunduran Diri';
        document.getElementById('resignation-member-name').textContent = 'Memuat...';
        document.getElementById('resignation-total-savings').textContent = 'Memuat...';
        document.getElementById('resignation-member-id-input').value = memberId;
        
        const confirmBtn = document.getElementById('confirm-resignation-btn');
        confirmBtn.disabled = true; // Disable button while loading

        try {
            // Fetch the list and find the specific member to get their details
            const resignations = await apiFetch(`${ADMIN_API_URL}/pending-resignations`);
            const member = resignations.find(r => r.id.toString() === memberId.toString());

            if (!member) {
                throw new Error('Anggota tidak ditemukan dalam daftar permintaan pengunduran diri.');
            }

            document.getElementById('resignation-member-name').textContent = member.name;
            document.getElementById('resignation-total-savings').textContent = formatCurrency(member.total_savings);
            confirmBtn.disabled = false; // Re-enable button

        } catch (error) {
            console.error('Error showing resignation modal:', error);
            document.getElementById('resignation-modal-title').textContent = 'Error';
            // Use a specific content div for the error message to not break the layout
            const contentDiv = document.getElementById('resignation-modal-content');
            if (contentDiv) {
                contentDiv.innerHTML = `<p class="text-red-500">${error.message}</p>`;
            }
        }
    }

    const memberDetailsModal = document.getElementById('member-details-modal');
    const memberDetailsContent = document.getElementById('member-details-content');
    const memberDetailsModalTitle = document.getElementById('member-details-modal-title');
    document.getElementById('close-member-details-modal-btn')?.addEventListener('click', () => memberDetailsModal.classList.add('hidden'));

    memberDetailsContent.addEventListener('click', async (e) => {
        if (e.target.id === 'show-member-loan-history-btn') {
            const button = e.target;
            const memberId = button.dataset.memberId;
            const container = document.getElementById('member-loan-history-container');
            
            // Toggle visibility
            if (!container.classList.contains('hidden')) {
                container.classList.add('hidden');
                button.textContent = 'Lihat Riwayat Pinjaman';
                return;
            }

            button.disabled = true;
            button.textContent = 'Memuat...';
            container.innerHTML = '<p class="text-gray-500">Memuat riwayat pinjaman...</p>';
            container.classList.remove('hidden');

            try {
                const loans = await apiFetch(`${ADMIN_API_URL}/members/${memberId}/loans`);

                if (loans.length === 0) {
                    container.innerHTML = '<p class="text-gray-500 text-sm">Anggota ini tidak memiliki riwayat pinjaman.</p>';
                    return;
                }

                container.innerHTML = `
                    <div class="overflow-x-auto border rounded-lg mt-2">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th>
                                    <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tipe Pinjaman</th>
                                    <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Jumlah</th>
                                    <th class="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${loans.map(loan => {
                                    const statusClass = loan.status === 'Lunas' ? 'bg-blue-100 text-blue-800' : (loan.status === 'Approved' ? 'bg-green-100 text-green-800' : (loan.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'));
                                    return `<tr><td class="px-4 py-2 text-sm text-gray-500">${formatDate(loan.date)}</td><td class="px-4 py-2 text-sm text-gray-900">${loan.loanTypeName}</td><td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(loan.amount)}</td><td class="px-4 py-2 text-center"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${loan.status}</span></td></tr>`;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>`;
            } catch (error) {
                container.innerHTML = `<p class="text-red-500">${error.message}</p>`;
            } finally {
                button.disabled = false;
                button.textContent = 'Sembunyikan Riwayat';
            }
        }
    });

    const showMemberDetails = async (memberId) => {
        memberDetailsModal.classList.remove('hidden');
        memberDetailsModalTitle.textContent = 'Memuat Data...';
        memberDetailsContent.innerHTML = `<div class="text-center py-8"><p class="text-gray-500">Memuat data detail...</p></div>`;
        try { // Menggunakan endpoint admin yang baru
            const member = await apiFetch(`${ADMIN_API_URL}/members/${memberId}`);

            const renderDetail = (label, value) => `<div><dt class="text-sm font-medium text-gray-500">${label}</dt><dd class="mt-1 text-sm text-gray-900">${value || '-'}</dd></div>`;
            const renderImage = (label, path) => {
                if (!path) return '';
                const webPath = path.replace(/\\/g, '/');
                const fullUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                return `<div><dt class="text-sm font-medium text-gray-500">${label}</dt><dd class="mt-1"><a href="${fullUrl}" target="_blank" rel="noopener noreferrer"><img src="${fullUrl}" alt="${label}" class="rounded-lg max-h-48 border hover:opacity-80 transition-opacity"></a></dd></div>`;
            };

            memberDetailsModalTitle.textContent = `Detail Anggota: ${member.name}`;
            const fullAddress = [member.address_detail, member.address_village, member.address_district, member.address_city, member.address_province].filter(Boolean).join(', ');
            const statusClass = member.status === 'Active' ? 'bg-green-100 text-green-800' : (member.status === 'Rejected' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800');

            memberDetailsContent.innerHTML = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
                    <dl class="space-y-4">
                        ${renderDetail('Nama Lengkap', member.name)}
                        ${renderDetail('Nomor Koperasi', member.cooperative_number)}
                        ${renderDetail('Nomor KTP', member.ktp_number)}
                        ${renderDetail('Email', member.email)}
                        ${renderDetail('No. Telepon', member.phone)}
                    </dl>
                    <dl class="space-y-4">
                        ${renderDetail('Perusahaan', member.company_name)}
                        ${renderDetail('Jabatan', member.position_name)}
                        ${renderDetail(member.status === 'Active' ? 'Tanggal Bergabung' : 'Tanggal Pendaftaran', formatDate(member.approval_date || member.registration_date))}
                        ${renderDetail('Status', `<span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${member.status}</span>`)}
                    </dl>
                </div>
                <div class="border-t border-gray-200 pt-6 mt-6">
                    <div class="flex justify-between items-center mb-4">
                        <h4 class="text-md font-semibold text-gray-800">Informasi Keuangan</h4>
                        <button id="show-member-loan-history-btn" data-member-id="${member.id}" class="text-sm bg-blue-500 text-white py-1 px-3 rounded-md hover:bg-blue-600">Lihat Riwayat Pinjaman</button>
                    </div>
                    <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
                        ${renderDetail('Total Simpanan', formatCurrency(member.total_savings))}
                        ${renderDetail('Total Pinjaman Aktif', formatCurrency(member.total_loans))}
                    </dl>
                    <div id="member-loan-history-container" class="mt-4 hidden"></div>
                </div>
                <div class="border-t border-gray-200 pt-6 mt-6">
                    <h4 class="text-md font-semibold text-gray-800 mb-4">Alamat</h4>
                    <dl>${renderDetail('Alamat Lengkap', fullAddress)}</dl>
                </div>
                <div class="border-t border-gray-200 pt-6 mt-6">
                    <h4 class="text-md font-semibold text-gray-800 mb-4">Data Ahli Waris</h4>
                    <dl class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-6">
                        ${renderDetail('Nama Ahli Waris', member.heir_name)}
                        ${renderDetail('Hubungan', member.heir_relationship)}
                        ${renderDetail('No. Kartu Keluarga', member.heir_kk_number)}
                        ${renderDetail('No. Telepon', member.heir_phone)}
                    </dl>
                </div>
                <div class="border-t border-gray-200 pt-6 mt-6">
                    <h4 class="text-md font-semibold text-gray-800 mb-4">Dokumen Terlampir</h4>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        ${renderImage('Foto KTP', member.ktp_photo_path)}
                        ${renderImage('Foto Selfie', member.selfie_photo_path)}
                        ${renderImage('Foto Kartu Keluarga', member.kk_photo_path)}
                    </div>
                </div>
            `;
        } catch (error) {
            memberDetailsContent.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
        }
    };

    const loadPendingDeposits = async () => {
        const tableBody = document.getElementById('pending-savings-table-body');
        if (!tableBody) return;
        const colspan = 7; // Increased colspan due to new column
        tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Memuat pengajuan setoran...</td></tr>`;

        try {
            const responseData = await apiFetch(`${ADMIN_API_URL}/savings?status=Pending`);
            const allItems = responseData.data || responseData;
            // Filter for items that are deposits (Wajib or Sukarela)
            const items = allItems.filter(item => ['Simpanan Wajib', 'Simpanan Sukarela'].includes(item.savingTypeName));

            tableBody.innerHTML = '';
            if (items.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Tidak ada pengajuan setoran baru.</td></tr>`;
                return;
            }
            items.forEach(item => {
                const row = tableBody.insertRow();
                let actionButtons = `<span class="text-xs text-gray-400">Tidak ada aksi</span>`;

                if (['admin', 'akunting'].includes(userRole)) {
                    actionButtons = `<button class="approve-btn text-green-600" data-id="${item.id}" data-type="savings" data-new-status="Approved">Setujui</button>
                                     <button class="reject-btn text-red-600" data-id="${item.id}" data-type="savings" data-new-status="Rejected">Tolak</button>`;
                }
                
                let proofHtml = '-';
                if (item.proof_path) {
                    const webPath = item.proof_path.replace(/\\/g, '/');
                    const fullUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                    proofHtml = `
                        <a href="${fullUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-blue-600 hover:text-blue-800 hover:underline">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd" /></svg>
                            <span class="ml-1">Lihat</span>
                        </a>`;
                }

                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${item.memberName || 'N/A'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.savingTypeName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.cooperativeNumber || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.date)}</td>
                    <td class="px-6 py-4 text-sm text-center">${proofHtml}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error(`Error loading pending deposits:`, error);
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const loadPendingWithdrawals = async () => {
        const tableBody = document.getElementById('pending-withdrawals-table-body');
        if (!tableBody) return;
        const colspan = 6;
        tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Memuat pengajuan penarikan...</td></tr>`;

        try {
            const responseData = await apiFetch(`${ADMIN_API_URL}/savings?status=Pending`);
            const allItems = responseData.data || responseData;
            // Filter for items that ARE withdrawals
            const items = allItems.filter(item => item.savingTypeName === 'Penarikan Simpanan Sukarela');

            tableBody.innerHTML = '';
            if (items.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Tidak ada pengajuan penarikan baru.</td></tr>`;
                return;
            }
            items.forEach(item => {
                const row = tableBody.insertRow();
                let actionButtons = `<span class="text-xs text-gray-400">Tidak ada aksi</span>`;

                if (['admin', 'akunting'].includes(userRole)) {
                    actionButtons = `<button class="approve-btn text-green-600" data-id="${item.id}" data-type="savings" data-new-status="Approved">Setujui</button>
                                     <button class="reject-btn text-red-600" data-id="${item.id}" data-type="savings" data-new-status="Rejected">Tolak</button>`;
                }

                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${item.memberName || 'N/A'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.cooperativeNumber || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.description || '-'}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error(`Error loading pending withdrawals:`, error);
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const loadPendingApprovals = async (type) => {
        const endpoint = type === 'savings' ? 'savings' : 'loans';
        const tableBody = document.getElementById(`pending-${endpoint}-table-body`);
        const isLoan = type === 'loans';
        const url = isLoan ? `${ADMIN_API_URL}/pending-loans` : `${ADMIN_API_URL}/savings?status=Pending`;
        const colspan = isLoan ? 9 : 6;

        if (!isLoan) return; // Hanya proses untuk pinjaman, karena simpanan ditangani fungsi lain

        if (!tableBody) return;
        try {
            const responseData = await apiFetch(url);
            const items = responseData.data || responseData;

            tableBody.innerHTML = '';
            if (items.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-gray-500">Tidak ada pengajuan baru.</td></tr>`;
                return;
            }
            items.forEach(item => {
                const row = tableBody.insertRow();
                let actionButtons = `<span class="text-xs text-gray-400">Tidak ada aksi</span>`;

                if (isLoan) { // Logic for Loans
                    // Tombol Detail diubah menjadi tombol Surat Komitmen
                    actionButtons = `<button class="commitment-letter-btn text-blue-600 hover:text-blue-900" data-loan-id="${item.id}">Lihat Komitmen</button>`;

                    if (item.status === 'Pending' && ['admin', 'akunting'].includes(userRole)) {
                        actionButtons += `<button class="approve-btn text-green-600 ml-2" data-id="${item.id}" data-type="loans" data-new-status="Approved by Accounting">Setujui (Akunting)</button>
                                          <button class="reject-btn text-red-600" data-id="${item.id}" data-type="loans" data-new-status="Rejected">Tolak</button>`;
                    } else if (item.status === 'Approved by Accounting' && ['admin', 'manager'].includes(userRole)) {
                        actionButtons += `<button class="approve-btn text-green-600" data-id="${item.id}" data-type="loans" data-new-status="Approved">Finalisasi (Manager)</button>
                                          <button class="reject-btn text-red-600" data-id="${item.id}" data-type="loans" data-new-status="Rejected">Tolak</button>`;
                    }
                    row.innerHTML = `
                        <td class="px-6 py-4 text-sm text-gray-900">${item.memberName || 'N/A'}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">${item.cooperativeNumber || '-'}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">${item.loanTypeName}</td>
                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.amount)}</td>
                        <td class="px-6 py-4 text-sm text-gray-500 text-center">${item.tenorMonths} bln</td>
                        <td class="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                            <div>${item.bank_name || '-'}</div>
                            <div class="font-mono text-xs">${item.bank_account_number || '-'}</div>
                        </td>
                        <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.date)}</td>
                        <td class="px-6 py-4 text-sm text-gray-500">${item.status}</td>
                        <td class="px-6 py-4 text-sm font-medium space-x-2 whitespace-nowrap">${actionButtons}</td>
                    `;
                }
            });
        } catch (error) {
            console.error(`Error loading pending ${type}:`, error);
            tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const loadPendingLoanPayments = async () => {
        const tableBody = document.getElementById('pending-loan-payments-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">Memuat pembayaran tertunda...</td></tr>`;
    
        try {
            const payments = await apiFetch(`${ADMIN_API_URL}/pending-loan-payments`);
            tableBody.innerHTML = '';
            if (payments.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">Tidak ada pembayaran yang menunggu persetujuan.</td></tr>`;
                return;
            }
    
            payments.forEach(payment => {
                const row = tableBody.insertRow();
                const proofHtml = payment.proof_path
                    ? `<a href="${API_URL.replace('/api', '')}/${payment.proof_path.replace(/\\/g, '/')}" target="_blank" class="text-blue-600 hover:underline">Lihat</a>`
                    : '-';
                
                const actionButtons = `
                    <button class="approve-btn text-green-600" data-id="${payment.id}" data-type="loan-payments" data-new-status="Approved">Setujui</button>
                    <button class="reject-btn text-red-600" data-id="${payment.id}" data-type="loan-payments" data-new-status="Rejected">Tolak</button>
                `;
    
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-900">${payment.member_name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${payment.loan_id}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-center">${payment.installment_number}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(payment.amount_paid)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(payment.payment_date)}</td>
                    <td class="px-6 py-4 text-sm text-center">${proofHtml}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error('Error loading pending loan payments:', error);
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const generateAdminCommitmentPDF = async (loanId) => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const printBtn = document.getElementById('print-commitment-btn');
    
        printBtn.disabled = true;
        printBtn.textContent = 'Mencetak...';
    
        try {
            const { summary, installments } = await apiFetch(`${ADMIN_API_URL}/loans/${loanId}/details`);
    
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
    
            // --- Member & Loan Details ---
            let yPos = 45;
            doc.setFontSize(11);
            doc.text(`Nama: ${summary.memberName}`, 15, yPos);
            yPos += 7;
            doc.text(`No. Anggota: ${summary.cooperativeNumber || 'N/A'}`, 15, yPos);
            yPos += 10;
            doc.text(`Jumlah Pinjaman: ${formatCurrency(summary.amount)}`, 15, yPos);
            yPos += 7;
            doc.text(`Produk Pinjaman: ${summary.loan_type_name} - ${summary.tenor_months} bulan`, 15, yPos);
            yPos += 7;
            const totalRepayment = installments.reduce((sum, inst) => sum + parseFloat(inst.amount), 0);
            doc.text(`Total Pengembalian: ${formatCurrency(totalRepayment)}`, 15, yPos);
    
            // --- Amortization Table ---
            yPos += 10;
            doc.autoTable({
                startY: yPos,
                head: [['Bulan', 'Jatuh Tempo', 'Jumlah Bayar', 'Status']],
                body: installments.map(inst => [inst.installmentNumber, formatDate(inst.dueDate), formatCurrency(inst.amount), inst.status]),
                theme: 'grid',
                headStyles: { fillColor: [127, 29, 29] },
                styles: { fontSize: 9 },
                columnStyles: { 2: { halign: 'right' } }
            });
            yPos = doc.lastAutoTable.finalY + 10;
    
            // --- Signature ---
            doc.text(`Bandung, ${formatDate(summary.start_date)}`, 140, yPos);
            yPos += 7;
            doc.text('Hormat saya,', 140, yPos);
            yPos += 5;
    
            if (summary.commitment_signature_path) {
                const signatureUrl = `${API_URL.replace('/api', '')}/${summary.commitment_signature_path.replace(/\\/g, '/')}`;
                const signatureImg = new Image();
                signatureImg.src = signatureUrl;
                signatureImg.crossOrigin = "Anonymous"; // Penting untuk memuat gambar dari domain lain
                await new Promise(resolve => signatureImg.onload = resolve);
                doc.addImage(signatureImg, 'PNG', 140, yPos, 50, 25);
            } else {
                doc.text('[Tanda Tangan Tidak Tersedia]', 140, yPos + 15);
            }
            yPos += 30;
            doc.setLineWidth(0.2);
            doc.line(140, yPos, 190, yPos);
            doc.text(summary.memberName, 140, yPos + 5);
    
            doc.save(`Surat_Komitmen_Pinjaman_${summary.memberName}.pdf`);
    
        } catch (error) {
            alert(`Gagal membuat PDF: ${error.message}`);
        } finally {
            printBtn.disabled = false;
            printBtn.textContent = 'Cetak PDF';
        }
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
        return { tableHtml, totalRepayment: totalCicilan };
    };

    const showAdminLoanCommitment = async (loanId) => {
        const modal = document.getElementById('loan-commitment-modal');
        if (!modal) return;
    
        // Reset and show modal with loading state
        modal.classList.remove('hidden');
        const printableArea = document.getElementById('printable-commitment-area');
        printableArea.style.opacity = '0.5';
    
        try {
            // Fetch loan details using the specific endpoint
            const { summary, installments } = await apiFetch(`${ADMIN_API_URL}/loans/${loanId}/details`);
    
            // Populate modal with fetched data
            document.getElementById('commitment-member-name-text').textContent = `: ${summary.memberName}`;
            document.getElementById('commitment-coop-number-text').textContent = `: ${summary.cooperativeNumber || 'N/A'}`;
            document.getElementById('commitment-loan-amount-text').textContent = `: ${formatCurrency(summary.amount)}`;
            document.getElementById('commitment-loan-term-text').textContent = `: ${summary.loan_type_name} - ${summary.tenor_months} bulan`;

            const { tableHtml, totalRepayment } = generateAmortizationForModal(parseFloat(summary.amount), summary.tenor_months, summary.interest_rate);
            document.getElementById('commitment-total-repayment-text').textContent = `: ${formatCurrency(totalRepayment)}`;
            document.getElementById('commitment-amortization-table-container').innerHTML = tableHtml;
    
            document.getElementById('commitment-current-date').textContent = formatDate(summary.start_date);
            document.getElementById('commitment-signature-name-text').textContent = summary.memberName;
    
            // Display the member's signature image
            const signatureContainer = document.getElementById('member-signature-container');
            const signatureUrl = summary.commitment_signature_path ? `${API_URL.replace('/api', '')}/${summary.commitment_signature_path.replace(/\\/g, '/')}` : null;
            signatureContainer.innerHTML = signatureUrl ? `<img src="${signatureUrl}" alt="Tanda Tangan Anggota" class="w-full h-full object-contain">` : `<p class="text-gray-500 text-center">Tanda tangan tidak tersedia.</p>`;

            // Setup print button
            document.getElementById('print-commitment-btn').onclick = () => generateAdminCommitmentPDF(loanId);
    
            printableArea.style.opacity = '1';
        } catch (error) {
            alert(`Gagal memuat detail komitmen: ${error.message}`);
            modal.classList.add('hidden');
        }
    };

    document.getElementById('close-commitment-modal')?.addEventListener('click', () => document.getElementById('loan-commitment-modal').classList.add('hidden'));
    document.getElementById('cancel-commitment-modal')?.addEventListener('click', () => document.getElementById('loan-commitment-modal').classList.add('hidden'));

    const handleGenericApproval = async (e) => {
        // Tambahkan pengecekan untuk tombol detail anggota
        if (e.target.matches('.details-member-btn')) {
            const memberId = e.target.dataset.id;
            if (memberId) {
                showMemberDetails(memberId);
            }
            return; // Hentikan eksekusi agar tidak melanjutkan ke logika approve/reject
        }

        if (e.target.matches('.commitment-letter-btn')) {
            const loanId = e.target.dataset.loanId;
            showAdminLoanCommitment(loanId); // Panggil fungsi baru untuk menampilkan modal
            return;
        }

        // Logika yang sudah ada untuk approve/reject
        if (!e.target.matches('.approve-btn, .reject-btn')) return;
        const { id, type, newStatus } = e.target.dataset;
        const isApproved = !newStatus.includes('Rejected');

        // Tentukan endpoint API yang benar berdasarkan tipe data
        let endpoint;
        if (type === 'loans') {
            endpoint = `${ADMIN_API_URL}/loans`;
        } else if (type === 'savings') {
            endpoint = `${ADMIN_API_URL}/savings`;
        } else if (type === 'loan-payments') {
            endpoint = `${ADMIN_API_URL}/loan-payments`;
        } else { return; } // Jangan lakukan apa-apa jika tipe tidak dikenali

        if (!confirm(`Anda yakin ingin ${isApproved ? 'menyetujui' : 'menolak'} pengajuan ini?`)) return;

        try {
            await apiFetch(`${endpoint}/${id}/status`, {
                method: 'PUT',
                body: JSON.stringify({ status: newStatus }),
            });
            alert('Status berhasil diperbarui.');
            if (type === 'loans') {
                loadPendingApprovals(type); // Muat ulang daftar pinjaman
            } else if (type === 'savings') {
                loadPendingDeposits();
                loadPendingWithdrawals();
            } else if (type === 'loan-payments') {
                loadPendingLoanPayments();
            }
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };

    const loadApprovalCounts = async () => {
        try {
            // Endpoint ini perlu dibuat di backend untuk mengembalikan semua hitungan
            const counts = await apiFetch(`${API_URL}/admin/approval-counts`);

            const updateCount = (elementId, count) => {
                const el = document.getElementById(elementId);
                if (el) {
                    el.textContent = count > 0 ? `(${count})` : '';
                }
            };

            updateCount('pending-members-card-count', counts.members || 0);
            updateCount('pending-savings-card-count', counts.savings || 0);
            updateCount('pending-withdrawals-card-count', counts.withdrawals || 0);
            updateCount('pending-loans-card-count', counts.loans || 0);
            updateCount('pending-loan-payments-card-count', counts.loanPayments || 0);
            updateCount('pending-resignations-card-count', counts.resignations || 0);

        } catch (error) {
            console.error('Failed to load approval counts:', error);
        }
    };

    const setupApprovalCards = () => {
        const mainView = document.getElementById('approvals-main-view');
        const cardLinks = document.querySelectorAll('.approval-card-link');
        const tabContents = document.querySelectorAll('.approval-tab-content');
        const backButtons = document.querySelectorAll('.back-to-approvals-btn');

        const showMainView = () => {
            mainView.classList.remove('hidden');
            loadApprovalCounts(); // Muat ulang hitungan saat kembali ke menu utama
            tabContents.forEach(content => content.classList.add('hidden'));
        };

        cardLinks.forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = card.dataset.target;
                const targetContent = document.getElementById(targetId);

                mainView.classList.add('hidden');
                if (targetContent) {
                    targetContent.classList.remove('hidden');
                    // Panggil fungsi load data yang sesuai dengan tab yang diklik.
                    // Ini adalah perbaikan utama.
                    const loadFunction = {
                        'approval-members-tab': renderPendingMembers,
                        'approval-savings-tab': loadPendingDeposits,
                        'approval-loans-tab': () => loadPendingApprovals('loans'),
                        'approval-withdrawals-tab': loadPendingWithdrawals,
                        'approval-resignations-tab': () => {
                            loadPendingResignations();
                            loadResignationHistory(); // Muat juga riwayatnya
                        },
                        'approval-loan-payments-tab': loadPendingLoanPayments,
                    }[targetId];
                    if (loadFunction) loadFunction();
                }
            });
        });

        backButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                showMainView();
            });
        });
    };

    // --- FUNGSI UNTUK PESANAN MASUK (TOKO) ---
    const loadPendingOrders = async () => {
        const tableBody = document.getElementById('pending-orders-table-body');
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat pesanan masuk...</td></tr>`;

        try {
            // Endpoint baru di backend untuk mengambil pesanan yang menunggu pengambilan
            const orders = await apiFetch(`${ADMIN_API_URL}/sales/pending`);

            tableBody.innerHTML = '';
            if (orders.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada pesanan yang menunggu pengambilan.</td></tr>`;
                return;
            }

            orders.forEach(order => {
                let actionButtons = `
                    <button class="view-order-details-btn text-blue-600 hover:underline" data-order-id="${order.order_id}">Detail</button>
                    <button class="verify-order-btn text-green-600 hover:underline" data-order-id="${order.order_id}">Verifikasi</button>
                `;

                if (userRole === 'admin') {
                    actionButtons += `<button class="cancel-order-btn text-red-600 hover:underline ml-2" data-order-id="${order.order_id}">Batalkan</button>`;
                }

                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${order.order_id}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${order.member_name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(order.sale_date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(order.total_amount)}</td>
                    <td class="px-6 py-4 text-center text-sm font-medium">${actionButtons}</td>
                `;
            });
        } catch (error) {
            console.error('Error loading pending orders:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const showOrderDetailsModal = async (orderId) => {
        const modal = document.getElementById('order-details-modal');
        if (!modal) return;

        const titleEl = document.getElementById('order-details-modal-title');
        const wrapperEl = document.getElementById('order-details-content-wrapper');
        const printBtn = document.getElementById('print-order-details-btn');

        modal.classList.remove('hidden');
        titleEl.textContent = `Detail Pesanan: ${orderId}`;
        wrapperEl.innerHTML = '<p class="text-center py-8">Memuat detail barang...</p>';
        printBtn.onclick = () => window.print();

        try {
            // Endpoint baru untuk mengambil detail item dari sebuah pesanan
            const items = await apiFetch(`${ADMIN_API_URL}/sales/${orderId}/items`);

            if (items.length === 0) {
                wrapperEl.innerHTML = '<p class="text-center py-8 text-gray-500">Tidak ada barang dalam pesanan ini.</p>';
                return;
            }

            wrapperEl.innerHTML = `
                <div id="printable-area">
                    <h4 class="p-4 text-lg font-semibold text-center hidden print:block">Daftar Barang Pesanan: ${orderId}</h4>
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">No.</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Produk</th>
                                    <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Jumlah</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Harga Satuan</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Subtotal</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${items.map((item, index) => `
                                    <tr>
                                        <td class="px-6 py-4 text-sm text-gray-500">${index + 1}</td>
                                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${item.product_name}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-center">${item.quantity}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.price)}</td>
                                        <td class="px-6 py-4 text-sm text-gray-800 text-right font-semibold">${formatCurrency(item.subtotal)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error showing order details:', error);
            wrapperEl.innerHTML = `<p class="text-red-500 text-center py-8">${error.message}</p>`;
        }
    };

    // --- TOKO SEMBAKO TABS ---
    const sembakoTabButtons = document.querySelectorAll('.sembako-tab-btn');
    const sembakoTabContents = document.querySelectorAll('.sembako-tab-content');

    sembakoTabButtons.forEach(button => {
        button.addEventListener('click', e => {
            e.preventDefault();
            
            // Deactivate all buttons and content in this tab group
            sembakoTabButtons.forEach(btn => {
                btn.classList.remove('border-red-500', 'text-red-600');
                btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            });
            sembakoTabContents.forEach(content => content.classList.add('hidden'));
            
            // Activate the clicked button and its corresponding content
            button.classList.add('border-red-500', 'text-red-600');
            button.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            const targetId = button.dataset.target;
            const targetContent = document.getElementById(targetId);
            if (targetContent) {
                if (targetId === 'sembako-orders-tab') {
                    loadPendingOrders();
                }
                if (targetId === 'sembako-direct-cashier-tab') {
                    // Load products for the direct cashier dropdown
                    const productSelect = document.getElementById('direct-cashier-product-select');
                    if (productSelect) {
                        apiFetch(`${ADMIN_API_URL}/products?shop=sembako`).then(products => {
                            directCashierProducts = products;
                            productSelect.innerHTML = '<option value="">-- Pilih Produk --</option>' + products
                                .filter(p => p.stock > 0) // Only show products in stock
                                .map(p => `<option value="${p.id}">${p.name} (${formatCurrency(p.price)})</option>`).join('');
                        });
                    }
                }
                targetContent.classList.remove('hidden');
            }
        });
    });


    // --- CASHIER FUNCTIONALITY ---
    const cashierVerifyBtn = document.getElementById('cashier-verify-btn');
    const cashierBarcodeInp = document.getElementById('cashier-barcode-input');
    const cashierResultContainer = document.getElementById('cashier-result-container');
    const cashierErrorContainer = document.getElementById('cashier-error-container');
    const cashierCompleteBtn = document.getElementById('cashier-complete-btn');
    let currentVerifiedOrder = null; // Variabel untuk menyimpan data pesanan terverifikasi


    // --- NEW PAYMENT MODAL ELEMENTS ---
    const paymentModal = document.getElementById('payment-method-modal');
    const closePaymentModalBtn = document.getElementById('close-payment-modal-btn');
    const cancelPaymentModalBtn = document.getElementById('cancel-payment-modal-btn');
    const confirmPaymentBtn = document.getElementById('confirm-payment-btn');
    const paymentMethodRadios = document.querySelectorAll('input[name="payment-method"]');
    const tenorOptionsContainer = document.getElementById('tenor-options-container');
    const paymentTenorBtns = document.querySelectorAll('.payment-tenor-btn');
    const paymentTenorInput = document.getElementById('payment-tenor-input');

    const populateCashierUI = (orderData) => {
        // Validasi dasar untuk memastikan objek pesanan sesuai
        if (!orderData.orderId || !orderData.user || !orderData.items || !orderData.total) {
            throw new Error('Data pesanan tidak valid atau format tidak sesuai.');
        }
    
        // Simpan data pesanan yang valid untuk diselesaikan nanti
        currentVerifiedOrder = orderData;
    
        // Tampilkan data ke elemen HTML
        document.getElementById('cashier-order-id').textContent = orderData.orderId;
        document.getElementById('cashier-order-date').textContent = new Date(orderData.timestamp).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
        document.getElementById('cashier-member-name').textContent = orderData.user.name;
        document.getElementById('cashier-coop-number').textContent = orderData.user.coopNumber;
    
        const itemsTableBody = document.getElementById('cashier-items-table');
        itemsTableBody.innerHTML = '';
        orderData.items.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="py-2 text-left">${item.name}</td>
                <td class="py-2 text-center">${item.quantity}</td>
                <td class="py-2 text-right">${formatCurrency(item.price * item.quantity)}</td>
            `;
            itemsTableBody.appendChild(row);
        });
    
        document.getElementById('cashier-order-total').textContent = formatCurrency(orderData.total);
    
        cashierResultContainer.classList.remove('hidden');
    };

    const showCashierError = (message) => {
        if (cashierErrorContainer) {
            cashierErrorContainer.textContent = message;
            cashierErrorContainer.classList.remove('hidden');
        }
    };

    const showCashierVerificationModal = async (orderId = null) => {
        const modal = document.getElementById('cashier-verification-modal');
        if (!modal) return;

        // Reset UI
        cashierBarcodeInp.value = '';
        cashierBarcodeInp.disabled = false;
        cashierResultContainer.classList.add('hidden');
        cashierErrorContainer.classList.add('hidden');
        currentVerifiedOrder = null;

        // Hentikan scanner jika sedang berjalan saat modal ditutup
        if (html5QrCode && html5QrCode.isScanning) {
            html5QrCode.stop().catch(err => console.log("QR scanner stop failed on modal close, likely already stopped."));
        }
        document.getElementById('start-scan-btn').textContent = 'Mulai Pindai Kamera'; // Reset text tombol
        document.getElementById('start-scan-btn').disabled = false;

        modal.classList.remove('hidden');
        cashierBarcodeInp.focus();

        if (orderId) {
            cashierBarcodeInp.value = `Memuat pesanan ${orderId}...`;
            cashierBarcodeInp.disabled = true;

            try {
                const orderData = await apiFetch(`${ADMIN_API_URL}/sales/order/${orderId}`);
                populateCashierUI(orderData);
            } catch (error) {
                showCashierError(error.message);
            } finally {
                cashierBarcodeInp.value = '';
                cashierBarcodeInp.disabled = false;
                cashierBarcodeInp.focus();
            }
        }
    };

    // Event listener untuk tombol "Verifikasi" di tabel pesanan masuk
    document.getElementById('pending-orders-table-body')?.addEventListener('click', (e) => {
        if (e.target.matches('.view-order-details-btn')) {
            e.preventDefault();
            showOrderDetailsModal(e.target.dataset.orderId);
        } else if (e.target.matches('.verify-order-btn')) { // Baris ini yang menyebabkan error
            e.preventDefault();
            showCashierVerificationModal(e.target.dataset.orderId); // Ganti dengan fungsi yang benar
        }
    });

    const setupCashierVerificationModalListeners = () => {
        const modal = document.getElementById('cashier-verification-modal');
        if (!modal) return;
        document.getElementById('close-cashier-verification-modal').addEventListener('click', () => modal.classList.add('hidden'));

        if (cashierVerifyBtn) {
            cashierVerifyBtn.addEventListener('click', () => {
                const barcodeData = cashierBarcodeInp.value.trim();
                cashierResultContainer.classList.add('hidden');
                cashierErrorContainer.classList.add('hidden');
                currentVerifiedOrder = null; // Reset pada verifikasi baru

                if (!barcodeData) {
                    showCashierError('Input barcode tidak boleh kosong.');
                    return;
                }

                try {
                    const orderData = JSON.parse(barcodeData);
                    populateCashierUI(orderData);
                    cashierBarcodeInp.value = ''; // Kosongkan input setelah verifikasi berhasil
                } catch (error) {
                    console.error("Barcode verification error:", error);
                    currentVerifiedOrder = null; // Reset jika terjadi error
                    showCashierError('Gagal memverifikasi barcode. Pastikan data benar dan lengkap.');
                }
            });
        }

        if (cashierCompleteBtn) {
            cashierCompleteBtn.addEventListener('click', () => {
                if (!currentVerifiedOrder) {
                    alert('Tidak ada data pesanan yang terverifikasi untuk diselesaikan.');
                    return;
                }

                if (paymentModal) {
                    document.getElementById('payment-cash').checked = true;
                    tenorOptionsContainer.classList.add('hidden');
                    paymentTenorBtns.forEach(btn => btn.classList.remove('active'));
                    document.querySelector('.payment-tenor-btn[data-tenor="1"]').classList.add('active');
                    paymentTenorInput.value = '1';
                    paymentModal.classList.remove('hidden');
                } else {
                    alert('Error: Modal pembayaran tidak ditemukan.');
                }
            });
        }
    };

    if (paymentModal) {
        closePaymentModalBtn.addEventListener('click', () => paymentModal.classList.add('hidden'));
        cancelPaymentModalBtn.addEventListener('click', () => paymentModal.classList.add('hidden'));

        paymentMethodRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.value === 'Potong Gaji') {
                    tenorOptionsContainer.classList.remove('hidden');
                } else {
                    tenorOptionsContainer.classList.add('hidden');
                }
            });
        });

        paymentTenorBtns.forEach(button => {
            button.addEventListener('click', (e) => {
                e.preventDefault();
                paymentTenorBtns.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                paymentTenorInput.value = button.dataset.tenor;
            });
        });

        confirmPaymentBtn.addEventListener('click', async () => {
            const selectedPaymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
            let paymentDetails = { method: selectedPaymentMethod };

            if (selectedPaymentMethod === 'Potong Gaji') {
                paymentDetails.tenor = parseInt(paymentTenorInput.value, 10);
            }

            const orderPayload = { ...currentVerifiedOrder, payment: paymentDetails };

            const originalButtonText = confirmPaymentBtn.textContent;
            confirmPaymentBtn.disabled = true;
            confirmPaymentBtn.textContent = 'Memproses...';

            try {
                const result = await apiFetch(`${ADMIN_API_URL}/sales`, { method: 'POST', body: JSON.stringify(orderPayload) });
                alert(result.message || 'Transaksi berhasil diselesaikan.');
                
                paymentModal.classList.add('hidden');
                document.getElementById('cashier-verification-modal').classList.add('hidden'); // Close verification modal too
                currentVerifiedOrder = null;
                loadPendingOrders(); // Muat ulang daftar pesanan yang menunggu
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                confirmPaymentBtn.disabled = false;
                confirmPaymentBtn.textContent = 'Konfirmasi Pembayaran';
            }
        });
    }

    // --- FUNGSI UNTUK KASIR UMUM (NON-ANGGOTA) ---
    const setupDirectCashier = () => {
        const productGrid = document.getElementById('direct-cashier-product-grid');
        const cartBody = document.getElementById('direct-cashier-items-body');
        const totalEl = document.getElementById('direct-cashier-total');
        const completeBtn = document.getElementById('direct-cashier-complete-btn');
        const searchInput = document.getElementById('direct-cashier-search');

        if (!productGrid) return; // Only run if the UI exists

        const renderProductGrid = () => {
            productGrid.innerHTML = '';
            const searchTerm = searchInput.value.toLowerCase();
            const filteredProducts = directCashierProducts.filter(p => p.name.toLowerCase().includes(searchTerm));

            if (filteredProducts.length === 0) {
                productGrid.innerHTML = `<p class="col-span-full text-center text-gray-500">Produk tidak ditemukan.</p>`;
                return;
            }

            filteredProducts.forEach(p => {
                const isOutOfStock = p.stock <= 0;
                const card = document.createElement('div');
                card.className = `product-card border rounded-lg p-2 flex flex-col text-center cursor-pointer hover:shadow-lg transition-shadow ${isOutOfStock ? 'opacity-50 cursor-not-allowed' : ''}`;
                card.dataset.productId = p.id;

                let imageUrl = p.image_url ? `${API_URL.replace('/api', '')}${p.image_url}` : 'https://placehold.co/150x150?text=No+Image';

                card.innerHTML = `
                    <img src="${imageUrl}" alt="${p.name}" class="w-full h-24 object-cover rounded-md mb-2">
                    <p class="text-sm font-semibold flex-grow">${p.name}</p>
                    <p class="text-xs text-gray-500">Stok: ${p.stock}</p>
                    <p class="text-sm font-bold text-red-600">${formatCurrency(p.price)}</p>
                `;
                if (!isOutOfStock) {
                    card.addEventListener('click', () => addToCart(p.id));
                }
                productGrid.appendChild(card);
            });
        };

        const renderDirectCart = () => {
            cartBody.innerHTML = '';
            if (directCart.length === 0) {
                cartBody.innerHTML = `<div class="text-center py-10 text-gray-500"><svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" /></svg><p class="mt-2 text-sm">Keranjang kosong</p></div>`;
                completeBtn.disabled = true;
                totalEl.textContent = formatCurrency(0);
                return;
            }

            let total = 0;
            directCart.forEach((item, index) => {
                const subtotal = parseFloat(item.price) * item.quantity;
                total += subtotal;
                const itemEl = document.createElement('div');
                itemEl.className = 'flex items-center space-x-3 text-sm p-2 border-b';
                itemEl.innerHTML = `
                    <div class="flex-grow">
                        <p class="font-semibold">${item.name}</p>
                        <p class="text-xs text-gray-500">${formatCurrency(item.price)}</p>
                    </div>
                    <div class="flex items-center space-x-2">
                        <button class="cart-qty-btn" data-index="${index}" data-action="decrease">-</button>
                        <span>${item.quantity}</span>
                        <button class="cart-qty-btn" data-index="${index}" data-action="increase">+</button>
                    </div>
                    <p class="font-semibold w-20 text-right">${formatCurrency(subtotal)}</p>
                    <button class="remove-direct-cart-item-btn text-red-500 hover:text-red-700" data-index="${index}">&times;</button>
                `;
                cartBody.appendChild(itemEl);
            });
            totalEl.textContent = formatCurrency(total);
            completeBtn.disabled = false;
        };

        const addToCart = (productId, quantity = 1) => {
            const selectedProduct = directCashierProducts.find(p => p.id.toString() === productId);
            if (!selectedProduct) return;

            const existingItem = directCart.find(item => item.productId === selectedProduct.id);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                directCart.push({ productId: selectedProduct.id, name: selectedProduct.name, price: selectedProduct.price, quantity });
            }
            renderDirectCart();
        };

        const updateCartQuantity = (index, action) => {
            const item = directCart[index];
            if (!item) return;

            if (action === 'increase') {
                item.quantity++;
            } else if (action === 'decrease') {
                item.quantity--;
                if (item.quantity <= 0) {
                    directCart.splice(index, 1);
                }
            }
            renderDirectCart();
        };

        cartBody.addEventListener('click', (e) => {
            if (e.target.matches('.remove-direct-cart-item-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                directCart.splice(index, 1);
                renderDirectCart();
            }
            if (e.target.matches('.cart-qty-btn')) {
                const index = parseInt(e.target.dataset.index, 10);
                const action = e.target.dataset.action;
                updateCartQuantity(index, action);
            }
        });

        completeBtn.addEventListener('click', async () => {
            if (directCart.length === 0 || !confirm('Selesaikan dan catat penjualan ini?')) return;

            completeBtn.disabled = true;
            completeBtn.textContent = 'Memproses...';

            try {
                await apiFetch(`${ADMIN_API_URL}/cash-sale`, { method: 'POST', body: JSON.stringify({ items: directCart, paymentMethod: 'Cash' }) });
                alert('Penjualan berhasil dicatat.');
                directCart = [];
                renderDirectCart();
            } catch (error) {
                alert(`Error: ${error.message}`);
            } finally {
                completeBtn.disabled = false;
                completeBtn.textContent = 'Selesaikan Penjualan';
            }
        });

        searchInput.addEventListener('input', renderProductGrid);

        // Initial load
        apiFetch(`${ADMIN_API_URL}/products?shop=sembako`).then(products => {
            directCashierProducts = products;
            renderProductGrid();
        });
    };

    // --- FUNGSI UNTUK PENGATURAN (SETTINGS) ---

    // Generic Modal Closer
    const allModals = document.querySelectorAll('.fixed.inset-0.z-50');
    allModals.forEach(modal => {
        const closeButton = modal.querySelector('[id^="close-"]');
        const cancelButton = modal.querySelector('[id^="cancel-"]');
        if (closeButton) closeButton.addEventListener('click', () => modal.classList.add('hidden'));
        if (cancelButton) cancelButton.addEventListener('click', () => modal.classList.add('hidden'));
    });

    // --- RESIGNATION MODAL LOGIC ---
    const resignationModal = document.getElementById('resignation-modal');
    if (resignationModal) {
        document.getElementById('close-resignation-modal').addEventListener('click', () => resignationModal.classList.add('hidden'));
        document.getElementById('cancel-resignation-modal').addEventListener('click', () => resignationModal.classList.add('hidden'));

        document.getElementById('confirm-resignation-btn').addEventListener('click', async (e) => {
            const button = e.target;
            const memberId = document.getElementById('resignation-member-id-input').value;

            button.disabled = true;
            button.textContent = 'Memproses...';

            try {
                // This endpoint needs to be created in the backend.
                // It will change member status to 'Inactive', and create the journal entries.
                const result = await apiFetch(`${ADMIN_API_URL}/process-resignation`, {
                    method: 'POST',
                    body: JSON.stringify({ memberId: memberId }),
                });
                alert(result.message);

                resignationModal.classList.add('hidden');
                loadPendingResignations(); // Refresh the list

            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`);
            } finally { button.disabled = false; button.textContent = 'Konfirmasi & Proses'; }
        });
    }

    // --- FUNGSI UNTUK PROFIL ADMIN ---
    function setupAdminPhotoUpload(profile) {
        const photoSection = document.getElementById('admin-profile-photo-section');
        if (!photoSection) return;

        let photoUrl = 'https://i.pravatar.cc/150?u=' + encodeURIComponent(profile.email);
        if (profile.selfie_photo_path) {
            const webPath = profile.selfie_photo_path.replace(/\\/g, '/');
            photoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
        }

        photoSection.innerHTML = `
            <img id="admin-profile-page-photo" src="${photoUrl}" alt="Foto Profil" class="w-32 h-32 rounded-full object-cover border-4 border-gray-200">
            <div>
                <h4 class="text-lg font-semibold text-gray-700">Foto Profil</h4>
                <p class="text-sm text-gray-500 mb-3">Gunakan foto yang jelas untuk ikon profil Anda. (Format: JPG/PNG, Maks: 1MB)</p>
                <input type="file" id="admin-photo-upload-input" class="hidden" accept="image/png, image/jpeg">
                <button id="admin-trigger-photo-upload-btn" class="px-4 py-2 bg-red-100 text-red-800 text-sm font-semibold rounded-md hover:bg-red-200">
                    Ganti Foto
                </button>
                <button id="admin-save-photo-btn" class="hidden ml-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-md hover:bg-green-700">
                    Simpan Foto
                </button>
                <button id="admin-cancel-photo-upload-btn" class="hidden ml-2 px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-md hover:bg-gray-300">
                    Batal
                </button>
                <div id="admin-photo-upload-feedback" class="mt-2 text-sm"></div>
            </div>
        `;

        const triggerBtn = document.getElementById('admin-trigger-photo-upload-btn');
        const saveBtn = document.getElementById('admin-save-photo-btn');
        const cancelBtn = document.getElementById('admin-cancel-photo-upload-btn');
        const fileInput = document.getElementById('admin-photo-upload-input');
        const profileImg = document.getElementById('admin-profile-page-photo');
        const feedbackEl = document.getElementById('admin-photo-upload-feedback');

        triggerBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (file) {
                if (file.size > 1 * 1024 * 1024) {
                    feedbackEl.textContent = 'Ukuran file terlalu besar (Maks 1MB).';
                    feedbackEl.className = 'mt-2 text-sm text-red-600';
                    fileInput.value = '';
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
            profileImg.src = photoUrl;
            fileInput.value = '';
            triggerBtn.classList.remove('hidden');
            saveBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            feedbackEl.textContent = '';
        });

        saveBtn.addEventListener('click', async () => {
            const file = fileInput.files[0];
            if (!file) return;

            saveBtn.disabled = true; saveBtn.textContent = 'Mengunggah...';
            feedbackEl.textContent = ''; feedbackEl.className = 'mt-2 text-sm';

            const formData = new FormData();
            formData.append('selfie_photo', file);

            try {
                await apiFetch(`${API_URL}/member/profile/photo`, { method: 'PUT', body: formData });

                feedbackEl.textContent = 'Foto profil berhasil diperbarui!';
                feedbackEl.className = 'mt-2 text-sm text-green-600';
                initializeHeader(); // Refresh the header icon
                
                setTimeout(() => { triggerBtn.classList.remove('hidden'); saveBtn.classList.add('hidden'); cancelBtn.classList.add('hidden'); feedbackEl.textContent = ''; }, 2000);

            } catch (error) {
                feedbackEl.textContent = `Error: ${error.message}`;
                feedbackEl.className = 'mt-2 text-sm text-red-600';
            } finally { saveBtn.disabled = false; saveBtn.textContent = 'Simpan Foto'; }
        });
    }

    async function loadAdminProfileData() {
        try {
            const profile = await apiFetch(`${API_URL}/member/profile`);
            setupAdminPhotoUpload(profile);
        } catch (error) {
            console.error('Error loading admin profile data:', error);
            const photoSection = document.getElementById('admin-profile-photo-section');
            if (photoSection) {
                photoSection.innerHTML = `<p class="text-red-500">Gagal memuat data profil.</p>`;
            }
        }
    }

    const setupSimpleCrud = (config) => {
        const { modal, form, tableBody, addBtn, endpoint, title, fields, renderRow } = config;
        let itemsCache = []; // Cache untuk menyimpan item yang sudah dimuat

        // Defensive check: If the required HTML elements for this CRUD don't exist, skip setup.
        if (!modal || !form || !tableBody) {
            return () => {}; // Return an empty function to prevent errors on call.
        }

        const idInput = form.querySelector('input[type="hidden"]');
        const modalTitle = modal.querySelector('[id$="-modal-title"]');
        const finalEndpoint = endpoint.startsWith('admin/') ? `${API_URL}/${endpoint}` : `${ADMIN_API_URL}/${endpoint}`;

        const loadData = async () => {
            try {
                const items = await apiFetch(finalEndpoint);
                itemsCache = items; // Simpan item ke cache
                tableBody.innerHTML = '';
                items.forEach((item, index) => tableBody.insertAdjacentHTML('beforeend', renderRow(item, userRole, index)));
            } catch (error) {
                console.error(`Error loading ${title}:`, error);
                tableBody.innerHTML = `<tr><td colspan="${fields.length + 1}" class="text-center py-4 text-red-500">${error.message || 'Gagal memuat data.'}</td></tr>`;
            }
        };

        addBtn?.addEventListener('click', () => {
            form.reset();
            idInput.value = '';
            modalTitle.textContent = `Tambah ${title} Baru`;
            if (config.onAdd) config.onAdd();
            modal.classList.remove('hidden');
        });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = idInput.value;
            const body = {};
            fields.forEach(field => {
                // The original selector logic was too generic and failed on complex field names.
                // This new logic is more robust.
                const dashedField = field.replace(/_/g, '-');
                
                // 1. Try a more specific selector first, looking for an ID that ENDS with the field name.
                // e.g., for 'account_number', it looks for an ID ending in 'account-number-input'.
                let element = form.querySelector(`[id$="${dashedField}-input"]`) || form.querySelector(`[id$="${dashedField}-select"]`);

                // 2. Add a special case for inconsistent IDs like 'parent-account-select' for the 'parent_id' field.
                if (field === 'parent_id' && !element) {
                    element = form.querySelector('#parent-account-select');
                }
                // FIX: Tambahkan kasus khusus untuk dropdown tipe pinjaman di modal tenor
                if (field === 'loan_type_id' && !element) {
                    element = form.querySelector('#loan-term-loantype-select');
                }
                // FIX: Add specific selectors for loan term modal fields that don't follow the generic pattern
                if (field === 'tenor_months' && !element) {
                    element = form.querySelector('#loan-term-tenor-input');
                }
                if (field === 'interest_rate' && !element) {
                    element = form.querySelector('#loan-term-interest-input');
                }


                if (element) {
                    if (element.type === 'checkbox') {
                        body[field] = element.checked; // Correctly handle checkbox state
                    } else if (element.type === 'number') {
                        // Sanitize number input: replace comma with dot for decimal values
                        // This handles locales where comma is used as a decimal separator.
                        // FIX: Ensure value is a string before calling replace to avoid errors on empty inputs.
                        body[field] = String(element.value).replace(',', '.');
                    } else {
                        body[field] = element.value;
                    }
                }
            });

            const url = id ? `${finalEndpoint}/${id}` : `${finalEndpoint}`;
            const method = id ? 'PUT' : 'POST';

            try {
                await apiFetch(url, { method, body: JSON.stringify(body) });
                modal.classList.add('hidden');
                loadData();
            } catch (error) { alert(error.message); }
        });

        tableBody?.addEventListener('click', async (e) => {
            const target = e.target;
            const id = target.dataset.id;

            if (target.classList.contains(`edit-${title.toLowerCase().replace(' ', '-')}-btn`)) {
                // Gunakan cache, bukan panggil API lagi
                const item = itemsCache.find(i => String(i.id) === String(id));
                if (!item) {
                    return alert(`Error: Tidak dapat menemukan data untuk ${title} dengan ID ${id}.`);
                }

                idInput.value = item.id;
                fields.forEach(field => {
                    // Logika selector yang lama terlalu umum dan gagal pada nama field yang kompleks.
                    // Logika baru ini lebih tangguh dan spesifik.
                    const dashedField = field.replace(/_/g, '-');
                    
                    // 1. Coba selector yang lebih spesifik, mencari ID yang BERAKHIR dengan nama field.
                    let inputElement = form.querySelector(`[id$="${dashedField}-input"]`) || form.querySelector(`[id$="${dashedField}-select"]`);

                    // 2. Tambahkan kasus khusus untuk ID yang tidak konsisten seperti 'parent-account-select'.
                    if (field === 'parent_id' && !inputElement) {
                        inputElement = form.querySelector('#parent-account-select');
                    }
                // FIX: Tambahkan kasus khusus untuk dropdown tipe pinjaman di modal tenor
                if (field === 'loan_type_id' && !inputElement) {
                    inputElement = form.querySelector('#loan-term-loantype-select');
                }

                    if (inputElement) {
                        const value = item[field];
                        inputElement.value = value === null || value === undefined ? '' : value;
                    }
                });
                modalTitle.textContent = `Ubah ${title}`;
                if (config.onEdit) await config.onEdit(item); // Tunggu onEdit selesai
                modal.classList.remove('hidden');
            }

            if (target.classList.contains(`delete-${title.toLowerCase().replace(' ', '-')}-btn`)) {
                if (confirm(`Anda yakin ingin menghapus ${title} ini?`)) {
                    try {
                        await apiFetch(`${ADMIN_API_URL}/${endpoint}/${id}`, { method: 'DELETE' });
                        loadData();
                    } catch (error) { alert(error.message); }
                }
            }
        });
        return loadData;
    };

    // --- FUNGSI UNTUK KELOLA USER & ROLE ---
    const loadUsers = async () => {
        const tableBody = document.getElementById('users-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Memuat...</td></tr>`;
        try {
            const users = await apiFetch(`${ADMIN_API_URL}/users`);

            tableBody.innerHTML = '';
            if (users.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4">Tidak ada pengguna ditemukan.</td></tr>`;
                return;
            }

            users.forEach(user => {
                const statusClass = user.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${user.name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${user.email}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${user.role}</td>
                    <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${user.status}</span></td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">
                        <button class="edit-user-btn text-indigo-600 hover:text-indigo-900" data-id="${user.id}">Ubah</button>
                        <button class="delete-user-btn text-red-600 hover:text-red-900" data-id="${user.id}" data-name="${user.name}">Hapus</button>
                    </td>
                `;
            });
        } catch (error) {
            console.error('Error loading users:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const renderRolePermissions = async () => {
        const container = document.getElementById('role-permissions-container');
        if (!container) return;
        container.innerHTML = `<div class="col-span-full text-center py-8"><p class="text-gray-500">Memuat hak akses...</p></div>`;

        try {
            // 1. Dapatkan semua kemungkinan hak akses dari backend
            const allPermissions = await apiFetch(`${ADMIN_API_URL}/permissions`);

            // 2. Definisikan peran yang akan dikelola
            const rolesToManage = ['admin', 'manager', 'akunting'];

            // 3. Ambil dan render kartu untuk setiap peran
            const rolePromises = rolesToManage.map(async (role) => {
                const rolePerms = await apiFetch(`${ADMIN_API_URL}/roles/${role}/permissions`);
                const userHasPermissionSet = new Set(rolePerms);

                // Tentukan apakah kartu ini dapat diedit
                const isEditable = userRole === 'admin' && role !== 'admin';

                const permissionsHTML = allPermissions.map(perm => {
                    const isChecked = userHasPermissionSet.has(perm.key);
                    return `
                        <label class="flex items-center space-x-3 ${isEditable ? 'cursor-pointer' : 'cursor-not-allowed'}">
                            <input type="checkbox" data-permission-key="${perm.key}" ${isChecked ? 'checked' : ''} ${!isEditable ? 'disabled' : ''} class="permission-checkbox rounded border-gray-300 text-red-600 shadow-sm focus:border-red-300 focus:ring focus:ring-offset-0 focus:ring-red-200 focus:ring-opacity-50">
                            <span class="text-gray-700">${perm.description}</span>
                        </label>
                    `;
                }).join('');

                const saveButtonHTML = isEditable ? `
                    <div class="px-4 py-3 bg-gray-50 text-right sm:px-6">
                        <button data-role="${role}" class="save-role-permissions-btn bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700">Simpan Perubahan</button>
                    </div>
                ` : '';

                return `
                    <div class="bg-white shadow overflow-hidden sm:rounded-lg">
                        <div class="px-4 py-5 sm:px-6">
                            <h3 class="text-lg leading-6 font-medium text-gray-900 capitalize">${role}</h3>
                            <p class="mt-1 max-w-2xl text-sm text-gray-500">${role === 'admin' ? 'Akses penuh ke sistem (tidak dapat diubah).' : `Hak akses untuk peran ${role}.`}</p>
                        </div>
                        <div class="border-t border-gray-200 px-4 py-5 sm:p-6">
                            <h4 class="text-md font-semibold text-gray-800 mb-4">Hak Akses:</h4>
                            <div class="space-y-4">${permissionsHTML}</div>
                        </div>
                        ${saveButtonHTML}
                    </div>
                `;
            });

            const cardsHTML = await Promise.all(rolePromises);
            container.innerHTML = cardsHTML.join('');

        } catch (error) {
            console.error('Error rendering role permissions:', error);
            container.innerHTML = `<div class="col-span-full text-center py-8"><p class="text-red-500">${error.message}</p></div>`;
        }
    };

    // 1. Kelola Perusahaan
    const loadEmployers = setupSimpleCrud({
        modal: document.getElementById('employer-modal'),
        form: document.getElementById('employer-form'),
        tableBody: document.getElementById('employers-table-body'),
        addBtn: document.getElementById('show-add-employer-form-btn'),
        endpoint: 'employers',
        title: 'Perusahaan',
        fields: ['name', 'address', 'phone', 'contract_number', 'document_url'],
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.address || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.phone || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.contract_number || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    ${item.document_url ? `<a href="${item.document_url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">Lihat Dokumen</a>` : '-'}
                </td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-perusahaan-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-perusahaan-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`,
    });

    // 2. Kelola Jabatan
    const loadPositions = setupSimpleCrud({
        modal: document.getElementById('position-modal'),
        form: document.getElementById('position-form'),
        tableBody: document.getElementById('positions-table-body'),
        addBtn: document.getElementById('show-add-position-form-btn'),
        endpoint: 'positions',
        title: 'Jabatan',
        fields: ['name'],
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-jabatan-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-jabatan-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 3. Kelola Tipe Simpanan
    const loadSavingTypes = setupSimpleCrud({
        modal: document.getElementById('saving-type-modal'),
        form: document.getElementById('saving-type-form'),
        tableBody: document.getElementById('saving-types-table-body'),
        addBtn: document.getElementById('show-add-saving-type-form-btn'),
        endpoint: 'savingtypes',
        title: 'Tipe Simpanan',
        fields: ['name', 'description'],
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.description || '-'}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-tipe-simpanan-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-tipe-simpanan-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 4. Kelola Tipe Pinjaman
    const loadLoanTypes = setupSimpleCrud({
        modal: document.getElementById('loan-type-modal'),
        form: document.getElementById('loan-type-form'),
        tableBody: document.getElementById('loan-types-table-body'),
        addBtn: document.getElementById('show-add-loan-type-form-btn'),
        endpoint: 'loantypes',
        title: 'Tipe Pinjaman',
        fields: ['name', 'description'],
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.description || '-'}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-tipe-pinjaman-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-tipe-pinjaman-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 5. Kelola Tenor & Bunga
    const loadLoanTerms = setupSimpleCrud({
        modal: document.getElementById('loan-term-modal'),
        form: document.getElementById('loan-term-form'),
        tableBody: document.getElementById('loan-terms-table-body'),
        addBtn: document.getElementById('show-add-loan-term-form-btn'),
        endpoint: 'loanterms',
        title: 'Tenor Pinjaman',
        fields: ['loan_type_id', 'tenor_months', 'interest_rate'],
        onAdd: () => {
            populateDropdown(document.getElementById('loan-term-loantype-select'), 'loantypes', 'id', 'name', 'Tipe Pinjaman');
        },
        onEdit: async (item) => {
            const select = document.getElementById('loan-term-loantype-select');
            // Tunggu dropdown selesai dimuat sebelum mengisi nilainya
            await populateDropdown(select, 'loantypes', 'id', 'name', 'Tipe Pinjaman');
                select.value = item.loan_type_id;
            // Isi nilai untuk tenor dan bunga secara manual
            document.getElementById('loan-term-tenor-input').value = item.tenor_months;
            document.getElementById('loan-term-interest-input').value = item.interest_rate;
        },
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.loan_type_name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.tenor_months} bulan</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.interest_rate}%</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-tenor-pinjaman-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-tenor-pinjaman-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 6. Kelola Akun (Chart of Accounts)
    const loadAccounts = setupSimpleCrud({
        modal: document.getElementById('account-modal'),
        form: document.getElementById('account-form'),
        tableBody: document.getElementById('accounts-table-body'),
        addBtn: document.getElementById('show-add-account-form-btn'),
        endpoint: 'accounts',
        title: 'Akun',
        fields: ['account_number', 'account_name', 'account_type', 'parent_id'],
        onAdd: () => {
            populateDropdown(document.getElementById('parent-account-select'), 'accounts', 'id', (item) => `${item.account_number} - ${item.account_name}`, 'Akun Induk (Opsional)');
            populateDropdown(document.getElementById('account-type-select'), 'accounttypes', 'name', 'name', 'Tipe Akun');
        },
        onEdit: (item) => {
            const select = document.getElementById('parent-account-select');
            populateDropdown(document.getElementById('account-type-select'), 'accounttypes', 'name', 'name', 'Tipe Akun').then(() => { document.getElementById('account-type-select').value = item.account_type; });
            populateDropdown(select, 'accounts', 'id', (item) => `${item.account_number} - ${item.account_name}`, 'Akun Induk (Opsional)').then(() => {
                select.value = item.parent_id;
            });
        },
        renderRow: (item, role) => {
            const isParent = item.is_parent;
            const isChild = item.parent_id !== null;

            // Terapkan style bold untuk akun induk, dan inden untuk akun anak
            const nameClasses = [
                isParent ? 'font-bold' : '',
                isChild ? 'pl-10' : 'pl-6' // Beri inden untuk anak
            ].join(' ');

            return `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900 ${isParent ? 'font-bold' : ''}">${item.account_number}</td>
                <td class="py-4 text-sm text-gray-800 ${nameClasses}">${item.account_name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.account_type}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-akun-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-akun-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`;
        }
    });

    // 6.1. Kelola Tipe Akun
    const loadAccountTypes = setupSimpleCrud({
        modal: document.getElementById('account-type-modal'),
        form: document.getElementById('account-type-form'),
        tableBody: document.getElementById('account-types-table-body'),
        addBtn: document.getElementById('show-add-account-type-form-btn'),
        endpoint: 'accounttypes', // This will be a new endpoint
        title: 'Tipe Akun',
        fields: ['name'],
        renderRow: (item, role) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-tipe-akun-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-tipe-akun-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 7. Kelola Supplier
    const loadSuppliers = setupSimpleCrud({
        modal: document.getElementById('supplier-modal'),
        form: document.getElementById('supplier-form'),
        tableBody: document.getElementById('suppliers-table-body'),
        addBtn: document.getElementById('show-add-supplier-form-btn'),
        endpoint: 'suppliers',
        title: 'Supplier',
        fields: ['name', 'contact_person', 'phone'],
        renderRow: (item, role, index) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-500">${index + 1}</td>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.contact_person || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.phone || '-'}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-supplier-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-supplier-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });

    // 7.1. Kelola Item Produk (Master)
    const loadMasterProducts = setupSimpleCrud({
        modal: document.getElementById('master-product-modal'),
        form: document.getElementById('master-product-form'),
        tableBody: document.getElementById('master-products-table-body'),
        addBtn: document.getElementById('add-master-product-btn'),
        endpoint: 'master-products',
        title: 'Item Produk',
        fields: ['item_number', 'name', 'description', 'default_unit'],
        renderRow: (item, role, index) => `
            <tr>
                <td class="px-6 py-4 text-sm text-gray-500">${index + 1}</td>
                <td class="px-6 py-4 text-sm font-mono text-gray-900">${item.item_number || '-'}</td>
                <td class="px-6 py-4 text-sm text-gray-900">${item.name}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${item.default_unit || '-'}</td>
                <td class="px-6 py-4 text-sm font-medium space-x-2">
                    <button class="edit-item-produk-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                    ${role === 'admin' ? `<button class="delete-item-produk-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>` : ''}
                </td>
            </tr>`
    });


    // 8. Kelola Pengumuman
    const loadAnnouncements = setupSimpleCrud({
        modal: document.getElementById('announcement-modal'),
        form: document.getElementById('announcement-form'),
        tableBody: document.getElementById('announcements-table-body'),
        addBtn: document.getElementById('add-announcement-btn'),
        endpoint: 'announcements',
        title: 'Pengumuman',
        fields: ['title', 'content', 'is_published'],
        onAdd: () => {
            // Set checkbox to checked by default for new announcements
            document.getElementById('is-published-input').checked = true;
        },
        onEdit: (item) => {
            // Handle checkbox state when editing
            document.getElementById('is-published-input').checked = item.is_published;
        },
        renderRow: (item) => {
            const statusClass = item.is_published ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
            const statusText = item.is_published ? 'Dipublikasikan' : 'Draft';
            return `
            <tr>
                <td class="px-6 py-4 text-sm font-medium text-gray-900">${item.title}</td>
                <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.created_at)}</td>
                <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span></td>
                <td class="px-6 py-4 text-sm font-medium space-x-2"><button class="edit-pengumuman-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button><button class="delete-pengumuman-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button></td>
            </tr>`;
        },
    });

    // --- FUNGSI UNTUK KELOLA MITRA ---
    const setupPartnerManagement = () => {
        const modal = document.getElementById('partner-modal');
        const form = document.getElementById('partner-form');
        const tableBody = document.getElementById('partners-table-body');
        const addBtn = document.getElementById('add-partner-btn');
        let partnersCache = []; // Cache untuk menyimpan data mitra
    
        if (!modal || !form || !tableBody || !addBtn) return;
    
        const loadPartners = async () => {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">Memuat mitra...</td></tr>`;
            try {
                const partners = await apiFetch(`${ADMIN_API_URL}/partners`);
                partnersCache = partners; // Simpan data ke cache
    
                tableBody.innerHTML = '';
                if (partners.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-gray-500">Belum ada mitra.</td></tr>`;
                    return;
                }
    
                partners.forEach(item => {
                    // FIX: Construct the correct public URL for the logo.
                    // The base URL for static assets is the API URL without the '/api' part.
                    const baseUrl = API_URL.replace('/api', '');
                    const logoUrl = item.logo_url.startsWith('http') ? item.logo_url : `${baseUrl}/${item.logo_url.replace(/\\/g, '/')}`;
                    const statusClass = item.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800';
                    const statusText = item.is_active ? 'Aktif' : 'Nonaktif';
                    const row = tableBody.insertRow();
                    row.innerHTML = `
                        <td class="px-6 py-4"><img src="${logoUrl}" alt="${item.name}" class="h-10 w-auto object-contain"></td>
                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${item.name}</td>
                        <td class="px-6 py-4 text-sm"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${statusText}</span></td>
                        <td class="px-6 py-4 text-sm font-medium space-x-2">
                            <button class="edit-partner-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                            <button class="delete-partner-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>
                        </td>
                    `;
                });
            } catch (error) {
                console.error('Error loading partners:', error);
                tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
            }
        };
    
        const showPartnerModal = (partner = null) => {
            form.reset();
            document.getElementById('partner-id-input').value = '';
            const logoPreview = document.getElementById('partner-logo-preview');
            const logoInput = document.getElementById('partner-logo-input');
    
            if (partner) {
                document.getElementById('partner-modal-title').textContent = 'Ubah Mitra';
                document.getElementById('partner-id-input').value = partner.id;
                document.getElementById('partner-name-input').value = partner.name;
                document.getElementById('partner-website-input').value = partner.website_url || '';
                // FIX: Construct the correct public URL for the logo preview.
                const baseUrl = API_URL.replace('/api', '');
                logoPreview.src = partner.logo_url.startsWith('http') ? partner.logo_url : `${baseUrl}/${partner.logo_url.replace(/\\/g, '/')}`;
                logoInput.required = false; // Logo tidak wajib saat mengubah
            } else {
                document.getElementById('partner-modal-title').textContent = 'Tambah Mitra Baru';
                logoPreview.src = 'https://placehold.co/100x100?text=Logo';
                logoInput.required = true; // Logo wajib saat menambah
            }
            modal.classList.remove('hidden');
        };
    
        addBtn.addEventListener('click', () => showPartnerModal());
        document.getElementById('close-partner-modal').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancel-partner-modal').addEventListener('click', () => modal.classList.add('hidden'));
    
        document.getElementById('partner-logo-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => { document.getElementById('partner-logo-preview').src = event.target.result; };
                reader.readAsDataURL(file);
            }
        });
    
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('partner-id-input').value;
            const formData = new FormData();
            formData.append('name', document.getElementById('partner-name-input').value);
            formData.append('website_url', document.getElementById('partner-website-input').value);

            const logoInput = document.getElementById('partner-logo-input');
            if (logoInput.files[0]) {
                formData.append('partnerLogo', logoInput.files[0]);
            }
    
            const url = id ? `${ADMIN_API_URL}/partners/${id}` : `${ADMIN_API_URL}/partners`;
            const method = id ? 'PUT' : 'POST';
    
            try { await apiFetch(url, { method, body: formData }); modal.classList.add('hidden'); loadPartners(); } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); }
        });
    
        tableBody.addEventListener('click', async (e) => {
            const button = e.target;
            const id = button.dataset.id;
            if (button.matches('.edit-partner-btn')) { const partner = partnersCache.find(p => p.id.toString() === id); if (partner) showPartnerModal(partner); }
            if (button.matches('.delete-partner-btn')) { if (confirm('Anda yakin ingin menghapus mitra ini?')) { try { await apiFetch(`${ADMIN_API_URL}/partners/${id}`, { method: 'DELETE' }); loadPartners(); } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); } } }
        });
    
        loadPartners();
    };

    // --- FUNGSI UNTUK UPDATE TAMPILAN HEADER (LOGO) ---
    const updateHeaderDisplay = (info) => {
        const headerLogo = document.getElementById('header-logo-img');
        if (!headerLogo) return;

        if (info && info.logo_url) {
            const webPath = info.logo_url.replace(/\\/g, '/');
            // Base URL untuk aset adalah root server API, bukan path /api
            const baseUrl = API_URL.replace('/api', '');
            const fullLogoUrl = `${baseUrl}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
            headerLogo.src = fullLogoUrl;
        } else {
            // Fallback ke logo default jika logo_url tidak ada
            headerLogo.src = 'logo/logo.png';
        }
    };

    // --- FUNGSI UNTUK KELOLA PROFIL KOPERASI ---
    const cooperativeProfileForm = document.getElementById('cooperative-profile-form');

    const loadCooperativeProfile = async () => {
        if (!cooperativeProfileForm) return;
        try {
            const info = await apiFetch(`${ADMIN_API_URL}/company-info`);

            document.getElementById('coop-name-input').value = info.name || '';
            document.getElementById('coop-address-input').value = info.address || '';
            document.getElementById('coop-phone-input').value = info.phone || '';
            
            const logoPreview = document.getElementById('coop-logo-preview');
            if (info.logo_url) {
                const webPath = info.logo_url.replace(/\\/g, '/');
                const fullLogoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                logoPreview.src = fullLogoUrl;
            } else {
                logoPreview.src = 'https://placehold.co/100x100?text=Logo';
            }

            // Pratinjau untuk logo baru
            document.getElementById('coop-logo-input').addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        logoPreview.src = event.target.result;
                    };
                    reader.readAsDataURL(file);
                }
            });

        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
            console.error('Error loading cooperative profile:', error);
        }
    };

    if (cooperativeProfileForm) {
        cooperativeProfileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = cooperativeProfileForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Menyimpan...';

            const formData = new FormData();
            formData.append('name', document.getElementById('coop-name-input').value);
            formData.append('address', document.getElementById('coop-address-input').value);
            formData.append('phone', document.getElementById('coop-phone-input').value);

            const logoInput = document.getElementById('coop-logo-input');
            if (logoInput.files[0]) {
                formData.append('logo', logoInput.files[0]); // 'logo' harus cocok dengan nama field multer di backend
            }

            try {
                const updatedInfo = await apiFetch(`${ADMIN_API_URL}/company-info`, { method: 'PUT', body: formData });
                updateHeaderDisplay(updatedInfo); // Perbarui logo di header
                alert('Profil koperasi berhasil diperbarui.');

            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); console.error('Error updating cooperative profile:', error);
            } finally { submitBtn.disabled = false; submitBtn.textContent = 'Simpan Perubahan'; }
        });
    }

    // --- FUNGSI UNTUK KELOLA TESTIMONI ---
    const testimonialModal = document.getElementById('testimonial-modal');
    const testimonialForm = document.getElementById('testimonial-form');
    const testimonialTableBody = document.getElementById('testimonials-table-body');

    const loadTestimonials = async () => {
        if (!testimonialTableBody) return;
        testimonialTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat testimoni...</td></tr>`;
        try {
            const testimonials = await apiFetch(`${ADMIN_API_URL}/testimonials`);

            testimonialTableBody.innerHTML = '';
            if (testimonials.length === 0) {
                testimonialTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Belum ada testimoni.</td></tr>`;
                return;
            }

            testimonials.forEach(item => {
                let photoUrl = 'https://placehold.co/100x100?text=Foto';
                if (item.photo_url) {
                    photoUrl = item.photo_url.startsWith('http') ? item.photo_url : `${API_URL.replace('/api', '')}${item.photo_url}`;
                }
                const row = testimonialTableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4"><img src="${photoUrl}" alt="${item.name}" class="h-10 w-10 object-cover rounded-full"></td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${item.name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.division || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title="${item.text}">${item.text}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">
                        <button class="edit-testimonial-btn text-indigo-600 hover:text-indigo-900" data-id="${item.id}">Ubah</button>
                        <button class="delete-testimonial-btn text-red-600 hover:text-red-900" data-id="${item.id}">Hapus</button>
                    </td>
                `;
            });
        } catch (error) {
            console.error('Error loading testimonials:', error);
            testimonialTableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const showTestimonialModal = async (testimonial = null) => {
        if (!testimonialModal) return;
        testimonialForm.reset();
        document.getElementById('testimonial-id-input').value = '';
        const photoPreview = document.getElementById('testimonial-photo-preview');

        if (testimonial) {
            document.getElementById('testimonial-modal-title').textContent = 'Ubah Testimoni';
            document.getElementById('testimonial-id-input').value = testimonial.id;
            document.getElementById('testimonial-name-input').value = testimonial.name;
            document.getElementById('testimonial-division-input').value = testimonial.division || '';
            document.getElementById('testimonial-text-input').value = testimonial.text;
            photoPreview.src = testimonial.photo_url ? (testimonial.photo_url.startsWith('http') ? testimonial.photo_url : `${API_URL.replace('/api', '')}${testimonial.photo_url}`) : 'https://placehold.co/100x100?text=Foto';
        } else {
            document.getElementById('testimonial-modal-title').textContent = 'Tambah Testimoni Baru';
            photoPreview.src = 'https://placehold.co/100x100?text=Foto';
        }
        testimonialModal.classList.remove('hidden');
    };

    if (testimonialModal) {
        document.getElementById('add-testimonial-btn')?.addEventListener('click', () => showTestimonialModal());
        document.getElementById('close-testimonial-modal')?.addEventListener('click', () => testimonialModal.classList.add('hidden'));
        document.getElementById('cancel-testimonial-modal')?.addEventListener('click', () => testimonialModal.classList.add('hidden'));

        document.getElementById('testimonial-photo-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => { document.getElementById('testimonial-photo-preview').src = event.target.result; };
                reader.readAsDataURL(file);
            }
        });

        testimonialForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('testimonial-id-input').value;
            const formData = new FormData();
            formData.append('name', document.getElementById('testimonial-name-input').value);
            formData.append('division', document.getElementById('testimonial-division-input').value);
            formData.append('text', document.getElementById('testimonial-text-input').value);

            const photoInput = document.getElementById('testimonial-photo-input');
            if (photoInput.files[0]) {
                formData.append('testimonialPhoto', photoInput.files[0]);
            }

            const url = id ? `${ADMIN_API_URL}/testimonials/${id}` : `${ADMIN_API_URL}/testimonials`;
            const method = id ? 'PUT' : 'POST';

            try {
                await apiFetch(url, { method, body: formData });
                alert(`Testimoni berhasil ${id ? 'diperbarui' : 'ditambahkan'}.`);
                testimonialModal.classList.add('hidden');
                loadTestimonials();
            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); }
        });
    }

    // --- FUNGSI UNTUK MAPING AKUN ---
    const createMappingTable = async (config) => {
        const { tableBodyId, typeEndpoint, mappingEndpoint, typeNameField, typeIdField } = config;
        const tableBody = document.getElementById(tableBodyId);

        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-gray-500">Memuat...</td></tr>`;

        try {
            const [types, accounts] = await Promise.all([
                apiFetch(`${ADMIN_API_URL}/${typeEndpoint}`),
                apiFetch(`${ADMIN_API_URL}/accounts`)
            ]);

            const accountOptions = `<option value="">-- Tidak Terhubung --</option>` +
                accounts.map(acc => `<option value="${acc.id}">${acc.account_number} - ${acc.account_name}</option>`).join('');

            tableBody.innerHTML = '';
            if (types.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-gray-500">Tidak ada tipe yang ditemukan.</td></tr>`;
                return;
            }

            types.forEach(type => {
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${type[typeNameField]}</td>
                    <td class="px-6 py-4">
                        <select data-id="${type[typeIdField]}" class="account-mapping-select block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm">
                            ${accountOptions}
                        </select>
                    </td>
                `;
                const select = row.querySelector('select');
                select.value = type.account_id || '';
            });

            tableBody.addEventListener('change', async (e) => {
                if (e.target.matches('.account-mapping-select')) {
                    const select = e.target;
                    const id = select.dataset.id;
                    const accountId = select.value;
                    select.disabled = true;
                    try {
                        await apiFetch(`${ADMIN_API_URL}/${mappingEndpoint}/${id}`, {
                            method: 'PUT',
                            body: JSON.stringify({ accountId: accountId || null })
                        });
                    } catch (error) { alert(`Error: ${error.message}`); } finally { select.disabled = false; }
                }
            });
        } catch (error) { console.error(error); tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-red-500">${error.message}</td></tr>`; }
    };

    const loadSavingAccountMapping = () => createMappingTable({ tableBodyId: 'saving-mapping-table-body', typeEndpoint: 'savingtypes', mappingEndpoint: 'map-saving-account', typeNameField: 'name', typeIdField: 'id' });
    const loadLoanAccountMapping = () => createMappingTable({ tableBodyId: 'loan-mapping-table-body', typeEndpoint: 'loantypes', mappingEndpoint: 'map-loan-account', typeNameField: 'name', typeIdField: 'id' });

    // --- FUNGSI UNTUK KARTU STOK BARANG ---
    const loadStockCard = async () => {
        const productSelect = document.getElementById('stock-card-product-select');
        const tableBody = document.getElementById('stock-card-table-body');
        if (!productSelect || !tableBody) return;

        // Ganti elemen select untuk menghapus event listener lama dan mencegah duplikasi
        const newSelect = productSelect.cloneNode(false); // false = jangan kloning options
        productSelect.parentNode.replaceChild(newSelect, productSelect);

        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat daftar produk...</td></tr>`;

        const handleProductChange = async () => {
            const productId = newSelect.value;
            if (!productId) {
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Pilih produk untuk melihat riwayat stok.</td></tr>`;
                return;
            }

            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Memuat riwayat stok...</td></tr>`;
            try {
                const history = await apiFetch(`${ADMIN_API_URL}/stock-card?productId=${productId}`);
    
                tableBody.innerHTML = '';
                if (history.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada riwayat pergerakan untuk produk ini.</td></tr>`;
                    return;
                }
    
                history.forEach(item => {
                    const row = tableBody.insertRow();
                    row.innerHTML = `
                        <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.date)}</td>
                        <td class="px-6 py-4 text-sm text-gray-900">${item.description}</td>
                        <td class="px-6 py-4 text-sm text-green-600 text-right">${item.in_qty > 0 ? item.in_qty : '-'}</td>
                        <td class="px-6 py-4 text-sm text-red-600 text-right">${item.out_qty > 0 ? item.out_qty : '-'}</td>
                        <td class="px-6 py-4 text-sm text-gray-800 font-semibold text-right">${item.balance}</td>
                    `;
                });
            } catch (error) {
                console.error('Error loading stock card history:', error);
                tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
            }
        };

        // Tambahkan event listener ke elemen select yang baru
        newSelect.addEventListener('change', handleProductChange);

        // Isi dropdown produk
        try { // Endpoint diubah dari 'admin/all-products' menjadi 'all-products' untuk menghindari duplikasi path
            await populateDropdown(newSelect, 'all-products', 'id', 'name', 'Produk');
            
            if (newSelect.options.length > 1) {
                newSelect.selectedIndex = 1; // Pilih produk pertama secara otomatis
                await handleProductChange(); // Panggil handler untuk memuat datanya
            } else {
                 tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada produk untuk ditampilkan. Tambahkan produk dari logistik terlebih dahulu.</td></tr>`;
            }
        } catch (error) {
            console.error('Gagal memuat dropdown produk kartu stok:', error);
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red-500">Gagal memuat daftar produk.</td></tr>`;
        }
    };

    // --- FUNGSI UNTUK LAPORAN LABA RUGI ---
    const setupIncomeStatementReport = () => {
        const generateBtn = document.getElementById('generate-is-report-btn');
        const downloadBtn = document.getElementById('download-is-pdf-btn');
        const previewContainer = document.getElementById('is-report-preview');
        const startDateInput = document.getElementById('is-start-date');
        const endDateInput = document.getElementById('is-end-date');
    
        if (!generateBtn) return;
    
        let reportDataCache = null; // Cache the generated report data
    
        // Set default dates to the current month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    
        const renderReport = (data) => {
            reportDataCache = data; // Cache the data
            const { revenue, cogs, grossProfit, expense, netIncome } = data;
    
            const renderSection = (title, items, total, isBold = false, isIndented = false) => {
                if (items.length === 0 && total === 0) return '';
                let itemsHtml = items.map(item => `
                    <tr class="text-sm">
                        <td class="py-1 px-4 ${isIndented ? 'pl-8' : ''}">${item.number} - ${item.name}</td>
                        <td class="py-1 px-4 text-right">${formatCurrency(item.total)}</td>
                        <td class="py-1 px-4"></td>
                    </tr>
                `).join('');
    
                return `
                    <tr class="font-semibold text-sm">
                        <td class="py-2 px-4 ${isBold ? 'font-bold' : ''}">${title}</td>
                        <td class="py-2 px-4"></td>
                        <td class="py-2 px-4 text-right">${formatCurrency(total)}</td>
                    </tr>
                    ${itemsHtml}
                `;
            };
    
            previewContainer.innerHTML = `
                <h3 class="text-lg font-bold text-center">Laporan Laba Rugi</h3>
                <p class="text-sm text-center text-gray-500 mb-4">Untuk Periode ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}</p>
                <table class="w-full">
                    <tbody>
                        ${renderSection('Pendapatan', revenue.items, revenue.total)}
                        ${renderSection('Beban Pokok Penjualan (HPP)', cogs.items, cogs.total)}
                        <tr class="font-bold text-sm border-t-2 border-gray-300">
                            <td class="py-2 px-4">Laba Kotor</td>
                            <td class="py-2 px-4"></td>
                            <td class="py-2 px-4 text-right">${formatCurrency(grossProfit)}</td>
                        </tr>
                        ${renderSection('Biaya Operasional', expense.items, expense.total, false, true)}
                        <tr class="font-bold text-md bg-gray-100 border-t-2 border-gray-300">
                            <td class="py-2 px-4">Laba Bersih</td>
                            <td class="py-2 px-4"></td>
                            <td class="py-2 px-4 text-right">${formatCurrency(netIncome)}</td>
                        </tr>
                    </tbody>
                </table>
            `;
            previewContainer.classList.remove('hidden');
            downloadBtn.classList.remove('hidden');
        };
    
        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
    
            if (!startDate || !endDate) {
                alert('Silakan pilih periode tanggal.');
                return;
            }
    
            generateBtn.disabled = true;
            generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            previewContainer.classList.remove('hidden');
            downloadBtn.classList.add('hidden');
    
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/income-statement?startDate=${startDate}&endDate=${endDate}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Tampilkan Laporan';
            }
        });
    
        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) {
                alert('Silakan hasilkan laporan terlebih dahulu.');
                return;
            }
    
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { revenue, cogs, grossProfit, expense, netIncome } = reportDataCache;
    
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);
    
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
            doc.setFontSize(12);
            doc.text('Laporan Laba Rugi', 105, 22, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Periode: ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}`, 105, 28, { align: 'center' });
    
            const tableBody = [];
            const addRow = (label, val1 = '', val2 = '', styles = {}) => {
                tableBody.push({
                    label: { content: label, styles: { fontStyle: 'normal', ...styles.label } },
                    val1: { content: val1, styles: { halign: 'right', ...styles.val1 } },
                    val2: { content: val2, styles: { halign: 'right', ...styles.val2 } },
                });
            };
    
            addRow('Pendapatan', '', formatCurrency(revenue.total), { label: { fontStyle: 'bold' } });
            revenue.items.forEach(item => addRow(`  ${item.name}`, formatCurrency(item.total), ''));
    
            addRow('Beban Pokok Penjualan (HPP)', '', `(${formatCurrency(cogs.total)})`, { label: { fontStyle: 'bold' } });
            cogs.items.forEach(item => addRow(`  ${item.name}`, `(${formatCurrency(item.total)})`, ''));
    
            addRow('Laba Kotor', '', formatCurrency(grossProfit), { label: { fontStyle: 'bold' }, val2: { fontStyle: 'bold' } });
            addRow('');
    
            addRow('Biaya Operasional', '', '', { label: { fontStyle: 'bold' } });
            expense.items.forEach(item => addRow(`  ${item.name}`, `(${formatCurrency(item.total)})`, ''));
            addRow('Total Biaya Operasional', '', `(${formatCurrency(expense.total)})`, { val2: { fontStyle: 'bold' } });
            addRow('');
    
            const netIncomeStyle = { fontStyle: 'bold', fillColor: [240, 240, 240] };
            addRow('Laba Bersih', '', formatCurrency(netIncome), { label: netIncomeStyle, val2: netIncomeStyle });
    
            doc.autoTable({
                startY: 35,
                theme: 'plain',
                body: tableBody,
                columnStyles: {
                    label: { cellWidth: 100 },
                    val1: { cellWidth: 40 },
                    val2: { cellWidth: 40 },
                },
                didParseCell: function (data) {
                    if (data.row.raw[data.column.dataKey]?.styles) {
                        Object.assign(data.cell.styles, data.row.raw[data.column.dataKey].styles);
                    }
                }
            });
    
            doc.save(`Laporan_Laba_Rugi_${startDateInput.value}_${endDateInput.value}.pdf`);
        });
    };

    // --- FUNGSI UNTUK LAPORAN PENJUALAN ---
    const setupSalesReport = () => {
        const generateBtn = document.getElementById('generate-sales-report-btn');
        const downloadBtn = document.getElementById('download-sales-pdf-btn');
        const previewContainer = document.getElementById('sales-report-preview');
        const startDateInput = document.getElementById('sales-start-date');
        const endDateInput = document.getElementById('sales-end-date');
        const shopTypeFilter = document.getElementById('sales-shop-type-filter');

        if (!generateBtn) return;

        let reportDataCache = null;

        // Set default dates to the current month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];

        const renderReport = (data) => {
            reportDataCache = data;
            const { summary, byProduct, byMember } = data;

            const summaryHtml = `
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 text-center">
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Total Pendapatan</p>
                        <p class="text-2xl font-bold text-blue-600">${formatCurrency(summary.totalRevenue)}</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Total Laba Kotor</p>
                        <p class="text-2xl font-bold text-green-600">${formatCurrency(summary.totalRevenue)}</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Jumlah Transaksi</p>
                        <p class="text-2xl font-bold text-purple-600">${summary.transactionCount}</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Total Barang Terjual</p>
                        <p class="text-2xl font-bold text-orange-600">${summary.totalItemsSold}</p>
                    </div>
                </div>
            `;

            const byProductHtml = `
                <div>
                    <h3 class="text-lg font-semibold text-gray-800 mb-2">Penjualan per Produk</h3>
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Produk</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Jumlah Terjual</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Pendapatan</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total HPP</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Laba Kotor</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${byProduct.map(p => `
                                    <tr>
                                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${p.name}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${p.total_quantity}</td>
                                        <td class="px-6 py-4 text-sm text-gray-800 font-semibold text-right">${formatCurrency(p.total_revenue)}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(p.total_cogs)}</td>
                                        <td class="px-6 py-4 text-sm text-green-600 font-bold text-right">${formatCurrency(p.gross_profit)}</td>
                                    </tr>
                                `).join('')}
                                ${byProduct.length === 0 ? '<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada penjualan produk.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            const byMemberHtml = `
                <div>
                    <h3 class="text-lg font-semibold text-gray-800 mb-2">Penjualan per Anggota</h3>
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="min-w-full divide-y divide-gray-200">
                            <thead class="bg-gray-50">
                                <tr>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Anggota</th>
                                    <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">No. Koperasi</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Jumlah Transaksi</th>
                                    <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Belanja</th>
                                </tr>
                            </thead>
                            <tbody class="bg-white divide-y divide-gray-200">
                                ${byMember.map(m => `
                                    <tr>
                                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${m.name}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500">${m.cooperative_number || '-'}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${m.transaction_count}</td>
                                        <td class="px-6 py-4 text-sm text-gray-800 font-semibold text-right">${formatCurrency(m.total_spent)}</td>
                                    </tr>
                                `).join('')}
                                ${byMember.length === 0 ? '<tr><td colspan="4" class="text-center py-4 text-gray-500">Tidak ada penjualan ke anggota pada periode ini.</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            previewContainer.innerHTML = summaryHtml + byProductHtml + byMemberHtml;
            downloadBtn.classList.remove('hidden');
        };

        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
            const shopType = shopTypeFilter.value;

            if (!startDate || !endDate) {
                alert('Silakan pilih periode tanggal.');
                return;
            }

            generateBtn.disabled = true;
            generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            downloadBtn.classList.add('hidden');

            try {
                const params = new URLSearchParams({
                    startDate: startDate,
                    endDate: endDate,
                });
                if (shopType) {
                    params.append('shopType', shopType);
                }
                const data = await apiFetch(`${ADMIN_API_URL}/sales-report?${params.toString()}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Tampilkan Laporan';
            }
        });

        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) {
                alert('Silakan hasilkan laporan terlebih dahulu.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { summary, byProduct, byMember } = reportDataCache;
            const startDate = document.getElementById('sales-start-date').value;
            const endDate = document.getElementById('sales-end-date').value;

            try {
                // 1. Fetch Company Info for Header
                const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);

                // 2. PDF Header
                doc.setFontSize(16);
                doc.setFont('helvetica', 'bold');
                doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
                doc.setFontSize(12);
                doc.text('Laporan Penjualan', 105, 22, { align: 'center' });
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.text(`Periode: ${formatDate(startDate)} - ${formatDate(endDate)}`, 105, 28, { align: 'center' });

                // 3. Summary Section
                let startY = 40;
                doc.setFontSize(11);
                doc.setFont('helvetica', 'bold');
                doc.text('Ringkasan Penjualan', 14, startY);
                startY += 6;
                doc.setFontSize(10);
                doc.setFont('helvetica', 'normal');
                doc.text(`Total Pendapatan: ${formatCurrency(summary.totalRevenue)}`, 14, startY);
                doc.text(`Total Laba Kotor: ${formatCurrency(summary.totalGrossProfit)}`, 14, startY + 6);
                doc.text(`Jumlah Transaksi: ${summary.transactionCount}`, 105, startY);
                doc.text(`Total Barang Terjual: ${summary.totalItemsSold}`, 105, startY + 6);
                startY += 16;

                // 4. Products Table
                const headProducts = [['Produk', 'Jml Terjual', 'Pendapatan', 'HPP', 'Laba Kotor']];
                const bodyProducts = byProduct.map(p => [
                    p.name,
                    p.total_quantity,
                    { content: formatCurrency(p.total_revenue), styles: { halign: 'right' } },
                    { content: formatCurrency(p.total_cogs), styles: { halign: 'right' } },
                    { content: formatCurrency(p.gross_profit), styles: { halign: 'right', fontStyle: 'bold' } }
                ]);

                doc.autoTable({
                    startY: startY,
                    head: headProducts,
                    body: bodyProducts,
                    theme: 'grid',
                    headStyles: { fillColor: [153, 27, 27] }, // red-800
                    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
                });

                // 5. Members Table
                let secondTableY = doc.lastAutoTable.finalY + 10;
                const headMembers = [['Nama Anggota', 'No. Koperasi', 'Jml Transaksi', 'Total Belanja']];
                const bodyMembers = byMember.map(m => [
                    m.name,
                    m.cooperative_number || '-',
                    { content: m.transaction_count, styles: { halign: 'right' } },
                    { content: formatCurrency(m.total_spent), styles: { halign: 'right' } }
                ]);

                doc.autoTable({
                    startY: secondTableY,
                    head: headMembers,
                    body: bodyMembers,
                    theme: 'grid',
                    headStyles: { fillColor: [153, 27, 27] }, // red-800
                    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } }
                });

                // 6. Save the PDF
                doc.save(`Laporan_Penjualan_${startDate}_${endDate}.pdf`);

            } catch (error) {
                console.error('Error generating sales report PDF:', error);
                alert('Gagal membuat PDF. Silakan coba lagi.');
            }
        });
    };

    // --- FUNGSI UNTUK LAPORAN NERACA ---
    const setupBalanceSheetReport = () => {
        const generateBtn = document.getElementById('generate-bs-report-btn');
        const downloadBtn = document.getElementById('download-bs-pdf-btn');
        const previewContainer = document.getElementById('bs-report-preview');
        const dateInput = document.getElementById('bs-date');
    
        if (!generateBtn) return;
    
        let reportDataCache = null;
    
        dateInput.value = new Date().toISOString().split('T')[0];
    
        const renderReport = (data) => {
            reportDataCache = data;
            const { assets, liabilities, equity } = data;    
            const renderSection = (items) => {
                let itemsHtml = items.map(item => `
                    <tr class="text-sm">
                        <td class="py-1 px-4 pl-8">${item.number} - ${item.name}</td>
                        <td class="py-1 px-4 text-right">${formatCurrency(item.beginning_balance)}</td>
                        <td class="py-1 px-4 text-right">${formatCurrency(item.ending_balance)}</td>
                    </tr>
                `).join('');
                return itemsHtml;
            };
    
            previewContainer.innerHTML = `
                <h3 class="text-lg font-bold text-center">Laporan Neraca</h3>
                <p class="text-sm text-center text-gray-500 mb-4">Per Tanggal ${formatDate(dateInput.value)}</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <table class="w-full">
                            <thead><tr class="border-b-2">
                                <th class="py-2 px-4 text-left font-bold">Aktiva</th>
                                <th class="py-2 px-4 text-right font-bold">Saldo Awal</th>
                                <th class="py-2 px-4 text-right font-bold">Saldo Akhir</th>
                            </tr></thead>
                            <tbody>
                                ${renderSection(assets.items)}
                            </tbody>
                            <tfoot class="border-t-2 font-bold"><tr class="bg-gray-100">
                                <td class="py-2 px-4">Total Aktiva</td>
                                <td class="py-2 px-4 text-right">${formatCurrency(assets.beginning_total)}</td>
                                <td class="py-2 px-4 text-right">${formatCurrency(assets.ending_total)}</td>
                            </tr></tfoot>
                        </table>
                    </div>
                    <div>
                        <table class="w-full">
                            <thead><tr class="border-b-2">
                                <th class="py-2 px-4 text-left font-bold">Kewajiban dan Ekuitas</th>
                                <th class="py-2 px-4 text-right font-bold">Saldo Awal</th>
                                <th class="py-2 px-4 text-right font-bold">Saldo Akhir</th>
                            </tr></thead>
                            <tbody>
                                <tr class="font-semibold text-sm"><td class="py-2 px-4" colspan="3">Kewajiban</td></tr>
                                ${renderSection(liabilities.items)}
                                <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Total Kewajiban</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.beginning_total)}</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.ending_total)}</td></tr>
                                <tr class="font-semibold text-sm"><td class="py-2 px-4" colspan="3">Ekuitas</td></tr>
                                ${renderSection(equity.items)}
                                <tr class="font-semibold text-sm border-t"><td class="py-2 px-4">Total Ekuitas</td><td class="py-2 px-4 text-right">${formatCurrency(equity.beginning_total)}</td><td class="py-2 px-4 text-right">${formatCurrency(equity.ending_total)}</td></tr>
                            </tbody>
                            <tfoot class="border-t-2 font-bold"><tr class="bg-gray-100"><td class="py-2 px-4">Total Kewajiban dan Ekuitas</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.beginning_total + equity.beginning_total)}</td><td class="py-2 px-4 text-right">${formatCurrency(liabilities.ending_total + equity.ending_total)}</td></tr></tfoot>
                        </table>
                    </div>
                </div>
            `;
            downloadBtn.classList.remove('hidden');
        };
    
        generateBtn.addEventListener('click', async () => {
            const asOfDate = dateInput.value;
            if (!asOfDate) { alert('Silakan pilih tanggal.'); return; }
    
            generateBtn.disabled = true; generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            downloadBtn.classList.add('hidden');
    
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/balance-sheet?asOfDate=${asOfDate}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false; generateBtn.textContent = 'Tampilkan Laporan';
            }
        });
    
        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) { alert('Silakan hasilkan laporan terlebih dahulu.'); return; }
    
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { assets, liabilities, equity } = reportDataCache;    
    
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);
    
            doc.setFontSize(16); doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
            doc.setFontSize(12); doc.text('Laporan Neraca', 105, 22, { align: 'center' });
            doc.setFontSize(10); doc.setFont('helvetica', 'normal');
            doc.text(`Per Tanggal: ${formatDate(dateInput.value)}`, 105, 28, { align: 'center' });
    
            const tableBody = [];
            const addRow = (label, val1 = '', val2 = '', styles = {}) => tableBody.push({ label: { content: label, styles: styles.label || {} }, val1: { content: val1, styles: { halign: 'right', ...(styles.val1 || {}) } }, val2: { content: val2, styles: { halign: 'right', ...(styles.val2 || {}) } } });
    
            addRow('AKTIVA', 'Saldo Awal', 'Saldo Akhir', { label: { fontStyle: 'bold' }, val1: { fontStyle: 'bold' }, val2: { fontStyle: 'bold' } });
            assets.items.forEach(item => addRow(`  ${item.name}`, formatCurrency(item.beginning_balance), formatCurrency(item.ending_balance)));
            addRow('TOTAL AKTIVA', formatCurrency(assets.beginning_total), formatCurrency(assets.ending_total), { label: { fontStyle: 'bold', fillColor: [240, 240, 240] }, val1: { fontStyle: 'bold', fillColor: [240, 240, 240] }, val2: { fontStyle: 'bold', fillColor: [240, 240, 240] } });
            addRow('');
            addRow('KEWAJIBAN & EKUITAS', '', '', { label: { fontStyle: 'bold' } });
            addRow('Kewajiban', '', '', { label: { fontStyle: 'bold' } });
            liabilities.items.forEach(item => addRow(`  ${item.name}`, formatCurrency(item.beginning_balance), formatCurrency(item.ending_balance)));
            addRow('Total Kewajiban', formatCurrency(liabilities.beginning_total), formatCurrency(liabilities.ending_total), { label: { fontStyle: 'bold' }, val1: { fontStyle: 'bold' }, val2: { fontStyle: 'bold' } });
            addRow('Ekuitas', '', '', { label: { fontStyle: 'bold' } });
            equity.items.forEach(item => addRow(`  ${item.name}`, formatCurrency(item.beginning_balance), formatCurrency(item.ending_balance)));
            addRow('Total Ekuitas', formatCurrency(equity.beginning_total), formatCurrency(equity.ending_total), { label: { fontStyle: 'bold' }, val1: { fontStyle: 'bold' }, val2: { fontStyle: 'bold' } });
            addRow('TOTAL KEWAJIBAN & EKUITAS', formatCurrency(liabilities.beginning_total + equity.beginning_total), formatCurrency(liabilities.ending_total + equity.ending_total), { label: { fontStyle: 'bold', fillColor: [240, 240, 240] }, val1: { fontStyle: 'bold', fillColor: [240, 240, 240] }, val2: { fontStyle: 'bold', fillColor: [240, 240, 240] } });
    
            doc.autoTable({ startY: 35, theme: 'plain', body: tableBody, columnStyles: { label: { cellWidth: 100 }, val1: { cellWidth: 40 }, val2: { cellWidth: 40 } }, didParseCell: (data) => { if (data.row.raw[data.column.dataKey]?.styles) Object.assign(data.cell.styles, data.row.raw[data.column.dataKey].styles); } });
            doc.save(`Laporan_Neraca_${dateInput.value}.pdf`);
        });
    };

    // --- FUNGSI UNTUK LAPORAN BUKU BESAR ---
    const setupGeneralLedgerReport = () => {
        const generateBtn = document.getElementById('generate-gl-report-btn');
        const downloadBtn = document.getElementById('download-gl-pdf-btn');
        const previewContainer = document.getElementById('gl-report-preview');
        const startAccountSelect = document.getElementById('gl-start-account-select');
        const endAccountSelect = document.getElementById('gl-end-account-select');
        const startDateInput = document.getElementById('gl-start-date');
        const endDateInput = document.getElementById('gl-end-date');
    
        if (!generateBtn) return;
    
        let reportDataCache = null;
    
        // Populate account dropdown
        const populateAccountDropdowns = async () => {
            await populateDropdown(startAccountSelect, 'accounts', 'id', (item) => `${item.account_number} - ${item.account_name}`, 'Akun Awal');
            await populateDropdown(endAccountSelect, 'accounts', 'id', (item) => `${item.account_number} - ${item.account_name}`, 'Akun Akhir');
        };
        populateAccountDropdowns();
    
        // Set default dates
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];
    
        const renderReport = (ledgers) => {
            reportDataCache = ledgers;
            previewContainer.innerHTML = '';

            if (!ledgers || ledgers.length === 0) {
                previewContainer.innerHTML = '<p class="text-center text-gray-500">Tidak ada data transaksi untuk akun dan periode yang dipilih.</p>';
                downloadBtn.classList.add('hidden');
                return;
            }

            ledgers.forEach(ledger => {
                const { account, summary, transactions } = ledger;
                const { beginningBalance, endingBalance } = summary;

                let transactionsHtml = transactions.map(tx => `
                    <tr class="text-sm">
                        <td class="py-2 px-4">${formatDate(tx.date)}</td>
                        <td class="py-2 px-4">${tx.description}</td>
                        <td class="py-2 px-4">${tx.reference || '-'}</td>
                        <td class="py-2 px-4 text-right">${tx.debit > 0 ? formatCurrency(tx.debit) : '-'}</td>
                        <td class="py-2 px-4 text-right">${tx.credit > 0 ? formatCurrency(tx.credit) : '-'}</td>
                        <td class="py-2 px-4 text-right">${formatCurrency(tx.balance)}</td>
                    </tr>
                `).join('');

                const ledgerHtml = `
                    <div class="break-after-page">
                        <h3 class="text-lg font-bold text-center">${account.account_number} - ${account.account_name}</h3>
                        <p class="text-sm text-center text-gray-500 mb-4">Periode ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}</p>
                        <div class="overflow-x-auto border rounded-lg">
                            <table class="min-w-full">
                                <thead class="bg-gray-50">
                                    <tr>
                                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tanggal</th>
                                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Keterangan</th>
                                        <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Ref</th>
                                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Kredit</th>
                                        <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Saldo</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-gray-200">
                                    <tr class="font-semibold bg-gray-100">
                                        <td colspan="5" class="py-2 px-4">Saldo Awal</td>
                                        <td class="py-2 px-4 text-right">${formatCurrency(beginningBalance)}</td>
                                    </tr>
                                    ${transactionsHtml}
                                </tbody>
                                <tfoot class="bg-gray-100 font-bold border-t-2">
                                    <tr>
                                        <td colspan="5" class="py-2 px-4 text-right">Saldo Akhir</td>
                                        <td class="py-2 px-4 text-right">${formatCurrency(endingBalance)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                `;
                previewContainer.innerHTML += ledgerHtml;
            });
            downloadBtn.classList.remove('hidden');
        };
    
        generateBtn.addEventListener('click', async () => {
            const startAccountId = startAccountSelect.value;
            const endAccountId = endAccountSelect.value;
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;
    
            if (!startAccountId || !endAccountId || !startDate || !endDate) { alert('Silakan pilih rentang akun dan periode tanggal.'); return; }
    
            generateBtn.disabled = true; generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            downloadBtn.classList.add('hidden');
    
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/general-ledger?startAccountId=${startAccountId}&endAccountId=${endAccountId}&startDate=${startDate}&endDate=${endDate}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false; generateBtn.textContent = 'Tampilkan Laporan';
            }
        });
    
        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache || reportDataCache.length === 0) { alert('Silakan hasilkan laporan terlebih dahulu.'); return; }
    
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);
            let isFirstPage = true;

            for (const ledger of reportDataCache) {
                if (!isFirstPage) {
                    doc.addPage();
                }
                isFirstPage = false;

                const { account, summary, transactions } = ledger;
                const { beginningBalance, endingBalance } = summary;

                doc.setFontSize(16); doc.setFont('helvetica', 'bold');
                doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
                doc.setFontSize(12); doc.text('Buku Besar', 105, 22, { align: 'center' });
                doc.setFontSize(11); doc.text(`${account.account_number} - ${account.account_name}`, 105, 28, { align: 'center' });
                doc.setFontSize(10); doc.setFont('helvetica', 'normal');
                doc.text(`Periode: ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}`, 105, 34, { align: 'center' });

                const head = [['Tanggal', 'Keterangan', 'Ref', 'Debit', 'Kredit', 'Saldo']];
                const body = [
                    [{ content: 'Saldo Awal', colSpan: 5, styles: { fontStyle: 'bold' } }, { content: formatCurrency(beginningBalance), styles: { halign: 'right', fontStyle: 'bold' } }]
                ];
                transactions.forEach(tx => {
                    body.push([formatDate(tx.date), tx.description, tx.reference || '-', tx.debit > 0 ? formatCurrency(tx.debit) : '', tx.credit > 0 ? formatCurrency(tx.credit) : '', formatCurrency(tx.balance)]);
                });
                body.push([
                    { content: 'Saldo Akhir', colSpan: 5, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
                    { content: formatCurrency(endingBalance), styles: { halign: 'right', fontStyle: 'bold', fillColor: [240, 240, 240] } }
                ]);

                doc.autoTable({ startY: 40, head: head, body: body, theme: 'grid', headStyles: { fillColor: [153, 27, 27] }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
            }
            doc.save(`Buku_Besar_${startDateInput.value}_sd_${endDateInput.value}.pdf`);
        });
    };

    // --- FUNGSI UNTUK LAPORAN STATUS TUTUP BUKU ---
    const setupMonthlyClosingStatusReport = () => {
        const yearSelect = document.getElementById('mcs-year-select');
        const previewContainer = document.getElementById('mcs-report-preview');
        const downloadBtn = document.getElementById('download-mcs-pdf-btn');

        if (!yearSelect) return;

        let reportDataCache = null;

        // Populate year dropdown
        const currentYear = new Date().getFullYear();
        yearSelect.innerHTML = '';
        for (let i = currentYear; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
        yearSelect.value = currentYear;

        const loadReport = async (year) => {
            previewContainer.innerHTML = '<p class="text-center py-8 text-gray-500">Memuat laporan...</p>';
            downloadBtn.classList.add('hidden');
            reportDataCache = null;
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/monthly-closing-status?year=${year}`);
                reportDataCache = data;

                const tableHtml = `
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bulan</th>
                                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal Tutup</th>
                                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Laba/Rugi Bersih</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${data.map(month => { const statusClass = month.status === 'Ditutup' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'; return `
                                    <tr>
                                        <td class="px-6 py-4 text-sm font-medium text-gray-900">${month.monthName}</td>
                                        <td class="px-6 py-4 text-center"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${month.status}</span></td>
                                        <td class="px-6 py-4 text-sm text-gray-500">${month.closedAt ? formatDate(month.closedAt) : '-'}</td>
                                        <td class="px-6 py-4 text-sm text-gray-500 text-right">${month.netIncome !== null ? formatCurrency(month.netIncome) : '-'}</td>
                                    </tr>`; }).join('')}
                        </tbody>
                    </table>`;
                previewContainer.innerHTML = tableHtml;
                downloadBtn.classList.remove('hidden');
            } catch (error) { previewContainer.innerHTML = `<p class="text-center py-8 text-red-500">${error.message}</p>`; }
        };

        yearSelect.addEventListener('change', () => { loadReport(yearSelect.value); });

        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) {
                alert('Silakan muat laporan terlebih dahulu.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const year = yearSelect.value;
            
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);

            // Header
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
            doc.setFontSize(12);
            doc.text('Laporan Status Tutup Buku', 105, 22, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Tahun: ${year}`, 105, 28, { align: 'center' });

            // Table
            const head = [['Bulan', 'Status', 'Tanggal Tutup', 'Laba/Rugi Bersih']];
            const body = reportDataCache.map(month => [
                month.monthName,
                month.status,
                month.closedAt ? formatDate(month.closedAt) : '-',
                month.netIncome !== null ? formatCurrency(month.netIncome) : '-'
            ]);

            doc.autoTable({ startY: 35, head: head, body: body, theme: 'grid', headStyles: { fillColor: [153, 27, 27] }, columnStyles: { 3: { halign: 'right' } } });

            doc.save(`Laporan_Status_Tutup_Buku_${year}.pdf`);
        });

        loadReport(currentYear); // Initial load
    };

    // --- FUNGSI UNTUK LAPORAN ARUS KAS ---
    const setupCashFlowReport = () => {
        const generateBtn = document.getElementById('generate-cf-report-btn');
        const downloadBtn = document.getElementById('download-cf-pdf-btn');
        const previewContainer = document.getElementById('cf-report-preview');
        const startDateInput = document.getElementById('cf-start-date');
        const endDateInput = document.getElementById('cf-end-date');

        if (!generateBtn) return;

        let reportDataCache = null;

        // Set default dates to the current month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];

        const renderReport = (data) => {
            reportDataCache = data;
            const { summary, operating, financing } = data;

            const renderSubSection = (items, isOutflow = false) => {
                return Object.entries(items)
                    .filter(([key, value]) => key !== 'total' && value > 0)
                    .map(([key, value]) => {
                        const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                        return `<tr class="text-sm"><td class="py-1 px-4 pl-8">${label}</td><td class="py-1 px-4 text-right">${isOutflow ? `(${formatCurrency(value)})` : formatCurrency(value)}</td></tr>`;
                    }).join('');
            };

            previewContainer.innerHTML = `
                <h3 class="text-lg font-bold text-center">Laporan Arus Kas</h3>
                <p class="text-sm text-center text-gray-500 mb-4">Untuk Periode ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}</p>
                <table class="w-full">
                    <tbody>
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
                    </tbody>
                </table>
            `;
            downloadBtn.classList.remove('hidden');
        };

        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!startDate || !endDate) {
                alert('Silakan pilih periode tanggal.');
                return;
            }

            generateBtn.disabled = true;
            generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            downloadBtn.classList.add('hidden');

            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Tampilkan Laporan';
            }
        });

        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) {
                alert('Silakan hasilkan laporan terlebih dahulu.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { summary, operating, financing } = reportDataCache;

            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);

            // PDF Header
            doc.setFontSize(16);
            doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
            doc.setFontSize(12);
            doc.text('Laporan Arus Kas', 105, 22, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`Periode: ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}`, 105, 28, { align: 'center' });

            const tableBody = [];
            const addRow = (label, value = '', styles = {}) => {
                tableBody.push({
                    label: { content: label, styles: { fontStyle: 'normal', ...styles.label } },
                    value: { content: value, styles: { halign: 'right', ...styles.value } },
                });
            };
            const addSubRow = (label, value = '', isOutflow = false) => {
                const formattedValue = isOutflow ? `(${formatCurrency(value)})` : formatCurrency(value);
                addRow(`  ${label}`, formattedValue);
            };

            // Operating Activities
            addRow('Arus Kas dari Aktivitas Operasi', '', { label: { fontStyle: 'bold' } });
            if (operating.inflows.fromSales > 0) addSubRow('Penerimaan dari Penjualan', operating.inflows.fromSales);
            if (operating.inflows.fromInterest > 0) addSubRow('Penerimaan Bunga Pinjaman', operating.inflows.fromInterest);
            if (operating.outflows.toSuppliers > 0) addSubRow('Pembayaran ke Supplier', operating.outflows.toSuppliers, true);
            if (operating.outflows.forExpenses > 0) addSubRow('Pembayaran Beban Operasional', operating.outflows.forExpenses, true);
            addRow('Arus Kas Bersih dari Aktivitas Operasi', formatCurrency(operating.net), { label: { fontStyle: 'bold' }, value: { fontStyle: 'bold' } });
            addRow('');

            // Financing Activities
            addRow('Arus Kas dari Aktivitas Pendanaan', '', { label: { fontStyle: 'bold' } });
            if (financing.inflows.fromSavings > 0) addSubRow('Setoran Simpanan Anggota', financing.inflows.fromSavings);
            if (financing.inflows.fromLoanRepayments > 0) addSubRow('Penerimaan Pokok Pinjaman', financing.inflows.fromLoanRepayments);
            if (financing.outflows.forLoanDisbursements > 0) addSubRow('Pencairan Pinjaman ke Anggota', financing.outflows.forLoanDisbursements, true);
            if (financing.outflows.forResignations > 0) addSubRow('Pengembalian Simpanan (Resign)', financing.outflows.forResignations, true);
            addRow('Arus Kas Bersih dari Aktivitas Pendanaan', formatCurrency(financing.net), { label: { fontStyle: 'bold' }, value: { fontStyle: 'bold' } });
            addRow('');

            // Summary
            const summaryStyle = { fontStyle: 'bold', fillColor: [240, 240, 240] };
            addRow('Kenaikan (Penurunan) Bersih Kas', formatCurrency(summary.netCashFlow), { label: summaryStyle, value: summaryStyle });
            addRow('Saldo Kas Awal Periode', formatCurrency(summary.beginningCash));
            addRow('Saldo Kas Akhir Periode', formatCurrency(summary.endingCash), { label: { fontStyle: 'bold' }, value: { fontStyle: 'bold' } });

            doc.autoTable({ startY: 35, theme: 'plain', body: tableBody, columnStyles: { label: { cellWidth: 140 }, value: { cellWidth: 40 } }, didParseCell: function (data) { if (data.row.raw[data.column.dataKey]?.styles) { Object.assign(data.cell.styles, data.row.raw[data.column.dataKey].styles); } } });

            doc.save(`Laporan_Arus_Kas_${startDateInput.value}_${endDateInput.value}.pdf`);
        });
    };

    // --- FUNGSI UNTUK HALAMAN INPUT SIMPANAN (BULK & MANUAL) ---
    const setupBulkSavingsPage = () => {
        const tabBtns = document.querySelectorAll('.savings-input-tab-btn');
        const tabContents = document.querySelectorAll('.savings-input-tab-content');
        const manualForm = document.getElementById('manual-saving-form');

        if (!tabBtns.length) return;

        // Tab switching logic
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

                // Populate dropdowns when manual tab is shown
                if (targetId === 'bulk-savings-manual-tab') {
                    populateDropdown(
                        document.getElementById('manual-saving-member'), 
                        'members?status=Active&role=member', 
                        'id', 
                        (item) => `${item.name} (${item.cooperative_number || 'N/A'})`,
                        'Anggota');
                    populateDropdown(document.getElementById('manual-saving-type'), 'savingtypes', 'id', 'name', 'Tipe Simpanan');
                    document.getElementById('manual-saving-date').valueAsDate = new Date();
                }
            });
        });

        // Manual form submission logic
        if (manualForm) {
            // Mencegah penambahan event listener berulang kali setiap kali halaman dikunjungi.
            // Jika flag 'listenerAttached' sudah ada, berarti listener sudah terpasang, jadi kita hentikan fungsi.
            if (manualForm.dataset.listenerAttached) {
                return;
            }
            manualForm.dataset.listenerAttached = 'true'; // Tandai bahwa listener sudah dipasang.

            manualForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const submitBtn = manualForm.querySelector('button[type="submit"]');
                const feedbackEl = document.getElementById('manual-saving-feedback');
                
                const body = {
                    memberId: document.getElementById('manual-saving-member').value,
                    savingTypeId: document.getElementById('manual-saving-type').value,
                    amount: document.getElementById('manual-saving-amount').value,
                    date: document.getElementById('manual-saving-date').value,
                    description: document.getElementById('manual-saving-description').value,
                };

                if (!body.memberId || !body.savingTypeId || !body.amount || !body.date) {
                    alert('Harap isi semua field yang wajib diisi.');
                    return;
                }

                submitBtn.disabled = true;
                submitBtn.textContent = 'Menyimpan...';
                feedbackEl.classList.add('hidden');

                try {
                    const result = await apiFetch(`${ADMIN_API_URL}/savings/manual`, {
                        method: 'POST',
                        body: JSON.stringify(body)
                    });

                    feedbackEl.textContent = result.message || 'Simpanan berhasil dicatat.';
                    feedbackEl.className = 'p-3 rounded-md text-sm bg-green-100 text-green-800';
                    feedbackEl.classList.remove('hidden');
                    manualForm.reset();
                    document.getElementById('manual-saving-date').valueAsDate = new Date();

                } catch (error) {
                    feedbackEl.textContent = `Error: ${error.message}`;
                    feedbackEl.className = 'p-3 rounded-md text-sm bg-red-100 text-red-800';
                    feedbackEl.classList.remove('hidden');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Simpan Transaksi';
                }
            });
        }
    };

    // --- FUNGSI UNTUK KELOLA ATURAN SHU ---
    const setupShuRules = () => {
        const form = document.getElementById('shu-rules-form');
        if (!form) return;
    
        const yearSelect = document.getElementById('shu-rules-year');
        const inputs = form.querySelectorAll('.shu-percentage-input');
        const totalDisplay = document.getElementById('shu-total-percentage');
        const errorDisplay = document.getElementById('shu-percentage-error');
    
        const updateTotal = () => {
            let total = 0;
            inputs.forEach(input => {
                total += parseFloat(input.value) || 0;
            });
            totalDisplay.textContent = `${total.toFixed(2)}%`;
            if (Math.abs(total - 100) > 0.01) {
                totalDisplay.classList.add('text-red-600');
                errorDisplay.classList.remove('hidden');
            } else {
                totalDisplay.classList.remove('text-red-600');
                errorDisplay.classList.add('hidden');
            }
        };
    
        const populateForm = (data) => {
            document.getElementById('shu-member-business-service').value = data.member_business_service_percentage;
            document.getElementById('shu-member-capital-service').value = data.member_capital_service_percentage;
            document.getElementById('shu-reserve-fund').value = data.reserve_fund_percentage;
            document.getElementById('shu-management-fund').value = data.management_fund_percentage;
            document.getElementById('shu-education-fund').value = data.education_fund_percentage;
            document.getElementById('shu-social-fund').value = data.social_fund_percentage;
            updateTotal();
        };
    
        const loadRulesForYear = async (year) => {
            try {
                const data = await apiFetch(`${ADMIN_API_URL}/shu-rules/${year}`);
                populateForm(data);
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            }
        };
    
        // Populate year dropdown
        yearSelect.innerHTML = ''; // Clear previous options
        const currentYear = new Date().getFullYear();
        for (let i = currentYear + 1; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
        yearSelect.value = currentYear;
    
        // Add event listeners
        yearSelect.addEventListener('change', () => loadRulesForYear(yearSelect.value));
        inputs.forEach(input => input.addEventListener('input', updateTotal));
    
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            let total = 0;
            inputs.forEach(input => { total += parseFloat(input.value) || 0; });
    
            if (Math.abs(total - 100) > 0.01) { alert('Total persentase harus tepat 100%.'); return; }
    
            const body = { year: yearSelect.value, member_business_service_percentage: document.getElementById('shu-member-business-service').value, member_capital_service_percentage: document.getElementById('shu-member-capital-service').value, reserve_fund_percentage: document.getElementById('shu-reserve-fund').value, management_fund_percentage: document.getElementById('shu-management-fund').value, education_fund_percentage: document.getElementById('shu-education-fund').value, social_fund_percentage: document.getElementById('shu-social-fund').value };
    
            submitBtn.disabled = true; submitBtn.textContent = 'Menyimpan...';
            try {
                await apiFetch(`${ADMIN_API_URL}/shu-rules`, { method: 'POST', body: JSON.stringify(body) });
                alert(`Aturan SHU untuk tahun ${body.year} berhasil disimpan.`);
            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); } finally { submitBtn.disabled = false; submitBtn.textContent = 'Simpan Aturan'; }
        });
    
        // Initial load
        loadRulesForYear(currentYear);
    };
    const loadShuRules = () => setupShuRules();

    // --- FUNGSI UNTUK POSTING SHU ---
    const setupPostShuPage = () => {
        const yearSelect = document.getElementById('shu-calc-year');
        const totalShuInput = document.getElementById('shu-calc-total');
        const calcBtn = document.getElementById('calculate-shu-preview-btn');
        const previewContainer = document.getElementById('shu-preview-container');
        const summaryContainer = document.getElementById('shu-preview-summary');
        const tableBody = document.getElementById('shu-preview-table-body');
        const postBtn = document.getElementById('post-shu-btn');
    
        if (!calcBtn) return;
    
        let cachedDistributionData = null;
    
        // Populate year dropdown
        yearSelect.innerHTML = '';
        const currentYear = new Date().getFullYear();
        for (let i = currentYear - 1; i >= currentYear - 5; i--) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            yearSelect.appendChild(option);
        }
    
        calcBtn.addEventListener('click', async () => {
            const year = yearSelect.value;
            const totalShu = totalShuInput.value;
    
            if (!totalShu || totalShu <= 0) {
                alert('Harap masukkan Total SHU yang valid.');
                return;
            }
    
            calcBtn.disabled = true;
            calcBtn.textContent = 'Menghitung...';
            previewContainer.classList.add('hidden');
    
            try {
                const { summary, distribution } = await apiFetch(`${ADMIN_API_URL}/shu/calculate-preview`, {
                    method: 'POST',
                    body: JSON.stringify({ year, totalShu })
                });
                cachedDistributionData = distribution; // Cache data for posting
    
                summaryContainer.innerHTML = `
                    <p>Total SHU Dibagikan: <strong>${formatCurrency(summary.totalShu)}</strong></p>
                    <p>Alokasi Jasa Usaha: <strong>${formatCurrency(summary.allocatedForBusiness)}</strong> | Alokasi Jasa Modal: <strong>${formatCurrency(summary.allocatedForCapital)}</strong></p>
                `;
    
                tableBody.innerHTML = '';
                if (distribution.length === 0) {
                    tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-4">Tidak ada anggota yang berhak menerima SHU.</td></tr>`;
                } else {
                    distribution.forEach(item => {
                        const row = tableBody.insertRow();
                        row.innerHTML = `
                            <td class="px-6 py-4 text-sm text-gray-900">${item.memberName}</td>
                            <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.shuFromBusiness)}</td>
                            <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.shuFromCapital)}</td>
                            <td class="px-6 py-4 text-sm font-semibold text-gray-800 text-right">${formatCurrency(item.totalMemberShu)}</td>
                        `;
                    });
                }
                previewContainer.classList.remove('hidden');
            } catch (error) {
                alert(`Gagal menghitung pratinjau: ${error.message}`);
            } finally {
                calcBtn.disabled = false;
                calcBtn.textContent = 'Hitung & Pratinjau';
            }
        });
    
        postBtn.addEventListener('click', async () => {
            if (!cachedDistributionData || !confirm(`Anda yakin ingin memposting SHU tahun ${yearSelect.value} ke ${cachedDistributionData.length} anggota? Tindakan ini tidak dapat dibatalkan.`)) return;
    
            postBtn.disabled = true; postBtn.textContent = 'Memposting...';
            try {
                const result = await apiFetch(`${ADMIN_API_URL}/shu/post-distribution`, { method: 'POST', body: JSON.stringify({ year: yearSelect.value, distributionData: cachedDistributionData }) });
                alert(result.message);
                previewContainer.classList.add('hidden');
            } catch (error) { alert(`Gagal memposting SHU: ${error.message}`); } finally { postBtn.disabled = false; postBtn.textContent = 'Posting SHU ke Semua Anggota'; }
        });
    };

    // --- FUNGSI UNTUK HUTANG USAHA (KARTU HUTANG) ---
    let currentPayablesFilters = {};
    const loadPayables = async (page = 1) => {
        const tableBody = document.getElementById('payables-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-gray-500">Memuat data hutang...</td></tr>`;
        try {
            const filters = { ...currentPayablesFilters, page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            const { data: payables, pagination } = await apiFetch(`${ADMIN_API_URL}/payables?${queryParams}`);

            tableBody.innerHTML = '';
            if (payables.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-gray-500">Tidak ada data hutang usaha.</td></tr>`;
                renderPagination('payables-pagination-controls', { totalItems: 0 }, loadPayables);
                return;
            }

            payables.forEach(item => {
                const statusClass = item.status === 'Paid' ? 'bg-green-100 text-green-800' : (item.status === 'Partially Paid' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800');
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.transaction_date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-900">${item.reference_number}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.supplier_name || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.total_amount)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.amount_paid)}</td>
                    <td class="px-6 py-4 text-sm font-semibold text-gray-800 text-right">${formatCurrency(item.remaining_amount)}</td>
                    <td class="px-6 py-4 text-center"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${item.status}</span></td>
                    <td class="px-6 py-4 text-center">
                        <button class="payable-details-btn text-blue-600 hover:underline text-sm" data-id="${item.id}">Detail/Bayar</button>
                    </td>
                `;
            });
            renderPagination('payables-pagination-controls', pagination, loadPayables);
        } catch (error) {
            console.error('Error loading payables:', error);
            tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const showPayableDetailsModal = async (payableId) => {
        const modal = document.getElementById('payable-details-modal');
        if (!modal) return;

        const contentEl = document.getElementById('payable-details-content');
        const formContainer = document.getElementById('payable-payment-form-container');
        modal.classList.remove('hidden');
        contentEl.innerHTML = '<p class="text-center py-8">Memuat detail hutang...</p>';
        formContainer.classList.add('hidden');

        try {
            const { header, payments } = await apiFetch(`${ADMIN_API_URL}/payables/${payableId}`);

            document.getElementById('payable-details-modal-title').textContent = `Detail Hutang: ${header.reference_number}`;
            
            let paymentsHtml = '<p class="text-sm text-gray-500">Belum ada pembayaran.</p>';
            if (payments.length > 0) {
                paymentsHtml = `
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50"><tr>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Tgl Bayar</th>
                            <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Jumlah</th>
                            <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Metode</th>
                        </tr></thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                        ${payments.map(p => `
                            <tr>
                                <td class="px-4 py-2 text-sm">${formatDate(p.payment_date)}</td>
                                <td class="px-4 py-2 text-sm text-right">${formatCurrency(p.amount)}</td>
                                <td class="px-4 py-2 text-sm">${p.payment_method}</td>
                            </tr>
                        `).join('')}
                        </tbody>
                    </table>
                `;
            }

            contentEl.innerHTML = `
                <div class="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><p class="text-gray-500">Supplier</p><p class="font-semibold">${header.supplier_name || '-'}</p></div>
                    <div><p class="text-gray-500">Tgl Transaksi</p><p class="font-semibold">${formatDate(header.transaction_date)}</p></div>
                    <div><p class="text-gray-500">Total Hutang</p><p class="font-semibold">${formatCurrency(header.total_amount)}</p></div>
                    <div><p class="text-gray-500">Sisa Hutang</p><p class="font-bold text-red-600">${formatCurrency(parseFloat(header.total_amount) - parseFloat(header.amount_paid))}</p></div>
                </div>
                <h4 class="text-md font-semibold text-gray-800 mb-2 mt-6">Riwayat Pembayaran</h4>
                <div class="overflow-x-auto border rounded-lg">${paymentsHtml}</div>
            `;

            if (header.status !== 'Paid') {
                formContainer.classList.remove('hidden');
                document.getElementById('payable-id-input').value = payableId;
                document.getElementById('payable-payment-date').valueAsDate = new Date();
                document.getElementById('payable-payment-amount').value = parseFloat(header.total_amount) - parseFloat(header.amount_paid);
            }

        } catch (error) {
            contentEl.innerHTML = `<p class="text-red-500 text-center py-8">${error.message}</p>`;
        }
    };

    document.getElementById('payables-table-body')?.addEventListener('click', (e) => {
        if (e.target.matches('.payable-details-btn')) {
            showPayableDetailsModal(e.target.dataset.id);
        }
    });

    document.getElementById('payable-payment-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        const submitBtn = form.querySelector('button[type="submit"]');
        const payableId = document.getElementById('payable-id-input').value;

        const body = {
            payableId: payableId,
            paymentDate: document.getElementById('payable-payment-date').value,
            amount: document.getElementById('payable-payment-amount').value,
            paymentMethod: document.getElementById('payable-payment-method').value,
        };

        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan...';

        try {
            await apiFetch(`${ADMIN_API_URL}/payables/payment`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            alert('Pembayaran berhasil dicatat.');
            // Refresh modal and table
            showPayableDetailsModal(payableId);
            loadPayables();
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Simpan Pembayaran';
        }
    });
    document.getElementById('close-payable-details-modal')?.addEventListener('click', () => document.getElementById('payable-details-modal').classList.add('hidden'));

    // --- EVENT LISTENER UNTUK SIMPAN HAK AKSES ROLE ---
    document.getElementById('role-permissions-container')?.addEventListener('click', async (e) => {
        if (!e.target.matches('.save-role-permissions-btn')) return;

        const button = e.target;
        const role = button.dataset.role;
        const card = button.closest('.bg-white.shadow');
        
        const checkedPermissions = Array.from(card.querySelectorAll('.permission-checkbox:checked'))
                                        .map(checkbox => checkbox.dataset.permissionKey);

        button.disabled = true;
        button.textContent = 'Menyimpan...';

        try {
            await apiFetch(`${ADMIN_API_URL}/roles/${role}/permissions`, {
                method: 'PUT',
                body: JSON.stringify({ permissions: checkedPermissions })
            });

            alert(`Hak akses untuk peran "${role}" berhasil diperbarui. Perubahan akan aktif pada sesi login berikutnya.`);
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = 'Simpan Perubahan';
        }
    });

    testimonialTableBody?.addEventListener('click', async (e) => {
        const button = e.target;
        const id = button.dataset.id;

        if (button.matches('.edit-testimonial-btn')) {
            const testimonial = await apiFetch(`${ADMIN_API_URL}/testimonials/${id}`);
            showTestimonialModal(testimonial);
        }

        if (button.matches('.delete-testimonial-btn')) {
            if (confirm('Anda yakin ingin menghapus testimoni ini?')) {
                try {
                    await apiFetch(`${ADMIN_API_URL}/testimonials/${id}`, { method: 'DELETE' });
                    loadTestimonials();
                } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); }
            }
        }
    });

    // --- FUNGSI UNTUK UNDUH TEMPLATE SIMPANAN ---
    const handleDownloadSavingsTemplate = () => {
        const downloadBtn = document.getElementById('download-savings-template-btn');
        if (!downloadBtn) return;

        downloadBtn.addEventListener('click', async () => {
            const originalText = downloadBtn.textContent;
            downloadBtn.textContent = 'Memproses...';
            downloadBtn.disabled = true;

            try {
                // We fetch a file, so we don't use the standard apiFetch that expects JSON
                const token = localStorage.getItem('token');
                const response = await fetch(`${ADMIN_API_URL}/savings/export-template`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => null);
                    throw new Error(errorData?.error || `Gagal mengunduh template. Status: ${response.status}`);
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'template_simpanan_anggota.xlsx'; 
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                downloadBtn.textContent = originalText;
                downloadBtn.disabled = false;
            }
        });
    };

    // --- FUNGSI UNTUK UNGGAH SIMPANAN BULK ---
    const handleBulkSavingsUpload = () => {
        const form = document.getElementById('bulk-savings-form');
        if (!form) return;

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('bulk-savings-file');
            const feedbackEl = document.getElementById('bulk-savings-feedback');
            const submitBtn = form.querySelector('button[type="submit"]');

            if (!fileInput.files || fileInput.files.length === 0) {
                alert('Silakan pilih file Excel untuk diunggah.');
                return;
            }

            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append('savingsFile', file); // Key 'savingsFile' harus cocok dengan di backend (multer)

            submitBtn.disabled = true;
            submitBtn.textContent = 'Mengunggah...';
            feedbackEl.classList.add('hidden');

            try {
                const result = await apiFetch(`${ADMIN_API_URL}/savings/bulk-upload`, { method: 'POST', body: formData });

                feedbackEl.textContent = result.message || 'File berhasil diunggah dan diproses.';
                feedbackEl.className = 'p-3 rounded-md text-sm bg-green-100 text-green-800';
                feedbackEl.classList.remove('hidden');
                form.reset();
            } catch (error) {
                feedbackEl.textContent = `Error: ${error.message}`;
                feedbackEl.className = 'p-3 rounded-md text-sm bg-red-100 text-red-800';
                feedbackEl.classList.remove('hidden');
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Unggah dan Proses';
            }
        });
    };

    // --- FUNGSI UNTUK KELOLA TOKO (USAHA KOPERASI) ---
    const loadShopProducts = async (shopType) => {
        const tableBody = document.getElementById(`toko-${shopType}-table-body`);
        if (!tableBody) return;

        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Memuat produk...</td></tr>`;

        try {
            // Menggunakan endpoint admin untuk mengambil produk
            const products = await apiFetch(`${ADMIN_API_URL}/products?shop=${shopType}`);

            tableBody.innerHTML = '';
            if (products.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-gray-500">Belum ada produk. Klik "Tambah Produk Baru" untuk memulai.</td></tr>`;
                return;
            }

            products.forEach(product => {
                const isOutOfStock = parseInt(product.stock, 10) <= 0;
                const row = tableBody.insertRow();
                if (isOutOfStock) {
                    row.classList.add('opacity-60', 'bg-gray-50');
                }
                let imageUrl = 'https://placehold.co/100x100?text=No+Image';
                if (product.image_url) {
                    // Check if it's an external URL or a local path
                    imageUrl = product.image_url.startsWith('http') 
                        ? product.image_url 
                        : `${API_URL.replace('/api', '')}${product.image_url}`;
                }
                row.innerHTML = `
                    <td class="px-6 py-4"><img src="${imageUrl}" alt="${product.name}" class="h-12 w-12 object-cover rounded"></td>
                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${product.name}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title="${product.description}">${product.description || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${formatCurrency(product.price)}</td>
                    <td class="px-6 py-4 text-sm ${isOutOfStock ? 'text-red-600 font-bold' : 'text-gray-500'}">${product.stock}</td>
                    <td class="px-6 py-4 text-sm font-medium space-x-2">
                        <button class="edit-product-btn text-indigo-600 hover:text-indigo-900" data-id="${product.id}" data-shop-type="${shopType}">Ubah</button>
                        <button class="delete-product-btn text-red-600 hover:text-red-900" data-id="${product.id}" data-shop-type="${shopType}">Hapus</button>
                    </td>
                `;
            });

        } catch (error) {
            console.error(`Error loading ${shopType} products:`, error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    // --- FUNGSI UNTUK MODAL PRODUK ---
    const productModal = document.getElementById('product-modal');
    const productForm = document.getElementById('product-form');
    const productModalTitle = document.getElementById('product-modal-title');

    const imagePreview = document.getElementById('product-image-preview');
    const currentImageUrlInput = document.getElementById('product-current-image-url');
    const showProductModal = async (product = null, shopType) => {
        if (!productModal) return;
        productForm.reset();
        document.getElementById('product-id-input').value = '';
        document.getElementById('product-shop-type-input').value = shopType;

        const nameContainer = document.getElementById('product-name-field-container');
        // Restore standard text input field by default
        nameContainer.innerHTML = `
            <label for="product-name-input" class="block text-sm font-medium text-gray-700">Nama Produk</label>
            <input type="text" id="product-name-input" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500">
        `;

        if (product) {
            // Mode Ubah
            productModalTitle.textContent = 'Ubah Produk';
            document.getElementById('product-id-input').value = product.id;
            document.getElementById('product-name-input').value = product.name;
            document.getElementById('product-name-input').readOnly = true; // Prevent editing name of existing product
            document.getElementById('product-name-input').classList.add('bg-gray-100');
            document.getElementById('product-description-input').value = product.description;
            document.getElementById('product-price-input').value = product.price;
            document.getElementById('product-stock-input').value = product.stock;
            // Tampilkan gambar yang sudah ada
            if (product.image_url) {
                imagePreview.src = product.image_url.startsWith('http')
                    ? product.image_url
                    : `${API_URL.replace('/api', '')}${product.image_url}`;
            } else {
                imagePreview.src = 'https://placehold.co/100x100?text=No+Image';
            }
            currentImageUrlInput.value = product.image_url || '';
        } else {
            // Mode Tambah
            productModalTitle.textContent = 'Tambah Produk Baru';
            imagePreview.src = 'https://placehold.co/100x100?text=No+Image';
            currentImageUrlInput.value = '';

            // Special logic for 'sembako' add mode
            if (shopType === 'sembako') {
                try {
                    const availableProducts = await apiFetch(`${ADMIN_API_URL}/logistics-products/${shopType}`);

                    if (availableProducts.length > 0) {
                        let options = availableProducts.map(p => `<option value="${p.productName}" data-stock="${p.availableStock || 0}">${p.productName}</option>`).join('');
                        nameContainer.innerHTML = `
                            <label for="product-name-select" class="block text-sm font-medium text-gray-700">Nama Produk (dari Logistik)</label>
                            <select id="product-name-select" required class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500">
                                <option value="">-- Pilih Produk --</option>
                                ${options}
                            </select>
                        `;

                        // Tambahkan event listener untuk mengisi stok secara otomatis
                        const nameSelect = document.getElementById('product-name-select');
                        const stockInput = document.getElementById('product-stock-input');
                        nameSelect.addEventListener('change', (e) => {
                            const selectedOption = e.target.options[e.target.selectedIndex];
                            const stock = selectedOption.dataset.stock || 0;
                            stockInput.value = stock;
                        });
                    }
                } catch (error) {
                    console.error("Could not load logistics products for dropdown:", error);
                    // The text input remains as a fallback
                }
            }
        }
        productModal.classList.remove('hidden');
    };

    if (productModal) {
        document.getElementById('close-product-modal').addEventListener('click', () => productModal.classList.add('hidden'));
        document.getElementById('cancel-product-modal').addEventListener('click', () => productModal.classList.add('hidden'));

        productForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('product-id-input').value;
            const shopType = document.getElementById('product-shop-type-input').value;

            const formData = new FormData();
            const nameInput = document.getElementById('product-name-input') || document.getElementById('product-name-select');
            formData.append('name', nameInput.value);
            formData.append('description', document.getElementById('product-description-input').value);
            formData.append('price', parseFloat(document.getElementById('product-price-input').value));
            formData.append('stock', parseInt(document.getElementById('product-stock-input').value, 10));
            formData.append('shop_type', shopType);

            const imageInput = document.getElementById('product-image-input');
            if (imageInput.files[0]) {
                formData.append('productImage', imageInput.files[0]);
            }

            const url = id ? `${ADMIN_API_URL}/products/${id}` : `${ADMIN_API_URL}/products`;
            const method = id ? 'PUT' : 'POST';

            try {
                await apiFetch(url, {
                    method,
                    body: formData,
                });

                alert(`Produk berhasil ${id ? 'diperbarui' : 'ditambahkan'}.`);
                productModal.classList.add('hidden');
                loadShopProducts(shopType); // Muat ulang daftar produk

            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
                console.error('Error saving product:', error);
            }
        });

        // Event listener untuk pratinjau gambar
        document.getElementById('product-image-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    imagePreview.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Event listener untuk semua tombol "Tambah Produk Baru"
    document.querySelectorAll('.add-product-btn').forEach(button => {
        button.addEventListener('click', async () => {
            const shopType = button.dataset.shopType;
            await showProductModal(null, shopType);
        });
    });

    // --- FUNGSI UNTUK KELOLA TOKO (USAHA KOPERASI) ---
    // This function is defined earlier in the file. This is a duplicate.

    // Event delegation for product actions
    document.querySelector('main').addEventListener('click', async (e) => {
        const button = e.target;
        const { id, shopType } = button.dataset;

        if (button.matches('.edit-product-btn')) {
            const product = await apiFetch(`${ADMIN_API_URL}/products/${id}`);
            await showProductModal(product, shopType);
        }

        if (button.matches('.delete-product-btn')) {
            if (confirm('Anda yakin ingin menghapus produk ini?')) {
                try {
                    // Pastikan shopType ada sebelum melanjutkan
                    if (!shopType) {
                        console.error('shopType is missing from the delete button dataset.');
                        alert('Terjadi kesalahan: Tipe toko tidak ditemukan.');
                        return;
                    }
                    await apiFetch(`${ADMIN_API_URL}/products/${id}`, { method: 'DELETE' });
                    alert('Produk berhasil dihapus.');
                    loadShopProducts(shopType);
                } catch (error) {
                    alert(`Terjadi kesalahan: ${error.message}`);
                }
            }
        }

        if (button.matches('.journal-details-btn')) {
            showJournalDetails(id);
        }

        if (button.matches('.logistics-details-btn')) {
            showLogisticsDetails(button.dataset.ref);
        }
    });

    // --- FUNGSI UNTUK KARTU LOGISTIK ---
    const loadLogistics = async () => {
        const tableBody = document.getElementById('logistics-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-gray-500">Memuat data logistik...</td></tr>`;
        try {
            // Menggunakan endpoint view khusus yang melakukan join
            const items = await apiFetch(`${ADMIN_API_URL}/logistics-view`);

            tableBody.innerHTML = '';
            if (items.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-gray-500">Belum ada data logistik.</td></tr>`;
                return;
            }

            items.forEach(item => {
                const statusClass = item.status === 'Received' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
                const row = tableBody.insertRow();
                row.innerHTML = `
                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(item.entry_date)}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.referenceNumber ? `<button class="logistics-details-btn text-blue-600 hover:underline" data-ref="${item.referenceNumber}">${item.referenceNumber}</button>` : '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-900">${item.supplierName || '-'}</td>
                    <td class="px-6 py-4 text-sm text-gray-900">${item.productName}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${item.quantity}</td>
                    <td class="px-6 py-4 text-sm text-gray-500">${item.unit}</td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(item.purchasePrice)}</td>
                    <td class="px-6 py-4 text-sm text-center"><span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClass}">${item.status || 'Pending'}</span></td>
                    <td class="px-6 py-4 text-sm text-gray-500 text-right font-semibold">${formatCurrency(item.totalAmount)}</td>
                `;
            });
        } catch (error) {
            console.error('Error loading logistics:', error);
            tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    let currentLogisticsRef;
    const showLogisticsDetails = async (ref) => {
        currentLogisticsRef = ref;
        const modal = document.getElementById('logistics-details-modal');
        if (!modal) return;

        const contentEl = document.getElementById('logistics-details-content');
        modal.classList.remove('hidden');
        contentEl.innerHTML = '<p class="text-center py-8">Memuat detail logistik...</p>';

        try {
            const { header, products } = await apiFetch(`${ADMIN_API_URL}/logistics-by-ref/${ref}`);

            const totalAmount = products.reduce((sum, p) => sum + parseFloat(p.totalAmount), 0);

            contentEl.innerHTML = `
                <div class="mb-4 space-y-2">
                    <p><span class="font-semibold">Tanggal:</span> ${formatDate(header.entryDate)}</p>
                    <p><span class="font-semibold">No. Logistik:</span> ${header.referenceNumber || '-'}</p>
                    <p><span class="font-semibold">Supplier:</span> ${header.supplierName || '-'}</p>
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Produk</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Harga Beli</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Jumlah</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${products.map(p => `
                                <tr>
                                    <td class="px-4 py-2 text-sm text-gray-900">${p.productName}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${p.quantity}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500">${p.unit}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(p.purchasePrice)}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(p.totalAmount)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot class="bg-gray-50 font-semibold">
                            <tr>
                                <td colspan="4" class="px-4 py-2 text-right">Total</td>
                                <td class="px-4 py-2 text-right">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;

            // Tampilkan/sembunyikan tombol aksi berdasarkan status
            const receiveBtn = document.getElementById('receive-logistics-ref-btn');
            const editBtn = document.getElementById('edit-logistics-ref-btn');
            const deleteBtn = document.getElementById('delete-logistics-ref-btn');

            if (header.status === 'Pending') {
                receiveBtn.classList.remove('hidden');
                editBtn.classList.remove('hidden');
                deleteBtn.classList.remove('hidden');
            } else { // Status 'Received'
                receiveBtn.classList.add('hidden');
                editBtn.classList.add('hidden');
                deleteBtn.classList.add('hidden');
            }
        } catch (error) {
            contentEl.innerHTML = `<p class="text-red-500 text-center py-8">${error.message}</p>`;
        }
    };

    const openLogisticsForEditing = async (ref) => {
        const entryModal = document.getElementById('logistics-modal');
        if (!entryModal) return;

        try {
            const { header, products } = await apiFetch(`${ADMIN_API_URL}/logistics-by-ref/${ref}`);

            document.getElementById('logistics-details-modal').classList.add('hidden');
            entryModal.classList.remove('hidden');

            const form = document.getElementById('logistics-form');
            form.reset();
            form.dataset.originalRef = ref;

            document.getElementById('logistics-modal-title').textContent = 'Ubah Data Pembelian';
            document.getElementById('logistics-id-input').value = 'editing';
            document.getElementById('logistics-entry_date-input').value = header.entryDate.split('T')[0];
            document.getElementById('logistics-reference_number-input').value = header.referenceNumber;

            const supplierSelect = document.getElementById('logistics-supplier_id-select');
            await populateDropdown(supplierSelect, 'suppliers', 'id', 'name', 'Pilih Supplier');
            supplierSelect.value = header.supplierId;

            const linesBody = document.getElementById('logistics-lines-body');
            linesBody.innerHTML = '';
            for (const product of products) {
                await addLogisticsLine();
                const lastRow = linesBody.lastElementChild;
                lastRow.querySelector('.logistics-product-name').value = product.productName;
                lastRow.querySelector('.logistics-quantity').value = product.quantity;
                lastRow.querySelector('.logistics-unit').value = product.unit;
                lastRow.querySelector('.logistics-purchase-price').value = product.purchasePrice;
            }
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };

    const printLogisticsPO = async (ref) => {
        const button = document.getElementById('print-logistics-po-btn');
        if (!button) return;

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = 'Mencetak...';

        try {
            // Ambil data koperasi untuk logo dan nama
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);

            const { header, products } = await apiFetch(`${ADMIN_API_URL}/logistics-by-ref/${ref}`);

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            // --- Muat dan tambahkan logo ---
            if (companyInfo.logo_url) {
                try {
                    const webPath = companyInfo.logo_url.replace(/\\/g, '/');
                    const fullLogoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                    
                    const imageResponse = await fetch(fullLogoUrl);
                    const imageBlob = await imageResponse.blob();
                    const reader = new FileReader();
                    const imageDataUrl = await new Promise(resolve => {
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(imageBlob);
                    });

                    const img = new Image();
                    img.src = imageDataUrl;
                    await new Promise(resolve => img.onload = resolve);
                    
                    const imgWidth = 20;
                    const imgHeight = img.height * (imgWidth / img.width);
                    doc.addImage(imageDataUrl, 'PNG', 14, 15, imgWidth, imgHeight);
                } catch (imgError) {
                    console.error("Gagal memuat logo untuk PDF:", imgError);
                }
            }

            // --- PDF Header ---
            doc.setFontSize(18);
            doc.setFont('helvetica', 'bold');
            doc.text('PURCHASE ORDER', 105, 20, { align: 'center' });

            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI KARYA KAGUM SEJAHTERA', 14, 40);
            doc.setFont('helvetica', 'normal');
            doc.text(companyInfo.address || 'Jl. Koperasi No. 123, Jakarta', 14, 45);

            // --- PO Details ---
            doc.setFont('helvetica', 'bold');
            doc.text('Kepada Yth:', 140, 45);
            doc.setFont('helvetica', 'normal');
            doc.text(header.supplierName || 'N/A', 140, 50);

            doc.setFont('helvetica', 'bold');
            doc.text('No. PO:', 14, 55);
            doc.setFont('helvetica', 'normal');
            doc.text(header.referenceNumber || '-', 35, 55);

            doc.setFont('helvetica', 'bold');
            doc.text('Tanggal:', 14, 60);
            doc.setFont('helvetica', 'normal');
            doc.text(formatDate(header.entryDate), 35, 60);

            // --- Products Table ---
            const tableColumn = ["No.", "Nama Produk", "Qty", "Unit", "Harga Satuan", "Jumlah"];
            const tableRows = [];
            let totalAmount = 0;

            products.forEach((product, index) => {
                tableRows.push([
                    index + 1,
                    product.productName,
                    product.quantity,
                    product.unit,
                    formatCurrency(product.purchasePrice),
                    formatCurrency(product.totalAmount)
                ]);
                totalAmount += parseFloat(product.totalAmount);
            });

            doc.autoTable({
                head: [tableColumn],
                body: tableRows,
                startY: 70,
                headStyles: { fillColor: [153, 27, 27] }, // red-800
                columnStyles: {
                    4: { halign: 'right' },
                    5: { halign: 'right' }
                }
            });

            // --- Total ---
            let finalY = doc.lastAutoTable.finalY;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text('Total', 140, finalY + 10);
            doc.text(formatCurrency(totalAmount), 196, finalY + 10, { align: 'right' });

            // --- Tanda Tangan ---
            finalY = finalY + 30; // Beri jarak dari total
            if (finalY > 250) { // Cek jika butuh halaman baru
                doc.addPage();
                finalY = 20;
            }

            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('Disetujui oleh,', 30, finalY, { align: 'center' });
            doc.text('Dibuat oleh,', 175, finalY, { align: 'center' });

            finalY += 25; // Jarak untuk tanda tangan

            doc.text('(___________________)', 30, finalY, { align: 'center' });
            doc.text('(___________________)', 175, finalY, { align: 'center' });

            finalY += 5;
            doc.setFont('helvetica', 'bold');
            doc.text('Ketua Koperasi', 30, finalY, { align: 'center' });
            doc.text('Akunting', 175, finalY, { align: 'center' });

            // --- Save PDF ---
            doc.save(`PO-${header.referenceNumber || 'TANPA_NOMOR'}.pdf`);

        } catch (error) {
            alert(`Gagal membuat PDF: ${error.message}`);
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    };

    let masterProductOptionsCache = null;
    const getMasterProductOptions = async () => {
        if (masterProductOptionsCache) {
            return masterProductOptionsCache;
        }
        try {
            const products = await apiFetch(`${ADMIN_API_URL}/master-products`);
            masterProductOptionsCache = '<option value="">-- Pilih Item Produk --</option>' + products.map(p => 
                `<option value="${p.id}" data-unit="${p.default_unit || ''}">${p.name} (${p.item_number || 'No-Item#'})</option>`
            ).join('');
            return masterProductOptionsCache;
        } catch (error) {
            console.error('Gagal memuat master produk untuk dropdown:', error);
            return '<option value="">Gagal memuat produk</option>';
        }
    };

    const addLogisticsLine = async () => {
        const template = document.getElementById('logistics-line-template');
        const linesBody = document.getElementById('logistics-lines-body');
        if (!template || !linesBody) return;
        const clone = template.content.cloneNode(true);
        const selectEl = clone.querySelector('.logistics-product-select');
        selectEl.innerHTML = await getMasterProductOptions();
        linesBody.appendChild(clone);

        // Auto-fill unit when a product is selected
        selectEl.addEventListener('change', (e) => {
            const selectedOption = e.target.options[e.target.selectedIndex];
            const unit = selectedOption.dataset.unit || '';
            const row = e.target.closest('.logistics-line-row');
            row.querySelector('.logistics-unit').value = unit;
        });
    };

    const setupLogisticsModal = () => {
        const modal = document.getElementById('logistics-modal');
        if (!modal) return;
        const form = document.getElementById('logistics-form');
        const title = document.getElementById('logistics-modal-title');
        const idInput = document.getElementById('logistics-id-input');
        const linesBody = document.getElementById('logistics-lines-body');

        document.getElementById('add-logistics-btn')?.addEventListener('click', () => {
            form.reset();
            idInput.value = '';
            linesBody.innerHTML = '';
            title.textContent = 'Form Pembelian Barang';
            document.getElementById('logistics-entry_date-input').valueAsDate = new Date();
            populateDropdown(document.getElementById('logistics-supplier_id-select'), 'suppliers', 'id', 'name', 'Pilih Supplier');
            addLogisticsLine(); // Add one initial line
            modal.classList.remove('hidden');
        });

        document.getElementById('add-logistics-line-btn')?.addEventListener('click', addLogisticsLine);

        linesBody.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-logistics-line-btn')) {
                e.target.closest('tr').remove();
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const isEditing = document.getElementById('logistics-id-input').value === 'editing';
            const originalRef = form.dataset.originalRef;
            const products = Array.from(linesBody.querySelectorAll('.logistics-line-row')).map(row => ({
                master_product_id: row.querySelector('.logistics-product-select').value,
                quantity: row.querySelector('.logistics-quantity').value,
                unit: row.querySelector('.logistics-unit').value,
                purchase_price: row.querySelector('.logistics-purchase-price').value,
            }));

            if (products.some(p => !p.master_product_id || !p.quantity || !p.unit || !p.purchase_price)) {
                alert('Harap isi semua kolom untuk setiap baris produk.');
                return;
            }

            const body = { 
                entry_date: document.getElementById('logistics-entry_date-input').value, 
                supplier_id: document.getElementById('logistics-supplier_id-select').value, 
                reference_number: document.getElementById('logistics-reference_number-input').value,
                products: products 
            };
            
            const url = isEditing ? `${ADMIN_API_URL}/logistics-by-ref/${originalRef}` : `${ADMIN_API_URL}/logistics_entries`;
            const method = isEditing ? 'PUT' : 'POST';

            try {
                await apiFetch(url, { method, body: JSON.stringify(body) });
                modal.classList.add('hidden');
                loadLogistics();
            } catch (error) { alert(error.message); }
        });
    };

    document.getElementById('logistics-details-footer')?.addEventListener('click', async (e) => {
        if (e.target.id === 'edit-logistics-ref-btn') {
            openLogisticsForEditing(currentLogisticsRef);
        } else if (e.target.id === 'print-logistics-po-btn') {
            printLogisticsPO(currentLogisticsRef);
        } else if (e.target.id === 'delete-logistics-ref-btn') {
            if (!confirm(`Anda yakin ingin menghapus semua entri untuk No. Logistik "${currentLogisticsRef}"?`)) return;
            try {
                await apiFetch(`${ADMIN_API_URL}/logistics-by-ref/${currentLogisticsRef}`, { method: 'DELETE' });
                alert('Data logistik berhasil dihapus.');
                document.getElementById('logistics-details-modal').classList.add('hidden');
                loadLogistics();
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            }
        } else if (e.target.id === 'receive-logistics-ref-btn') {
            if (!confirm(`Anda yakin ingin menerima semua barang untuk No. Logistik "${currentLogisticsRef}"? Stok akan diperbarui dan hutang akan dicatat.`)) return;

            const button = e.target;
            button.disabled = true;
            button.textContent = 'Memproses...';

            try {
                await apiFetch(`${ADMIN_API_URL}/logistics/receive`, {
                    method: 'POST',
                    body: JSON.stringify({ referenceNumber: currentLogisticsRef })
                });
                alert('Barang berhasil diterima.');
                document.getElementById('logistics-details-modal').classList.add('hidden');
                loadLogistics(); // Reload the main logistics list
                // Jika halaman Kartu Stok sedang aktif, muat ulang datanya
                if (document.getElementById('stock-card-content').classList.contains('active')) {
                    loadStockCard();
                }
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
                button.disabled = false;
                button.textContent = 'Terima Barang';
            }
        }
    });
    document.getElementById('close-logistics-details-modal')?.addEventListener('click', () => document.getElementById('logistics-details-modal').classList.add('hidden'));

    document.getElementById('journal-details-footer')?.addEventListener('click', (e) => {
        if (e.target.id === 'edit-journal-btn') {
            openJournalForEditing(currentJournalId);
        } else if (e.target.id === 'delete-journal-btn') {
            deleteJournal(currentJournalId);
        }
    });

    // --- FUNGSI UNTUK JURNAL UMUM ---
    let currentJournalId;
    let accountOptionsCache = null; // Cache for account dropdown options

    const getAccountOptions = async () => {
        if (accountOptionsCache) {
            return accountOptionsCache;
        }
        try {
        // Menggunakan endpoint baru yang hanya mengembalikan akun yang bisa dijurnal (bukan akun induk)
        const accounts = await apiFetch(`${ADMIN_API_URL}/journal-accounts`);
            accountOptionsCache = accounts.map(acc => 
                `<option value="${acc.id}">${acc.account_number} - ${acc.account_name}</option>`
            ).join('');
            return accountOptionsCache;
        } catch (error) {
        console.error('Error fetching account options for journal:', error);
        return '<option value="">Gagal memuat daftar akun</option>';
        }
    };

    const addJournalLine = async (accountId = '', debit = '', credit = '') => {
        const linesBody = document.getElementById('journal-lines-body');
        const accountOptions = await getAccountOptions();
        const newRow = document.createElement('tr');
        newRow.className = 'journal-line-row';
        newRow.innerHTML = `
            <td class="p-2">
                <select class="journal-account-select w-full rounded-md border-gray-300 shadow-sm text-sm" required>
                    <option value="">-- Pilih Akun --</option>
                    ${accountOptions}
                </select>
            </td>
            <td class="p-2">
                <input type="number" class="journal-debit-input w-full rounded-md border-gray-300 shadow-sm text-sm" value="${debit}" placeholder="0">
            </td>
            <td class="p-2">
                <input type="number" class="journal-credit-input w-full rounded-md border-gray-300 shadow-sm text-sm" value="${credit}" placeholder="0">
            </td>
            <td class="p-2 text-center">
                <button type="button" class="remove-journal-line-btn text-red-500 hover:text-red-700">&times;</button>
            </td>
        `;
        linesBody.appendChild(newRow);
        const select = newRow.querySelector('.journal-account-select');
        if (accountId) {
            select.value = accountId;
        }
    };

    const updateJournalTotals = () => {
        let totalDebit = 0;
        let totalCredit = 0;
        document.querySelectorAll('.journal-line-row').forEach(row => {
            const debit = parseFloat(row.querySelector('.journal-debit-input').value) || 0;
            const credit = parseFloat(row.querySelector('.journal-credit-input').value) || 0;
            totalDebit += debit;
            totalCredit += credit;
        });
        document.getElementById('journal-total-debit').textContent = formatCurrency(totalDebit);
        document.getElementById('journal-total-credit').textContent = formatCurrency(totalCredit);

        const balanceError = document.getElementById('journal-balance-error');
        if (totalDebit !== totalCredit) {
            balanceError.classList.remove('hidden');
        } else {
            balanceError.classList.add('hidden');
        }
    };

    const setupJournalModal = () => {
        const modal = document.getElementById('journal-entry-modal');
        if (!modal) return;

        document.getElementById('add-journal-btn').addEventListener('click', () => {
            document.getElementById('journal-entry-form').reset();
            document.getElementById('journal-id-input').value = '';
            document.getElementById('journal-lines-body').innerHTML = '';
            document.getElementById('journal-modal-title').textContent = 'Buat Jurnal Baru';
            addJournalLine();
            addJournalLine();
            updateJournalTotals();
            modal.classList.remove('hidden');
        });

        document.getElementById('close-journal-modal').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('cancel-journal-modal').addEventListener('click', () => modal.classList.add('hidden'));
        document.getElementById('add-journal-line-btn').addEventListener('click', () => addJournalLine());

        document.getElementById('journal-lines-body').addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-journal-line-btn')) {
                e.target.closest('tr').remove();
                updateJournalTotals();
            }
        });

        document.getElementById('journal-lines-body').addEventListener('input', (e) => {
            if (e.target.matches('.journal-debit-input, .journal-credit-input')) {
                const row = e.target.closest('tr');
                const debitInput = row.querySelector('.journal-debit-input');
                const creditInput = row.querySelector('.journal-credit-input');
                if (e.target === debitInput && debitInput.value > 0) creditInput.value = '';
                else if (e.target === creditInput && creditInput.value > 0) debitInput.value = '';
                updateJournalTotals();
            }
        });

        document.getElementById('journal-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const journalId = document.getElementById('journal-id-input').value;
            let totalDebit = 0, totalCredit = 0, isValid = true;
            const entries = [];
            document.querySelectorAll('.journal-line-row').forEach(row => {
                const accountId = row.querySelector('.journal-account-select').value;
                const debit = parseFloat(row.querySelector('.journal-debit-input').value) || 0;
                const credit = parseFloat(row.querySelector('.journal-credit-input').value) || 0;
                if (!accountId || (debit === 0 && credit === 0)) return;
                if (debit > 0 && credit > 0) { alert('Satu baris tidak boleh memiliki nilai Debit dan Kredit sekaligus.'); isValid = false; }
                totalDebit += debit; totalCredit += credit;
                entries.push({ account_id: accountId, debit, credit });
            });
            if (!isValid) return;
            if (entries.length < 2) { alert('Jurnal harus memiliki minimal dua baris entri.'); return; }
            if (totalDebit !== totalCredit || totalDebit === 0) { alert('Total Debit dan Kredit harus seimbang dan tidak boleh nol.'); return; }
            
            const journalData = { entry_date: document.getElementById('journal-date-input').value, reference_number: document.getElementById('journal-ref-input').value, description: document.getElementById('journal-desc-input').value, entries: entries };
            
            const method = journalId ? 'PUT' : 'POST';
            const url = journalId ? `${ADMIN_API_URL}/journals/${journalId}` : `${ADMIN_API_URL}/journals`;

            try {
                await apiFetch(url, { method, body: JSON.stringify(journalData) });
                alert(`Jurnal berhasil ${journalId ? 'diperbarui' : 'disimpan'}.`);
                modal.classList.add('hidden');
                loadGeneralJournal(1);
            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); }
        });
    };

    let currentJournalFilters = {};
    const loadGeneralJournal = async (page = 1) => {
        const tableBody = document.getElementById('journal-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">Memuat jurnal...</td></tr>`;
        try {
            const filters = { ...currentJournalFilters, page, limit: 10 };
            const queryParams = new URLSearchParams(filters).toString();
            const { data, pagination } = await apiFetch(`${ADMIN_API_URL}/journals?${queryParams}`);
            tableBody.innerHTML = '';
            if (data.length === 0) { tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">Tidak ada data jurnal.</td></tr>`; renderPagination('journal-pagination-controls', { totalItems: 0 }, loadGeneralJournal); return; }
            data.forEach(journal => {
                const row = tableBody.insertRow();
                row.innerHTML = `<td class="px-6 py-4 text-sm text-gray-500">${formatDate(journal.entry_date)}</td><td class="px-6 py-4 text-sm text-gray-500">${journal.reference_number || '-'}</td><td class="px-6 py-4 text-sm text-gray-900">${journal.description}</td><td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(journal.total_debit)}</td><td class="px-6 py-4 text-sm text-gray-500 text-right">${formatCurrency(journal.total_credit)}</td><td class="px-6 py-4 text-sm font-medium"><button class="journal-details-btn text-blue-600 hover:underline" data-id="${journal.id}">Detail</button></td>`;
            });
            renderPagination('journal-pagination-controls', pagination, loadGeneralJournal);
        } catch (error) {
            console.error('Error loading general journal:', error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">${error.message}</td></tr>`;
        }
    };

    const journalFilterForm = document.getElementById('journal-filter-form');
    if (journalFilterForm) {
        journalFilterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            currentJournalFilters = {
                search: document.getElementById('journal-filter-search').value,
                startDate: document.getElementById('journal-filter-start-date').value,
                endDate: document.getElementById('journal-filter-end-date').value,
            };
            Object.keys(currentJournalFilters).forEach(key => !currentJournalFilters[key] && delete currentJournalFilters[key]);
            loadGeneralJournal(1);
        });
        document.getElementById('journal-filter-reset-btn')?.addEventListener('click', () => {
            journalFilterForm.reset();
            currentJournalFilters = {};
            loadGeneralJournal(1);
        });
    }

    const showJournalDetails = async (journalId) => {
        currentJournalId = journalId;
        const modal = document.getElementById('journal-details-modal');
        if (!modal) return;

        const contentEl = document.getElementById('journal-details-content');

        modal.classList.remove('hidden');
        contentEl.innerHTML = '<p class="text-center py-8">Memuat detail jurnal...</p>';

        try {
            const { header, entries } = await apiFetch(`${ADMIN_API_URL}/journals/${journalId}`);

            contentEl.innerHTML = `
                <div class="mb-4 space-y-2">
                    <p><span class="font-semibold">Tanggal:</span> ${formatDate(header.entry_date)}</p>
                    <p><span class="font-semibold">No. Referensi:</span> ${header.reference_number || '-'}</p>
                    <p><span class="font-semibold">Deskripsi:</span> ${header.description}</p>
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Akun</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Kredit</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${entries.map(entry => `
                                <tr>
                                    <td class="px-4 py-2 text-sm text-gray-900">${entry.account_number} - ${entry.account_name}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(entry.debit)}</td>
                                    <td class="px-4 py-2 text-sm text-gray-500 text-right">${formatCurrency(entry.credit)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot class="bg-gray-50 font-semibold">
                            <tr>
                                <td class="px-4 py-2 text-right">Total</td>
                                <td class="px-4 py-2 text-right">${formatCurrency(header.total_debit)}</td>
                                <td class="px-4 py-2 text-right">${formatCurrency(header.total_credit)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        } catch (error) {
            contentEl.innerHTML = `<p class="text-red-500 text-center py-8">${error.message}</p>`;
        }
    };

    const openJournalForEditing = async (journalId) => {
        const entryModal = document.getElementById('journal-entry-modal');
        if (!entryModal) return;

        try {
            const { header, entries } = await apiFetch(`${ADMIN_API_URL}/journals/${journalId}`);

            document.getElementById('journal-details-modal').classList.add('hidden'); // Close detail modal
            entryModal.classList.remove('hidden'); // Open entry modal

            document.getElementById('journal-modal-title').textContent = 'Ubah Jurnal';
            document.getElementById('journal-id-input').value = header.id;
            document.getElementById('journal-date-input').value = header.entry_date.split('T')[0];
            document.getElementById('journal-ref-input').value = header.reference_number || '';
            document.getElementById('journal-desc-input').value = header.description;

            const linesBody = document.getElementById('journal-lines-body');
            linesBody.innerHTML = '';
            for (const entry of entries) {
                await addJournalLine(entry.account_id, entry.debit, entry.credit);
            }
            updateJournalTotals();
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };

    const deleteJournal = async (journalId) => {
        if (!confirm('Anda yakin ingin menghapus jurnal ini? Tindakan ini tidak dapat dibatalkan.')) return;
        try {
            await apiFetch(`${ADMIN_API_URL}/journals/${journalId}`, { method: 'DELETE' });
            alert('Jurnal berhasil dihapus.');
            document.getElementById('journal-details-modal').classList.add('hidden');
            loadGeneralJournal(1);
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        }
    };

    // Event delegation untuk tombol "Lihat Detail" pesanan
    document.getElementById('pending-orders-table-body')?.addEventListener('click', (e) => {
        if (e.target.matches('.view-order-details-btn')) {
            showOrderDetailsModal(e.target.dataset.orderId);
        } else if (e.target.matches('.verify-order-btn')) {
            showCashierVerificationModal(e.target.dataset.orderId);
        } else if (e.target.matches('.cancel-order-btn')) {
            const orderId = e.target.dataset.orderId;
            if (confirm(`Anda yakin ingin membatalkan pesanan #${orderId}? Stok barang akan dikembalikan.`)) {
                apiFetch(`${API_URL}/public/sales/${orderId}/cancel`, { method: 'POST' })
                    .then(() => {
                        alert('Pesanan berhasil dibatalkan.');
                        loadPendingOrders(); // Muat ulang daftar pesanan
                    })
                    .catch(err => alert(`Gagal membatalkan: ${err.message}`));
            }
        }
    });

    // --- FUNGSI UNTUK TAB DI HALAMAN KELOLA PRODUK ---
    const productTabButtons = document.querySelectorAll('.product-tab-btn');
    const productTabContents = document.querySelectorAll('.product-tab-content');

    productTabButtons.forEach(button => {
        button.addEventListener('click', e => {
            e.preventDefault();
            productTabButtons.forEach(btn => {
                btn.classList.remove('border-red-500', 'text-red-600');
                btn.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            });
            button.classList.add('border-red-500', 'text-red-600');
            const targetId = button.dataset.target;
            productTabContents.forEach(content => content.classList.toggle('hidden', content.id !== targetId));
            const shopType = targetId.split('-')[1]; // e.g., 'products-sembako-tab' -> 'sembako'
            loadShopProducts(shopType);
        });
    });

    // --- FUNGSI UNTUK NAVIGASI KONTEN UTAMA ---
    const switchContent = (targetId, params = {}, clickedLink = null) => {
        contentSections.forEach(section => {
            section.classList.remove('active');
        });

        // Tampilkan konten yang dituju
        const targetSection = document.getElementById(`${targetId}-content`);
        if (targetSection) {
            targetSection.classList.add('active');
        }
        
        // --- FIX: Ambil judul halaman dari elemen yang diklik ---
        let pageTitleText = 'Beranda';
        if (clickedLink) {
            // Kartu biasanya punya <h3>, link sidebar punya <span>
            const titleElement = clickedLink.querySelector('h3, span');
            if (titleElement) pageTitleText = titleElement.textContent.trim();
        }
        document.getElementById('page-title').textContent = pageTitleText;

        if (targetId === 'admin-profile') loadAdminProfileData();
        // Panggil fungsi load data yang sesuai
        if (targetId === 'dashboard') loadDashboardData();
        if (targetId === 'members') loadMembers(1);
        if (targetId === 'savings') loadSavings();
        if (targetId === 'testimonials') loadTestimonials();
        if (targetId === 'general-journal') {
            // Check if params are passed from another page (like the dashboard chart)
            if (params.startDate && params.endDate) {
                document.getElementById('journal-filter-start-date').value = params.startDate;
                document.getElementById('journal-filter-end-date').value = params.endDate;
                currentJournalFilters = { startDate: params.startDate, endDate: params.endDate, search: '' };
            }
            loadGeneralJournal(1);
        }
        if (targetId === 'receivables-ledger') loadReceivablesLedger();
        if (targetId === 'logistics-card') loadLogistics();
        if (targetId === 'stock-card') loadStockCard();
        if (targetId === 'payable-card') loadPayables();        
        if (targetId === 'bulk-savings-input') {
            setupBulkSavingsPage();
            handleDownloadSavingsTemplate();
            handleBulkSavingsUpload();
        }
        if (targetId === 'post-shu') setupPostShuPage();
    if (targetId === 'monthly-closing') setupMonthlyClosingPage();
        if (targetId === 'loans') loadLoans();
        if (targetId === 'approvals') {
            // Data untuk tab lain dimuat saat tab diklik.
        // FIX: Reset to the main approval view every time the page is loaded.
            // This prevents a detail tab from staying open when navigating away and back.
            const mainView = document.getElementById('approvals-main-view');
            const tabContents = document.querySelectorAll('.approval-tab-content');
            if (mainView) {
                mainView.classList.remove('hidden');
            }
            if (tabContents) tabContents.forEach(content => content.classList.add('hidden'));
            loadApprovalCounts(); // Load the counts for the cards.
        } else if (targetId === 'bulk-savings-input') {
            setupBulkSavingsPage();
        }
        if (targetId === 'manage-users-roles') {
            loadUsers(); renderRolePermissions(); } if (targetId === 'accounting' || targetId === 'bulk-savings-input' || targetId === 'reports' || targetId === 'usaha-koperasi') {
            // Tidak ada data yang perlu dimuat saat halaman menu atau form ditampilkan
        }

        // Load data for settings pages
        if (targetId.startsWith('manage-')) {
            const loadFunction = { 
                'manage-employers': loadEmployers, 'manage-positions': loadPositions, 'manage-saving-types': loadSavingTypes, 
                'manage-loan-types': loadLoanTypes, 'manage-loan-terms': loadLoanTerms, 
                'manage-accounts': () => { loadAccounts(); loadAccountTypes(); },
                'manage-suppliers': () => { loadSuppliers(); loadMasterProducts(); masterProductOptionsCache = null; }, // Load both and clear cache
                'manage-cooperative-profile': loadCooperativeProfile, 'manage-saving-account-mapping': loadSavingAccountMapping, 
                'manage-loan-account-mapping': loadLoanAccountMapping, 'manage-shu-rules': loadShuRules, 'manage-announcements': loadAnnouncements, 
                'manage-partners': setupPartnerManagement, 
                'manage-products': () => { document.querySelector('.product-tab-btn[data-target="products-sembako-tab"]').click(); } 
            }[targetId];
            if (loadFunction) loadFunction();
        }

        // Load data for shop pages
        if (targetId.startsWith('toko-')) {
            const shopType = targetId.replace('toko-', '');
            loadShopProducts(shopType);
            if (shopType === 'sembako') loadPendingOrders();
        }

        // Perbarui status 'active' pada link sidebar dan tombol menu
        sidebarLinks.forEach(link => {
            link.classList.remove('active');
        });
        const directLink = document.querySelector(`.sidebar-link[data-target="${targetId}"]`);
        
        // Activate the direct link if it exists
        if (directLink) {
            directLink.classList.add('active');
        }

        // Handle parent menu activation
        let parentMenuButton = null;
        if (targetId.startsWith('manage-')) {
            // For settings sub-pages, or any page that should activate the 'Settings' menu
            parentMenuButton = document.querySelector('.sidebar-link[data-target="settings"]');        
        } else if (targetId.startsWith('report-')) {
            if (targetId === 'report-income-statement') {
                setupIncomeStatementReport();
            } else if (targetId === 'report-balance-sheet') {
                setupBalanceSheetReport();
            } else if (targetId === 'report-monthly-closing-status') {
                setupMonthlyClosingStatusReport();
            } else if (targetId === 'report-cash-flow') {
                setupCashFlowReport();
            } else if (targetId === 'report-sales') {
                setupSalesReport();
            } else if (targetId === 'report-general-ledger') {
                setupGeneralLedgerReport();
            } else if (targetId === 'report-loan-interest') {
                setupLoanInterestReport();
            }
            // For report sub-pages
            parentMenuButton = document.querySelector('.sidebar-link[data-target="reports"]');
        } else if (['toko-sembako'].includes(targetId)) { // For Usaha Koperasi sub-pages
            parentMenuButton = document.querySelector('.sidebar-link[data-target="usaha-koperasi"]');
        } else if (targetId.startsWith('bulk-') || ['general-journal', 'receivables-ledger', 'logistics-card', 'stock-card', 'payable-card', 'post-shu', 'monthly-closing'].includes(targetId)) {
            // For accounting sub-pages
            parentMenuButton = document.querySelector('.sidebar-link[data-target="accounting"]');
        }

        if(parentMenuButton) {
            parentMenuButton.classList.add('active');
        }
    };

    document.querySelectorAll('.back-to-settings-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchContent('settings');
        });
    });

    document.querySelectorAll('.back-to-dashboard-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchContent('dashboard');
        });
    });

    document.querySelectorAll('.back-to-accounting-btn').forEach(btn => {
        btn.addEventListener('click', (e) => { 
            e.preventDefault();
            switchContent('accounting');
        });
    });

    document.querySelectorAll('.back-to-reports-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            switchContent('reports');
        });
    });

    allLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.dataset.target;
            if (targetId) {
                switchContent(targetId, {}, link); // Pass the clicked link element
                // Tutup sidebar di mode mobile setelah navigasi
                if (window.innerWidth < 768 && sidebar && !sidebar.classList.contains('-translate-x-full')) {
                    toggleMenu();
                }
            }
        });
    });

    // --- FUNGSI UNTUK TAB DI HALAMAN KELOLA SUPPLIER ---
    const supplierTabBtns = document.querySelectorAll('.supplier-tab-btn');
    const supplierTabContents = document.querySelectorAll('.supplier-tab-content');

    supplierTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;
            supplierTabBtns.forEach(b => b.classList.remove('border-red-500', 'text-red-600'));
            supplierTabBtns.forEach(b => b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300'));
            btn.classList.add('border-red-500', 'text-red-600');
            btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            supplierTabContents.forEach(content => content.classList.toggle('hidden', content.id !== targetId));
        });
    });

    // --- FUNGSI UNTUK TAB DI HALAMAN KELOLA AKUN (COA) ---
    const coaTabBtns = document.querySelectorAll('.coa-tab-btn');
    const coaTabContents = document.querySelectorAll('.coa-tab-content');

    coaTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;

            coaTabBtns.forEach(b => b.classList.remove('border-red-500', 'text-red-600'));
            coaTabBtns.forEach(b => b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300'));
            btn.classList.add('border-red-500', 'text-red-600');
            btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');

            coaTabContents.forEach(content => content.classList.toggle('hidden', content.id !== targetId));
        });
    });

    // --- FUNGSI UNTUK TAB DI HALAMAN TUTUP BUKU ---
    const monthlyClosingTabBtns = document.querySelectorAll('.monthly-closing-tab-btn');
    const monthlyClosingTabContents = document.querySelectorAll('.monthly-closing-tab-content');

    if (monthlyClosingTabBtns.length > 0) {
        monthlyClosingTabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const targetId = btn.dataset.target;

                monthlyClosingTabBtns.forEach(b => {
                    b.classList.remove('border-red-500', 'text-red-600');
                    b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
                });
                btn.classList.add('border-red-500', 'text-red-600');
                btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');

                monthlyClosingTabContents.forEach(content => {
                    content.classList.toggle('hidden', content.id !== targetId);
                });

                // Load data for history tab when it's clicked
                if (targetId === 'monthly-closing-history-tab') {
                    loadMonthlyClosingHistory();
                }
            });
        });
    }

    // --- FUNGSI UNTUK TAB DI HALAMAN USER & ROLE ---
    const userRoleTabBtns = document.querySelectorAll('.user-role-tab-btn');
    const userRoleTabContents = document.querySelectorAll('.user-role-tab-content');

    userRoleTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = btn.dataset.target;
            userRoleTabBtns.forEach(b => b.classList.remove('border-red-500', 'text-red-600'));
            userRoleTabBtns.forEach(b => b.classList.add('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300'));
            btn.classList.add('border-red-500', 'text-red-600');
            btn.classList.remove('border-transparent', 'text-gray-500', 'hover:text-gray-700', 'hover:border-gray-300');
            userRoleTabContents.forEach(content => content.classList.toggle('hidden', content.id !== targetId));
        });
    });

    document.getElementById('users-table-body')?.addEventListener('click', (e) => {
        if (e.target.matches('.edit-user-btn')) {
            showEditUserModal(e.target.dataset.id);
        } else if (e.target.id === 'add-user-btn') { // Listener untuk tombol baru
            showAddUserModal();
        } else if (e.target.matches('.delete-user-btn')) {
            deleteUser(e.target.dataset.id, e.target.dataset.name);
        }
    });

    document.getElementById('manage-users-tab')?.addEventListener('click', (e) => {
        if (e.target.id === 'add-user-btn') showAddUserModal();
    });

    // Tambahkan event listener untuk tombol persetujuan simpanan dan pinjaman
    const pendingSavingsTableBody = document.getElementById('pending-savings-table-body');
    if (pendingSavingsTableBody) pendingSavingsTableBody.addEventListener('click', handleGenericApproval);
    const withdrawalsTableBody = document.getElementById('pending-withdrawals-table-body');
    if (withdrawalsTableBody) withdrawalsTableBody.addEventListener('click', handleGenericApproval);

    document.getElementById('pending-loans-table-body')?.addEventListener('click', handleGenericApproval);
    document.getElementById('pending-loan-payments-table-body')?.addEventListener('click', handleGenericApproval);
    

    // Tambahkan penutup untuk modal user-role
    document.getElementById('close-edit-user-modal')?.addEventListener('click', () => document.getElementById('edit-user-modal').classList.add('hidden'));
    document.getElementById('cancel-edit-user-modal')?.addEventListener('click', () => document.getElementById('edit-user-modal').classList.add('hidden'));

    // Event listener untuk menutup modal detail pesanan
    document.getElementById('close-order-details-modal-btn')?.addEventListener('click', () => {
        document.getElementById('order-details-modal').classList.add('hidden');
    });

    // --- EVENT LISTENERS UNTUK FILTER SIMPANAN ---
    const savingsFilterForm = document.getElementById('savings-filter-form');
    if (savingsFilterForm) {
        const savingTypeSelect = document.getElementById('savings-filter-type');
        populateDropdown(savingTypeSelect, 'savingtypes', 'id', 'name', 'Semua Tipe');

        savingsFilterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            currentSavingsFilters = {
                search: document.getElementById('savings-filter-search').value,
                savingTypeId: document.getElementById('savings-filter-type').value,
                status: document.getElementById('savings-filter-status').value,
                startDate: document.getElementById('savings-filter-start-date').value,
                endDate: document.getElementById('savings-filter-end-date').value,
            };
            // Hapus filter kosong
            Object.keys(currentSavingsFilters).forEach(key => !currentSavingsFilters[key] && delete currentSavingsFilters[key]);
            loadSavings(1);
        });
        document.getElementById('savings-filter-reset-btn').addEventListener('click', () => {
            savingsFilterForm.reset();
            currentSavingsFilters = {};
            loadSavings(1);
        });
    }

    // --- FUNGSI UNTUK UBAH & HAPUS PENGGUNA ---
    const showEditUserModal = async (userId) => {
        const modal = document.getElementById('edit-user-modal');
        const form = document.getElementById('edit-user-form');
        if (!modal || !form) return;
        const passwordContainer = document.getElementById('edit-user-password-container');

        form.reset();
        modal.classList.remove('hidden');
        document.getElementById('edit-user-modal-title').textContent = 'Memuat data pengguna...';

        try {
            const user = await apiFetch(`${ADMIN_API_URL}/members/${userId}`);
            const emailInput = document.getElementById('edit-user-email-input');

            document.getElementById('edit-user-modal-title').textContent = `Ubah Data: ${user.name}`;
            document.getElementById('edit-user-id-input').value = user.id;
            document.getElementById('edit-user-name-input').value = user.name;
            emailInput.value = user.email;
            emailInput.readOnly = true;
            emailInput.classList.add('bg-gray-100');
            document.getElementById('edit-user-phone-input').value = user.phone || '';
            passwordContainer.classList.remove('hidden'); // Tampilkan field password saat edit
            document.getElementById('edit-user-password-input').required = false; // Password tidak wajib diisi saat edit
            document.getElementById('edit-user-status-select').value = user.status;
            document.getElementById('edit-user-role-select').value = user.role;

            const companySelect = document.getElementById('edit-user-company-select');
            const positionSelect = document.getElementById('edit-user-position-select');
            
            await populateDropdown(companySelect, 'employers', 'id', 'name', 'Perusahaan');
            await populateDropdown(positionSelect, 'positions', 'id', 'name', 'Jabatan');

            companySelect.value = user.company_id || '';
            positionSelect.value = user.position_id || '';

        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
            modal.classList.add('hidden');
        }
    };

    const showAddUserModal = async () => {
        const modal = document.getElementById('edit-user-modal');
        const form = document.getElementById('edit-user-form');
        if (!modal || !form) return;
        const passwordContainer = document.getElementById('edit-user-password-container');
        const emailInput = document.getElementById('edit-user-email-input');

        form.reset();
        modal.classList.remove('hidden');

        document.getElementById('edit-user-modal-title').textContent = 'Tambah User Baru';
        document.getElementById('edit-user-id-input').value = ''; // Kosongkan ID

        // Kosongkan dan aktifkan field email
        emailInput.value = '';
        emailInput.readOnly = false;
        emailInput.classList.remove('bg-gray-100');

        // Tampilkan dan wajibkan field password
        passwordContainer.classList.remove('hidden');
        document.getElementById('edit-user-password-input').required = true;

        // Set default values
        document.getElementById('edit-user-status-select').value = 'Active';
        document.getElementById('edit-user-role-select').value = 'akunting';

        // Populate dropdowns
        try {
            const companySelect = document.getElementById('edit-user-company-select');
            const positionSelect = document.getElementById('edit-user-position-select');
            await populateDropdown(companySelect, 'employers', 'id', 'name', 'Perusahaan');
            await populateDropdown(positionSelect, 'positions', 'id', 'name', 'Jabatan');
        } catch (error) {
            console.error("Gagal memuat dropdown untuk modal user:", error);
        }
    };

    document.getElementById('edit-user-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('edit-user-id-input').value;
        const submitBtn = e.target.querySelector('button[type="submit"]');
        const isNewUser = !userId;
        const userData = {
            name: document.getElementById('edit-user-name-input').value,
            phone: document.getElementById('edit-user-phone-input').value,
            company_id: document.getElementById('edit-user-company-select').value,
            position_id: document.getElementById('edit-user-position-select').value,
            status: document.getElementById('edit-user-status-select').value,
            role: document.getElementById('edit-user-role-select').value,
        };

        if (isNewUser) {
            userData.email = document.getElementById('edit-user-email-input').value;
            userData.password = document.getElementById('edit-user-password-input').value;
        } else {
            const password = document.getElementById('edit-user-password-input').value;
            if (password) userData.password = password; // Hanya kirim password jika diisi
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan...';

        try {
            const url = isNewUser ? `${ADMIN_API_URL}/users` : `${ADMIN_API_URL}/users/${userId}`;
            await apiFetch(url, { method: isNewUser ? 'POST' : 'PUT', body: JSON.stringify(userData) });
            alert(`Data pengguna berhasil ${isNewUser ? 'ditambahkan' : 'diperbarui'}.`);
            document.getElementById('edit-user-modal').classList.add('hidden');
            loadUsers();
        } catch (error) {
            alert(`Terjadi kesalahan: ${error.message}`);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Simpan Perubahan';
        }
    });

    const deleteUser = async (userId, userName) => {
        if (!confirm(`Anda yakin ingin menghapus pengguna "${userName}"? Tindakan ini tidak dapat dibatalkan dan akan menghapus data pengguna secara permanen.`)) return;
        try {
            await apiFetch(`${ADMIN_API_URL}/users/${userId}`, { method: 'DELETE' });
            alert(`Pengguna "${userName}" berhasil dihapus.`);
            loadUsers();
        } catch (error) { alert(`Terjadi kesalahan: ${error.message}`); }
    };

    // --- FUNGSI UNTUK GANTI PASSWORD ---
    const setupChangePassword = () => {
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
                const result = await apiFetch(`${API_URL}/member/change-password`, {
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

    // --- FUNGSI UNTUK LAPORAN JASA PINJAMAN ---
    const setupLoanInterestReport = () => {
        const generateBtn = document.getElementById('generate-li-report-btn');
        const downloadBtn = document.getElementById('download-li-pdf-btn');
        const previewContainer = document.getElementById('li-report-preview');
        const startDateInput = document.getElementById('li-start-date');
        const endDateInput = document.getElementById('li-end-date');

        if (!generateBtn) return;

        let reportDataCache = null;

        // Set default dates to the current month
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startDateInput.value = firstDay.toISOString().split('T')[0];
        endDateInput.value = today.toISOString().split('T')[0];

        const renderReport = (data) => {
            reportDataCache = data;
            const { summary, details } = data;

            const summaryHtml = `
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center mb-8">
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Total Pendapatan Bunga</p>
                        <p class="text-2xl font-bold text-green-600">${formatCurrency(summary.totalInterestIncome)}</p>
                    </div>
                    <div class="bg-gray-50 p-4 rounded-lg">
                        <p class="text-sm text-gray-600">Jumlah Transaksi Pembayaran</p>
                        <p class="text-2xl font-bold text-blue-600">${summary.totalPaymentsCount}</p>
                    </div>
                </div>
            `;

            const detailsHtml = `
                <h3 class="text-lg font-semibold text-gray-800 mb-2">Rincian Pendapatan per Anggota</h3>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="min-w-full divide-y divide-gray-200">
                        <thead class="bg-gray-50">
                            <tr>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nama Anggota</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">No. Pinjaman</th>
                                <th class="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Angsuran Ke-</th>
                                <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tanggal Bayar</th>
                                <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pendapatan Bunga</th>
                            </tr>
                        </thead>
                        <tbody class="bg-white divide-y divide-gray-200">
                            ${details.map(d => `
                                <tr>
                                    <td class="px-6 py-4 text-sm font-medium text-gray-900">${d.member_name}</td>
                                    <td class="px-6 py-4 text-sm text-gray-500">${d.loan_id}</td>
                                    <td class="px-6 py-4 text-sm text-gray-500 text-center">${d.installment_number}</td>
                                    <td class="px-6 py-4 text-sm text-gray-500">${formatDate(d.payment_date)}</td>
                                    <td class="px-6 py-4 text-sm text-green-600 font-semibold text-right">${formatCurrency(d.interest_amount)}</td>
                                </tr>
                            `).join('')}
                            ${details.length === 0 ? '<tr><td colspan="5" class="text-center py-4 text-gray-500">Tidak ada pendapatan bunga pada periode ini.</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            `;

            previewContainer.innerHTML = summaryHtml + detailsHtml;
            downloadBtn.classList.remove('hidden');
        };

        generateBtn.addEventListener('click', async () => {
            const startDate = startDateInput.value;
            const endDate = endDateInput.value;

            if (!startDate || !endDate) {
                alert('Silakan pilih periode tanggal.');
                return;
            }

            generateBtn.disabled = true;
            generateBtn.textContent = 'Memuat...';
            previewContainer.innerHTML = '<p class="text-center text-gray-500">Menghasilkan laporan...</p>';
            downloadBtn.classList.add('hidden');

            try {
                const data = await apiFetch(`${ADMIN_API_URL}/reports/loan-interest?startDate=${startDate}&endDate=${endDate}`);
                renderReport(data);
            } catch (error) {
                previewContainer.innerHTML = `<p class="text-center text-red-500">${error.message}</p>`;
            } finally {
                generateBtn.disabled = false;
                generateBtn.textContent = 'Tampilkan Laporan';
            }
        });

        downloadBtn.addEventListener('click', async () => {
            if (!reportDataCache) {
                alert('Silakan hasilkan laporan terlebih dahulu.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const { summary, details } = reportDataCache;
            const companyInfo = await apiFetch(`${ADMIN_API_URL}/company-info`);

            doc.setFontSize(16); doc.setFont('helvetica', 'bold');
            doc.text(companyInfo.name.toUpperCase() || 'KOPERASI', 105, 15, { align: 'center' });
            doc.setFontSize(12); doc.text('Laporan Pendapatan Jasa Pinjaman', 105, 22, { align: 'center' });
            doc.setFontSize(10); doc.setFont('helvetica', 'normal');
            doc.text(`Periode: ${formatDate(startDateInput.value)} - ${formatDate(endDateInput.value)}`, 105, 28, { align: 'center' });

            const head = [['Anggota', 'No. Pinjaman', 'Angsuran Ke-', 'Tgl Bayar', 'Pendapatan Bunga']];
            const body = details.map(d => [d.member_name, d.loan_id, d.installment_number, formatDate(d.payment_date), formatCurrency(d.interest_amount)]);

            doc.autoTable({
                startY: 35,
                head: head,
                body: body,
                theme: 'grid',
                headStyles: { fillColor: [153, 27, 27] },
                columnStyles: { 4: { halign: 'right' } },
                didDrawPage: (data) => {
                    // Footer
                    doc.setFontSize(10);
                    doc.text(`Total Pendapatan Bunga: ${formatCurrency(summary.totalInterestIncome)}`, data.settings.margin.left, doc.internal.pageSize.height - 10);
                }
            });

            doc.save(`Laporan_Jasa_Pinjaman_${startDateInput.value}_${endDateInput.value}.pdf`);
        });
    };

    // --- FUNGSI UNTUK EKSPOR COA KE EXCEL ---
    const setupCoaExport = () => {
        const downloadBtn = document.getElementById('download-accounts-excel-btn');
        if (!downloadBtn) return;

        downloadBtn.addEventListener('click', async () => {
            const originalText = downloadBtn.textContent;
            downloadBtn.disabled = true;
            downloadBtn.textContent = 'Memproses...';

            try {
                // Use raw fetch for file downloads, not the JSON-parsing apiFetch
                const token = localStorage.getItem('token');
                const response = await fetch(`${ADMIN_API_URL}/accounts/export`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Gagal mengunduh file.' }));
                    throw new Error(errorData.error);
                }

                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                a.download = 'Daftar_Akun_COA.xlsx';
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();

            } catch (error) { alert(`Terjadi kesalahan: ${error.message}`);
            } finally { downloadBtn.disabled = false; downloadBtn.textContent = originalText; }
        });
    };

    // --- FUNGSI UNTUK IMPOR COA DARI EXCEL ---
    const setupCoaImport = () => {
        const importBtn = document.getElementById('import-accounts-excel-btn');
        const fileInput = document.getElementById('import-accounts-excel-input');
        if (!importBtn || !fileInput) return;

        importBtn.addEventListener('click', () => {
            fileInput.click(); // Memicu input file yang tersembunyi
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const originalHtml = importBtn.innerHTML;
            importBtn.disabled = true;
            importBtn.innerHTML = 'Mengunggah...';

            const formData = new FormData();
            formData.append('accountsFile', file); // 'accountsFile' harus cocok dengan nama field di backend

            try {
                const result = await apiFetch(`${ADMIN_API_URL}/accounts/import`, { method: 'POST', body: formData });
                
                alert(result.message || 'File berhasil diimpor.');
                loadAccounts(); // Muat ulang tabel akun
            } catch (error) {
                alert(`Terjadi kesalahan: ${error.message}`);
            } finally {
                importBtn.disabled = false; importBtn.innerHTML = originalHtml; fileInput.value = ''; // Reset input file
            }
        });
    };

    // --- INISIALISASI ---
    const initializeHeader = async () => {
        try {
            const info = await apiFetch(`${ADMIN_API_URL}/company-info`);
            updateHeaderDisplay(info);
        } catch (error) {
            console.error('Gagal memuat info koperasi untuk header:', error);
        }

        try {
            const profile = await apiFetch(`${API_URL}/member/profile`);
            const iconEl = document.getElementById('header-profile-icon');
            if (iconEl && profile.selfie_photo_path) {
                const webPath = profile.selfie_photo_path.replace(/\\/g, '/');
                const photoUrl = `${API_URL.replace('/api', '')}${webPath.startsWith('/') ? '' : '/'}${webPath}`;
                iconEl.src = photoUrl;
            }
        } catch (error) {
            console.error('Gagal memuat foto profil untuk header:', error);
        }
    };

    // --- FUNGSI UNTUK DROPDOWN PROFIL ---
    const setupProfileDropdown = () => {
        const profileButton = document.getElementById('user-profile-button');
        const dropdown = document.getElementById('user-dropdown');

        if (!profileButton || !dropdown) return;

        profileButton.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        // Tutup dropdown jika diklik di luar
        document.addEventListener('click', () => {
            dropdown.classList.add('hidden');
        });

            // Handle klik di dalam dropdown
            dropdown.addEventListener('click', (e) => {
                e.preventDefault();
                const targetLink = e.target.closest('a');
                if (!targetLink) return;

                if (targetLink.dataset.target) {
                    switchContent(targetLink.dataset.target);
                } else if (targetLink.id === 'change-password-btn') {
                    const modal = document.getElementById('change-password-modal');
                    if (modal) modal.classList.remove('hidden');
                } else if (targetLink.id === 'header-logout-button') {
                    if (confirm('Anda yakin ingin keluar?')) {
                        localStorage.clear();
                        window.location.href = 'login.html';
                    }
                }
                dropdown.classList.add('hidden'); // Sembunyikan dropdown setelah aksi
            });
    };

    // --- FUNGSI UNTUK LOGOUT ---
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

    const initializeApp = async () => {
        await checkAdminAuth(); // Tunggu hak akses dimuat
        initializeHeader();
        setupProfileDropdown(); // Siapkan dropdown profil
        setupChangePassword(); // Siapkan fungsi ganti password
        setupDashboardFilters(); // Siapkan filter untuk grafik dasbor
        handleBulkSavingsUpload();
        handleDownloadSavingsTemplate();
        setupJournalModal();
        setupCashierVerificationModalListeners();
        setupLogisticsModal();
        setupCoaExport();
        setupNotificationSystem(); // Panggil fungsi setup notifikasi
        setupCoaImport();
        document.getElementById('close-journal-details-modal')?.addEventListener('click', () => document.getElementById('journal-details-modal').classList.add('hidden'));
        setupApprovalCards();
    
        // Pindahkan event listener yang lebih spesifik ke sini untuk kerapian
        document.getElementById('close-order-details-modal-btn')?.addEventListener('click', () => document.getElementById('order-details-modal').classList.add('hidden'));

        setupLogout();

        // Muat konten awal
        switchContent('dashboard');
    };

    initializeApp();
});