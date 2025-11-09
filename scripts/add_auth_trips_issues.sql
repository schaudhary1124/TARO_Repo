-- Users with role-based access
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'user' | 'dev' | 'owner'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Saved trips
CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start TEXT,
  end TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS trip_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL,
  attraction_id TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0, -- 0/1 to match your UI lock
  position INTEGER, -- optional sort
  FOREIGN KEY (trip_id) REFERENCES trips(id)
);

-- Ratings (aggregate-friendly but still auditable per user)
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  attraction_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  UNIQUE (user_id, attraction_id)
);

-- Issues reported from UI
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, -- nullable (guest)
  subject TEXT NOT NULL,
  payload TEXT, -- JSON blob as text
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
