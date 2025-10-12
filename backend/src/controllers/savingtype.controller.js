const pool = require('../../db');

const getSavingTypes = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM saving_types ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching saving types:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data tipe simpanan.' });
    }
};

const createSavingType = async (req, res) => {
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama tipe simpanan wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO saving_types (name, description) VALUES ($1, $2) RETURNING *',
            [name, description]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating saving type:', err.message);
        res.status(500).json({ error: 'Gagal membuat tipe simpanan baru.' });
    }
};

const updateSavingType = async (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Nama tipe simpanan wajib diisi.' });
    }
    try {
        const result = await pool.query(
            'UPDATE saving_types SET name = $1, description = $2 WHERE id = $3 RETURNING *',
            [name, description, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating saving type:', err.message);
        res.status(500).json({ error: 'Gagal memperbarui tipe simpanan.' });
    }
};

const deleteSavingType = async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM saving_types WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        }
        res.status(204).send();
    } catch (err) {
        console.error('Error deleting saving type:', err.message);
        res.status(500).json({ error: 'Gagal menghapus tipe simpanan.' });
    }
};

const mapSavingAccount = async (req, res) => {
    const { id } = req.params;
    const { accountId } = req.body;
    try {
        const result = await pool.query('UPDATE saving_types SET account_id = $1 WHERE id = $2 RETURNING *', [accountId, id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Tipe simpanan tidak ditemukan.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error mapping saving account:', err.message);
        res.status(500).json({ error: 'Gagal menyimpan maping akun.' });
    }
};

module.exports = {
    getSavingTypes,
    createSavingType,
    updateSavingType,
    deleteSavingType,
    mapSavingAccount,
};