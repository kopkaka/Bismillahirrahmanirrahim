import { API_URL } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registration-form');
    const successMessage = document.getElementById('success-message');

    // --- Elemen Alamat ---
    const provinsiSelect = document.getElementById('reg-provinsi');
    const kotaSelect = document.getElementById('reg-kota');
    const kecamatanSelect = document.getElementById('reg-kecamatan');
    const kelurahanSelect = document.getElementById('reg-kelurahan');
    const alamatDetailTextarea = document.getElementById('reg-alamat-detail');
    const perusahaanSelect = document.getElementById('reg-perusahaan');
    const jabatanSelect = document.getElementById('reg-jabatan');

    // --- Elemen Alamat Domisili ---
    const domicileSameAsKtpCheckbox = document.getElementById('domicile-same-as-ktp');
    const domicileAddressSection = document.getElementById('domicile-address-section');
    const domisiliProvinsiSelect = document.getElementById('reg-domisili-provinsi');
    const domisiliKotaSelect = document.getElementById('reg-domisili-kota');
    const domisiliKecamatanSelect = document.getElementById('reg-domisili-kecamatan');
    const domisiliKelurahanSelect = document.getElementById('reg-domisili-kelurahan');
    const domisiliAlamatDetailTextarea = document.getElementById('reg-domisili-alamat-detail');

    // --- Elemen Password ---
    const passwordInput = document.getElementById('reg-password');
    const passwordConfirmInput = document.getElementById('reg-password-confirm');
    const passwordError = document.getElementById('password-error');
    const passwordToggles = document.querySelectorAll('.password-toggle');
    const passwordStrengthText = document.getElementById('password-strength-text');
    const passwordStrengthBar = document.getElementById('password-strength-bar');

    const WILAYAH_API_URL = 'https://www.emsifa.com/api-wilayah-indonesia/api';

    // --- Fungsi untuk mengambil data wilayah ---
    async function fetchAndPopulate(url, selectElement, defaultOptionText) {
        try {
            selectElement.innerHTML = `<option value="">Memuat...</option>`;
            selectElement.disabled = true;

            const response = await fetch(url);
            if (!response.ok) throw new Error('Gagal mengambil data');
            
            const items = await response.json();

            selectElement.innerHTML = `<option value="">-- Pilih ${defaultOptionText} --</option>`;
            items.forEach(item => {
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = item.name;
                selectElement.appendChild(option);
            });
            selectElement.disabled = false;
        } catch (error) {
            console.error('Error fetching data:', error);
            selectElement.innerHTML = `<option value="">Gagal memuat data</option>`;
        }
    }

    // --- Fungsi untuk memuat data dari API ke dropdown ---
    async function populateDropdownFromAPI(endpoint, selectElement, valueKey, textKey, defaultOptionText) {
        try {
            selectElement.innerHTML = `<option value="">Memuat...</option>`;
            const response = await fetch(`${API_URL}/${endpoint}`);
            if (!response.ok) throw new Error(`Gagal memuat ${defaultOptionText}`);
            
            const data = await response.json();

            if (data.length === 0) {
                selectElement.innerHTML = `<option value="">-- Tidak ada data ${defaultOptionText} --</option>`;
                return;
            }
            selectElement.innerHTML = `<option value="">-- Pilih ${defaultOptionText} --</option>`;
            data.forEach(item => {
                const option = document.createElement('option');
                option.value = item[valueKey];
                option.textContent = item[textKey];
                selectElement.appendChild(option);
            });
        } catch (error) {
            console.error(`Error populating ${defaultOptionText}:`, error);
            selectElement.innerHTML = `<option value="">Gagal memuat data</option>`;
        }
    }

    // --- Event Listeners untuk Dropdown Wilayah ---
    // 1. Muat Provinsi saat halaman siap
    fetchAndPopulate(`${WILAYAH_API_URL}/provinces.json`, provinsiSelect, 'Provinsi');

    // 2. Muat Kota/Kabupaten saat Provinsi dipilih
    provinsiSelect.addEventListener('change', () => {
        const provinsiId = provinsiSelect.value;
        kecamatanSelect.innerHTML = '<option value="">Pilih kabupaten/kota terlebih dahulu</option>';
        kecamatanSelect.disabled = true;
        kelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>';
        kelurahanSelect.disabled = true;
        if (provinsiId) {
            fetchAndPopulate(`${WILAYAH_API_URL}/regencies/${provinsiId}.json`, kotaSelect, 'Kabupaten/Kota');
        } else {
            kotaSelect.innerHTML = '<option value="">Pilih provinsi terlebih dahulu</option>';
            kotaSelect.disabled = true;
        }
    });

    // 3. Muat Kecamatan saat Kota/Kabupaten dipilih
    kotaSelect.addEventListener('change', () => {
        const kotaId = kotaSelect.value;
        kelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>';
        kelurahanSelect.disabled = true;
        if (kotaId) {
            fetchAndPopulate(`${WILAYAH_API_URL}/districts/${kotaId}.json`, kecamatanSelect, 'Kecamatan');
        } else {
            kecamatanSelect.innerHTML = '<option value="">Pilih kabupaten/kota terlebih dahulu</option>';
            kecamatanSelect.disabled = true;
        }
    });

    // 4. Muat Kelurahan saat Kecamatan dipilih
    kecamatanSelect.addEventListener('change', () => {
        const kecamatanId = kecamatanSelect.value;
        if (kecamatanId) {
            fetchAndPopulate(`${WILAYAH_API_URL}/villages/${kecamatanId}.json`, kelurahanSelect, 'Kelurahan/Desa');
        } else {
            kelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>';
            kelurahanSelect.disabled = true;
        }
    });

    // --- Event Listener untuk Checkbox Alamat Domisili ---
    domicileSameAsKtpCheckbox.addEventListener('change', () => {
        const isChecked = domicileSameAsKtpCheckbox.checked;
        domicileAddressSection.classList.toggle('hidden', isChecked);

        // Setel atribut 'required' berdasarkan status checkbox
        const domicileInputs = [
            domisiliProvinsiSelect,
            domisiliKotaSelect,
            domisiliKecamatanSelect,
            domisiliKelurahanSelect,
            domisiliAlamatDetailTextarea
        ];

        domicileInputs.forEach(input => {
            input.required = !isChecked;
        });

        // Jika checkbox dicentang (alamat sama), reset dan nonaktifkan field domisili
        if (isChecked) {
            domicileInputs.forEach(input => {
                if (input.tagName === 'SELECT') {
                    input.innerHTML = '<option value="">Pilih...</option>';
                    input.disabled = true;
                } else {
                    input.value = '';
                }
            });
            domisiliProvinsiSelect.disabled = false; // Provinsi harus selalu bisa dipilih
        } else {
            // Jika tidak dicentang, muat provinsi untuk alamat domisili
            fetchAndPopulate(`${WILAYAH_API_URL}/provinces.json`, domisiliProvinsiSelect, 'Provinsi');
        }
    });

    // --- Event Listeners untuk Dropdown Alamat Domisili ---
    domisiliProvinsiSelect.addEventListener('change', () => {
        const provinsiId = domisiliProvinsiSelect.value;
        domisiliKecamatanSelect.innerHTML = '<option value="">Pilih kabupaten/kota terlebih dahulu</option>';
        domisiliKecamatanSelect.disabled = true;
        domisiliKelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>';
        domisiliKelurahanSelect.disabled = true;
        if (provinsiId) {
            fetchAndPopulate(`${WILAYAH_API_URL}/regencies/${provinsiId}.json`, domisiliKotaSelect, 'Kabupaten/Kota');
        } else {
            domisiliKotaSelect.innerHTML = '<option value="">Pilih provinsi terlebih dahulu</option>';
            domisiliKotaSelect.disabled = true;
        }
    });

    domisiliKotaSelect.addEventListener('change', () => {
        const kotaId = domisiliKotaSelect.value;
        domisiliKelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>';
        domisiliKelurahanSelect.disabled = true;
        if (kotaId) { fetchAndPopulate(`${WILAYAH_API_URL}/districts/${kotaId}.json`, domisiliKecamatanSelect, 'Kecamatan'); } else { domisiliKecamatanSelect.innerHTML = '<option value="">Pilih kabupaten/kota terlebih dahulu</option>'; domisiliKecamatanSelect.disabled = true; }
    });

    domisiliKecamatanSelect.addEventListener('change', () => { const kecamatanId = domisiliKecamatanSelect.value; if (kecamatanId) { fetchAndPopulate(`${WILAYAH_API_URL}/villages/${kecamatanId}.json`, domisiliKelurahanSelect, 'Kelurahan/Desa'); } else { domisiliKelurahanSelect.innerHTML = '<option value="">Pilih kecamatan terlebih dahulu</option>'; domisiliKelurahanSelect.disabled = true; } });

    // --- Muat data Perusahaan dan Jabatan dari API ---
    populateDropdownFromAPI('public/employers', perusahaanSelect, 'id', 'name', 'Perusahaan');
    populateDropdownFromAPI('public/positions', jabatanSelect, 'id', 'name', 'Jabatan');

    // --- Fungsi untuk toggle password visibility ---
    passwordToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            // Input adalah sibling persis sebelum div toggle
            const input = toggle.previousElementSibling;
            const eyeOpen = toggle.querySelector('.eye-open');
            const eyeClosed = toggle.querySelector('.eye-closed');

            if (input.type === 'password') {
                input.type = 'text';
                eyeOpen.classList.add('hidden');
                eyeClosed.classList.remove('hidden');
            } else {
                input.type = 'password';
                eyeOpen.classList.remove('hidden');
                eyeClosed.classList.add('hidden');
            }
        });
    });

    // --- Fungsi untuk mengecek kekuatan password ---
    const checkPasswordStrength = (password) => {
        let score = 0;
        // Kriteria: panjang, huruf kecil, huruf besar, angka, simbol
        if (password.length >= 8) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[@$!%*?&]/.test(password)) score++;

        if (password.length === 0) {
            return { text: '', color: '', width: '0%' };
        }
        if (password.length < 8) {
            return { text: 'Terlalu Pendek', color: 'bg-red-500', width: '10%' };
        }

        switch (score) {
            case 2: // Panjang + 1 kriteria lain
                return { text: 'Lemah', color: 'bg-red-500', width: '25%' };
            case 3: // Panjang + 2 kriteria lain
                return { text: 'Sedang', color: 'bg-yellow-500', width: '50%' };
            case 4: // Panjang + 3 kriteria lain (misal: huruf besar, kecil, angka)
                return { text: 'Kuat', color: 'bg-orange-500', width: '75%' };
            case 5: // Semua kriteria terpenuhi
                return { text: 'Sangat Kuat', color: 'bg-green-500', width: '100%' };
            default: // Hanya panjang, tidak ada kriteria lain
                return { text: 'Sangat Lemah', color: 'bg-red-500', width: '15%' };
        }
    };

    // --- Event listener untuk input password ---
    passwordInput.addEventListener('input', () => {
        const password = passwordInput.value;
        const strength = checkPasswordStrength(password);

        passwordStrengthText.textContent = strength.text;
        passwordStrengthBar.style.width = strength.width;

        // Hapus kelas warna sebelumnya dan tambahkan yang baru
        passwordStrengthBar.classList.remove('bg-red-500', 'bg-yellow-500', 'bg-orange-500', 'bg-green-500');
        if (strength.color) {
            passwordStrengthBar.classList.add(strength.color);
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // --- Validasi Password ---
        const password = passwordInput.value;
        const confirmPassword = passwordConfirmInput.value;
        
        passwordError.classList.add('hidden'); // Sembunyikan pesan error setiap kali submit

        // Validasi form secara eksplisit.
        // `reportValidity()` akan menampilkan pesan error bawaan browser jika ada field yang tidak valid.
        if (!form.reportValidity()) {
            // Hentikan eksekusi jika form tidak valid.
            return;
        }

        if (password !== confirmPassword) {
            passwordError.textContent = 'Password dan konfirmasi password tidak cocok.';
            passwordError.classList.remove('hidden');
            passwordConfirmInput.focus(); // Fokus ke input konfirmasi
            return; // Hentikan eksekusi
        }

        // --- Validasi Kekuatan Password (Client-side) ---
        const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!passwordRegex.test(password)) {
            passwordError.innerHTML = 'Password harus minimal 8 karakter dan mengandung:<ul class="list-disc list-inside mt-1"><li>Huruf besar (A-Z)</li><li>Huruf kecil (a-z)</li><li>Angka (0-9)</li><li>Simbol (@$!%*?&)</li></ul>';
            passwordError.classList.remove('hidden');
            passwordInput.focus();
            return;
        }

        // 1. Buat objek FormData untuk mengirim data, termasuk file
        const formData = new FormData();
        const getSelectedText = (el) => el.selectedIndex > 0 ? el.options[el.selectedIndex].text : '';

        // Append data teks
        formData.append('name', document.getElementById('reg-nama').value);
        formData.append('ktp_number', document.getElementById('reg-ktp').value);
        formData.append('phone', document.getElementById('reg-telepon').value);
        
        // Improvement: Send null if individual registration is checked
        const isIndividual = document.getElementById('individual-registration').checked;
        if (isIndividual) {
            formData.append('company_id', null);
            formData.append('position_id', null);
        } else {
            formData.append('company_id', perusahaanSelect.value);
            formData.append('position_id', jabatanSelect.value);
        }

        formData.append('email', document.getElementById('reg-email').value);
        formData.append('password', passwordInput.value); // Hashing akan dilakukan di backend
        
        // Append data alamat
        formData.append('address_province', getSelectedText(provinsiSelect));
        formData.append('address_city', getSelectedText(kotaSelect));
        formData.append('address_district', getSelectedText(kecamatanSelect));
        formData.append('address_village', getSelectedText(kelurahanSelect));
        formData.append('address_detail', alamatDetailTextarea.value);

        // Append data alamat domisili only if the checkbox is not checked
        if (!domicileSameAsKtpCheckbox.checked) {
            formData.append('domicile_address_province', getSelectedText(domisiliProvinsiSelect));
            formData.append('domicile_address_city', getSelectedText(domisiliKotaSelect));
            formData.append('domicile_address_district', getSelectedText(domisiliKecamatanSelect));
            formData.append('domicile_address_village', getSelectedText(domisiliKelurahanSelect));
            formData.append('domicile_address_detail', domisiliAlamatDetailTextarea.value);
        }

        // Append data ahli waris
        formData.append('heir_name', document.getElementById('reg-ahli-waris-nama').value);
        formData.append('heir_kk_number', document.getElementById('reg-ahli-waris-kk').value);
        formData.append('heir_relationship', document.getElementById('reg-ahli-waris-hubungan').value);
        formData.append('heir_phone', document.getElementById('reg-ahli-waris-telepon').value);

        // Append file
        formData.append('ktp_photo', document.getElementById('reg-foto-ktp').files[0]);
        formData.append('selfie_photo', document.getElementById('reg-foto-selfie').files[0]);
        formData.append('kk_photo', document.getElementById('reg-foto-kk').files[0]);

        try {
            // 2. Kirim data ke backend
            // Ganti URL ini dengan URL API backend Anda yang sebenarnya
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                body: formData, // Browser akan otomatis mengatur Content-Type ke multipart/form-data
            });

            if (!response.ok) {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.indexOf("application/json") !== -1) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Pendaftaran gagal. Silakan coba lagi.');
                } else {
                    const errorText = await response.text();
                    console.error("Server returned non-JSON response:", errorText);
                    throw new Error('Terjadi kesalahan pada server. Silakan cek konsol untuk detail.');
                }
            }

            // 3. Tampilkan pesan sukses dan sembunyikan form
            form.classList.add('hidden');
            // Ubah pesan sukses
            successMessage.innerHTML = `
                <h3 class="text-2xl font-bold text-green-700 mb-2">Pendaftaran Berhasil!</h3>
                <p class="text-gray-600">Terima kasih telah mendaftar. Kami telah mengirimkan email konfirmasi ke alamat email Anda.</p>
                <p class="text-gray-600 mt-2">Silakan tunggu persetujuan dari admin koperasi. Anda akan mendapatkan notifikasi lebih lanjut setelah akun Anda diaktifkan.</p>
                <p class="mt-4 text-sm text-gray-500">Anda akan diarahkan ke halaman login dalam beberapa detik...</p>
            `;
            successMessage.classList.remove('hidden');

            // 4. Arahkan kembali ke halaman login setelah beberapa detik
            setTimeout(() => { window.location.href = 'login.html'; }, 5000);

        } catch (error) {
            console.error('Error during registration:', error);
            passwordError.textContent = error.message;
            passwordError.classList.remove('hidden');
        }
    });
});