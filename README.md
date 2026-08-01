# The Primrose Path — Nursery Website

A full-stack production website built for **The Primrose Path and Pragati Gardens**, a 20+ year old landscape and nursery company based in Hyderabad.

🌐 **Live site:** [walktheprimrosepath.com](https://www.walktheprimrosepath.com)

---

## Features

- 🌿 **Plant catalogue** — live plant listings connected to a database with photos, pricing, care tips, watering, sunlight, temperature and humidity
- 📱 **QR code system** — each plant gets a unique scannable QR tag that opens its detail page
- 🤖 **AI chatbot (Primmy)** — Gemini-powered plant assistant that answers customer queries using live plant data
- 🔐 **Admin panel** — password-protected backend to manage plants, offers, reviews and gallery without any coding
- 📸 **Photo uploads** — plant and gallery photos uploaded directly from the admin panel
- 💬 **WhatsApp integration** — customers can order plants or claim offers directly via WhatsApp
- ⭐ **Reviews** — customers can submit reviews from the website; admin can delete spam
- 🏷️ **Offers management** — admin can add, edit and delete offers in real time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, Vanilla JavaScript |
| Backend | Node.js, Express.js |
| Database | PostgreSQL (Supabase) |
| File Storage | Supabase Storage |
| Authentication | JWT (httpOnly cookies) |
| File Uploads | Multer |
| AI Chatbot | Google Gemini API |
| Deployment | Render |
| CI/CD | GitHub → Render auto-deploy |

---

## Project Structure

```
├── server.js        # Express backend, REST API, all routes
├── index.html       # Public website (all pages)
├── admin.html       # Admin panel (plants, offers, reviews, gallery)
├── login.html       # Admin login page
└── package.json     # Dependencies
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/plants | Get all plants |
| GET | /api/plants/:id | Get single plant |
| POST | /api/plants | Add new plant |
| PUT | /api/plants/:id | Update plant |
| DELETE | /api/plants/:id | Delete plant |
| GET | /api/offers | Get all offers |
| POST | /api/offers | Add offer |
| GET | /api/reviews | Get all reviews |
| POST | /api/reviews | Submit review |
| POST | /api/login | Admin login |
| POST | /api/ask | AI chatbot query |

---

## Security

- Admin panel protected with JWT authentication via httpOnly cookies
- Row Level Security (RLS) enabled on all Supabase tables
- Environment variables stored securely on Render (never in code)
- File upload validation — images only, max 5MB

---

## Developed by

Vignesh — ECM Student, VIT Chennai  
Built as a freelance project for The Primrose Path and Pragati Gardens, Hyderabad.
