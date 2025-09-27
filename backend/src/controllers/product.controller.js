const pool = require('../../db');
const { v4: uuidv4 } = require('uuid');
const { createNotification } = require('../utils/notification.util');


const getPublicTestimonials = async (req, res) => {
    try {
        const result = await pool.query('SELECT name, division, text, photo_url FROM testimonials ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public testimonials:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data testimoni.' });
    }
};

const getPublicProducts = async (req, res) => {
    const { shop } = req.query;

    if (!shop) {
        return res.status(400).json({ error: 'Parameter "shop" diperlukan.' });
    }

    try {
        const query = 'SELECT id, name, description, price, stock, image_url, shop_type FROM products WHERE shop_type = $1 ORDER BY name ASC';
        const result = await pool.query(query, [shop]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const getPublicEmployers = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM companies ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public employers:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data perusahaan.' });
    }
};

const getPublicPositions = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, name FROM positions ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public positions:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data jabatan.' });
    }
};

const getPublicLoanTerms = async (req, res) => {
    try {
        const query = `
            SELECT 
                lt.id, 
                lt.tenor_months, 
                lt.interest_rate, 
                lty.name as loan_type_name 
            FROM loan_terms lt
            JOIN loan_types lty ON lt.loan_type_id = lty.id
            ORDER BY lty.name, lt.tenor_months;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public loan terms:', err.message);
        res.status(500).json({ error: 'Gagal memuat produk pinjaman.' });
    }
};

const getPublicAnnouncements = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT title, content, created_at FROM announcements WHERE is_published = TRUE ORDER BY created_at DESC LIMIT 5'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public announcements:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pengumuman.' });
    }
};

const validateMemberByCoopNumber = async (req, res) => {
    const { cooperative_number } = req.body;
    if (!cooperative_number) {
        return res.status(400).json({ error: 'Nomor koperasi diperlukan.' });
    }
    try {
        const result = await pool.query(
            "SELECT id, name, cooperative_number FROM members WHERE cooperative_number = $1 AND status = 'Active'",
            [cooperative_number]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Anggota tidak ditemukan atau tidak aktif.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error validating member by coop number:', err.message);
        res.status(500).json({ error: 'Gagal memvalidasi anggota.' });
    }
};

const createSaleOrder = async (req, res) => {
    const { items, memberId, shopType, totalAmount } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0 || !shopType || !totalAmount) {
        return res.status(400).json({ error: 'Data pesanan tidak lengkap.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Generate a unique order ID
        const orderId = `ORD-${Date.now()}-${uuidv4().slice(0, 4).toUpperCase()}`;

        // 2. Create sales header
        const saleRes = await client.query(
            'INSERT INTO sales (order_id, member_id, shop_type, total_amount, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [orderId, memberId, shopType, totalAmount, 'Menunggu Pengambilan']
        );
        const saleId = saleRes.rows[0].id;

        // 3. Create sale items
        const saleItemsQueryParts = [];
        const saleItemsValues = [];
        let paramIndex = 1;
        for (const item of items) {
            saleItemsQueryParts.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
            saleItemsValues.push(saleId, item.id, item.quantity, item.price);
        }
        const saleItemsQuery = `INSERT INTO sale_items (sale_id, product_id, quantity, price) VALUES ${saleItemsQueryParts.join(', ')}`;
        await client.query(saleItemsQuery, saleItemsValues);

        // 4. Create notification for member
        if (memberId) {
            createNotification(memberId, `Pesanan Anda #${orderId} telah diterima dan sedang disiapkan. Silakan ambil di kasir.`, 'transactions')
                .catch(err => console.error(`Failed to create sale order notification for user ${memberId}:`, err));
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Pesanan berhasil dibuat.', orderId });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating sale order:', err.message);
        res.status(500).json({ error: 'Gagal membuat pesanan.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getPublicTestimonials,
    getPublicProducts,
    getPublicEmployers,
    getPublicPositions,
    getPublicLoanTerms,
    getPublicAnnouncements,
    validateMemberByCoopNumber,
    createSaleOrder,
};