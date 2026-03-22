-- Book Notes — Full Schema with Users
-- Run this on your Railway Postgres database

DROP TABLE IF EXISTS books;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS users;

-- Users table
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Session table (for express-session / connect-pg-simple)
CREATE TABLE session (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON    NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_session_expire ON session (expire);

-- Books table — now linked to a user
CREATE TABLE books (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  author          VARCHAR(255) NOT NULL,
  isbn            VARCHAR(20),
  genre           VARCHAR(100),
  rating          SMALLINT CHECK (rating BETWEEN 1 AND 10),
  status          VARCHAR(20) NOT NULL DEFAULT 'read'
                  CHECK (status IN ('read', 'reading', 'want')),
  date_read       DATE,
  page_count      INTEGER CHECK (page_count > 0),
  favourite_quote TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_books_user    ON books (user_id);
CREATE INDEX idx_books_rating  ON books (rating DESC);
CREATE INDEX idx_books_date    ON books (date_read DESC);
CREATE INDEX idx_books_title   ON books (title ASC);
CREATE INDEX idx_books_status  ON books (status);