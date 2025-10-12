const pool = require('../../db');

const getLogisticsEntries = async (req, res) => {
    try {
        const query = `
            SELECT 
                le.id,
                le.reference_number AS "referenceNumber",
                le.entry_date,
                mp.name AS "productName",
                s.name AS "supplierName",
                le.quantity,
                le.unit,
                le.purchase_price AS "purchasePrice",
                le.total_amount AS "totalAmount",
                le.status
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            LEFT JOIN master_products mp ON le.master_product_id = mp.id
            ORDER BY le.entry_date DESC, le.created_at DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching logistics entries:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data logistik.' });
    }
};

const getAvailableLogisticsProducts = async (req, res) => {
    const { shopType } = req.params;
    try {
        const query = `
            SELECT
                mp.name AS "productName",
                mp.default_unit AS "unit",
                (SELECT COALESCE(SUM(l.quantity), 0) FROM logistics_entries l WHERE l.master_product_id = mp.id AND l.status = 'Received') AS "availableStock"
            FROM master_products mp
            WHERE NOT EXISTS (
                SELECT 1 
                FROM products p 
                WHERE p.name = mp.name AND p.shop_type = $1
            )
            ORDER BY "productName" ASC
        `;
        const result = await pool.query(query, [shopType]);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching available logistics products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data produk dari logistik.' });
    }
};

const createLogisticsEntry = async (req, res) => {
    const { entry_date, supplier_id, products, reference_number } = req.body;

    if (!entry_date || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({ error: 'Data tidak lengkap. Tanggal dan minimal satu produk diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let finalReferenceNumber = reference_number;
        if (!finalReferenceNumber) {
            const date = new Date(entry_date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const prefix = `LOG-${year}${month}${day}-`;

            const seqResult = await client.query(
                "SELECT COUNT(DISTINCT reference_number) FROM logistics_entries WHERE reference_number LIKE $1",
                [`${prefix}%`]
            );
            const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
            finalReferenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;
        }

        const insertQuery = `
            INSERT INTO logistics_entries (entry_date, supplier_id, master_product_id, quantity, unit, purchase_price, reference_number) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;

        for (const product of products) {
            if (!product.master_product_id || !product.quantity || !product.unit || !product.purchase_price) {
                throw new Error('Setiap baris produk harus memiliki produk terpilih, qty, unit, dan harga beli.');
            }
            const values = [entry_date, supplier_id || null, product.master_product_id, product.quantity, product.unit, product.purchase_price, finalReferenceNumber];
            await client.query(insertQuery, values);
        }

        await client.query('COMMIT');
        res.status(201).json({ message: 'Data logistik berhasil disimpan.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating logistics entry:', err.message);
        res.status(500).json({ error: err.message || 'Gagal menyimpan data logistik.' });
    } finally {
        client.release();
    }
};

const getLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    try {
        const query = `
            SELECT
                le.id, le.reference_number, le.entry_date, le.quantity, le.unit, le.purchase_price, le.total_amount, le.status,
                mp.name AS "productName",
                s.name AS "supplierName", s.id as "supplierId"
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            LEFT JOIN master_products mp ON le.master_product_id = mp.id
            WHERE le.reference_number = $1
            ORDER BY le.id ASC
        `;
        const result = await pool.query(query, [ref]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Data logistik tidak ditemukan.' });
        }

        const firstRow = result.rows[0];
        const responseData = {
            header: { referenceNumber: firstRow.reference_number, entryDate: firstRow.entry_date, supplierName: firstRow.supplierName, supplierId: firstRow.supplierId, status: firstRow.status },
            products: result.rows.map(row => ({ id: row.id, productName: row.product_name, quantity: row.quantity, unit: row.unit, purchasePrice: row.purchase_price, totalAmount: row.total_amount }))
        };

        res.json(responseData);
    } catch (err) {
        console.error('Error fetching logistics by reference:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail logistik.' });
    }
};

const updateLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    const { entry_date, supplier_id, products, reference_number } = req.body;

    if (!entry_date || !Array.isArray(products) || products.length === 0 || !reference_number) {
        return res.status(400).json({ error: 'Data tidak lengkap.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM logistics_entries WHERE reference_number = $1', [ref]);

        const insertQuery = `
            INSERT INTO logistics_entries (entry_date, supplier_id, master_product_id, quantity, unit, purchase_price, reference_number) 
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        for (const product of products) {
            if (!product.master_product_id || !product.quantity || !product.unit || !product.purchase_price) {
                throw new Error('Setiap baris produk harus lengkap.');
            }
            const values = [entry_date, supplier_id || null, product.master_product_id, product.quantity, product.unit, product.purchase_price, reference_number];
            await client.query(insertQuery, values);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'Data logistik berhasil diperbarui.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error updating logistics entry:', err.message);
        res.status(500).json({ error: err.message || 'Gagal memperbarui data logistik.' });
    } finally {
        client.release();
    }
};

const deleteLogisticsByReference = async (req, res) => {
    const { ref } = req.params;
    try {
        await pool.query('DELETE FROM logistics_entries WHERE reference_number = $1', [ref]);
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting logistics by reference:', err.message);
        res.status(500).json({ error: 'Gagal menghapus data logistik.' });
    }
};

const getMasterProducts = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM master_products ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching master products:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data item produk.' });
    }
};

const createMasterProduct = async (req, res) => {
    const { item_number, name, description, default_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama item produk wajib diisi.' });
    try {
        const query = 'INSERT INTO master_products (item_number, name, description, default_unit) VALUES ($1, $2, $3, $4) RETURNING *';
        const result = await pool.query(query, [item_number || null, name, description || null, default_unit || null]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Nomor item atau nama item sudah ada.' });
        console.error('Error creating master product:', err.message);
        res.status(500).json({ error: 'Gagal membuat item produk baru.' });
    }
};

const updateMasterProduct = async (req, res) => {
    const { id } = req.params;
    const { item_number, name, description, default_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama item produk wajib diisi.' });
    try {
        const query = 'UPDATE master_products SET item_number = $1, name = $2, description = $3, default_unit = $4 WHERE id = $5 RETURNING *';
        const result = await pool.query(query, [item_number || null, name, description || null, default_unit || null, id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item produk tidak ditemukan.' });
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Nomor item atau nama item sudah ada.' });
        console.error('Error updating master product:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui item produk.' });
    }
};

const deleteMasterProduct = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM master_products WHERE id = $1', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item produk tidak ditemukan.' });
        res.status(204).send();
    } catch (err) {
        if (err.code === '23503') return res.status(400).json({ error: 'Gagal menghapus. Item ini masih digunakan di data logistik.' });
        console.error('Error deleting master product:', err.message);
        res.status(500).json({ error: 'Gagal menghapus item produk.' });
    }
};

module.exports = {
    getLogisticsEntries,
    getAvailableLogisticsProducts,
    createLogisticsEntry,
    getLogisticsByReference,
    updateLogisticsByReference,
    deleteLogisticsByReference,
    getMasterProducts,
    createMasterProduct,
    updateMasterProduct,
    deleteMasterProduct
};