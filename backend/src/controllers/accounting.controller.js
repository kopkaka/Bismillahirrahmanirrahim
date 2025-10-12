const pool = require('../../db');
const { getAccountIds } = require('../utils/getAccountIds.util');

const getReceivableLogistics = async (req, res) => {
    try {
        const query = `
            SELECT 
                le.reference_number,
                MIN(le.entry_date) as entry_date,
                s.name as supplier_name,
                SUM(le.total_amount) as total_purchase
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            WHERE le.status = 'Pending'
            GROUP BY le.reference_number, s.name
            ORDER BY MIN(le.entry_date) ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching receivable logistics:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data penerimaan barang.' });
    }
};

const receiveLogisticsItems = async (req, res) => {
    const { referenceNumber } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const itemsRes = await client.query(`
            SELECT le.*, mp.name as product_name
            FROM logistics_entries le
            JOIN master_products mp ON le.master_product_id = mp.id
            WHERE le.reference_number = $1 AND le.status = $2 FOR UPDATE
        `, [referenceNumber, 'Pending']);
        if (itemsRes.rows.length === 0) {
            throw new Error('Tidak ada barang yang bisa diterima untuk nomor referensi ini atau sudah diterima.');
        }
        const items = itemsRes.rows;
        const supplierId = items[0].supplier_id;
        const entryDate = items[0].entry_date;
        const totalAmount = items.reduce((sum, item) => sum + parseFloat(item.total_amount), 0);

        // --- Optimization: Bulk update product stock using a single query ---
        const stockUpdateQuery = `
            UPDATE products SET stock = stock + temp.quantity
            FROM (VALUES ${items.map((_, i) => `($${i*2+1}, $${i*2+2}::integer)`).join(', ')})
            AS temp(name, quantity)
            WHERE products.name = temp.name;
        `;
        const stockUpdateValues = items.flatMap(item => [item.product_name, item.quantity]);
        await client.query(stockUpdateQuery, stockUpdateValues);

        // --- Refactoring: Fetch account IDs dynamically ---
        const accountIds = await getAccountIds(['Persediaan Barang Dagang', 'Hutang Usaha'], client);
        const inventoryAccountId = accountIds['Persediaan Barang Dagang'];
        const payableAccountId = accountIds['Hutang Usaha'];

        if (!inventoryAccountId || !payableAccountId) {
            throw new Error('Akun "Persediaan Barang Dagang" atau "Hutang Usaha" tidak ditemukan di COA.');
        }

        const description = `Pembelian barang dari supplier ref: ${referenceNumber}`;
        
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [entryDate, description, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;

        // Journal: Debit Inventory, Credit Accounts Payable
        const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
        await client.query(journalEntriesQuery, [journalId, inventoryAccountId, totalAmount, payableAccountId]);

        // Create the payable record
        await client.query(
            'INSERT INTO accounts_payable (supplier_id, reference_number, transaction_date, total_amount, journal_id) VALUES ($1, $2, $3, $4, $5)',
            [supplierId, referenceNumber, entryDate, totalAmount, journalId]
        );

        // Mark logistics entries as received
        await client.query(
            "UPDATE logistics_entries SET status = 'Received' WHERE reference_number = $1",
            [referenceNumber]
        );

        await client.query('COMMIT');
        res.json({ message: `Barang dengan referensi ${referenceNumber} berhasil diterima.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error receiving logistics items:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses penerimaan barang.' });
    } finally {
        client.release();
    }
};

const getPayables = async (req, res) => {
    const { search, status, startDate, endDate, page = 1, limit = 10 } = req.query;

    try {
        let baseQuery = `
            FROM accounts_payable ap
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
        `;
        
        const conditions = [];
        const values = [];
        let paramIndex = 1;

        if (search) {
            conditions.push(`(s.name ILIKE $${paramIndex} OR ap.reference_number ILIKE $${paramIndex})`);
            values.push(`%${search}%`);
            paramIndex++;
        }
        if (status) {
            conditions.push(`ap.status = $${paramIndex++}`);
            values.push(status);
        }
        if (startDate) {
            conditions.push(`ap.transaction_date >= $${paramIndex++}`);
            values.push(startDate);
        }
        if (endDate) {
            conditions.push(`ap.transaction_date <= $${paramIndex++}`);
            values.push(endDate);
        }

        const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
        
        const countQuery = `SELECT COUNT(ap.id) ${baseQuery}${whereClause}`;
        const countResult = await pool.query(countQuery, values);
        const totalItems = parseInt(countResult.rows[0].count, 10);
        const totalPages = Math.ceil(totalItems / limit) || 1;
        const offset = (page - 1) * limit;

        const dataQuery = `
            SELECT 
                ap.id,
                ap.reference_number,
                ap.transaction_date,
                ap.total_amount,
                ap.amount_paid,
                (ap.total_amount - ap.amount_paid) as remaining_amount,
                ap.status,
                s.name as supplier_name
            ${baseQuery}${whereClause}
            ORDER BY ap.status ASC, ap.transaction_date ASC
            LIMIT $${paramIndex++} OFFSET $${paramIndex++}
        `;

        const dataResult = await pool.query(dataQuery, [...values, limit, offset]);

        res.json({
            data: dataResult.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: parseInt(page, 10),
                limit: parseInt(limit, 10)
            }
        });
    } catch (err) {
        console.error('Error fetching payables:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data hutang usaha.' });
    }
};

const getPayableDetails = async (req, res) => {
    const { id } = req.params;
    try {
        const headerQuery = `
            SELECT ap.*, s.name as supplier_name 
            FROM accounts_payable ap 
            LEFT JOIN suppliers s ON ap.supplier_id = s.id
            WHERE ap.id = $1
        `;
        const paymentsQuery = 'SELECT * FROM ap_payments WHERE payable_id = $1 ORDER BY payment_date DESC';

        const [headerRes, paymentsRes] = await Promise.all([
            pool.query(headerQuery, [id]),
            pool.query(paymentsQuery, [id])
        ]);

        if (headerRes.rows.length === 0) {
            return res.status(404).json({ error: 'Data hutang tidak ditemukan.' });
        }

        res.json({
            header: headerRes.rows[0],
            payments: paymentsRes.rows
        });
    } catch (err) {
        console.error('Error fetching payable details:', err.message);
        res.status(500).json({ error: 'Gagal mengambil detail hutang.' });
    }
};

const recordPayablePayment = async (req, res) => {
    const { payableId, paymentDate, amount, paymentMethod } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const payableRes = await client.query('SELECT * FROM accounts_payable WHERE id = $1 FOR UPDATE', [payableId]);
        if (payableRes.rows.length === 0) throw new Error('Hutang tidak ditemukan.');
        const payable = payableRes.rows[0];
        
        const amountToPay = parseFloat(amount);
        if (isNaN(amountToPay) || amountToPay <= 0) throw new Error('Jumlah pembayaran tidak valid.');

        const newAmountPaid = parseFloat(payable.amount_paid) + amountToPay;
        if (newAmountPaid > parseFloat(payable.total_amount)) {
            throw new Error('Jumlah pembayaran melebihi sisa hutang.');
        }

        // --- Refactoring: Fetch account IDs dynamically ---
        const accountIds = await getAccountIds(['Hutang Usaha', 'Kas'], client);
        const payableAccountId = accountIds['Hutang Usaha'];
        const cashAccountId = accountIds['Kas'];
        if (!payableAccountId || !cashAccountId) {
            throw new Error('Akun "Hutang Usaha" atau "Kas" tidak ditemukan di COA.');
        }

        const description = `Pembayaran hutang ke supplier ref: ${payable.reference_number}`;
        
        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [paymentDate, description, payable.reference_number]);
        const journalId = journalHeaderRes.rows[0].id;

        const journalEntriesQuery = 'INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3)';
        await client.query(journalEntriesQuery, [journalId, payableAccountId, amountToPay, cashAccountId]);

        await client.query(
            'INSERT INTO ap_payments (payable_id, payment_date, amount, payment_method, journal_id) VALUES ($1, $2, $3, $4, $5)',
            [payableId, paymentDate, amountToPay, paymentMethod, journalId]
        );

        const newStatus = newAmountPaid >= parseFloat(payable.total_amount) ? 'Paid' : 'Partially Paid';
        await client.query(
            'UPDATE accounts_payable SET amount_paid = $1, status = $2 WHERE id = $3',
            [newAmountPaid, newStatus, payableId]
        );

        await client.query('COMMIT');
        res.json({ message: 'Pembayaran berhasil dicatat.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error recording payable payment:', err.message);
        res.status(400).json({ error: err.message || 'Gagal mencatat pembayaran.' });
    } finally {
        client.release();
    }
};

const getStockCardHistory = async (req, res) => {
    const { productId } = req.query;

    if (!productId) {
        return res.json([]);
    }

    try {
        const productRes = await pool.query('SELECT name FROM products WHERE id = $1', [productId]);
        if (productRes.rows.length === 0) return res.status(404).json({ error: 'Produk toko tidak ditemukan.' });
        const productName = productRes.rows[0].name;
        const masterProductRes = await pool.query('SELECT id FROM master_products WHERE name = $1', [productName]);
        const masterProductId = masterProductRes.rows[0]?.id;

        if (!masterProductId) {
            return res.json([]); // No master product found, so no history
        }

        // --- Refactoring: Include stock out from sales ---
        const inQuery = `
            SELECT 
                entry_date as date,
                'Penerimaan dari ' || COALESCE(s.name, 'N/A') || ' (Ref: ' || reference_number || ')' as description,
                quantity as "in_qty",
                0 as "out_qty",
                'IN' as type
            FROM logistics_entries le
            LEFT JOIN suppliers s ON le.supplier_id = s.id
            WHERE le.master_product_id = $1 AND le.status = 'Received'
        `;

        const outQuery = `
            SELECT
                s.sale_date as date,
                'Penjualan (Struk: ' || s.order_id || ')' as description,
                0 as "in_qty",
                si.quantity as "out_qty",
                'OUT' as type
            FROM sale_items si
            JOIN sales s ON si.sale_id = s.id
            WHERE si.product_id = $1 AND s.status = 'Selesai'
        `;

        const movementsQuery = `(${inQuery}) UNION ALL (${outQuery}) ORDER BY date ASC, type ASC`;
        const movementsRes = await pool.query(movementsQuery, [masterProductId]);
        
        let runningBalance = 0;
        const history = movementsRes.rows.map(mov => {
            const in_qty = parseInt(mov.in_qty, 10) || 0;
            const out_qty = parseInt(mov.out_qty, 10) || 0;
            runningBalance += in_qty - out_qty;
            // Return a new object to avoid modifying the original row object
            return { date: mov.date, description: mov.description, in_qty, out_qty, balance: runningBalance };
        });

        res.json(history);

    } catch (err) {
        console.error('Error fetching stock card history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat kartu stok.' });
    }
};

const createCashSale = async (req, res) => {
    const { items, paymentMethod, memberId, loanTermId } = req.body;
    const createdByUserId = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Keranjang belanja kosong.' });
    }
    const isLedgerPayment = paymentMethod.toLowerCase().includes('gaji') || paymentMethod.toLowerCase().includes('ledger');
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (paymentMethod === 'Employee Ledger') {
            if (!memberId) throw new Error('ID Anggota diperlukan untuk pembayaran Potong Gaji.');
            const memberRes = await client.query('SELECT id FROM members WHERE id = $1 AND status = \'Active\'', [memberId]);
            if (memberRes.rows.length === 0) throw new Error(`Anggota dengan ID ${memberId} tidak ditemukan atau tidak aktif.`);
        }

        let totalSaleAmount = 0;
        let totalCostOfGoodsSold = 0;
        const processedItems = [];
        let shopType = null;

        for (const item of items) {
            const productRes = await client.query('SELECT name, price, stock, shop_type FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
            if (productRes.rows.length === 0) throw new Error(`Produk dengan ID ${item.productId} tidak ditemukan.`);
            
            const product = productRes.rows[0];
            const requestedQty = parseInt(item.quantity, 10);

            if (!shopType) shopType = product.shop_type;

            if (product.stock < requestedQty) throw new Error(`Stok tidak mencukupi untuk produk "${product.name}". Sisa stok: ${product.stock}.`);

            const cogsRes = await client.query(
                `SELECT le.purchase_price FROM logistics_entries le JOIN master_products mp ON le.master_product_id = mp.id WHERE mp.name = $1 AND le.status = 'Received' ORDER BY le.entry_date DESC, le.id DESC LIMIT 1`,
                 [product.name]
            );
            const costPerItem = cogsRes.rows.length > 0 ? parseFloat(cogsRes.rows[0].purchase_price) : 0;

            await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [requestedQty, item.productId]);

            const pricePerItem = parseFloat(product.price);
            totalSaleAmount += pricePerItem * requestedQty;
            totalCostOfGoodsSold += costPerItem * requestedQty;

            processedItems.push({ ...item, name: product.name, pricePerItem, costPerItem });
        }

        const orderId = `CASH-${Date.now()}`;

        const saleRes = await client.query(
            'INSERT INTO sales (order_id, total_amount, payment_method, created_by_user_id, member_id, sale_date, status, shop_type) VALUES ($1, $2, $3, $4, $5, NOW(), \'Selesai\', $6) RETURNING id, order_id, sale_date',
            [orderId, totalSaleAmount, paymentMethod, createdByUserId, memberId || null, shopType]
        );
        const saleId = saleRes.rows[0].id;

        const saleItemsQueryParts = processedItems.map((_, i) => `($1, $${i*4 + 2}, $${i*4 + 3}, $${i*4 + 4}, $${i*4 + 5})`).join(', ');
        const saleItemsValues = [saleId, ...processedItems.flatMap(p => [p.productId, p.quantity, p.pricePerItem, p.costPerItem])];
        await client.query(`INSERT INTO sale_items (sale_id, product_id, quantity, price, cost_per_item) VALUES ${saleItemsQueryParts}`, saleItemsValues);

        let journalId = null;
        if (isLedgerPayment) {
            if (!loanTermId) throw new Error('Tenor pinjaman wajib dipilih untuk pembayaran Potong Gaji.');

            const termRes = await client.query('SELECT loan_type_id FROM loan_terms WHERE id = $1', [loanTermId]);
            if (termRes.rows.length === 0) throw new Error('Tenor pinjaman tidak valid.');
            const loanTypeId = termRes.rows[0].loan_type_id;

            const loanInsertQuery = `INSERT INTO loans (member_id, loan_type_id, loan_term_id, amount, date, status, remaining_principal) VALUES ($1, $2, $3, $4, NOW(), 'Approved', $4) RETURNING id`;
            const newLoanRes = await client.query(loanInsertQuery, [memberId, loanTypeId, loanTermId, totalSaleAmount]);
            const newLoanId = newLoanRes.rows[0].id;

            await client.query('UPDATE sales SET loan_id = $1 WHERE id = $2', [newLoanId, saleId]);
        } else {
            const paymentMethodRes = await client.query('SELECT account_id FROM payment_methods WHERE name = $1', [paymentMethod]);
            if (paymentMethodRes.rows.length === 0 || !paymentMethodRes.rows[0].account_id) {
                throw new Error(`Metode pembayaran "${paymentMethod}" tidak valid atau belum terhubung ke akun COA.`);
            } 
            const debitAccountId = paymentMethodRes.rows[0].account_id;
            
            // --- Refactoring: Fetch account IDs dynamically ---
            const accountIds = await getAccountIds(['Persediaan Barang Dagang', 'Pendapatan Penjualan', 'Beban Pokok Penjualan'], client);
            const inventoryAccountId = accountIds['Persediaan Barang Dagang'];
            const salesRevenueAccountId = accountIds['Pendapatan Penjualan'];
            const cogsAccountId = accountIds['Beban Pokok Penjualan'];
            if (!inventoryAccountId || !salesRevenueAccountId || !cogsAccountId) throw new Error('Satu atau lebih akun penting untuk penjualan (Persediaan, Pendapatan, HPP) tidak ditemukan di COA.');

            const description = `Penjualan Tunai Toko (Kasir Umum) Struk #${saleId}`;
            const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES (NOW(), $1, $2) RETURNING id', [description, `CASH-SALE-${saleId}`]);
            journalId = journalHeaderRes.rows[0].id;

            const journalEntriesQuery = `INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ($1, $2, $3, 0), ($1, $4, 0, $3), ($1, $5, $6, 0), ($1, $7, 0, $6)`;
            await client.query(journalEntriesQuery, [journalId, debitAccountId, totalSaleAmount, salesRevenueAccountId, cogsAccountId, totalCostOfGoodsSold, inventoryAccountId]);
        }

        if (journalId) {
            await client.query('UPDATE sales SET journal_id = $1 WHERE id = $2', [journalId, saleId]);
        }

        await client.query('COMMIT');
        
        const receiptData = {
            saleId: saleId,
            orderId: saleRes.rows[0].order_id,
            saleDate: saleRes.rows[0].sale_date,
            totalAmount: totalSaleAmount,
            paymentMethod: paymentMethod,
            items: processedItems.map(p => ({ name: p.name, quantity: p.quantity, price: p.pricePerItem, subtotal: p.quantity * p.pricePerItem })),
            cashierName: req.user.name
        };

        res.status(201).json({ message: 'Penjualan tunai berhasil dicatat.', receiptData: receiptData });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating cash sale:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses penjualan tunai.' });
    } finally {
        client.release();
    }
};

const getGeneralLedger = async (req, res) => {
    const { startAccountId, endAccountId, startDate, endDate } = req.query;

    if (!startAccountId || !endAccountId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Rentang akun, tanggal mulai, dan tanggal akhir diperlukan.' });
    }

    const client = await pool.connect();
    try {
        const startAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [startAccountId]);
        const endAccountRes = await client.query('SELECT account_number FROM chart_of_accounts WHERE id = $1', [endAccountId]);

        if (startAccountRes.rows.length === 0) throw new Error('Akun awal tidak ditemukan.');
        if (endAccountRes.rows.length === 0) throw new Error('Akun akhir tidak ditemukan.');

        const startAccountNumber = startAccountRes.rows[0].account_number;
        const endAccountNumber = endAccountRes.rows[0].account_number;

        const [finalStart, finalEnd] = startAccountNumber <= endAccountNumber ? [startAccountNumber, endAccountNumber] : [endAccountNumber, startAccountNumber];

        const accountsToProcessRes = await client.query(
            `SELECT id, account_number, account_name, account_type FROM chart_of_accounts WHERE account_number >= $1 AND account_number <= $2 ORDER BY account_number ASC`,
            [finalStart, finalEnd]
        );
        const accountsToProcess = accountsToProcessRes.rows;

        if (accountsToProcess.length === 0) return res.json([]);

        const allLedgers = [];

        for (const account of accountsToProcess) {
            const isDebitNormalBalance = ['Aset', 'HPP', 'Biaya'].includes(account.account_type);

            const beginningBalanceQuery = `SELECT COALESCE(SUM(CASE WHEN $1 THEN je.debit - je.credit ELSE je.credit - je.debit END), 0) as balance FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $2 AND gj.entry_date < $3`;
            const transactionsQuery = `SELECT gj.entry_date, gj.description, gj.reference_number, je.debit, je.credit FROM journal_entries je JOIN general_journal gj ON je.journal_id = gj.id WHERE je.account_id = $1 AND gj.entry_date BETWEEN $2 AND $3 ORDER BY gj.entry_date ASC, gj.id ASC`;

            const [beginningBalanceRes, transactionsRes] = await Promise.all([
                client.query(beginningBalanceQuery, [isDebitNormalBalance, account.id, startDate]),
                client.query(transactionsQuery, [account.id, startDate, endDate])
            ]);

            let runningBalance = parseFloat(beginningBalanceRes.rows[0].balance);
            const beginningBalance = runningBalance;

            const transactions = transactionsRes.rows.map(tx => {
                const debit = parseFloat(tx.debit);
                const credit = parseFloat(tx.credit);
                runningBalance += isDebitNormalBalance ? (debit - credit) : (credit - debit);
                return { date: tx.entry_date, description: tx.description, reference: tx.reference_number, debit, credit, balance: runningBalance };
            });

            if (transactions.length > 0 || Math.abs(beginningBalance) > 0.001) {
                allLedgers.push({
                    account: { id: account.id, account_number: account.account_number, account_name: account.account_name },
                    summary: { beginningBalance, endingBalance: runningBalance },
                    transactions
                });
            }
        }

        res.json(allLedgers);
    } catch (err) {
        console.error('Error generating general ledger:', err.message);
        res.status(500).json({ error: 'Gagal membuat laporan buku besar.' });
    } finally {
        client.release();
    }
};

const getMonthlyClosingStatus = async (req, res) => {
    const { year } = req.query;

    if (!year || isNaN(parseInt(year))) {
        return res.status(400).json({ error: 'Tahun yang valid diperlukan.' });
    }

    try {
        const closedMonthsRes = await pool.query(
            'SELECT month, closed_at, net_income FROM monthly_closings WHERE year = $1',
            [year]
        );
        const closedMonthsMap = new Map(closedMonthsRes.rows.map(row => [row.month, row]));

        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const report = [];

        for (let i = 1; i <= 12; i++) {
            const closedData = closedMonthsMap.get(i);
            report.push({ month: i, monthName: monthNames[i - 1], status: closedData ? 'Ditutup' : 'Terbuka', closedAt: closedData ? closedData.closed_at : null, netIncome: closedData ? closedData.net_income : null, });
        }

        res.json(report);
    } catch (err) {
        console.error('Error fetching monthly closing status:', err.message);
        res.status(500).json({ error: 'Gagal mengambil status tutup buku.' });
    }
};

const getMonthlyClosings = async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT year, month, closed_at, net_income FROM monthly_closings ORDER BY year DESC, month DESC LIMIT 12'
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching monthly closings history:', err.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat tutup buku.' });
    }
};

const processMonthlyClosing = async (req, res) => {
    const { year, month } = req.body;
    const { id: userId } = req.user;

    if (!year || !month) {
        return res.status(400).json({ error: 'Tahun dan bulan diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existingClosing = await client.query('SELECT * FROM monthly_closings WHERE year = $1 AND month = $2', [year, month]);
        if (existingClosing.rows.length > 0) throw new Error(`Bulan ${month}/${year} sudah pernah ditutup.`);

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        const accountsToCloseQuery = `SELECT coa.id, coa.account_type, COALESCE(SUM(CASE WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit ELSE je.debit - je.credit END), 0) as balance FROM journal_entries je JOIN chart_of_accounts coa ON je.account_id = coa.id JOIN general_journal gj ON je.journal_id = gj.id WHERE gj.entry_date BETWEEN $1 AND $2 AND coa.account_type IN ('Pendapatan', 'HPP', 'Biaya') GROUP BY coa.id, coa.account_type HAVING COALESCE(SUM(CASE WHEN coa.account_type = 'Pendapatan' THEN je.credit - je.debit ELSE je.debit - je.credit END), 0) != 0;`;
        const accountsToCloseRes = await client.query(accountsToCloseQuery, [startDate, endDate]);
        const accountsToClose = accountsToCloseRes.rows;

        if (accountsToClose.length === 0) {
            await client.query('INSERT INTO monthly_closings (year, month, closed_by_user_id, net_income) VALUES ($1, $2, $3, 0)', [year, month, userId]);
            await client.query('COMMIT');
            return res.json({ message: `Tidak ada transaksi pendapatan/biaya pada periode ${month}/${year}. Bulan ditandai sebagai ditutup.` });
        }

        let netIncome = 0;
        const closingEntries = [];
        accountsToClose.forEach(acc => {
            const balance = parseFloat(acc.balance);
            netIncome += balance;
            if (acc.account_type === 'Pendapatan') closingEntries.push({ account_id: acc.id, debit: balance, credit: 0 });
            else closingEntries.push({ account_id: acc.id, debit: 0, credit: balance });
        });

        const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const description = `Jurnal Penutup Bulan ${monthNames[month - 1]} ${year}`;

        const entryDate = new Date(endDate);
        const refYear = entryDate.getFullYear();
        const refMonth = String(entryDate.getMonth() + 1).padStart(2, '0');
        const refDay = String(entryDate.getDate()).padStart(2, '0');
        const prefix = `JRNL-${refYear}${refMonth}${refDay}-`;

        const seqResult = await client.query("SELECT COUNT(*) FROM general_journal WHERE reference_number LIKE $1", [`${prefix}%`]);
        const nextSeq = parseInt(seqResult.rows[0].count, 10) + 1;
        const referenceNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

        const journalHeaderRes = await client.query('INSERT INTO general_journal (entry_date, description, reference_number) VALUES ($1, $2, $3) RETURNING id', [endDate, description, referenceNumber]);
        const journalId = journalHeaderRes.rows[0].id;

        const incomeSummaryAccountRes = await client.query("SELECT id FROM chart_of_accounts WHERE account_number = '3-2110'");
        if (incomeSummaryAccountRes.rows.length === 0) throw new Error("Akun 'Ikhtisar Laba Rugi' (3-2110) tidak ditemukan di COA.");
        const incomeSummaryAccountId = incomeSummaryAccountRes.rows[0].id;

        if (netIncome > 0) closingEntries.push({ account_id: incomeSummaryAccountId, debit: 0, credit: netIncome });
        else if (netIncome < 0) closingEntries.push({ account_id: incomeSummaryAccountId, debit: -netIncome, credit: 0 });

        const journalQueryParts = closingEntries.map((_, i) => `($1, $${i*3 + 2}, $${i*3 + 3}, $${i*3 + 4})`);
        const journalValues = [journalId, ...closingEntries.flatMap(e => [e.account_id, e.debit, e.credit])];
        await client.query(`INSERT INTO journal_entries (journal_id, account_id, debit, credit) VALUES ${journalQueryParts.join(', ')}`, journalValues);

        await client.query('INSERT INTO monthly_closings (year, month, closed_by_user_id, net_income, journal_id) VALUES ($1, $2, $3, $4, $5)', [year, month, userId, netIncome, journalId]);

        await client.query('COMMIT');
        res.status(201).json({ message: `Proses tutup buku untuk ${monthNames[month - 1]} ${year} berhasil.` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error processing monthly closing:', err.message);
        res.status(400).json({ error: err.message || 'Gagal memproses tutup buku.' });
    } finally {
        client.release();
    }
};

const reopenMonthlyClosing = async (req, res) => {
    const { year, month } = req.body;

    if (!year || !month) {
        return res.status(400).json({ error: 'Tahun dan bulan diperlukan.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const closingRes = await client.query('SELECT journal_id FROM monthly_closings WHERE year = $1 AND month = $2 FOR UPDATE', [year, month]);
        if (closingRes.rows.length === 0) throw new Error(`Periode ${month}/${year} tidak ditemukan atau belum ditutup.`);
        const { journal_id } = closingRes.rows[0];

        const nextClosingRes = await client.query('SELECT 1 FROM monthly_closings WHERE (year > $1) OR (year = $1 AND month > $2) LIMIT 1', [year, month]);
        if (nextClosingRes.rows.length > 0) throw new Error('Tidak dapat membuka periode ini karena periode berikutnya sudah ditutup. Buka periode yang lebih baru terlebih dahulu.');

        if (journal_id) {
            await client.query('DELETE FROM general_journal WHERE id = $1', [journal_id]);
        }

        await client.query('DELETE FROM monthly_closings WHERE year = $1 AND month = $2', [year, month]);

        await client.query('COMMIT');
        res.json({ message: `Periode ${String(month).padStart(2, '0')}/${year} berhasil dibuka kembali.` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error reopening monthly closing:', err.message);
        res.status(400).json({ error: err.message || 'Gagal membuka kembali periode.' });
    } finally {
        client.release();
    }
};

module.exports = {
    getReceivableLogistics,
    receiveLogisticsItems,
    getPayables,
    getPayableDetails,
    recordPayablePayment,
    getStockCardHistory,
    createCashSale,
    getMonthlyClosings,
    processMonthlyClosing,
    reopenMonthlyClosing
};