import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', function() {
    // --- Scroll Animation ---
    const scrollObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('opacity-100')) {
                entry.target.classList.add('opacity-100', '!translate-y-0');
                entry.target.classList.remove('opacity-0', 'translate-y-5');
                observer.unobserve(entry.target); // Stop observing after animation
            }
        });
    }, {
        threshold: 0.1
    });

    document.querySelectorAll('.scroll-animate').forEach(el => scrollObserver.observe(el));

    // --- Fungsionalitas Sidebar Mobile Baru ---
    const mobileMenuButton = document.getElementById('mobile-menu-button');
    const mobileSidebar = document.getElementById('mobile-sidebar');
    const closeSidebarButton = document.getElementById('close-sidebar-button');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mobileMenuLinks = document.querySelectorAll('.mobile-menu-link');

    function openSidebar() {
        if (!mobileSidebar || !sidebarOverlay) return;
        mobileSidebar.classList.remove('-translate-x-full');
        mobileSidebar.classList.add('translate-x-0');
        sidebarOverlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden'; // Mencegah scroll di background
    }

    function closeSidebar() {
        if (!mobileSidebar || !sidebarOverlay) return;
        mobileSidebar.classList.remove('translate-x-0');
        mobileSidebar.classList.add('-translate-x-full');
        sidebarOverlay.classList.add('hidden');
        document.body.style.overflow = ''; // Mengizinkan scroll kembali
    }

    if (mobileMenuButton && mobileSidebar && closeSidebarButton && sidebarOverlay) {
        mobileMenuButton.addEventListener('click', openSidebar);
        closeSidebarButton.addEventListener('click', closeSidebar);
        sidebarOverlay.addEventListener('click', closeSidebar);
        
        // Menutup sidebar saat link di dalamnya diklik
        mobileMenuLinks.forEach(link => {
            link.addEventListener('click', closeSidebar);
        });
    }

    // --- Toko Online Dropdown ---
    const tokoDropdownButton = document.getElementById('toko-dropdown-button');
    const tokoDropdownMenu = document.getElementById('toko-dropdown-menu');

    if (tokoDropdownButton && tokoDropdownMenu) {
        tokoDropdownButton.addEventListener('click', (event) => {
            event.stopPropagation(); // Mencegah window click event terpicu
            tokoDropdownMenu.classList.toggle('hidden');
        });

        // Tutup dropdown jika diklik di luar
        window.addEventListener('click', function(e) {
            if (!tokoDropdownButton.contains(e.target) && !tokoDropdownMenu.contains(e.target)) {
                tokoDropdownMenu.classList.add('hidden');
            }
        });
    }

    // --- Mobile Toko Dropdown ---
    const mobileTokoDropdownButton = document.getElementById('mobile-toko-dropdown-button');
    const mobileTokoDropdownMenu = document.getElementById('mobile-toko-dropdown-menu');

    if (mobileTokoDropdownButton && mobileTokoDropdownMenu) {
        mobileTokoDropdownButton.addEventListener('click', (event) => {
            event.stopPropagation();
            mobileTokoDropdownMenu.classList.toggle('hidden');
            // Animasi ikon panah
            const icon = mobileTokoDropdownButton.querySelector('svg');
            icon.classList.toggle('rotate-180');
        });
    }

    // --- Loan Simulation ---
    const loanContainer = document.getElementById('pinjaman');
    if (loanContainer) {
        const savingsSlider = document.getElementById('savingsSlider');
        const savingsInput = document.getElementById('savingsInput');
        const tenorInput = document.getElementById('tenor');
        const tenorBtns = document.querySelectorAll('.tenor-btn');
        const interestRateInput = document.getElementById('interest-rate');
        const plafonText = document.getElementById('plafonText');
        const cicilanText = document.getElementById('cicilanText');
        const amortizationSection = document.getElementById('amortization-section');
        const amortizationTableBody = document.getElementById('amortization-table-body');
        const amortizationTableFooter = document.getElementById('amortization-table-footer');
        const downloadPdfBtn = document.getElementById('download-amortization-pdf-btn');

        const formatCurrency = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
        const formatNumber = (value) => value.toLocaleString('id-ID');
        const parseNumber = (value) => Number(String(value).replace(/[^0-9]/g, ''));

        let amortizationData = []; // Cache for CSV export

        const calculateLoan = () => {
            const savings = parseNumber(savingsInput.value);
            const tenor = parseInt(tenorInput.value, 10);
            const annualInterestRate = parseFloat(interestRateInput.value);

            if (isNaN(savings) || isNaN(tenor) || isNaN(annualInterestRate)) return;

            const plafon = savings * 1.5;
            plafonText.textContent = formatCurrency(plafon);

            // Calculate the first installment to show in the summary (using sliding rate)
            const monthlyInterestRate = (annualInterestRate / 100) / 12;
            const principalComponent = plafon > 0 && tenor > 0 ? plafon / tenor : 0;
            const firstInterestComponent = plafon * monthlyInterestRate;
            const firstInstallment = principalComponent + firstInterestComponent;

            cicilanText.textContent = formatCurrency(firstInstallment);

            generateAmortization(plafon, tenor, annualInterestRate);
        };

        const generateAmortization = (principal, tenor, annualInterestRate) => {
            amortizationData = []; // Clear cache
            if (principal <= 0 || tenor <= 0) {
                amortizationSection.classList.add('hidden');
                return;
            }
            amortizationSection.classList.remove('hidden');
            amortizationTableBody.innerHTML = '';
            amortizationTableFooter.innerHTML = '';

            const monthlyInterestRate = (annualInterestRate / 100) / 12;
            const principalComponent = principal / tenor;
            
            let remainingBalance = principal;
            let totalPrincipalPaid = 0, totalInterestPaid = 0, totalInstallmentPaid = 0;

            for (let i = 1; i <= tenor; i++) {
                const interestComponent = remainingBalance * monthlyInterestRate;
                const totalInstallment = principalComponent + interestComponent;
                remainingBalance -= principalComponent;

                totalPrincipalPaid += principalComponent;
                totalInterestPaid += interestComponent;
                totalInstallmentPaid += totalInstallment;

                const rowData = {
                    bulan: i,
                    pokok: principalComponent,
                    bunga: interestComponent,
                    total: totalInstallment,
                    sisa: remainingBalance < 1 ? 0 : remainingBalance
                };
                amortizationData.push(rowData);

                const rowHtml = `<tr><td class="px-6 py-3 text-sm text-gray-500 text-center">${rowData.bulan}</td><td class="px-6 py-3 text-sm text-gray-500 text-right">${formatCurrency(rowData.pokok)}</td><td class="px-6 py-3 text-sm text-gray-500 text-right">${formatCurrency(rowData.bunga)}</td><td class="px-6 py-3 text-sm font-semibold text-gray-800 text-right">${formatCurrency(rowData.total)}</td><td class="px-6 py-3 text-sm text-gray-500 text-right">${formatCurrency(rowData.sisa)}</td></tr>`;
                amortizationTableBody.innerHTML += rowHtml;
            }

            const footerRow = `<tr><td class="px-6 py-3 text-left text-xs uppercase font-bold">Total</td><td class="px-6 py-3 text-sm font-bold text-right">${formatCurrency(totalPrincipalPaid)}</td><td class="px-6 py-3 text-sm font-bold text-right">${formatCurrency(totalInterestPaid)}</td><td class="px-6 py-3 text-sm font-bold text-right">${formatCurrency(totalInstallmentPaid)}</td><td></td></tr>`;
            amortizationTableFooter.innerHTML = footerRow;
        };

        savingsSlider.addEventListener('input', () => {
            savingsInput.value = formatNumber(savingsSlider.value);
            calculateLoan();
        });

        savingsInput.addEventListener('blur', () => {
            const value = parseNumber(savingsInput.value);
            savingsSlider.value = value;
            savingsInput.value = formatNumber(value);
            calculateLoan();
        });

        tenorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tenorBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                tenorInput.value = btn.dataset.tenor;
                calculateLoan();
            });
        });

        interestRateInput.addEventListener('input', calculateLoan);

        downloadPdfBtn.addEventListener('click', () => {
            if (amortizationData.length === 0) return;

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            const tableColumn = ["Bulan", "Cicilan Pokok", "Bunga", "Total Cicilan", "Sisa Pinjaman"];
            const tableRows = [];

            amortizationData.forEach(item => {
                const row = [
                    item.bulan,
                    formatCurrency(item.pokok),
                    formatCurrency(item.bunga),
                    formatCurrency(item.total),
                    formatCurrency(item.sisa)
                ];
                tableRows.push(row);
            });

            doc.autoTable({
                head: [tableColumn],
                body: tableRows,
                startY: 20,
                headStyles: { fillColor: [127, 29, 29] }, // Warna merah KOPKAKA
            });
            doc.text("Estimasi Rincian Cicilan Pinjaman", 14, 15);
            doc.save("estimasi_cicilan.pdf");
        });

        // Initial calculation
        calculateLoan();
    }

    // --- SHU Simulation ---
    const shuContainer = document.getElementById('shu');
    if (shuContainer) {
        const shuInputs = shuContainer.querySelectorAll('.shu-input');
        const shuTotalKoperasiEl = document.getElementById('shuTotalKoperasi');
        const shuPersenJasaEl = document.getElementById('shuPersenJasa');
        const shuPersenModalEl = document.getElementById('shuPersenModal');
        const shuTotalTransaksiEl = document.getElementById('shuTotalTransaksi');
        const shuTotalSimpananEl = document.getElementById('shuTotalSimpanan');
        const shuTransaksiAndaEl = document.getElementById('shuTransaksiAnda');
        const shuSimpananAndaEl = document.getElementById('shuSimpananAnda');

        const shuJasaTextEl = document.getElementById('shuJasaText');
        const shuModalTextEl = document.getElementById('shuModalText');
        const shuTotalTextEl = document.getElementById('shuTotalText');

        const formatCurrency = (value) => {
            return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(value);
        };
        
        const formatNumber = (value) => {
            return value.toLocaleString('id-ID');
        }

        const parseNumber = (value) => {
            return Number(String(value).replace(/[^0-9]/g, ''));
        };

        const calculateSHU = () => {
            const totalSHU = parseNumber(shuTotalKoperasiEl.value);
            const persenJasa = parseFloat(shuPersenJasaEl.value) / 100;
            const persenModal = parseFloat(shuPersenModalEl.value) / 100;
            const totalTransaksi = parseNumber(shuTotalTransaksiEl.value);
            const totalSimpanan = parseNumber(shuTotalSimpananEl.value);
            const transaksiAnda = parseNumber(shuTransaksiAndaEl.value);
            const simpananAnda = parseNumber(shuSimpananAndaEl.value);

            if (isNaN(totalSHU) || isNaN(persenJasa) || isNaN(persenModal) || isNaN(totalTransaksi) || isNaN(totalSimpanan) || isNaN(transaksiAnda) || isNaN(simpananAnda)) {
                return;
            }

            const alokasiSHUJasa = totalSHU * persenJasa;
            const alokasiSHUModal = totalSHU * persenModal;

            const shuJasa = (totalTransaksi > 0) ? (transaksiAnda / totalTransaksi) * alokasiSHUJasa : 0;
            const shuModal = (totalSimpanan > 0) ? (simpananAnda / totalSimpanan) * alokasiSHUModal : 0;
            const totalSHUAnda = shuJasa + shuModal;

            shuJasaTextEl.textContent = formatCurrency(shuJasa);
            shuModalTextEl.textContent = formatCurrency(shuModal);
            shuTotalTextEl.textContent = formatCurrency(totalSHUAnda);
        };

        shuInputs.forEach(input => {
            if (input.getAttribute('inputmode') === 'numeric') {
                input.addEventListener('blur', (e) => {
                    const value = parseNumber(e.target.value);
                    e.target.value = isNaN(value) ? '' : formatNumber(value);
                });
            }
            input.addEventListener('input', calculateSHU);
        });

        shuInputs.forEach(input => {
             if (input.getAttribute('inputmode') === 'numeric') {
                const value = parseNumber(input.value);
                input.value = isNaN(value) ? '' : formatNumber(value);
            }
        });
        calculateSHU();
    }

    // --- Load Public Testimonials ---
    const loadPublicTestimonials = async () => {
        const container = document.getElementById('testimonials-container');
        if (!container) return;

        container.innerHTML = '<p class="text-center text-gray-500 col-span-full">Memuat testimoni...</p>';

        try {
            const response = await fetch(`${API_URL}/public/testimonials`); // This endpoint is defined in public.routes.js
            if (!response.ok) throw new Error('Gagal memuat data testimoni.');
            
            const testimonials = await response.json();
            container.innerHTML = ''; // Clear loading state

            if (testimonials.length === 0) {
                container.innerHTML = '<p class="text-center text-gray-500 col-span-full">Belum ada testimoni.</p>';
                return;
            }

            testimonials.forEach((item, index) => {
                let photoUrl = 'https://i.pravatar.cc/150?u=' + encodeURIComponent(item.name); // Fallback avatar
                if (item.photo_url) {
                    photoUrl = item.photo_url.startsWith('http') 
                        ? item.photo_url 
                        : `${API_URL.replace('/api', '')}${item.photo_url}`;
                }

                const delay = index * 200;

                const testimonialCard = `
                    <div class="scroll-animate bg-gray-50 p-8 rounded-lg shadow-md opacity-0 transform translate-y-5 transition-all duration-700 ease-out" style="transition-delay: ${delay}ms;">
                        <p class="text-gray-600 italic">"${item.text}"</p>
                        <div class="flex items-center mt-6">
                            <img class="h-12 w-12 rounded-full object-cover" src="${photoUrl}" alt="Foto ${item.name}">
                            <div class="ml-4">
                                <p class="font-semibold text-gray-800">${item.name}</p>
                                <p class="text-sm text-gray-500">${item.division || 'Anggota'}</p>
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', testimonialCard);
            });

            document.querySelectorAll('#testimonials-container .scroll-animate').forEach(el => scrollObserver.observe(el));
        } catch (error) {
            console.error('Error loading testimonials:', error);
            container.innerHTML = `<p class="text-center text-red-500 col-span-full">${error.message}</p>`;
        }
    };

    // --- Load Public Partners ---
    const loadPartners = async () => {
        const list1 = document.getElementById('partners-list-1');
        const list2 = document.getElementById('partners-list-2');
        const container = document.getElementById('logo-cloud-container');

        if (!list1 || !list2 || !container) return;

        try {
            const response = await fetch(`${API_URL}/public/partners`);
            if (!response.ok) throw new Error('Gagal memuat data mitra.');
            const partners = await response.json();

            if (partners.length === 0) {
                container.innerHTML = '<p class="text-gray-500">Belum ada mitra yang ditampilkan.</p>';
                return;
            }

            const renderList = (partners) => {
                return partners.map(partner => {
                    const logoUrl = partner.logo_url.startsWith('http') ? partner.logo_url : `${API_URL.replace('/api', '')}/${partner.logo_url}`;
                    if (partner.website_url) {
                        return `<li><a href="${partner.website_url}" target="_blank" rel="noopener noreferrer"><img src="${logoUrl}" alt="${partner.name}"></a></li>`;
                    }
                    return `<li><img src="${logoUrl}" alt="${partner.name}"></li>`;
                }).join('');
            };

            list1.innerHTML = renderList(partners);
            list2.innerHTML = renderList(partners); // Duplikasi untuk animasi scroll

        } catch (error) {
            console.error('Error loading partners:', error);
            container.innerHTML = `<p class="text-red-500 text-sm">${error.message}</p>`;
        }
    };
    loadPublicTestimonials();
    loadPartners();
});