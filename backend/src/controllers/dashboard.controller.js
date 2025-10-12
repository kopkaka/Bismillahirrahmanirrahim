const pool = require('../../db');
const dashboardService = require('../services/dashboard.service');

const getDashboardStats = async (req, res) => {
    try {
        const stats = await dashboardService.getDashboardStats();
        res.json(stats);
    } catch (err) {
        console.error('Error fetching dashboard stats:', err.message);
        res.status(500).json({ error: 'Gagal mengambil statistik dasbor.' });
    }
};

const getCashFlowSummary = async (req, res) => {
    try {
        const data = await dashboardService.getCashFlowSummary(req.query.startDate, req.query.endDate);
        res.json(data);
    } catch (err) {
        console.error('Error fetching cash flow summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan arus kas.' });
    }
};

const getMemberGrowth = async (req, res) => {
    try {
        const data = await dashboardService.getMemberGrowth();
        res.json(data);
    } catch (err) {
        console.error('Error fetching member growth data:', err.message);
        res.status(500).json({ error: 'Gagal mengambil data pertumbuhan anggota.' });
    }
};

const getBalanceSheetSummary = async (req, res) => {
    try {
        const summary = await dashboardService.getBalanceSheetSummary();
        res.json(summary);
    } catch (err) {
        console.error('Error generating balance sheet summary:', err.message);
        res.status(500).json({ error: 'Gagal membuat ringkasan neraca.' });
    }
};

const getIncomeStatementSummary = async (req, res) => {
    try {
        const processedData = await dashboardService.getIncomeStatementSummary(req.query.year);
        res.json(processedData);
    } catch (err) {
        console.error('Error fetching income statement summary:', err.message);
        res.status(500).json({ error: 'Gagal mengambil ringkasan laba rugi.' });
    }
};

module.exports = {
    getDashboardStats,
    getCashFlowSummary,
    getMemberGrowth,
    getBalanceSheetSummary,
    getIncomeStatementSummary
};