PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  can_transfer INTEGER NOT NULL DEFAULT 0 CHECK (can_transfer IN (0,1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  default_location_id INTEGER REFERENCES locations(id),
  image_url TEXT NOT NULL DEFAULT '',
  qr_value TEXT NOT NULL UNIQUE,
  stock_max INTEGER NOT NULL DEFAULT 0 CHECK (stock_max >= 0),
  stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
  unit_price_minor INTEGER NOT NULL DEFAULT 0 CHECK (unit_price_minor >= 0),
  item_type TEXT NOT NULL DEFAULT 'returnable' CHECK (item_type IN ('consumable','returnable')),
  requires_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_approval IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  remark TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stock_balances (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  location_code TEXT NOT NULL CHECK (location_code IN ('BTT','TKE')),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (asset_id, location_code)
);

CREATE TABLE IF NOT EXISTS stock_reservations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  location_code TEXT NOT NULL CHECK (location_code IN ('BTT','TKE')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  request_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  location_code TEXT NOT NULL CHECK (location_code IN ('BTT','TKE')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  request_type TEXT NOT NULL CHECK (request_type IN ('consume','borrow')),
  project_name TEXT NOT NULL DEFAULT '',
  borrower_name TEXT NOT NULL DEFAULT '',
  expected_return_date TEXT,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by TEXT NOT NULL REFERENCES users(id),
  decided_by TEXT REFERENCES users(id),
  decision_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS borrow_transactions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  location_code TEXT NOT NULL CHECK (location_code IN ('BTT','TKE')),
  project_name TEXT NOT NULL DEFAULT '',
  borrower_name TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  quantity_returned INTEGER NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0 AND quantity_returned <= quantity),
  borrow_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expected_return_date TEXT,
  remark TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'borrowed' CHECK (status IN ('borrowed','partially_returned','returned','overdue','damaged','lost')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS borrow_returns (
  id TEXT PRIMARY KEY,
  borrow_id TEXT NOT NULL REFERENCES borrow_transactions(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good','damaged','lost')),
  note TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL REFERENCES users(id),
  returned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('opening','receive','consume','borrow','return','transfer_out','transfer_in','adjustment','damage','loss')),
  from_location TEXT CHECK (from_location IN ('BTT','TKE')),
  to_location TEXT CHECK (to_location IN ('BTT','TKE')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  before_quantity INTEGER,
  after_quantity INTEGER,
  reference_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  performed_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  user_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  event_type TEXT NOT NULL CHECK (event_type IN ('low_stock','approval_pending','overdue_borrow')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(email, event_type)
);

CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(name);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_movements_asset_date ON stock_movements(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_status ON borrow_transactions(status, expected_return_date);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_date ON activity_logs(created_at DESC);
