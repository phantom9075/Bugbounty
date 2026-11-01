require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'perimeter-zero-production-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon')
    ? { rejectUnauthorized: false } : false,
});

const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || '*')
  .split(',').map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
}));
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- auth ---------- */
function signToken(u) {
  return jwt.sign(
    { id: u.id, role: u.role, name: u.name, email: u.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
function role(r) {
  return (req, res, next) =>
    req.user.role === r ? next() : res.status(403).json({ error: 'Forbidden' });
}

app.post('/api/auth/register', async (req, res) => {
  const { role, name, email, password } = req.body || {};
  if (!role || !name || !email || !password)
    return res.status(400).json({ error: 'Missing fields' });
  if (!['company', 'tester'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password too short' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (role,name,email,password_hash)
       VALUES ($1,$2,$3,$4) RETURNING id,role,name,email`,
      [role, name.trim(), email.toLowerCase().trim(), hash]
    );
    const u = r.rows[0];
    res.json({ token: signToken(u), user: u });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase().trim()]);
  const u = r.rows[0];
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({
    token: signToken(u),
    user: { id: u.id, role: u.role, name: u.name, email: u.email },
  });
});

app.get('/api/auth/me', auth, (req, res) => res.json(req.user));

/* ---------- testers list (company only) ---------- */
app.get('/api/testers', auth, role('company'), async (req, res) => {
  const r = await pool.query(
    `SELECT id, name, email FROM users WHERE role='tester' ORDER BY name ASC`
  );
  res.json(r.rows);
});

/* ---------- projects (company) ---------- */
app.post('/api/projects', auth, role('company'), async (req, res) => {
  const { name, description = '', assets = [], price = 0 } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  if (!Array.isArray(assets) || !assets.length)
    return res.status(400).json({ error: 'At least one asset required' });
  const r = await pool.query(
    `INSERT INTO projects (company_id,name,description,assets,price)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.user.id, name.trim(), description, JSON.stringify(assets), price | 0]
  );
  res.json(r.rows[0]);
});

app.get('/api/projects/company', auth, role('company'), async (req, res) => {
  const r = await pool.query(
    `SELECT p.*,
       (SELECT COUNT(*) FROM project_requests
        WHERE project_id=p.id AND status='requested')::int AS pending_requests
     FROM projects p
     WHERE p.company_id=$1
     ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.get('/api/projects/:id/requests', auth, role('company'), async (req, res) => {
  const proj = await pool.query(
    'SELECT id FROM projects WHERE id=$1 AND company_id=$2',
    [req.params.id, req.user.id]
  );
  if (!proj.rows[0]) return res.status(404).json({ error: 'Not found' });
  const r = await pool.query(
    `SELECT pr.id, pr.status, pr.message, pr.created_at,
            u.name AS tester_name, u.email AS tester_email
     FROM project_requests pr
     JOIN users u ON u.id = pr.tester_id
     WHERE pr.project_id = $1
     ORDER BY pr.created_at DESC`,
    [req.params.id]
  );
  res.json(r.rows);
});

app.post('/api/projects/:id/requests/:reqId/approve',
  auth, role('company'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const proj = await client.query(
      'SELECT * FROM projects WHERE id=$1 AND company_id=$2 FOR UPDATE',
      [req.params.id, req.user.id]
    );
    if (!proj.rows[0]) throw new Error('Project not found');

    const reqRow = await client.query(
      'SELECT * FROM project_requests WHERE id=$1 AND project_id=$2',
      [req.params.reqId, req.params.id]
    );
    if (!reqRow.rows[0]) throw new Error('Request not found');

    await client.query(
      "UPDATE project_requests SET status='approved' WHERE id=$1",
      [req.params.reqId]
    );
    await client.query(
      `UPDATE project_requests SET status='rejected'
       WHERE project_id=$1 AND id<>$2 AND status='requested'`,
      [req.params.id, req.params.reqId]
    );
    await client.query(
      `UPDATE projects SET status='assigned', assigned_tester_id=$1
       WHERE id=$2`,
      [reqRow.rows[0].tester_id, req.params.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.delete('/api/projects/:id', auth, role('company'), async (req, res) => {
  const r = await pool.query(
    'DELETE FROM projects WHERE id=$1 AND company_id=$2',
    [req.params.id, req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
});

/* ---------- projects (tester) ---------- */
app.get('/api/projects/open', auth, role('tester'), async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, p.name, p.description, p.price, p.assets, p.status,
            p.created_at, u.name AS company_name,
            pr.status AS my_request_status
     FROM projects p
     JOIN users u ON u.id = p.company_id
     LEFT JOIN project_requests pr
       ON pr.project_id = p.id AND pr.tester_id = $1
     WHERE p.status = 'open'
     ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.get('/api/projects/active', auth, role('tester'), async (req, res) => {
  const r = await pool.query(
    `SELECT p.id, p.name, p.description, p.price, p.assets, p.status,
            p.created_at, u.name AS company_name
     FROM projects p
     JOIN users u ON u.id = p.company_id
     JOIN project_requests pr
       ON pr.project_id = p.id AND pr.tester_id = $1 AND pr.status='approved'
     WHERE p.status IN ('assigned','in_progress','completed')
     ORDER BY p.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.get('/api/projects/my-requests', auth, role('tester'), async (req, res) => {
  const r = await pool.query(
    `SELECT pr.status AS request_status, pr.created_at AS requested_at,
            p.id AS project_id, p.name, p.price, p.assets, p.status AS project_status,
            u.name AS company_name
     FROM project_requests pr
     JOIN projects p ON p.id = pr.project_id
     JOIN users u ON u.id = p.company_id
     WHERE pr.tester_id = $1
     ORDER BY pr.created_at DESC`,
    [req.user.id]
  );
  res.json(r.rows);
});

app.post('/api/projects/:id/requests', auth, role('tester'), async (req, res) => {
  const { message = '' } = req.body || {};
  const proj = await pool.query('SELECT status FROM projects WHERE id=$1', [req.params.id]);
  if (!proj.rows[0]) return res.status(404).json({ error: 'Not found' });
  if (proj.rows[0].status !== 'open')
    return res.status(400).json({ error: 'Project is not open' });

  const existing = await pool.query(
    'SELECT status FROM project_requests WHERE project_id=$1 AND tester_id=$2',
    [req.params.id, req.user.id]
  );
  if (existing.rows[0] && existing.rows[0].status === 'approved')
    return res.status(400).json({ error: 'Already approved' });

  const r = await pool.query(
    `INSERT INTO project_requests (project_id, tester_id, message)
     VALUES ($1,$2,$3)
     ON CONFLICT (project_id, tester_id)
     DO UPDATE SET message=EXCLUDED.message, status='requested', created_at=NOW()
     RETURNING *`,
    [req.params.id, req.user.id, message]
  );
  res.json(r.rows[0]);
});

app.post('/api/projects/:id/start', auth, role('tester'), async (req, res) => {
  const r = await pool.query(
    `UPDATE projects SET status='in_progress'
     WHERE id=$1 AND assigned_tester_id=$2 AND status IN ('assigned','in_progress')
     RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!r.rowCount) return res.status(403).json({ error: 'Not assigned to you' });
  res.json({ ok: true });
});

/* ---------- single project ---------- */
app.get('/api/projects/:id', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT p.*, u.name AS company_name
     FROM projects p JOIN users u ON u.id = p.company_id
     WHERE p.id = $1`,
    [req.params.id]
  );
  const p = r.rows[0];
  if (!p) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'company' && p.company_id !== req.user.id)
    return res.status(403).json({ error: 'Forbidden' });
  if (req.user.role === 'tester') {
    const ok = await pool.query(
      `SELECT 1 FROM project_requests
       WHERE project_id=$1 AND tester_id=$2 AND status='approved'`,
      [p.id, req.user.id]
    );
    if (!ok.rows[0]) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(p);
});

/* ---------- results ---------- */
app.get('/api/projects/:id/results', auth, role('tester'), async (req, res) => {
  const ok = await pool.query(
    'SELECT 1 FROM projects WHERE id=$1 AND assigned_tester_id=$2',
    [req.params.id, req.user.id]
  );
  if (!ok.rows[0]) return res.status(403).json({ error: 'Forbidden' });
  const r = await pool.query(
    'SELECT test_id,status,severity,notes,updated_at FROM results WHERE project_id=$1',
    [req.params.id]
  );
  res.json(r.rows);
});

app.put('/api/projects/:id/results', auth, role('tester'), async (req, res) => {
  const ok = await pool.query(
    'SELECT 1 FROM projects WHERE id=$1 AND assigned_tester_id=$2',
    [req.params.id, req.user.id]
  );
  if (!ok.rows[0]) return res.status(403).json({ error: 'Forbidden' });
  const { results } = req.body || {};
  if (!Array.isArray(results)) return res.status(400).json({ error: 'Invalid payload' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of results) {
      if (!r || typeof r.test_id !== 'string') continue;
      if (r.status) {
        await client.query(
          `INSERT INTO results (project_id,test_id,status,severity,notes,updated_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (project_id,test_id)
           DO UPDATE SET status=$3, severity=$4, notes=$5, updated_at=NOW()`,
          [req.params.id, r.test_id, r.status, r.severity || null, r.notes || null]
        );
      } else {
        await client.query(
          'DELETE FROM results WHERE project_id=$1 AND test_id=$2',
          [req.params.id, r.test_id]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

/* ---------- checklist & download routes ---------- */
app.get('/download-zip', (req, res) => {
  res.download(path.join(__dirname, 'public', 'perimeter-zero.zip'), 'perimeter-zero.zip');
});

app.get('/perimeter-zero.zip', (req, res) => {
  res.download(path.join(__dirname, 'public', 'perimeter-zero.zip'), 'perimeter-zero.zip');
});

app.get('/checklist', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'perimeter-zero-checklist.html'));
});

/* ---------- health + fallback ---------- */
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'signin-register.html'));
});

app.listen(PORT, () => console.log(`Perimeter Zero listening on :${PORT}`));
