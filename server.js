require('dotenv').config();
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

// Supabase client (set SUPABASE_URL and SUPABASE_KEY in env)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

// Multer config - memory storage so we can upload buffers to Supabase
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => file.mimetype && file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only"))
});

// DB
const db = new sqlite3.Database("./plants.db", err => {
    if (err) { console.error("DB open error:", err); process.exit(1); }
    console.log("Connected to SQLite database.");
    initDB();
});

// Catch any unhandled DB-level errors so they don't crash Node silently
db.on("error", err => console.error("DB error:", err));

// Global crash guard — logs the error instead of silently dying
process.on("uncaughtException", err => console.error("Uncaught exception:", err));

function initDB() {
    // Use db.serialize() so every statement runs in order, one after the other
    db.serialize(() => {

        // Plants table
        db.run(`CREATE TABLE IF NOT EXISTS plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, sci TEXT, price INTEGER,
            type TEXT, water TEXT, sun TEXT, season TEXT,
            care TEXT, avail INTEGER DEFAULT 1, emoji TEXT, photo TEXT
        )`);
        // Safe ALTER TABLE — duplicate column errors are intentionally ignored
        db.run(`ALTER TABLE plants ADD COLUMN emoji TEXT`, err => {
            if (err && !err.message.includes("duplicate column")) console.error("ALTER plants emoji:", err);
        });
        db.run(`ALTER TABLE plants ADD COLUMN photo TEXT`, err => {
            if (err && !err.message.includes("duplicate column")) console.error("ALTER plants photo:", err);
        });

        // Admins table + seed
        db.run(`CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE, password TEXT
        )`, err => {
            if (err) return console.error("CREATE admins:", err);
            db.run(`INSERT OR IGNORE INTO admins (username,password) VALUES ('admin','primrose123')`);
        });

        // Offers table + seed
        db.run(`CREATE TABLE IF NOT EXISTS offers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            emoji TEXT, title TEXT NOT NULL,
            desc TEXT, badge TEXT, validity TEXT, msg TEXT
        )`, err => {
            if (err) return console.error("CREATE offers:", err);
            db.get("SELECT COUNT(*) as c FROM offers", [], (err, row) => {
                if (!err && row.c === 0) {
                    [["🌿","Monsoon Starter Pack","Get 3 easy-care plants — Money Plant, Aloe Vera & Peace Lily.","30% OFF","Valid till 30 June 2026","Hi! I want the Monsoon Starter Pack offer."],
                     ["🌸","Buy 2 Get 1 Free","Purchase any 2 flowering plants and get a third one free.","FREE PLANT","Weekends only","Hi! I want the Buy 2 Get 1 Free offer."],
                     ["🎁","Housewarming Gift Combo","Curated set of 5 indoor plants with decorative pots.","999 ONLY","Limited stock","Hi! I want the Housewarming Gift Combo."],
                     ["🌱","Sapling Bundle","10 mixed vegetable saplings — tomato, chilli, brinjal & more.","BEST VALUE","All year","Hi! I want the Sapling Bundle offer."]
                    ].forEach(o => db.run("INSERT INTO offers (emoji,title,desc,badge,validity,msg) VALUES (?,?,?,?,?,?)", o));
                }
            });
        });

        // Reviews table + seed
        db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, location TEXT,
            rating INTEGER, text TEXT,
            emoji TEXT DEFAULT '🌿', date TEXT
        )`, err => {
            if (err) return console.error("CREATE reviews:", err);
            db.get("SELECT COUNT(*) as c FROM reviews", [], (err, row) => {
                if (!err && row.c === 0) {
                    [["Priya S.","Madhapur",5,"Amazing plants! The QR code idea is so smart.","🌸","01/06/2026"],
                     ["Ravi Kumar","Gachibowli",5,"Bought 6 plants, all healthy and growing well.","🌿","28/05/2026"],
                     ["Ananya T.","Kondapur",4,"Great nursery! The care guide is really useful.","🌹","20/05/2026"],
                     ["Srinivas M.","HITEC City",5,"Ordered via WhatsApp, delivered same day!","🪴","15/05/2026"]
                    ].forEach(r => db.run("INSERT INTO reviews (name,location,rating,text,emoji,date) VALUES (?,?,?,?,?,?)", r));
                }
            });
        });

        // Gallery table
        db.run(`CREATE TABLE IF NOT EXISTS gallery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT DEFAULT 'group',
            label TEXT, "desc" TEXT,
            photo TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        )`, err => {
            if (err) console.error("CREATE gallery:", err);
        });
        db.all("PRAGMA table_info(gallery)", [], (err, cols) => {
            if (err) return console.error("PRAGMA gallery:", err);
            const hasCategory = cols.some(c => c.name === 'category');
            if (!hasCategory) {
                db.run(`ALTER TABLE gallery ADD COLUMN category TEXT DEFAULT 'group'`, err => {
                    if (err && !err.message.includes("duplicate column")) console.error("ALTER gallery category:", err);
                });
            }
            db.run(`UPDATE gallery SET category='group' WHERE category IS NULL`, err => {
                if (err) console.error("MIGRATE gallery category:", err);
            });
        });
        db.get("SELECT COUNT(*) as c FROM gallery", [], (err, row) => {
            if (!err && row && row.c === 0) {
                const seed = [
                    ['group','Buddha feature grouping','image-1.png','uploads/company-assets/image-1.png'],
                    ['group','Office plant display','image-2.png','uploads/company-assets/image-2.png'],
                    ['group','Workspace plant cluster','image-3.png','uploads/company-assets/image-3.png'],
                    ['group','Large format indoor arrangement','image-4.png','uploads/company-assets/image-4.png'],
                    ['group','Planter boxes','indoor-plants-images-broucher-p07-01.jpg','uploads/company-assets/pdf-extracted/indoor-plants-images-broucher-p07-01.jpg'],
                    ['landscapes','Landscape path','profile-p-p01-01.jpg','uploads/company-assets/pdf-extracted/profile-p-p01-01.jpg'],
                    ['landscapes','Landscape walkway','profile-p-p01-02.jpg','uploads/company-assets/pdf-extracted/profile-p-p01-02.jpg'],
                    ['landscapes','Landscape feature','profile-p-p01-03.jpg','uploads/company-assets/pdf-extracted/profile-p-p01-03.jpg'],
                    ['landscapes','Garden landscape','profile-p-p01-04.jpg','uploads/company-assets/pdf-extracted/profile-p-p01-04.jpg'],
                    ['landscapes','Garden maintenance','profile-p-p01-05.jpg','uploads/company-assets/pdf-extracted/profile-p-p01-05.jpg'],
                    ['landscapes','Garden design','ppt-image-09.jpg','uploads/ppt-assets/ppt-image-09.jpg'],
                    ['customers','Administrative Staff College of India','ASCI','uploads/ppt-assets/ppt-image-21.jpg'],
                    ['customers','ICAR','ICAR','uploads/ppt-assets/ppt-image-25.jpg'],
                    ['customers','Dell','Dell','uploads/ppt-assets/ppt-image-26.jpg'],
                    ['customers','DRS International School','DRS International School','uploads/ppt-assets/ppt-image-27.jpg'],
                    ['customers','GE','GE','uploads/ppt-assets/ppt-image-29.jpg'],
                    ['customers','Microsoft','Microsoft','uploads/ppt-assets/ppt-image-30.jpg'],
                    ['customers','Motorola','Motorola','uploads/ppt-assets/ppt-image-31.jpg'],
                    ['customers','Tata Indicom','Tata Indicom','uploads/ppt-assets/ppt-image-32.jpg'],
                    ['customers','RMZ','RMZ','uploads/ppt-assets/ppt-image-33.jpg']
                ];
                seed.forEach(item => db.run("INSERT INTO gallery (category,label,\"desc\",photo) VALUES (?,?,?,?)", item));
            }
        });

    }); // end serialize
}

// ===== LOGIN =====
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM admins WHERE username=? AND password=?", [username, password], (err, row) => {
        if (err) return res.status(500).json(err);
        res.json({ success: !!row });
    });
});

// ===== PLANTS =====
app.get("/api/plants", (req, res) => {
    db.all("SELECT * FROM plants ORDER BY id DESC", [], (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});

app.get("/api/plants/:id", (req, res) => {
    db.get("SELECT * FROM plants WHERE id=?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json(err);
        if (!row) return res.status(404).json({ error: "Plant not found" });
        res.json(row);
    });
});

app.post("/api/plants", upload.single("photo"), async (req, res) => {
    try {
        const { name, sci, price, type, water, sun, season, care, avail } = req.body;
        let photo = null;
        if (req.file) {
            if (supabase) {
                const filePath = `plants/${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(req.file.originalname)}`;
                const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
                if (error) return res.status(500).json({ error });
                const urlData = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
                photo = (urlData && (urlData.publicUrl || (urlData.data && urlData.data.publicUrl) || urlData.publicURL)) || null;
            } else {
                const filename = Date.now() + "-" + Math.round(Math.random()*1e6) + path.extname(req.file.originalname);
                const out = path.join(__dirname, 'uploads', filename);
                fs.writeFileSync(out, req.file.buffer);
                photo = "/uploads/" + filename;
            }
        }
        db.run(
            `INSERT INTO plants (name,sci,price,type,water,sun,season,care,avail,photo) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [name, sci, price, type, water, sun, season, care, avail, photo],
            function(err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true, id: this.lastID, photo });
            }
        );
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/plants/:id", upload.single("photo"), async (req, res) => {
    try {
        const { name, sci, price, type, water, sun, season, care, avail } = req.body;
        if (req.file) {
            db.get("SELECT photo FROM plants WHERE id=?", [req.params.id], async (err, row) => {
                try {
                    if (row && row.photo && supabase) {
                        // try to remove previous file from supabase if possible
                        try {
                            const parsed = (() => {
                                try {
                                    const u = new URL(row.photo);
                                    const parts = u.pathname.split('/');
                                    const idx = parts.indexOf('object');
                                    if (idx !== -1) {
                                        const bucket = parts[idx+2];
                                        const filePath = parts.slice(idx+3).join('/');
                                        return { bucket, filePath };
                                    }
                                } catch(e){}
                                return null;
                            })();
                            if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.filePath]);
                        } catch(e) { /* ignore */ }
                    }
                    let photo = null;
                    if (supabase) {
                        const filePath = `plants/${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(req.file.originalname)}`;
                        const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
                        if (error) return res.status(500).json({ error });
                        const urlData = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
                        photo = (urlData && (urlData.publicUrl || (urlData.data && urlData.data.publicUrl) || urlData.publicURL)) || null;
                    } else {
                        const filename = Date.now() + "-" + Math.round(Math.random()*1e6) + path.extname(req.file.originalname);
                        const out = path.join(__dirname, 'uploads', filename);
                        fs.writeFileSync(out, req.file.buffer);
                        photo = "/uploads/" + filename;
                    }
                    db.run(`UPDATE plants SET name=?,sci=?,price=?,type=?,water=?,sun=?,season=?,care=?,avail=?,photo=? WHERE id=?`,
                        [name, sci, price, type, water, sun, season, care, avail, photo, req.params.id],
                        function(err) {
                            if (err) return res.status(500).json(err);
                            res.json({ success: true, photo });
                        }
                    );
                } catch(e) { res.status(500).json({ error: e.message }); }
            });
        } else {
            db.run(`UPDATE plants SET name=?,sci=?,price=?,type=?,water=?,sun=?,season=?,care=?,avail=? WHERE id=?`,
                [name, sci, price, type, water, sun, season, care, avail, req.params.id],
                function(err) {
                    if (err) return res.status(500).json(err);
                    res.json({ success: true });
                }
            );
        }
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plants/:id", (req, res) => {
    db.get("SELECT photo FROM plants WHERE id=?", [req.params.id], async (err, row) => {
        try {
            if (row && row.photo) {
                // attempt to delete from Supabase if URL looks like a Supabase storage URL
                if (supabase) {
                    try {
                        const parsed = (() => {
                            try {
                                const u = new URL(row.photo);
                                const parts = u.pathname.split('/');
                                const idx = parts.indexOf('object');
                                if (idx !== -1) {
                                    const bucket = parts[idx+2];
                                    const filePath = parts.slice(idx+3).join('/');
                                    return { bucket, filePath };
                                }
                            } catch(e){}
                            return null;
                        })();
                        if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.filePath]);
                    } catch(e) { /* ignore */ }
                }
                // fallback: try removing local file if it exists and looks local
                try { const old = "." + row.photo; if (fs.existsSync(old)) fs.unlinkSync(old); } catch(e){}
            }
            db.run("DELETE FROM plants WHERE id=?", [req.params.id], function(err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true });
            });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });
});

// ===== GALLERY =====
app.get("/api/gallery", (req, res) => {
    const category = req.query.category;
    const sql = category ? "SELECT * FROM gallery WHERE category=? ORDER BY sort_order ASC, id ASC" : "SELECT * FROM gallery ORDER BY category ASC, sort_order ASC, id ASC";
    const params = category ? [category] : [];
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json(err);
        res.json(rows);
    });
});
app.get("/api/gallery/:id", (req, res) => {
    db.get("SELECT * FROM gallery WHERE id=?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json(err);
        if (!row) return res.status(404).json({ error: "Gallery item not found" });
        res.json(row);
    });
});

app.post("/api/gallery", upload.single("photo"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Photo required" });
        const { category, label, desc } = req.body;
        let photo = null;
        if (supabase) {
            const filePath = `gallery/${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(req.file.originalname)}`;
            const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
            if (error) return res.status(500).json({ error });
            const urlData = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
            photo = (urlData && (urlData.publicUrl || (urlData.data && urlData.data.publicUrl) || urlData.publicURL)) || null;
        } else {
            const filename = Date.now() + "-" + Math.round(Math.random()*1e6) + path.extname(req.file.originalname);
            const out = path.join(__dirname, 'uploads', filename);
            fs.writeFileSync(out, req.file.buffer);
            photo = "/uploads/" + filename;
        }
        db.run(
            `INSERT INTO gallery (category,label, "desc", photo) VALUES (?,?,?,?)`,
            [category || 'group', label || "Gallery Photo", desc || "", photo],
            function(err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true, id: this.lastID, photo });
            }
        );
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/gallery/:id", upload.single("photo"), (req, res) => {
    const { category, label, desc } = req.body;
    const updateFields = [label || "Gallery Photo", desc || "", category || 'group', req.params.id];
    if (req.file) {
        db.get("SELECT photo FROM gallery WHERE id=?", [req.params.id], async (err, row) => {
            try {
                if (row && row.photo && supabase) {
                    try {
                        const parsed = (() => {
                            try {
                                const u = new URL(row.photo);
                                const parts = u.pathname.split('/');
                                const idx = parts.indexOf('object');
                                if (idx !== -1) {
                                    const bucket = parts[idx+2];
                                    const filePath = parts.slice(idx+3).join('/');
                                    return { bucket, filePath };
                                }
                            } catch(e){}
                            return null;
                        })();
                        if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.filePath]);
                    } catch(e) { /* ignore */ }
                }
                let photo = null;
                if (supabase) {
                    const filePath = `gallery/${Date.now()}-${Math.round(Math.random()*1e6)}${path.extname(req.file.originalname)}`;
                    const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
                    if (error) return res.status(500).json({ error });
                    const urlData = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
                    photo = (urlData && (urlData.publicUrl || (urlData.data && urlData.data.publicUrl) || urlData.publicURL)) || null;
                } else {
                    const filename = Date.now() + "-" + Math.round(Math.random()*1e6) + path.extname(req.file.originalname);
                    const out = path.join(__dirname, 'uploads', filename);
                    fs.writeFileSync(out, req.file.buffer);
                    photo = "/uploads/" + filename;
                }
                db.run(`UPDATE gallery SET label=?,"desc"=?,category=?,photo=? WHERE id=?`,
                    [label || "Gallery Photo", desc || "", category || 'group', photo, req.params.id],
                    function(err) {
                        if (err) return res.status(500).json(err);
                        res.json({ success: true, photo });
                    }
                );
            } catch(e) { res.status(500).json({ error: e.message }); }
        });
    } else {
        db.run(`UPDATE gallery SET label=?,"desc"=?,category=? WHERE id=?`,
            updateFields,
            function(err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true });
            }
        );
    }
});

app.delete("/api/gallery/:id", (req, res) => {
    db.get("SELECT photo FROM gallery WHERE id=?", [req.params.id], async (err, row) => {
        try {
            if (row && row.photo) {
                if (supabase) {
                    try {
                        const parsed = (() => {
                            try {
                                const u = new URL(row.photo);
                                const parts = u.pathname.split('/');
                                const idx = parts.indexOf('object');
                                if (idx !== -1) {
                                    const bucket = parts[idx+2];
                                    const filePath = parts.slice(idx+3).join('/');
                                    return { bucket, filePath };
                                }
                            } catch(e){}
                            return null;
                        })();
                        if (parsed) await supabase.storage.from(parsed.bucket).remove([parsed.filePath]);
                    } catch(e) { /* ignore */ }
                }
                try { const old = "." + row.photo; if (fs.existsSync(old)) fs.unlinkSync(old); } catch(e){}
            }
            db.run("DELETE FROM gallery WHERE id=?", [req.params.id], function(err) {
                if (err) return res.status(500).json(err);
                res.json({ success: true });
            });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });
});

// ===== OFFERS =====
app.get("/api/offers", (req, res) => db.all("SELECT * FROM offers ORDER BY id ASC", [], (err, rows) => err ? res.status(500).json(err) : res.json(rows)));
app.post("/api/offers", (req, res) => {
    const { emoji, title, desc, badge, validity, msg } = req.body;
    db.run(`INSERT INTO offers (emoji,title,desc,badge,validity,msg) VALUES (?,?,?,?,?,?)`,
        [emoji, title, desc, badge, validity, msg],
        function(err) { err ? res.status(500).json(err) : res.json({ success: true, id: this.lastID }); }
    );
});
app.put("/api/offers/:id", (req, res) => {
    const { emoji, title, desc, badge, validity, msg } = req.body;
    db.run(`UPDATE offers SET emoji=?,title=?,desc=?,badge=?,validity=?,msg=? WHERE id=?`,
        [emoji, title, desc, badge, validity, msg, req.params.id],
        function(err) { err ? res.status(500).json(err) : res.json({ success: true }); }
    );
});
app.delete("/api/offers/:id", (req, res) => db.run("DELETE FROM offers WHERE id=?", [req.params.id], function(err) { err ? res.status(500).json(err) : res.json({ success: true }); }));

// ===== REVIEWS =====
app.get("/api/reviews", (req, res) => db.all("SELECT * FROM reviews ORDER BY id DESC", [], (err, rows) => err ? res.status(500).json(err) : res.json(rows)));
app.post("/api/reviews", (req, res) => {
    const { name, location, rating, text } = req.body;
    if (!name || !text || !rating) return res.status(400).json({ error: "Missing fields" });
    db.run(`INSERT INTO reviews (name,location,rating,text,emoji,date) VALUES (?,?,?,?,?,?)`,
        [name, location || "Hyderabad", Number(rating), text, "🌿", new Date().toLocaleDateString("en-IN")],
        function(err) { err ? res.status(500).json(err) : res.json({ success: true, id: this.lastID }); }
    );
});
app.delete("/api/reviews/:id", (req, res) => db.run("DELETE FROM reviews WHERE id=?", [req.params.id], function(err) { err ? res.status(500).json(err) : res.json({ success: true }); }));

// ===== PAGE ROUTES =====
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/plant/:id", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🌿 The Primrose Path server running!`);
    
});