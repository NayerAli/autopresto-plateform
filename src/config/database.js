﻿const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

let db;

const ensureDirectories = () => {
  const dirs = [
    path.join(process.cwd(), 'src', 'db'),
    path.join(process.cwd(), 'generated_reports')
  ];

  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

const initializeDatabase = () => {
  return new Promise((resolve, reject) => {
    ensureDirectories();
    
    const dbPath = path.join(process.cwd(), 'src', 'db', 'database.sqlite');
    logger.debug(`Attempting to create/open database at: ${dbPath}`);

    db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
      if (err) {
        logger.error('Error connecting to the database:', err);
        reject(err);
      } else {
        logger.debug(`Connected to the database at ${dbPath}`);
        createTables()
          // .then(() => temporaryDatabaseUpdate())
          .then(() => createDefaultAdminUser())
          .then(() => seedInspectionItems())
          .then(resolve)
          .catch(reject);
      }
    });
  });
};

const createTables = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users
      db.run(`CREATE TABLE IF NOT EXISTS Users (
        user_id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        role TEXT NOT NULL,
        password TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Customers
      db.run(`CREATE TABLE IF NOT EXISTS Customers (
        customer_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE,
        email TEXT UNIQUE,
        address TEXT,
        is_company BOOLEAN DEFAULT false
      )`);

      // Vehicules
      db.run(`CREATE TABLE IF NOT EXISTS Vehicules (
        vehicule_id TEXT PRIMARY KEY,
        license_plate TEXT UNIQUE NOT NULL,
        customer_id TEXT,
        brand TEXT,
        model TEXT,
        engine_code TEXT,
        revision_oil_type TEXT,
        revision_oil_volume TEXT,
        brake_disc_thickness_front TEXT,
        brake_disc_thickness_rear TEXT,
        first_registration_date TEXT,
        drain_plug_torque TEXT,
        FOREIGN KEY (customer_id) REFERENCES Customers(customer_id)
      )`);

      // InspectionItems
      db.run(`CREATE TABLE IF NOT EXISTS InspectionItems (
        item_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT CHECK(type IN ('checkbox', 'text', 'number', 'options')) NOT NULL,
        category TEXT NOT NULL,
        is_active BOOLEAN DEFAULT true,
        options TEXT,
        display_order INTEGER
      )`);

      // InspectionReports
      db.run(`CREATE TABLE IF NOT EXISTS InspectionReports (
        report_id TEXT PRIMARY KEY,
        vehicule_id TEXT NOT NULL,
        mileage INTEGER,
        comments TEXT,
        next_technical_inspection DATE,
        filters TEXT,
        inspection_results JSON NOT NULL DEFAULT '{}',
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        mechanics TEXT[] DEFAULT '{}',
        FOREIGN KEY (vehicule_id) REFERENCES Vehicules(vehicule_id),
        FOREIGN KEY (created_by) REFERENCES Users(user_id)
      )`, (err) => {
        if (err) {
          logger.error('Error creating tables:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  });
};

const getDatabase = () => {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase first.');
  }
  return db;
};

const addVehicle = (licensePlate, ownerName, contactInfo, vehiculeDetails = {}) => {
  return new Promise((resolve, reject) => {
    const vehiculeId = uuidv4();
    db.run(`INSERT INTO Vehicules (
      vehicule_id, 
      license_plate, 
      owner_name, 
      contact_info,
      brand,
      model,
      engine_code,
      revision_oil_type,
      revision_oil_volume,
      brake_disc_thickness_front,
      brake_disc_thickness_rear,
      drain_plug_torque
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vehiculeId, 
        licensePlate, 
        ownerName, 
        contactInfo,
        vehiculeDetails.brand || null,
        vehiculeDetails.model || null,
        vehiculeDetails.engine_code || null,
        vehiculeDetails.revision_oil_type || null,
        vehiculeDetails.revision_oil_volume || null,
        vehiculeDetails.brake_disc_thickness_front || null,
        vehiculeDetails.brake_disc_thickness_rear || null,
        vehiculeDetails.drain_plug_torque || null
      ],
      (err) => {
        if (err) reject(err);
        else resolve(vehiculeId);
      }
    );
  });
};

// ==================== Users ====================
const createDefaultAdminUser = async () => {
  const defaultUsername = 'admin';
  const defaultPassword = 'password123';
  const defaultEmail = 'admin@example.com';

  if (await getUserByUsername(defaultUsername) !== 'N/A') {
    logger.debug('Default admin user already exists. Skipping creation.');
    return;
  }

  await addUser(defaultUsername, defaultEmail, 'admin', defaultPassword);
};

const addUser = (username, email, role, password) => {
  return new Promise(async (resolve, reject) => {
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if email or username already exists
    db.get('SELECT * FROM Users WHERE email = ? OR username = ?', [email, username], (err, row) => {
      if (err) reject(err);
      if (row) reject(new Error('Email or username already exists'));
    });
    
    db.run(`
      INSERT INTO Users (
        user_id, 
        username, 
        email, 
        role, 
        password
      ) VALUES (?, ?, ?, ?, ?)`,
      [userId, username, email, role, hashedPassword],
      (err) => {
        if (err) reject(err);
        else resolve(userId);
      }
    );
  });
};

const deactivateUser = (userId) => {
  return new Promise((resolve, reject) => {
    db.run(`UPDATE Users SET is_active = false WHERE user_id = ?`, [userId], (err) => {
      if (err) reject(err); else resolve();
    });
  });
};

const getUserById = (userId) => {
  // log all things from here to debugger
  logger.debug(`Getting user with ID: ${userId}`);
  return new Promise((resolve, reject) => {
    db.get('SELECT user_id, username, email, role, is_active FROM Users WHERE user_id = ?', [userId], (err, row) => {
      if (err) reject(err);
      else if (!row) {
        logger.error(`User with ID ${userId} not found. Returning N/A`);
        resolve('N/A');
      } else if (!row.is_active) {
        logger.warn(`User ${userId} status is ${row.is_active}. Adding Deactivated label to username`);
        row.username += ' (D)';
        resolve(row);
      } else {
        logger.debug(`User with ID ${userId} found: ${row.username}`);
        resolve(row);
      }
    });
  });
};

const getUserByUsername = (username) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT user_id, username, email, role, is_active FROM Users WHERE username = ?', [username], (err, row) => {
      if (err) reject(err);
      else if (!row) {
        logger.error(`Username ${username} not found. Returning N/A`);
        resolve('N/A');
      } else if (!row.is_active) {
        logger.warn(`User ${username} status is ${row.is_active}. Adding Deactivated label to username`);
        row.username += ' (D)';
        resolve(row);
      } else {
        logger.debug(`User ${username} found: ${row.user_id}`);
        resolve(row);
      }
    });
  });
};

const getUserWithPasswordByUsername = (username) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT user_id, username, email, role, is_active, password FROM Users WHERE username = ?', [username], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
};

const getAllActiveUsers = () => {
  return new Promise((resolve, reject) => {
    db.all('SELECT user_id, username, email, role FROM Users WHERE is_active = true', (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
};

// ==================== Inspection Items ====================
// Add function to seed default inspection items
const seedInspectionItems = () => {
  const defaultOptions = JSON.stringify([
    { id: 0, label: 'Conforme', icon: '/static/img/icon_conforme.svg' },
    { id: 1, label: 'Non conforme', icon: '/static/img/icon_not_conforme.svg' },
    { id: 2, label: 'Non vérifié', icon: '/static/img/icon_unverified.svg' },
    { id: 3, label: 'À planifier', icon: '/static/img/icon_to_plan.svg' }
  ]);

  return new Promise((resolve, reject) => {
    // First check if items already exist
    db.get('SELECT COUNT(*) as count FROM InspectionItems', [], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      
      if (row.count > 0) {
        resolve(); // Items already seeded
        return;
      }

      const defaultItems = [
        // Interior items
        { category: 'Intérieur', name: 'Antivol de roues', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Intérieur', name: 'Démarreur', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Intérieur', name: 'Voyants tableau de bord', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Intérieur', name: 'Rétroviseurs', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Intérieur', name: 'Klaxon', type: 'options', options: defaultOptions, display_order: 5 },
        { category: 'Intérieur', name: 'Frein à main', type: 'options', options: defaultOptions, display_order: 6 },
        { category: 'Intérieur', name: 'Essuie-glaces', type: 'options', options: defaultOptions, display_order: 7 },
        { category: 'Intérieur', name: 'Éclairage', type: 'options', options: defaultOptions, display_order: 8 },
        { category: 'Intérieur', name: 'Jeu au volant', type: 'options', options: defaultOptions, display_order: 9 },

        // Engine items
        { category: 'Moteur', name: 'Niveau d\'huile moteur', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Moteur', name: 'Niveau refroidissement', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Moteur', name: 'Niveau liquide de frein', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Moteur', name: 'Batterie & Alternateur', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Moteur', name: 'Fuite boîte de vitesses', type: 'options', options: defaultOptions, display_order: 6 },
        { category: 'Moteur', name: 'Fuite de moteur', type: 'options', options: defaultOptions, display_order: 7 },
        { category: 'Moteur', name: 'Supports moteur', type: 'options', options: defaultOptions, display_order: 8 },
        { category: 'Moteur', name: 'Liquide de frein', type: 'options', options: defaultOptions, display_order: 6 },
        { category: 'Moteur', name: 'Filtre à air', type: 'options', options: defaultOptions, display_order: 7 },
        { category: 'Moteur', name: 'Courroie accessoire', type: 'options', options: defaultOptions, display_order: 8 },


        // Front items
        { category: 'Direction Avant', name: 'Roulement AV', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Direction Avant', name: 'Pneus AV', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Direction Avant', name: 'Parallélisme', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Direction Avant', name: 'Disques de frein AV', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Direction Avant', name: 'Plaquettes de frein AV', type: 'options', options: defaultOptions, display_order: 5 },
        { category: 'Direction Avant', name: 'Amortisseur AV', type: 'options', options: defaultOptions, display_order: 6 },
        { category: 'Direction Avant', name: 'Biellette barre stab', type: 'options', options: defaultOptions, display_order: 7 },
        { category: 'Direction Avant', name: 'Direction complète', type: 'options', options: defaultOptions, display_order: 8 },
        { category: 'Direction Avant', name: 'Cardans', type: 'options', options: defaultOptions, display_order: 9 },
        { category: 'Direction Avant', name: 'Triangles AV', type: 'options', options: defaultOptions, display_order: 10 },
        { category: 'Direction Avant', name: 'Flexible de frein AV', type: 'options', options: defaultOptions, display_order: 11 },

        // Rear items
        { category: 'Direction Arrière', name: 'Pneus AR', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Direction Arrière', name: 'Freins AR', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Direction Arrière', name: 'Roulement AR', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Direction Arrière', name: 'Flexible de frein AR', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Direction Arrière', name: 'Amortisseur AR', type: 'options', options: defaultOptions, display_order: 5 },
        { category: 'Direction Arrière', name: 'Silent Blocs AR', type: 'options', options: defaultOptions, display_order: 6 },

        // Accessories items
        { category: 'Accessoires', name: 'Plaque immatriculation AV', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Accessoires', name: 'Plaque immatriculation AR', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Accessoires', name: 'Antenne radio', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Accessoires', name: 'Roue de secours', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Accessoires', name: 'Gilet & Triangle', type: 'options', options: defaultOptions, display_order: 5 },
        { category: 'Accessoires', name: 'Crique / Clé roue', type: 'options', options: defaultOptions, display_order: 6 },

        // Work completed items
        { category: 'Travaux terminés', name: 'Mise à zéro vidange', type: 'options', options: defaultOptions, display_order: 1 },
        { category: 'Travaux terminés', name: 'Serrage des roues (Nm)', type: 'options', options: defaultOptions, display_order: 2 },
        { category: 'Travaux terminés', name: 'Etiquette de vidange', type: 'options', options: defaultOptions, display_order: 3 },
        { category: 'Travaux terminés', name: 'Etiquette distribution', type: 'options', options: defaultOptions, display_order: 4 },
        { category: 'Travaux terminés', name: 'Etiquette plaquettes', type: 'options', options: defaultOptions, display_order: 5 },
        { category: 'Travaux terminés', name: 'Parfum intérieur', type: 'options', options: defaultOptions, display_order: 6 },
        { category: 'Travaux terminés', name: 'Nettoyage', type: 'options', options: defaultOptions, display_order: 7 }
      ];

      // Use serialize to ensure sequential insertion
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare(`
          INSERT INTO InspectionItems (
            item_id, name, type, category, is_active, options, display_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        defaultItems.forEach(item => {
          stmt.run([
            uuidv4(),
            item.name,
            item.type,
            item.category,
            true,
            item.options,
            item.display_order
          ]);
        });

        stmt.finalize();

        db.run('COMMIT', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
};

// Add function to get inspection items
const getInspectionItems = () => {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.all(
      `SELECT * FROM InspectionItems WHERE is_active = true ORDER BY category, display_order`, 
      (err, rows) => {
        if (err) {
          logger.error('Error fetching inspection items:', err);
          reject(err);
        } else {
          resolve(rows || []); // Always return an array
        }
      }
    );
  });
};

// Add function to save inspection report
const saveInspectionReport = (reportData, userId) => {
  return new Promise((resolve, reject) => {
    const customerPhone = reportData.client_phone;
    const customerEmail = reportData.client_email;

    // Check if customer already exists based on phone or email
    db.get(`SELECT customer_id FROM Customers WHERE phone = ? OR email = ?`, [customerPhone, customerEmail], (err, row) => {
      if (err) {
        return reject(err);
      }

      let customerId;
      if (row) {
        customerId = row.customer_id;
        console.log(`Existing customer found: ${customerId}`);
        
        // Update existing customer
        db.run(`UPDATE Customers SET
          name = ?,
          phone = ?,
          email = ?,
          address = ?,
          is_company = ?
        WHERE customer_id = ?`, [
          reportData.client_name,
          reportData.client_phone,
          reportData.client_email || null,
          reportData.client_address || null,
          reportData.is_company || false,
          customerId
        ], function(err) {
          if (err) {
            return reject(err);
          }
          proceedWithReport();
        });
      } else {
        logger.debug('No existing customer found, creating new customer with data:', reportData);
        // Create new customer
        customerId = uuidv4();
        db.run(`INSERT INTO Customers (
          customer_id, name, phone, email, address, is_company
        ) VALUES (?, ?, ?, ?, ?, ?)`, [
          customerId,
          reportData.client_name,
          reportData.client_phone,
          reportData.client_email || null,
          reportData.client_address || null,
          reportData.is_company || false
        ], function(err) {
          if (err) {
            return reject(err);
          }
          proceedWithReport();
        });
      }

      const proceedWithReport = () => {
        const vehiculeId = uuidv4();
        db.run(`INSERT OR REPLACE INTO Vehicules (
          vehicule_id, license_plate, customer_id, brand, model, 
          engine_code, revision_oil_type, revision_oil_volume,
          brake_disc_thickness_front, brake_disc_thickness_rear,
          drain_plug_torque,
          first_registration_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          vehiculeId,
          reportData.license_plate.toUpperCase(),
          customerId,
          reportData.brand || null,
          reportData.model || null,
          reportData.engine_code || null,
          reportData.revision_oil_type || null,
          reportData.revision_oil_volume || null,
          reportData.brake_disc_thickness_front || null,
          reportData.brake_disc_thickness_rear || null,
          reportData.drain_plug_torque || null,
          reportData.first_registration_date || null
        ], function(err) {
          if (err) return reject(err);

          const reportId = uuidv4();
          db.run(`INSERT INTO InspectionReports (
            report_id,
            vehicule_id,
            mileage,
            comments,
            next_technical_inspection,
            filters,
            inspection_results,
            created_by,
            created_at,
            mechanics
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`, [
            reportId,
            vehiculeId,
            reportData.mileage || null,
            reportData.comments || null,
            reportData.next_technical_inspection || null,
            reportData.filters || null,
            JSON.stringify(reportData.inspection || '{}'),
            userId,
            JSON.stringify(reportData.mechanics || '{}'),
          ], function(err) {
            if (err) {
              return reject(err);
            }

            db.run('COMMIT', (err) => {
              if (err) reject(err);
              else resolve(reportId);
            });
          });
        });
      };
    });

    db.run('BEGIN TRANSACTION', (err) => {
      if (err) return reject(err);
      // Transaction started
    });
  });
};

const updateInspectionReports = (reportId, reportData, userId) => {
  return new Promise((resolve, reject) => {
    const db = getDatabase();

    // First get the existing report to get vehicule_id and customer_id
    db.get(`
      SELECT 
        ir.vehicule_id,
        v.customer_id
      FROM InspectionReports ir
      LEFT JOIN Vehicules v ON ir.vehicule_id = v.vehicule_id
      WHERE ir.report_id = ?
    `, [reportId], (err, existingReport) => {
      if (err) {
        return reject(err);
      }
      
      if (!existingReport) {
        return reject(new Error('Report not found'));
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        try {
          // 1. Update the customer
          db.run(`UPDATE Customers SET
            name = ?,
            phone = ?,
            email = ?,
            address = ?,
            is_company = ?
          WHERE customer_id = ?`, [
            reportData.client_name,
            reportData.client_phone,
            reportData.client_email || null,
            reportData.client_address || null,
            reportData.is_company || false,
            existingReport.customer_id
          ], function(err) {
            if (err) throw err;

            // 2. Update the vehicule
            db.run(`UPDATE Vehicules SET
              license_plate = ?,
              brand = ?,
              model = ?,
              engine_code = ?,
              revision_oil_type = ?,
              revision_oil_volume = ?,
              brake_disc_thickness_front = ?,
              brake_disc_thickness_rear = ?,
              drain_plug_torque = ?,
              first_registration_date = ?
            WHERE vehicule_id = ?`, [
              reportData.license_plate.toUpperCase(),
              reportData.brand || null,
              reportData.model || null,
              reportData.engine_code || null,
              reportData.revision_oil_type || null,
              reportData.revision_oil_volume || null,
              reportData.brake_disc_thickness_front || null,
              reportData.brake_disc_thickness_rear || null,
              reportData.drain_plug_torque || null,
              reportData.first_registration_date || null,
              existingReport.vehicule_id
            ], function(err) {
              if (err) throw err;

              // 3. Update the inspection report
              db.run(`UPDATE InspectionReports SET
                mileage = ?,
                comments = ?,
                next_technical_inspection = ?,
                filters = ?,
                inspection_results = ?,
                created_by = ?,
                mechanics = ?
              WHERE report_id = ?`, [
                reportData.mileage || null,
                reportData.comments || null,
                reportData.next_technical_inspection || null,
                reportData.filters || null,
                JSON.stringify(reportData.inspection || '{}'),
                userId,
                JSON.stringify(reportData.mechanics || '{}'),
                reportId
              ], function(err) {
                if (err) throw err;

                db.run('COMMIT', (err) => {
                  if (err) reject(err);
                  else resolve(reportId);
                });
              });
            });
          });

        } catch (error) {
          db.run('ROLLBACK', () => {
            reject(error);
          });
        }
      });
    });
  });
};

// Add function to get inspection report by ID
const getInspectionReport = (reportId) => {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    
    // First get the report details
    db.get(`
      SELECT 
        ir.*,
        v.*
        u.username as username,
        c.name as client_name,
        c.phone as client_phone,
        c.email as client_email,
        c.address as client_address,
        c.is_company
      FROM InspectionReports ir
      LEFT JOIN Vehicules v ON ir.vehicule_id = v.vehicule_id
      LEFT JOIN Users u ON ir.created_by = u.user_id
      LEFT JOIN Customers c ON v.customer_id = c.customer_id
      WHERE ir.report_id = ?
    `, [reportId], (err, reportData) => {
      if (err) {
        logger.error('Error fetching inspection report:', err);
        return reject(err);
      }
      
      if (!reportData) {
        return resolve(null);
      }

      // Then get all active inspection items
      db.all(`
        SELECT 
          item_id,
          name,
          category,
          type,
          options
        FROM InspectionItems 
        WHERE is_active = true
        ORDER BY category, display_order
      `, [], (err, items) => {
        if (err) {
          logger.error('Error fetching inspection items:', err);
          return reject(err);
        }

        try {
          const inspectionResults = JSON.parse(reportData.inspection_results || '{}');
          
          // Map inspection results to items
          const formattedResults = items.map(item => {
            const result = inspectionResults[item.item_id] || {};
            return {
              item_id: item.item_id,
              name: item.name,
              category: item.category,
              type: item.type,
              value: parseInt(result.value, 10) || 0,
              options: JSON.parse(item.options || '[]'),
              unit: result.unit
            };
          });

          reportData.inspection_results = formattedResults;
          resolve(reportData);
        } catch (error) {
          logger.error('Error parsing inspection results:', error);
          reportData.inspection_results = [];
          resolve(reportData);
        }
      });
    });
  });
};

// Add function to get all inspection reports
const getAllVehicules = async () => {
  return new Promise((resolve, reject) => {
    const db = getDatabase();
    db.all('SELECT * FROM Vehicules', [], (err, vehicules) => {
      if (err) reject(err);
      else {
        resolve(vehicules);
      }
    });
  });
};

// Get the vehicule by license plate
const getVehiculeByLicensePlate = async (license_plate) => {
  const db = getDatabase();
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM Vehicules WHERE license_plate = ?`, [license_plate], (err, vehicule) => {
      if (err) reject(err);
      else resolve(vehicule);
    });
  });
};

// Get the vehicule by id
const getVehiculeById = async (vehicule_id) => {
  const db = getDatabase();
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM Vehicules WHERE vehicule_id = ?`, [vehicule_id], (err, vehicule) => {
      if (err) reject(err);
      else resolve(vehicule);
    });
  });
};

// Get the customer by vehicule id
const getCustomerById = async (customer_id) => {
  const db = getDatabase();
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM Customers WHERE customer_id = ?`, [customer_id], (err, customer) => {
      if (err) reject(err);
      else resolve(customer);
    });
  });
};

// Map inspection results to inspection items
const mapInspectionResults = async (inspectionResults) => {
  const items = await getInspectionItems();

  return items.map(item => {
    const result = inspectionResults[item.item_id] || {};
    return {
      item_id: item.item_id,
      name: item.name,
      category: item.category,
      type: item.type,
      value: parseInt(result.value, 10) || 0,
      options: JSON.parse(item.options || '[]'),
      unit: result.unit
    };
  });
};

const temporaryDatabaseUpdate = async () => {
  // Backup using Vacuum into database_vacuum.sqlite
  // db.run('VACUUM INTO ?', ['database_vacuum.sqlite']);
  // console.log("Database vacuumed.");

  // Drop table InspectionReports
  // await db.run('DROP TABLE InspectionReports');
  // console.log("Table InspectionReports dropped.");

  console.log("Updating the database...");
  // Hash the password
  // const hashedPassword = await bcrypt.hash('30122010', 10);
  // Update the user with id 0c4297ff-78a5-4b56-b2d8-9a0a9a156188 and set the password and email.
  // db.run(`UPDATE Users SET password = ?, username = ?, email = ? WHERE user_id = ?`, [hashedPassword, 'd.celine', 'toto@toto.com', '0c4297ff-78a5-4b56-b2d8-9a0a9a156188']);
  
  // Update the InspectionItems with id efd99bd5-1967-4720-8655-3edd1fe45c62 and set the name to "Serrage des roues (Nm)".
  // db.run(`UPDATE InspectionItems SET name = ? WHERE item_id = ?`, ['Serrage des roues (Nm)', 'efd99bd5-1967-4720-8655-3edd1fe45c62']);
  
  // Add column mechanics to InspectionReports
  const query = `ALTER TABLE InspectionReports 
  ADD COLUMN mechanics TEXT[] DEFAULT '{}';`;
  await db.run(query);
  console.log("Column mechanics added to InspectionReports.");

  // Add column is_active to Users
  const query2 = `ALTER TABLE Users 
  ADD COLUMN is_active BOOLEAN DEFAULT TRUE;`;
  await db.run(query2);
  console.log("Column is_active added to Users.");
  
  console.log("Database updated.");
};

module.exports = {
  initializeDatabase,
  getDatabase,
  addVehicle,
  getInspectionItems,
  saveInspectionReport,
  updateInspectionReports,
  getInspectionReport,
  getVehiculeByLicensePlate,
  getVehiculeById,
  getCustomerById,
  getAllVehicules,
  // Users
  addUser,
  getUserById,
  deactivateUser,
  getAllActiveUsers,
  getUserByUsername,
  getUserWithPasswordByUsername
};
