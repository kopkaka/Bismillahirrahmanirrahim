const pool = require('../../db');
const { createNotification } = require('../utils/notification.util');
const { getAccountId } = require('../utils/getAccountId.util'); // Keep for single use cases
const { getAccountIds } = require('../utils/getAccountIds.util.js'); // Import the new efficient function

/**
 * @desc    Mendapatkan aturan pembagian SHU untuk tahun tertentu.
 * @route   GET /api/admin/shu-rules/:year
 * @access  Private (Admin, Akunting)
 */
const getShuRules = async (req, res) => {
    const { year } = req.params;

    try {
        const result = await pool.query('SELECT * FROM shu_rules WHERE year = $1', [year]);

        if (result.rows.length > 0) {
            // Konversi nilai numerik ke float untuk konsistensi di frontend
            const rules = result.rows[0];
            for (const key in rules) {
                if (key !== 'year') {
                    rules[key] = parseFloat(rules[key]);
                }
            }
            res.json(rules);
        } else {
            // Jika tidak ada aturan untuk tahun tersebut, kembalikan aturan default
            res.json({
                year: parseInt(year),
                reserve_fund_percentage: 25.00,
                member_business_service_percentage: 40.00,
                member_capital_service_percentage: 20.00,
                management_fund_percentage: 5.00,
                education_fund_percentage: 5.00,
                social_fund_percentage: 5.00,
            });
        }
    } catch (err) {
        console.error('Error fetching SHU rules:', err.message);
        res.status(500).json({ error: 'Gagal mengambil aturan SHU.' });
    }
};

/**
 * @desc    Menyimpan atau memperbarui aturan pembagian SHU untuk tahun tertentu.
 * @route   POST /api/admin/shu-rules
 * @access  Private (Admin)
 */
const saveShuRules = async (req, res) => {
    const {
        year,
        reserve_fund_percentage,
        member_business_service_percentage,
        member_capital_service_percentage,
        management_fund_percentage,
        education_fund_percentage,
        social_fund_percentage
    } = req.body;

    const total = [
        reserve_fund_percentage,
        member_business_service_percentage,
        member_capital_service_percentage,
        management_fund_percentage,
        education_fund_percentage,
        social_fund_percentage
    ].reduce((sum, val) => sum + (parseFloat(val) || 0), 0);

    if (Math.abs(total - 100) > 0.01) {
        return res.status(400).json({ error: 'Total persentase alokasi SHU harus tepat 100%.' });
    }

    try {
        const query = `
            INSERT INTO shu_rules (year, reserve_fund_percentage, member_business_service_percentage, member_capital_service_percentage, management_fund_percentage, education_fund_percentage, social_fund_percentage)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (year) DO UPDATE SET
                reserve_fund_percentage = EXCLUDED.reserve_fund_percentage,
                member_business_service_percentage = EXCLUDED.member_business_service_percentage,
                member_capital_service_percentage = EXCLUDED.member_capital_service_percentage,
                management_fund_percentage = EXCLUDED.management_fund_percentage,
                education_fund_percentage = EXCLUDED.education_fund_percentage,
                social_fund_percentage = EXCLUDED.social_fund_percentage
            RETURNING *;
        `;
        const values = [year, reserve_fund_percentage, member_business_service_percentage, member_capital_service_percentage, management_fund_percentage, education_fund_percentage, social_fund_percentage];
        const result = await pool.query(query, values);

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error saving SHU rules:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan aturan SHU.' });
    }
};

/**
 * @desc    Menghitung pratinjau distribusi SHU.
 * @route   POST /api/admin/shu/calculate-preview
 * @access  Private (Akunting)
 */
const calculateShuPreview = async (req, res) => {
    const { year, totalShu } = req.body;

    if (!year || !totalShu || totalShu <= 0) {
        return res.status(400).json({ error: 'Tahun dan Total SHU harus diisi dengan benar.' });
    }

    const client = await pool.connect();
    try {
        // 1. Get SHU rules for the year
        const rulesRes = await client.query('SELECT * FROM shu_rules WHERE year = $1', [year]);
        if (rulesRes.rows.length === 0) {
            throw new Error(`Aturan SHU untuk tahun ${year} belum ditetapkan.`);
        }
        const rules = rulesRes.rows[0];

        // 2. Calculate allocations
        const allocatedForBusiness = totalShu * (parseFloat(rules.member_business_service_percentage) / 100);
        const allocatedForCapital = totalShu * (parseFloat(rules.member_capital_service_percentage) / 100);

        // --- PERFORMANCE OPTIMIZATION ---
        // Combine the query for cooperative-wide totals and per-member totals into a single, efficient query.
        // This reduces database round-trips from two to one.
        const allDataQuery = `
            WITH member_sales AS (
                SELECT
                    member_id,
                    SUM(total_amount) as total_member_sales
                FROM sales
                WHERE status = 'Selesai' AND EXTRACT(YEAR FROM sale_date) = $1
                GROUP BY member_id
            ), member_savings AS (
                SELECT
                    s.member_id,
                    SUM(s.amount) as total_member_savings
                FROM savings s
                JOIN saving_types st ON s.saving_type_id = st.id
                WHERE st.name IN ('Simpanan Pokok', 'Simpanan Wajib')
                  AND s.status = 'Approved'
                  AND EXTRACT(YEAR FROM s.date) <= $1
                GROUP BY s.member_id
            ), cooperative_totals AS (
                SELECT
                    COALESCE(SUM(total_member_sales), 0) as total_coop_sales
                FROM member_sales
            )
            SELECT
                m.id,
                m.name,
                COALESCE(msa.total_member_sales, 0) as "memberTransactions",
                COALESCE(msv.total_member_savings, 0) as "memberCapital",
                (SELECT total_coop_sales FROM cooperative_totals) as "totalTransactions",
                (SELECT COALESCE(SUM(total_member_savings), 0) FROM member_savings) as "totalCapital"
            FROM members m
            LEFT JOIN member_sales msa ON m.id = msa.member_id
            LEFT JOIN member_savings msv ON m.id = msv.member_id
            WHERE m.status = 'Active' AND m.role = 'member';
        `;
        const allDataRes = await client.query(allDataQuery, [year]);
        const membersData = allDataRes.rows;

        if (membersData.length === 0) {
            return res.json({ summary: {}, distribution: [] });
        }

        const { totalTransactions, totalCapital } = membersData[0]; // Totals are the same for every row

        // 4. Calculate SHU for each member using the pre-fetched data
        const distribution = [];
        for (const member of membersData) {
            const shuFromBusiness = totalTransactions > 0 ? (parseFloat(member.memberTransactions) / totalTransactions) * allocatedForBusiness : 0;
            const shuFromCapital = totalCapital > 0 ? (parseFloat(member.memberCapital) / totalCapital) * allocatedForCapital : 0;
            const totalMemberShu = shuFromBusiness + shuFromCapital;

            if (totalMemberShu > 0) {
                distribution.push({
                    memberId: member.id,
                    memberName: member.name,
                    shuFromBusiness: shuFromBusiness,
                    shuFromCapital: shuFromCapital,
                    totalMemberShu: totalMemberShu
                });
            }
        }

        res.json({
            summary: {
                totalShu: parseFloat(totalShu), // Ensure totalShu is a number
                allocatedForBusiness,
                allocatedForCapital,
            },
            distribution
        });

    } catch (err) {
        console.error('Error calculating SHU preview:', err.message);
        res.status(400).json({ error: err.message || 'Gagal menghitung pratinjau SHU.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Memposting hasil distribusi SHU ke simpanan anggota dan membuat jurnal.
 * @route   POST /api/admin/shu/post-distribution
 * @access  Private (Akunting)
 */
const postDistribution = async (req, res) => {
    const { year, distributionData } = req.body;
    const userId = req.user.id;

    if (!year || !Array.isArray(distributionData) || distributionData.length === 0) {
        return res.status(400).json({ error: 'Data distribusi tidak valid.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Check if SHU for this year has already been posted
        const existingDist = await client.query('SELECT id FROM shu_distributions WHERE year = $1 LIMIT 1', [year]);
        if (existingDist.rows.length > 0) {
            throw new Error(`SHU untuk tahun ${year} sudah pernah diposting.`);
        }

        // 2. Get necessary account IDs and saving type ID
        const shuSavingTypeId = (await client.query("SELECT id FROM saving_types WHERE name = 'Simpanan SHU'")).rows[0]?.id;
        if (!shuSavingTypeId) throw new Error("Tipe simpanan 'Simpanan SHU' tidak ditemukan.");

        const shuAccountId = await getAccountId('SHU Tahun Berjalan', client);
        const reserveFundAccountId = await getAccountId('Dana Cadangan', client);
        const managementFundAccountId = await getAccountId('Dana Pengurus & Karyawan', client);
        const educationFundAccountId = await getAccountId('Dana Pendidikan', client);
        const socialFundAccountId = await getAccountId('Dana Sosial', client);
        const shuSavingAccountId = (await client.query("SELECT account_id FROM saving_types WHERE id = $1", [shuSavingTypeId])).rows[0]?.account_id;
        if (!shuSavingAccountId) throw new Error("Akun untuk 'Simpanan SHU' belum di-mapping.");

        // 3. Get SHU rules for the year
        const rulesRes = await client.query('SELECT * FROM shu_rules WHERE year = $1', [year]);
        if (rulesRes.rows.length === 0) throw new Error(`Aturan SHU untuk tahun ${year} belum ditetapkan.`);
        const rules = rulesRes.rows[0];

        // 4. Calculate total SHU and allocations from distribution data
        const totalMemberShu = distributionData.reduce((sum, item) => sum + item.totalMemberShu, 0);
        const totalShuToDistribute = totalMemberShu / ((parseFloat(rules.member_business_service_percentage) + parseFloat(rules.member_capital_service_percentage)) / 100);

        const reserveFundAmount = totalShuToDistribute * (parseFloat(rules.reserve_fund_percentage) / 100);
        const managementFundAmount = totalShuToDistribute * (parseFloat(rules.management_fund_percentage) / 100);
        const educationFundAmount = totalShuToDistribute * (parseFloat(rules.education_fund_percentage) / 100);
        const socialFundAmount = totalShuToDistribute * (parseFloat(rules.social_fund_percentage) / 100);

        // 5. Create the main journal entry
        const journalDesc = `Jurnal Penutup dan Distribusi SHU Tahun ${year}`;
        const journalRes = await client.query(
            'INSERT INTO general_journal (entry_date, description) VALUES (NOW(), $1) RETURNING id',
            [journalDesc]
        );
        const journalId = journalRes.rows[0].id;

        // 6. Create journal entry lines
        const journalEntries = [
            // Debit SHU Tahun Berjalan
            { account_id: accountIds['SHU Tahun Berjalan'], debit: totalShuToDistribute, credit: 0 },
            // Credit all allocations
            { account_id: accountIds['Dana Cadangan'], debit: 0, credit: reserveFundAmount },
            { account_id: accountIds['Dana Pengurus & Karyawan'], debit: 0, credit: managementFundAmount },
            { account_id: accountIds['Dana Pendidikan'], debit: 0, credit: educationFundAmount },
            { account_id: accountIds['Dana Sosial'], debit: 0, credit: socialFundAmount },
            { account_id: shuSavingAccountId, debit: 0, credit: totalMemberShu }
        ];

        for (const entry of journalEntries) {
            await client.query(
                'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, $4)',
                [journalId, entry.account_id, entry.debit, entry.credit]
            );
        }

        // 7. Loop through members, insert into shu_distributions and savings, and create notifications
        for (const item of distributionData) {
            // Insert into shu_distributions
            await client.query(
                `INSERT INTO shu_distributions (member_id, year, total_shu_amount, shu_from_capital, shu_from_services, distribution_date)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [item.memberId, year, item.totalMemberShu, item.shuFromCapital, item.shuFromBusiness]
            );

            // Insert into savings as 'Simpanan SHU'
            await client.query(
                `INSERT INTO savings (member_id, saving_type_id, amount, date, status, description, journal_id)
                 VALUES ($1, $2, $3, NOW(), 'Approved', $4, $5)`,
                [item.memberId, shuSavingTypeId, item.totalMemberShu, `SHU Tahun ${year}`, journalId]
            );

            // Create notification for the member
            const notificationMessage = `Selamat! Anda telah menerima SHU tahun ${year} sebesar ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(item.totalMemberShu)}. Dana telah ditambahkan ke Simpanan SHU Anda.`;
            createNotification(item.memberId, notificationMessage, 'shu-history').catch(err => console.error(err));
        }

        await client.query('COMMIT');
        res.status(201).json({ message: `SHU tahun ${year} berhasil diposting untuk ${distributionData.length} anggota.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error posting SHU distribution:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memposting SHU.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Mendapatkan riwayat SHU untuk anggota yang sedang login.
 * @route   GET /api/member/shu-history
 * @access  Private
 */
const getMemberShuHistory = async (req, res) => {
    const memberId = req.user.id;

    try {
        const query = `
            SELECT 
                year,
                total_shu_amount,
                shu_from_capital, 
                shu_from_services AS shu_from_business, -- Alias to match frontend
                distribution_date
            FROM shu_distributions
            WHERE member_id = $1
            ORDER BY year DESC
        `;
        const result = await pool.query(query, [memberId]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching member SHU history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat SHU.' });
    }
};

/**
 * @desc    Mendapatkan riwayat SHU untuk semua anggota (Admin).
 * @route   GET /api/admin/shu-history
 * @access  Private (Admin)
 */
const getShuHistory = async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    try {
        // First, get the total count of all distributions for pagination
        const countQuery = 'SELECT COUNT(*) FROM shu_distributions';
        const countResult = await pool.query(countQuery);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);

        // Then, fetch the paginated data
        // Performance: Using LIMIT and OFFSET is the standard and efficient way to paginate in SQL.
        const dataQuery = `
            SELECT 
                sd.id,
                sd.year,
                sd.total_shu_amount,
                sd.shu_from_capital,
                sd.shu_from_services,
                sd.distribution_date,
                m.name as member_name,
                m.cooperative_number
            FROM shu_distributions sd
            JOIN members m ON sd.member_id = m.id
            ORDER BY sd.distribution_date DESC, m.name ASC
            LIMIT $1 OFFSET $2
        `;
        const result = await pool.query(dataQuery, [limit, offset]);

        res.json({
            data: result.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            }
        });
    } catch (err) {
        console.error('Error fetching all SHU history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat SHU.' });
    }
};


module.exports = {
    getShuRules,
    saveShuRules,
    calculateShuPreview,
    postDistribution,
    getMemberShuHistory,
    getShuHistory // Export the new function
};