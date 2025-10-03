const pool = require('../../db');
const { sendApprovalEmail } = require('../utils/email.util');
const { createNotification } = require('../utils/notification.util');

/**
 * @desc    Get all members with filtering
 * @route   GET /api/members
 * @access  Private (Admin, Akunting, Manager)
 */
const getAllMembers = async (req, res) => {
    const { status, search, companyId, page = 1, limit = 10 } = req.query;

    // Base query
    let query = `
        SELECT
            m.id,
            m.name,
            m.cooperative_number,
            m.ktp_number,
            m.registration_date,
            m.approval_date,
            m.resignation_date,
            m.status,
            m.role,
            c.name AS "company_name",
            p.name AS "position_name",
            (SELECT COALESCE(SUM(s.amount), 0) FROM savings s WHERE s.member_id = m.id AND s.status = 'Approved') AS total_savings,
            (SELECT COALESCE(SUM(l.remaining_principal), 0) FROM loans l WHERE l.member_id = m.id AND l.status = 'Approved') AS total_loans
        FROM
            members m
        LEFT JOIN
            companies c ON m.company_id = c.id
        LEFT JOIN
            positions p ON m.position_id = p.id
    `;

    // Count query
    let countQuery = `SELECT COUNT(m.id) FROM members m`;

    const conditions = [];
    const values = [];
    let paramIndex = 1;

    // Default filter to only show active members if no status is specified
    if (status) {
        conditions.push(`m.status = $${paramIndex++}`);
        values.push(status);
    } else {
        conditions.push(`m.status = 'Active'`);
    }

    if (search) {
        conditions.push(`(m.name ILIKE $${paramIndex} OR m.cooperative_number ILIKE $${paramIndex} OR m.ktp_number ILIKE $${paramIndex})`);
        values.push(`%${search}%`);
        paramIndex++;
    }
    if (companyId) {
        conditions.push(`m.company_id = $${paramIndex++}`);
        values.push(companyId);
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
    query += whereClause;
    countQuery += whereClause;

    try {
        // Get total items for pagination
        const countResult = await pool.query(countQuery, values);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit);
        const offset = (page - 1) * limit;

        // Add ordering and pagination to the main query
        query += ` ORDER BY m.registration_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        const queryParams = [...values, limit, offset];

        const result = await pool.query(query, queryParams);

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
        console.error('Error fetching all members:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data anggota.' });
    }
};

/**
 * @desc    Get a single member by ID
 * @route   GET /api/members/:id
 * @access  Private (Admin, Akunting, Manager)
 */
const getMemberById = async (req, res) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT
                m.*,
                c.name AS company_name,
                p.name AS position_name,
                (SELECT COALESCE(SUM(s.amount), 0) FROM savings s WHERE s.member_id = m.id AND s.status = 'Approved') AS total_savings,
                (SELECT COALESCE(SUM(l.remaining_principal), 0) FROM loans l WHERE l.member_id = m.id AND l.status = 'Approved') AS total_loans
            FROM members m
            LEFT JOIN companies c ON m.company_id = c.id
            LEFT JOIN positions p ON m.position_id = p.id
            WHERE m.id = $1
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Anggota tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching member by id:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data anggota.' });
    }
};

/**
 * @desc    Update a member's status (e.g., approve/reject registration)
 * @route   PUT /api/members/:id/status
 * @access  Private (Admin)
 */
const updateMemberStatus = async (req, res) => {
    const { id } = req.params;
    const { status: newStatus } = req.body;

    if (!['Active', 'Rejected', 'Inactive'].includes(newStatus)) {
        return res.status(400).json({ error: 'Status tidak valid. Gunakan "Active", "Rejected", atau "Inactive".' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get current member details and lock the row
        const memberRes = await client.query('SELECT id, name, email, status, cooperative_number FROM members WHERE id = $1 FOR UPDATE', [id]);
        if (memberRes.rows.length === 0) {
            throw new Error('Anggota tidak ditemukan.');
        }
        const member = memberRes.rows[0];
        const currentStatus = member.status;

        // 2. Validate state transition
        if (currentStatus === newStatus) {
            // No change, but we can return success to make the client-side simpler.
            await client.query('ROLLBACK'); // No need for a transaction if there's no change
            return res.json(member);
        }

        if (currentStatus !== 'Pending' && (newStatus === 'Active' || newStatus === 'Rejected')) {
            throw new Error(`Hanya anggota dengan status "Pending" yang dapat disetujui atau ditolak.`);
        }
        
        if (currentStatus !== 'Active' && newStatus === 'Inactive') {
            throw new Error(`Hanya anggota "Active" yang dapat diubah menjadi "Inactive".`);
        }

        // 3. Perform update based on new status
        let updatedMember;
        if (newStatus === 'Active') {
            let cooperativeNumber = member.cooperative_number;
            // Generate cooperative number only if it doesn't exist
            if (!cooperativeNumber) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const prefix = `KOP-${year}${month}-`;
                // This count can have a race condition, but it's a low risk for this use case.
                const seqResult = await client.query("SELECT COUNT(*) FROM members WHERE cooperative_number LIKE $1", [`${prefix}%`]);
                const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
                cooperativeNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
            }
            
            const result = await client.query(
                'UPDATE members SET status = $1, approval_date = NOW(), cooperative_number = $2 WHERE id = $3 RETURNING *',
                [newStatus, cooperativeNumber, id]
            );
            updatedMember = result.rows[0];

            // Send notifications
            sendApprovalEmail(updatedMember.email, updatedMember.name).catch(err => console.error("Gagal mengirim email persetujuan:", err));
            createNotification(updatedMember.id, `Selamat! Pendaftaran Anda sebagai anggota telah disetujui.`, 'profile').catch(err => console.error("Gagal membuat notifikasi persetujuan:", err));

        } else { // For 'Rejected' or 'Inactive'
            const result = await client.query('UPDATE members SET status = $1 WHERE id = $2 RETURNING *', [newStatus, id]);
            updatedMember = result.rows[0];

            if (newStatus === 'Rejected') {
                // TODO: Consider creating and calling a sendRejectionEmail utility function.
                createNotification(updatedMember.id, `Mohon maaf, pendaftaran Anda belum dapat kami setujui saat ini.`, 'profile').catch(err => console.error("Gagal membuat notifikasi penolakan:", err));
            }
        }

        await client.query('COMMIT');
        res.json(updatedMember);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating member status:', err.message);
        // Use 400 for business logic errors, 500 for unexpected server errors
        res.status(err.message.includes('Hanya anggota') ? 400 : 500).json({ error: err.message || 'Gagal memperbarui status anggota.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getAllMembers,
    getMemberById,
    updateMemberStatus,
};