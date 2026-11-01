# Perimeter Zero · Pentesting & Escrow Platform

A full-stack penetration testing and vulnerability disclosure platform connecting companies and verified security researchers with scoped engagements, live escrow calculation, and OWASP Top 10 checklist execution.

## Project Structure
```text
├── package.json               # Backend dependencies and start script
├── server.js                  # Production Express API server
├── schema.sql                 # Neon PostgreSQL schema
├── .env.example               # Environment variables template
├── .gitignore
└── public/
    ├── signin-register.html   # Authentication (Company / Tester login & register)
    ├── admin-dashboard.html   # Company Dashboard (Post programs & approve testers)
    ├── tester-dashboard.html  # Pentester Dashboard (Browse open projects & start)
    ├── perimeter-zero-checklist.html # Real-time OWASP checklist & report generator
    └── checklist.html         # Redirector to checklist
```

---

## Deployment Guide (Render + Neon)

### Step 1: Set up Neon PostgreSQL
1. Create a free project at [Neon](https://neon.tech).
2. Open the **SQL Editor** tab in your Neon Console.
3. Open `schema.sql` from this folder, copy all contents, paste it into the Neon SQL editor, and click **Run**.
4. Copy your database connection string from the Neon dashboard:
   `postgres://[user]:[password]@[endpoint].neon.tech/neondb?sslmode=require`

### Step 2: Deploy to Render
1. Push this folder to a GitHub repository.
2. In [Render](https://render.com), click **New +** -> **Web Service**.
3. Select your repository.
4. Set the following configurations:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. Under **Environment Variables**, add:
   - `DATABASE_URL`: `(Your Neon PostgreSQL connection string)`
   - `JWT_SECRET`: `(A strong random string, e.g. 32+ characters)`
   - `CORS_ORIGIN`: `*`
6. Click **Deploy Web Service**.

---

## Local Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Add your Neon `DATABASE_URL` in `.env`.
4. Start the server:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000` in your browser.
