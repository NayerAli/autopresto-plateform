﻿const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth');
const { getDatabase } = require('../config/database');
const logger = require('../utils/logger');

router.get('/', isAuthenticated, async (req, res) => {
  try {
    const db = getDatabase();
    const reports = await new Promise((resolve, reject) => {
      db.all(`
        SELECT 
          ir.report_id,
          ir.date,
          ir.client_name,
          ir.client_phone,
          ir.created_at,
          v.license_plate,
          u.user_name as technician_name
        FROM InspectionReports ir
        JOIN Vehicules v ON ir.vehicle_id = v.vehicle_id
        LEFT JOIN Users u ON ir.technician_id = u.user_id
        ORDER BY ir.created_at DESC
        LIMIT 10
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    res.render('dashboard', {
      reports,
      errors: [],
      success: req.flash('success'),
      user: req.session.user
    });
  } catch (error) {
    logger.error('Error loading dashboard:', error);
    res.render('dashboard', {
      reports: [],
      errors: ['Error loading reports'],
      user: req.session.user
    });
  }
});

module.exports = router;
