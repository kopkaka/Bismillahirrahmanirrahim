const pool = require('../../db');
const fs = require('fs');
const path = require('path');
const { createNotification } = require('../utils/notification.util');

const getProducts = async (req, res) => {
    const { shop } = req.query;

    if (!shop) {
        return res.status(400).json({ error: 'Parameter "shop" diperlukan.' });
    }

    try {
        const query = 'SELECT id, name, description, price, stock, image_url, shop_type FROM products WHERE shop_type = $1 ORDER BY name ASC';
        const result = await pool.query(query, [shop]);
        res.json(result.rows);
    } catch (err) {
        console.error(`Error fetching products for shop [${shop}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const getProductById = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error fetching product by id [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const createProduct = async (req, res) => {
    const { name, description, price, stock, shop_type } = req.body;
    let imageUrl = null;
    if (req.file) {
        imageUrl = '/' + req.file.path.replace(/\\/g, '/');
    }

    if (!name || price == null || stock == null || !shop_type) {
        return res.status(400).json({ error: 'Nama, harga, stok, dan tipe toko wajib diisi.' });
    }

    try {
        const query = `
            INSERT INTO products (name, description, price, stock, image_url, shop_type)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;
        const values = [name, description, price, stock, imageUrl, shop_type];
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating product:', err.message);
        res.status(500).json({ error: 'Gagal membuat produk baru.' });
    }
};

const updateProduct = async (req, res) => {
    const { id } = req.params;
    const { name, description, price, stock, shop_type } = req.body;
    const client = await pool.connect();

    if (!name || price == null || stock == null || !shop_type) {
        return res.status(400).json({ error: 'Nama, harga, stok, dan tipe toko wajib diisi.' });
    }

    try {
        await client.query('BEGIN');

        const oldProductRes = await client.query('SELECT image_url FROM products WHERE id = $1', [id]);
        const oldImageUrl = oldProductRes.rows[0]?.image_url;
        let newImageUrl = oldImageUrl;

        if (req.file) {
            newImageUrl = '/' + req.file.path.replace(/\\/g, '/');
        }

        const query = `
            UPDATE products
            SET name = $1, description = $2, price = $3, stock = $4, image_url = $5, shop_type = $6
            WHERE id = $7 RETURNING *;
        `;
        const values = [name, description, price, stock, newImageUrl, shop_type, id];
        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Produk tidak ditemukan.' });
        }

        if (req.file && oldImageUrl && oldImageUrl !== newImageUrl) {
            const oldImagePath = path.resolve(process.cwd(), oldImageUrl.startsWith('/') ? oldImageUrl.substring(1) : oldImageUrl);
            fs.unlink(oldImagePath, (err) => {
                if (err) console.error("Gagal menghapus gambar lama:", oldImagePath, err);
            });
        }

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error updating product [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal memperbarui produk.' });
    } finally {
        client.release();
    }
};

const deleteProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const oldProductRes = await pool.query('SELECT image_url FROM products WHERE id = $1', [id]);
        const oldImageUrl = oldProductRes.rows[0]?.image_url;
        
        await pool.query('DELETE FROM products WHERE id = $1', [id]);
        
        if (oldImageUrl) {
            const oldImagePath = path.resolve(process.cwd(), oldImageUrl.startsWith('/') ? oldImageUrl.substring(1) : oldImageUrl);
            fs.unlink(oldImagePath, (err) => { if (err) console.error("Gagal menghapus gambar produk:", oldImagePath, err); });
        }
        res.status(204).send();
    } catch (err) {
        console.error(`Error deleting product [${id}]:`, err.message);
        res.status(500).json({ error: 'Gagal menghapus produk.' });
    }
};

/**
 * @desc    Creates a new sale order from the public shop (toko).
 * @route   POST /api/public/sales
 * @access  Public
 */
const createSaleOrder = async (req, res) => {
    const { items, memberId } = req.body; // Expects items: [{ productId, quantity }]

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Fetch all products at once to validate stock and get prices
        const productIds = items.map(item => item.productId);
        const productsRes = await client.query(
            'SELECT id, name, price, stock, shop_type FROM products WHERE id = ANY($1::int[]) FOR UPDATE',
            [productIds]
        );
        const productMap = new Map(productsRes.rows.map(p => [p.id, p]));

        let totalAmount = 0;
        let shopType = null;

        // 2. Validate items and calculate total
        for (const item of items) {
            const product = productMap.get(item.productId);
            if (!product) throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan.`);
            if (product.stock < item.quantity) throw new Error(`Stok untuk produk "${product.name}" tidak mencukupi.`);
            if (!shopType) shopType = product.shop_type; // Set shop_type from the first item
            totalAmount += parseFloat(product.price) * item.quantity;
        }

        // 3. Create a unique order ID
        const orderId = `ORD-${Date.now()}`;

        // 4. Insert into sales table with 'Menunggu Pengambilan' status
        const saleRes = await client.query(
            'INSERT INTO sales (order_id, member_id, total_amount, status, shop_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [orderId, memberId, totalAmount, 'Menunggu Pengambilan', shopType]
        );
        const saleId = saleRes.rows[0].id;

        // 5. Bulk insert sale items and update stock
        for (const item of items) {
            const product = productMap.get(item.productId);
            await client.query(
                'INSERT INTO sale_items (sale_id, product_id, quantity, price, subtotal) VALUES ($1, $2, $3, $4, $5)',
                [saleId, item.productId, item.quantity, product.price, parseFloat(product.price) * item.quantity]
            );
            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.productId]);
        }

        await client.query('COMMIT');

        // 6. Send notifications (async, non-blocking)
        createNotification(memberId, `Pesanan Anda #${orderId} telah dibuat dan sedang disiapkan.`, 'transactions').catch(console.error);
        const adminsRes = await pool.query("SELECT id FROM members WHERE role = 'admin' OR role = 'kasir'");
        for (const admin of adminsRes.rows) {
            createNotification(admin.id, `Pesanan baru #${orderId} menunggu pengambilan di kasir.`, 'usaha-koperasi').catch(console.error);
        }

        res.status(201).json({ message: 'Pesanan berhasil dibuat.', orderId: orderId });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating sale order:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membuat pesanan.' });
    } finally {
        client.release();
    }
};

/**
 * @desc    Get all products for the public-facing store.
 * @route   GET /api/public/products
 * @access  Public
 */
const getPublicProducts = async (req, res) => {
    try {
        // Select only the fields needed for the public store to avoid exposing unnecessary data.
        const query = `
            SELECT id, name, description, price, stock, image_url, shop_type 
            FROM products 
            ORDER BY name ASC`;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk.' });
    }
};

const getPendingSales = async (req, res) => {
    try {
        const query = `
            SELECT 
                s.id,
                s.order_id,
                s.sale_date,
                s.total_amount,
                s.status,
                m.name as member_name
            FROM sales s
            JOIN members m ON s.member_id = m.id
            WHERE s.status = 'Menunggu Pengambilan'
            ORDER BY s.sale_date ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching pending sales:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pesanan masuk.' });
    }
};

const getSaleDetailsByOrderId = async (req, res) => {
    const { orderId } = req.params;
    const client = await pool.connect();
    try {
        const saleHeaderRes = await client.query(`
            SELECT 
                s.id, 
                s.order_id, 
                s.sale_date, 
                s.total_amount, 
                m.id as member_id, 
                m.name as member_name, 
                m.cooperative_number
            FROM sales s
            LEFT JOIN members m ON s.member_id = m.id
            WHERE s.order_id = $1
        `, [orderId]);

        if (saleHeaderRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
        }
        const header = saleHeaderRes.rows[0];

        const saleItemsRes = await client.query(`
            SELECT si.quantity, si.price, p.name 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = $1
        `, [header.id]);

        const responseData = {
            orderId: header.order_id,
            user: header.member_id ? { id: header.member_id, name: header.member_name, coopNumber: header.cooperative_number } : { id: null, name: 'Pelanggan Tunai', coopNumber: null },
            items: saleItemsRes.rows,
            total: parseFloat(header.total_amount),
            timestamp: header.sale_date
        };

        res.json(responseData);
    } catch (err) {
        console.error(`Error fetching sale details for admin on order ${orderId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil detail pesanan.' });
    } finally {
        client.release();
    }
};

const getSaleItemsByOrderId = async (req, res) => {
    const { orderId } = req.params;
    try {
        const saleRes = await pool.query('SELECT id FROM sales WHERE order_id = $1', [orderId]);
        if (saleRes.rows.length === 0) {
            return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
        }
        const saleId = saleRes.rows[0].id;

        const itemsRes = await pool.query(`
            SELECT 
                si.quantity, 
                si.price, 
                si.subtotal,
                p.name as product_name 
            FROM sale_items si 
            JOIN products p ON si.product_id = p.id 
            WHERE si.sale_id = $1
        `, [saleId]);

        res.json(itemsRes.rows);
    } catch (err) {
        console.error(`Error fetching sale items for order ${orderId}:`, err.message);
        res.status(500).json({ error: 'Gagal mengambil detail barang pesanan.' });
    }
};

const completeOrder = async (req, res) => {
    const { orderId } = req.params; // Ambil orderId dari URL
    const { paymentMethod, memberId, loanTermId } = req.body;
    const { id: cashierId } = req.user;

    if (!paymentMethod) {
        return res.status(400).json({ error: 'Metode pembayaran diperlukan.' });
    }
    const isLedgerPayment = paymentMethod.toLowerCase().includes('gaji') || paymentMethod.toLowerCase().includes('ledger');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const saleRes = await client.query("SELECT * FROM sales WHERE order_id = $1 AND status = 'Menunggu Pengambilan' FOR UPDATE", [orderId]);
        if (saleRes.rows.length === 0) {
            throw new Error('Pesanan tidak ditemukan atau sudah diproses.');
        }
        const sale = saleRes.rows[0];

        let journalId;
        if (isLedgerPayment) {
            if (!memberId) throw new Error('ID Anggota diperlukan untuk pembayaran Potong Gaji.');
            if (!loanTermId) throw new Error('Tenor pinjaman wajib dipilih untuk pembayaran potong gaji.');

            const termRes = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loanTermId]);
            if (termRes.rows.length === 0) throw new Error('Tenor pinjaman tidak valid.');
            const loanTypeId = termRes.rows[0].loan_type_id;

            const loanInsertQuery = `
                INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal)
                VALUES ($1, $2, $3, $4, NOW(), 'Approved', $4) RETURNING id
            `;
            const newLoanRes = await client.query(loanInsertQuery, [memberId, loanTypeId, loanTermId, sale.total_amount]);
            const newLoanId = newLoanRes.rows[0].id;

            await client.query('UPDATE sales SET loan_id = $1 WHERE id = $2', [newLoanId, sale.id]);

        } else {
            const paymentMethodRes = await client.query('SELECT account_id FROM payment_methods WHERE name = $1', [paymentMethod]);
            if (paymentMethodRes.rows.length === 0 || !paymentMethodRes.rows[0].account_id) {
                throw new Error(`Metode pembayaran "${paymentMethod}" tidak valid atau belum terhubung ke akun COA.`);
            }
            const debitAccountId = paymentMethodRes.rows[0].account_id;

            const itemsRes = await client.query('SELECT SUM(cost_per_item * quantity) as total_cogs FROM sale_items WHERE sale_id = $1', [sale.id]);
            const totalCostOfGoodsSold = parseFloat(itemsRes.rows[0].total_cogs || 0);

            const inventoryAccountId = 8; const salesRevenueAccountId = 12; const cogsAccountId = 13;
            const description = `Penyelesaian pesanan #${orderId}`;
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, `SALE-${sale.id}`]);
            journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `
                INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES
                ($1, $2, $3, 0), ($1, $4, 0, $3), ($1, $5, $6, 0), ($1, $7, 0, $6)
            `;
            await client.query(journalEntriesQuery, [journalId, debitAccountId, sale.total_amount, salesRevenueAccountId, cogsAccountId, totalCostOfGoodsSold, inventoryAccountId]);
        }

        await client.query(
            "UPDATE sales SET status = 'Selesai', payment_method = $1, created_by_user_id = $2, journal_id = $3 WHERE id = $4",
            [paymentMethod, cashierId, journalId, sale.id]
        );

        if (sale.member_id) {
            createNotification(
                sale.member_id,
                `Pesanan Anda #${orderId} telah selesai diproses di kasir.`,
                'transactions'
            ).catch(err => console.error(`Gagal membuat notifikasi penyelesaian pesanan untuk user ${sale.member_id}:`, err));
        }

        await client.query('COMMIT');
        res.json({ message: 'Transaksi berhasil diselesaikan.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error completing order:', err.message);
        res.status(400).json({ error: err.message || 'Gagal menyelesaikan transaksi.' });
    } finally {
        client.release();
    }
};

const cancelSale = async (req, res) => {
    const { id: saleId } = req.params;
    const { role: userRole } = req.user;

    if (!['admin', 'akunting'].includes(userRole)) {
        return res.status(403).json({ error: 'Anda tidak memiliki izin untuk tindakan ini.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const saleRes = await client.query("SELECT id, status, journal_id FROM sales WHERE id = $1 FOR UPDATE", [saleId]);
        if (saleRes.rows.length === 0) throw new Error('Transaksi penjualan tidak ditemukan.');
        const sale = saleRes.rows[0];
        if (sale.status !== 'Selesai') throw new Error(`Hanya transaksi dengan status "Selesai" yang dapat dibatalkan. Status saat ini: ${sale.status}.`);

        const itemsRes = await client.query('SELECT product_id, quantity FROM sale_items WHERE sale_id = $1', [saleId]);
        if (itemsRes.rows.length === 0) throw new Error('Item penjualan tidak ditemukan untuk transaksi ini.');

        for (const item of itemsRes.rows) {
            await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2', [item.quantity, item.product_id]);
        }

        if (sale.journal_id) {
            await client.query('DELETE FROM general_journal WHERE id = $1', [sale.journal_id]);
        }

        await client.query("UPDATE sales SET status = 'Dibatalkan' WHERE id = $1", [saleId]);

        await client.query('COMMIT');
        res.json({ message: 'Transaksi berhasil dibatalkan. Stok telah dikembalikan dan jurnal telah dihapus.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error cancelling sale:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membatalkan transaksi.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getPublicProducts,
    getPendingSales,
    getSaleDetailsByOrderId,
    getSaleItemsByOrderId,
    validateMemberByCoopNumber: require('../controllers/auth.controller').validateMemberByCoopNumber,
    createSaleOrder,
    completeOrder,
    cancelSale
};