const pool = require('../../db');
const fs = require('fs');
const path = require('path');
/**
 * @desc    Get products. Can be filtered by shop type.
 * @route   GET /api/admin/products?shop=... or /api/public/products?shop=...
 * @access  Private/Public
 */
const getProducts = async (req, res) => {
    const { shop } = req.query;
    try {
        // Cek apakah permintaan datang dari rute publik menggunakan originalUrl
        // yang berisi path lengkap, contoh: /api/public/products
        const isPublicRequest = req.originalUrl.includes('/public/');

        let query = 'SELECT id, name, description, price, stock, image_url, shop_type FROM products';
        const values = [];
        let whereClauses = [];

        if (shop) {
            whereClauses.push(`shop_type = $${values.length + 1}`);
            values.push(shop);
        }
        // Hanya tampilkan produk dengan stok > 0 untuk rute publik
        if (isPublicRequest) {
            whereClauses.push('stock > 0');
        }
        if (whereClauses.length > 0) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        query += ' ORDER BY name ASC';
        const result = await pool.query(query, values);
        res.json(result.rows);
    } catch (err) {
        // Log the shop type if it exists for better debugging
        const shopIdentifier = shop ? ` for shop [${shop}]` : '';
        console.error(`Error fetching products${shopIdentifier}:`, err.message);
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

/**
 * @desc    Validates a member by their cooperative number for cashier use.
 * @route   GET /api/admin/validate-member/:cooperativeNumber
 * @access  Admin, Kasir
 */
const validateMemberForCashier = async (req, res) => {
    const { cooperativeNumber } = req.params;
    try {
        const result = await pool.query(
            "SELECT id, name, cooperative_number FROM members WHERE cooperative_number = $1 AND status = 'Active'",
            [cooperativeNumber]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Anggota tidak ditemukan atau tidak aktif.' });
        }
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Gagal memvalidasi anggota.' }); }
};

/**
 * @desc    Get products for admin-side use (e.g., cashier)
 * @route   GET /api/admin/products
 * @access  Private (Admin, Kasir)
 */
const getAdminProducts = async (req, res) => {
    // This function now correctly reuses the more flexible getProducts logic.
    return getProducts(req, res);
};

module.exports = {
    getProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    getAdminProducts,
    validateMemberForCashier, // Tambahkan fungsi baru ini
    cancelSale
};