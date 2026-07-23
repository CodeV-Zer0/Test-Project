require('dotenv').config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const cookieParser = require('cookie-parser');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 10000;

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

const JWT_SECRET = process.env.JWT_SECRET || 'primrose-jwt-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const JWT_MAX_AGE = process.env.JWT_MAX_AGE_MS ? parseInt(process.env.JWT_MAX_AGE_MS, 10) : 8 * 3600 * 1000;

// ===== GEMINI / WHATSAPP SUPPORT =====
const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || '').trim();

const sanitizedWhatsApp = WHATSAPP_NUMBER.replace(/[^0-9]/g, '');

if (!GOOGLE_API_KEY) console.warn('Warning: GOOGLE_API_KEY / GEMINI_API_KEY is not set. Gemini calls will fail.');


if (!sanitizedWhatsApp) console.warn('Warning: WHATSAPP_NUMBER is not set or invalid.');


let genAI;
if (GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
}

function getTokenFromRequest(req) {
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

function isComplex(question) {
    if (!question) return false;
    const q = question.toLowerCase();
    const keywords = ['emergency','urgent','diagnose','severe','legal','medical','inspect','replace','warranty','refund'];
    if (question.length > 200) return true;
    if (keywords.some(k => q.includes(k))) return true;
    return false;
}

// ====================== AI CHATBOT ======================
app.post('/api/ask', async (req, res) => {
    try {
        const { question, history } = req.body;
        if (!question) return res.status(400).json({ error: 'Missing question' });

        if (isComplex(question)) {
            const text = encodeURIComponent(`Customer needs help: ${question}`);
            const wa = sanitizedWhatsApp ? `https://wa.me/${sanitizedWhatsApp}?text=${text}` : '';
            return res.json({ redirect: true, whatsappUrl: wa });
        }

        if (!genAI) {
            return res.status(503).json({ error: 'Gemini API key not configured' });
        }

        // Fetch live data from Supabase
        const { data: plants } = await supabase.from('plants').select('name,sci,price,type,water,sun,season,care,avail,temperature,humidity');
        const { data: offers } = await supabase.from('offers').select('title,description,badge,validity');
        const { data: gallery } = await supabase.from('gallery').select('category,label,description');
        const { data: reviews } = await supabase.from('reviews').select('name,location,rating,text').order('id', { ascending: false }).limit(5);

        const plantsText = (plants || []).map(p =>
            `- ${p.name}${p.sci ? ` (${p.sci})` : ''}: ₹${p.price || '-'}, ${p.avail ? 'In stock' : 'Sold out'}. Watering: ${p.water || '-'}. Sunlight: ${p.sun || '-'}. Temperature: ${p.temperature || '-'}. Humidity: ${p.humidity || '-'}. Care: ${p.care || '-'}`
        ).join('\n');

        const offersText = (offers || []).map(o =>
            `- ${o.title}: ${o.description || ''} (${o.badge || ''}, ${o.validity || ''})`
        ).join('\n');

        const groupArrangements = (gallery || []).filter(g => g.category === 'group')
            .map(g => `- ${g.label}${g.description ? `: ${g.description}` : ''}`).join('\n');

        const landscapes = (gallery || []).filter(g => g.category === 'landscapes')
            .map(g => `- ${g.label}${g.description ? `: ${g.description}` : ''}`).join('\n');

        const customers = (gallery || []).filter(g => g.category === 'customers')
            .map(g => g.label).join(', ');

        const reviewsText = (reviews || []).map(r =>
            `- ${r.name} (${r.location || 'Hyderabad'}, ${r.rating}★): "${r.text}"`
        ).join('\n');

        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: `
            You are "Primmy", a friendly plant-care expert and sales assistant for The Primrose Path nursery in Hyderabad.

            CURRENT PLANT CATALOGUE (use for availability, prices, recommendations):
            ${plantsText || 'No plants currently listed.'}

            CURRENT OFFERS:
            ${offersText || 'No active offers.'}

            GROUP ARRANGEMENTS (indoor plant groupings/displays we create):
            ${groupArrangements || 'No group arrangements listed yet.'}

            LANDSCAPE WORK (gardens, paths, outdoor design we've done):
            ${landscapes || 'No landscape projects listed yet.'}

            NOTABLE CUSTOMERS / INSTITUTIONS WE'VE WORKED WITH:
            ${customers || 'Not listed.'}

            RECENT CUSTOMER REVIEWS:
            ${reviewsText || 'No reviews yet.'}

            Rules:
            Rules:
            - Answer in 2-5 concise sentences.
            - Use the catalogue above for prices/availability — don't guess.
            - Give practical plant-care advice (watering, sunlight, soil) when relevant.
            - If asked about group arrangements, landscapes, or past work, refer to the lists above.
            - If asked about reviews or reputation, you can mention real customer feedback above.
            - If a catalogue plant matches the query, recommend it first with price and availability.
            - If no catalogue plant matches, use your general plant knowledge to answer helpfully, then add: "We may not have this in stock right now — visit us or check back soon!"
            - Never say you lack real-time info or can't answer general plant questions — you are a knowledgeable plant expert.
            - Mention relevant offers if applicable.
            - Use at most one emoji.
            - Remember context from earlier in the conversation.
            `
        });

const rawHistory = (history || []).map(h => ({
    role: h.role === 'user' ? 'user' : 'model',
    parts: [{ text: h.text || ' ' }]  // never send empty text
}));

// Gemini requires strict user/model alternation
// Filter out any consecutive duplicates
const chatHistory = rawHistory.filter((h, i) => {
    if (i === 0) return true;
    return h.role !== rawHistory[i - 1].role;
});

// History must end with a model turn (not user)
if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'user') {
    chatHistory.pop();
}

const chat = model.startChat({ history: chatHistory });
const result = await chat.sendMessage(question);
        const answer = result.response.text().trim();

        return res.json({ redirect: false, answer });

} catch (err) {
    console.error("Gemini error:", err?.message || err);
    return res.status(500).json({ 
        error: 'Failed to get response from AI',
        detail: err.message 
    });
}
});
// ====================== MULTER ======================
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => 
        file.mimetype && file.mimetype.startsWith("image/") ? cb(null, true) : cb(new Error("Images only"))
});

// Upload to Supabase
async function uploadToSupabase(file, folder) {
    const filePath = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname)}`;
    const { error } = await supabase.storage.from(SUPABASE_BUCKET).upload(filePath, file.buffer, { contentType: file.mimetype });
    if (error) throw error;
    const { data } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(filePath);
    return data.publicUrl;
}

// Delete from Supabase
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

// ====================== AUTH ======================
const Razorpay = require('razorpay');

let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

app.post('/api/checkout/create-order', async (req, res) => {
  const total = Number(req.body.total);
  if(!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET){
    const missing = [];
    if (!process.env.RAZORPAY_KEY_ID) missing.push('RAZORPAY_KEY_ID');
    if (!process.env.RAZORPAY_KEY_SECRET) missing.push('RAZORPAY_KEY_SECRET');
    return res.status(500).json({ error: `Payment gateway is not configured. Missing: ${missing.join(', ')}` });
  }
  
  if (!razorpay) {
      razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
  }

  if(!Number.isFinite(total) || total <= 0){
    return res.status(400).json({ error: 'Invalid order total' });
  }
  try{
    const order = await razorpay.orders.create({ amount: Math.round(total * 100), currency: 'INR', receipt: 'order_' + Date.now() });
    res.json({ ...order, keyId: process.env.RAZORPAY_KEY_ID });
  }catch(e){
    res.status(500).json({ error: 'Could not create payment order' });
  }
});

app.post('/api/checkout/verify', async (req, res) => {
  const crypto = require('crypto');
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, cart, address, total } = req.body;
  const transportFee = Number(req.body.transportFee || 0);
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
  if(expected !== razorpay_signature) return res.status(400).json({ success:false });
  await supabase.from('orders').insert({ cart_items: cart, address, transport_fee: transportFee, total, razorpay_order_id, razorpay_payment_id, status: 'paid' });
  res.json({ success: true });
});
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

app.post('/api/logout', (req, res) => {
    res.clearCookie('adminToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'Lax' });
    res.json({ success: true });
});

// ====================== PLANTS ======================
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
        const { name, sci, price, type, water, sun, season, care, avail, temperature, humidity } = req.body;
        let photo = null;
        if (req.file) photo = await uploadToSupabase(req.file, 'plants');

        const { data, error } = await supabase.from('plants').insert([
            { name, sci, price: price ? parseInt(price) : null, type, water, sun, season, care, avail: avail !== undefined ? parseInt(avail) : 1, photo, temperature, humidity }
        ]).select().single();

        if (error) return res.status(500).json(error);
        res.json({ success: true, id: data.id, photo });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/plants/:id", requireAuth, upload.single("photo"), async (req, res) => {
    try {
        const { name, sci, price, type, water, sun, season, care, avail, temperature, humidity } = req.body;
        let photo = undefined;
        if (req.file) {
            const { data: old } = await supabase.from('plants').select('photo').eq('id', req.params.id).single();
            if (old && old.photo) await deleteFromSupabase(old.photo);
            photo = await uploadToSupabase(req.file, 'plants');
        }
        const updateData = { name, sci, price: price ? parseInt(price) : null, type, water, sun, season, care, avail: avail !== undefined ? parseInt(avail) : 1, temperature, humidity };
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

// ====================== GALLERY ======================
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

// ====================== OFFERS ======================
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

// ====================== REVIEWS ======================
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

// Sitemap
app.get("/sitemap.xml", (req, res) => {
    res.header("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.walktheprimrosepath.com/</loc><priority>1.0</priority></url>
  <url><loc>https://www.walktheprimrosepath.com/plant/</loc><priority>0.8</priority></url>
</urlset>`);
});

// Page Routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/plant/:id", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🌿 The Primrose Path server running on port ${PORT}`);
});
