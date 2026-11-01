CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          TEXT NOT NULL CHECK (role IN ('company','tester')),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  description        TEXT DEFAULT '',
  assets             JSONB NOT NULL DEFAULT '[]',
  price              INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','assigned','in_progress','completed')),
  assigned_tester_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_status  ON projects(status);

CREATE TABLE IF NOT EXISTS project_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'requested'
             CHECK (status IN ('requested','approved','rejected')),
  message    TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, tester_id)
);
CREATE INDEX IF NOT EXISTS idx_requests_project ON project_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_requests_tester  ON project_requests(tester_id);

CREATE TABLE IF NOT EXISTS results (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  test_id    TEXT NOT NULL,
  status     TEXT,
  severity   TEXT,
  notes      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, test_id)
);
CREATE INDEX IF NOT EXISTS idx_results_project ON results(project_id);
