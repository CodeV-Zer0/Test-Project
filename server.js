require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

if (!fs.existsSync("./uploads")) fs.mkdirSync("./uploads");

// Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'uploads';
const JWT_SECRET = process.env.JWT_SECRET || process.env.ADMIN_TOKEN || 'primrose-jwt-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const JWT_MAX_AGE = process.env.JWT_MAX_AGE_MS ? parseInt(process.env.JWT_MAX_AGE_MS, 10) : 8 * 3600 * 1000; // 8 hours default

function getTokenFromRequest(req) {
    // prefer cookie (httpOnly) when present
    if (req.cookies && req.cookies.adminToken) return req.cookies.adminToken;
    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
        return auth.slice(7);
    }
    return req.headers['x-admin-token'] || '';
}

function requireAuth(req, res, next) {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

    // ===== GEMINI / WHATSAPP SUPPORT =====
    // Accept either `GOOGLE_API_KEY` or `GEMINI_API_KEY` (Render screenshot shows GEMINI_API_KEY)
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
    const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '';

    if (!GOOGLE_API_KEY) console.warn('Warning: GOOGLE_API_KEY / GEMINI_API_KEY is not set. Gemini calls will fail.');
    if (!WHATSAPP_NUMBER) console.warn('Warning: WHATSAPP_NUMBER is not set. WhatsApp redirects will be incomplete.');

    function isComplex(question) {
        if (!question) return false;
        const q = question.toLowerCase();
        const keywords = ['emergency','urgent','diagnose','severe','legal','medical','inspect','replace','warranty','refund'];
        if (question.length > 200) return true;
        if (keywords.some(k => q.includes(k))) return true;
        return false;
    }

    app.post('/api/ask', async (req, res) => {
        try {
            const { question } = req.body;
            if (!question) return res.status(400).json({ error: 'Missing question' });

            if (isComplex(question)) {
                const text = encodeURIComponent(`Customer needs help: ${question}`);
                const wa = `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
                return res.json({ redirect: true, whatsappUrl: wa });
            }

            // Call Google Generative API (Gemini / text-bison example). Replace model if desired.
            const url = `https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generate?key=${GOOGLE_API_KEY}`;
            const body = {
                prompt: { text: `You are a friendly plant-care expert. Answer concisely and practically for a customer:\n\n${question}` },
                temperature: 0.2,
                candidateCount: 1
            };

            const upstream = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!upstream.ok) {
                const errText = await upstream.text();
                return res.status(502).json({ error: 'Upstream error', detail: errText });
            }
            const data = await upstream.json();
            let answer = '';
            if (data?.candidates && data.candidates.length) answer = data.candidates[0].content || '';
            else if (data?.output && data.output.length) answer = data.output[0].content || '';
            else answer = JSON.stringify(data);

            return res.json({ redirect: false, answer });
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    });

// Multer config - memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => file.mimetype && file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only"))
});

// Global crash guard
process.on("uncaughtException", err => console.error("Uncaught exception:", err));

// Helper: upload file to Supabase Storage
async function uploadToSupabase(file, folder) {
    const filePath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
}

// Helper: delete file from Supabase Storage given a public URL
async function deleteFromSupabase(publicUrl) {
    try {
        const u = new URL(publicUrl);
        const parts = u.pathname.split('/');
        const idx = parts.indexOf('object');
        if (idx !== -1) {
            const filePath = parts.slice(idx + 3).join('/');
            await supabase.storage.from(SUPABASE_BUCKET).remove([filePath]);
        }
    } catch (e) { /* ignore */ }
}

// ===== LOGIN =====
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Username and password are required' });
    }
    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .eq('username', username)
        .eq('password', password)
        .single();
    if (error && error.code !== 'PGRST116') return res.status(500).json(error);
    if (!data) return res.json({ success: false });

    const token = jwt.sign({ username: data.username, role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    // set httpOnly cookie (used by the admin UI) and return success
    res.cookie('adminToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: JWT_MAX_AGE
    });
    res.json({ success: true });
});

app.get("/api/admin/verify", requireAuth, (req, res) => {
    res.json({ success: true, user: req.user });
});

// Logout - clear cookie
app.post('/api/logout', (req, res) => {
    res.clearCookie('adminToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
    res.json({ success: true });
});

// ===== PLANTS =====
app.get("/api/plants", async (req, res) => {
    const { data, error } = await supabase.from('plants').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json(error);
    res.json(data);
});

app.get("/api/plants/:id", async (req, res) => {
    const { data, error } = await supabase.from('plants').select('*').eq('id', req.params.id).single();
    if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json(error);
    res.json(data);
});

app.post("/api/plants", requireAuth, upload.single("photo"), async (req, res) => {
    try {
        const { name, sci, price, type, water, sun, season, care, avail } = req.body;
        let photo = null;
        if (req.file) photo = await uploadToSupabase(req.file, 'plants');
        const { data, error } = await supabase.from('plants').insert([
            { name, sci, price: price ? parseInt(price) : null, type, water, sun, season, care, avail: avail !== undefined ? parseInt(avail) : 1, photo }
        ]).select().single();
        if (error) return res.status(500).json(error);
        res.json({ success: true, id: data.id, photo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/plants/:id", requireAuth, upload.single("photo"), async (req, res) => {
    try {
        const { name, sci, price, type, water, sun, season, care, avail } = req.body;
        let photo = undefined;
        if (req.file) {
            const { data: old } = await supabase.from('plants').select('photo').eq('id', req.params.id).single();
            if (old && old.photo) await deleteFromSupabase(old.photo);
            photo = await uploadToSupabase(req.file, 'plants');
        }
        const updateData = { name, sci, price: price ? parseInt(price) : null, type, water, sun, season, care, avail: avail !== undefined ? parseInt(avail) : 1 };
        if (photo !== undefined) updateData.photo = photo;
        const { error } = await supabase.from('plants').update(updateData).eq('id', req.params.id);
        if (error) return res.status(500).json(error);
        res.json({ success: true, photo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/plants/:id", requireAuth, async (req, res) => {
    try {
        const { data: old } = await supabase.from('plants').select('photo').eq('id', req.params.id).single();
        if (old && old.photo) await deleteFromSupabase(old.photo);
        const { error } = await supabase.from('plants').delete().eq('id', req.params.id);
        if (error) return res.status(500).json(error);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== GALLERY =====
app.get("/api/gallery", async (req, res) => {
    const category = req.query.category;
    let query = supabase.from('gallery').select('*').order('sort_order', { ascending: true }).order('id', { ascending: true });
    if (category) query = query.eq('category', category);
    const { data, error } = await query;
    if (error) return res.status(500).json(error);
    res.json(data.map(r => ({ ...r, desc: r.description })));
});

app.get("/api/gallery/:id", async (req, res) => {
    const { data, error } = await supabase.from('gallery').select('*').eq('id', req.params.id).single();
    if (error) return res.status(error.code === 'PGRST116' ? 404 : 500).json(error);
    res.json({ ...data, desc: data.description });
});

app.post("/api/gallery", requireAuth, upload.single("photo"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Photo required" });
        const { category, label, desc } = req.body;
        const photo = await uploadToSupabase(req.file, 'gallery');
        const { data, error } = await supabase.from('gallery').insert([
            { category: category || 'group', label: label || "Gallery Photo", description: desc || "", photo }
        ]).select().single();
        if (error) return res.status(500).json(error);
        res.json({ success: true, id: data.id, photo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/gallery/:id", requireAuth, upload.single("photo"), async (req, res) => {
    try {
        const { category, label, desc } = req.body;
        let photo = undefined;
        if (req.file) {
            const { data: old } = await supabase.from('gallery').select('photo').eq('id', req.params.id).single();
            if (old && old.photo) await deleteFromSupabase(old.photo);
            photo = await uploadToSupabase(req.file, 'gallery');
        }
        const updateData = { label: label || "Gallery Photo", description: desc || "", category: category || 'group' };
        if (photo !== undefined) updateData.photo = photo;
        const { error } = await supabase.from('gallery').update(updateData).eq('id', req.params.id);
        if (error) return res.status(500).json(error);
        res.json({ success: true, photo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/gallery/:id", requireAuth, async (req, res) => {
    try {
        const { data: old } = await supabase.from('gallery').select('photo').eq('id', req.params.id).single();
        if (old && old.photo) await deleteFromSupabase(old.photo);
        const { error } = await supabase.from('gallery').delete().eq('id', req.params.id);
        if (error) return res.status(500).json(error);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== OFFERS =====
app.get("/api/offers", async (req, res) => {
    const { data, error } = await supabase.from('offers').select('*').order('id', { ascending: true });
    if (error) return res.status(500).json(error);
    res.json(data.map(r => ({ ...r, desc: r.description })));
});

app.post("/api/offers", requireAuth, async (req, res) => {
    const { emoji, title, desc, badge, validity, msg } = req.body;
    const { data, error } = await supabase.from('offers').insert([
        { emoji, title, description: desc, badge, validity, msg }
    ]).select().single();
    if (error) return res.status(500).json(error);
    res.json({ success: true, id: data.id });
});

app.put("/api/offers/:id", requireAuth, async (req, res) => {
    const { emoji, title, desc, badge, validity, msg } = req.body;
    const { error } = await supabase.from('offers').update({ emoji, title, description: desc, badge, validity, msg }).eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

app.delete("/api/offers/:id", requireAuth, async (req, res) => {
    const { error } = await supabase.from('offers').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// ===== REVIEWS =====
app.get("/api/reviews", async (req, res) => {
    const { data, error } = await supabase.from('reviews').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json(error);
    res.json(data);
});

app.post("/api/reviews", async (req, res) => {
    const { name, location, rating, text } = req.body;
    if (!name || !text || !rating) return res.status(400).json({ error: "Missing fields" });
    const { data, error } = await supabase.from('reviews').insert([
        { name, location: location || "Hyderabad", rating: Number(rating), text, emoji: "🌿", date: new Date().toLocaleDateString("en-IN") }
    ]).select().single();
    if (error) return res.status(500).json(error);
    res.json({ success: true, id: data.id });
});

app.delete("/api/reviews/:id", requireAuth, async (req, res) => {
    const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
    if (error) return res.status(500).json(error);
    res.json({ success: true });
});

// ===== SITEMAP =====
app.get("/sitemap.xml", (req, res) => {
    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.walktheprimrosepath.com/</loc><priority>1.0</priority></url>
  <url><loc>https://www.walktheprimrosepath.com/plant/</loc><priority>0.8</priority></url>
</urlset>`);
});

// ===== PAGE ROUTES =====
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/plant/:id", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🌿 The Primrose Path server running on port ${PORT}`);
});