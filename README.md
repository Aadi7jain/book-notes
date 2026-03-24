# Book Notes

A personal reading journal with multi-user authentication. Track books you've read, write notes, rate them, and browse your library. Covers pulled automatically from Open Library.

Live: [book-notes-aadi-jain.up.railway.app](https://book-notes-aadi-jain.up.railway.app)

---

## Stack

- **Node.js + Express** — server and routing
- **PostgreSQL** via `pg` — database
- **EJS** — templating
- **bcrypt** — password hashing
- **express-session + connect-pg-simple** — session management
- **Resend** — transactional email (password reset)
- **Axios** — Open Library API requests
- **Vanilla CSS and JS** — no frontend framework

---

## Features

- **Multi-user auth** — sign up, log in, log out, each account is completely private
- **Forgot password** — secure email reset flow via Resend
- **Add, edit, delete books** — full CRUD per user
- **Book covers** fetched from Open Library by ISBN
- **Open Library search** on the add form — click a result to autofill title, author, ISBN, and page count
- **Sort** by most recent, rating, or title
- **Filter** by reading status (read / currently reading / want to read) and genre
- **Live search** by title or author — no page reload
- **Stats page** — books per genre, books per year, top rated, totals
- **Reading stats bar** on the home page
- **Favourite quote** per book, displayed as a pull quote on the detail page
- **Genre tagging**
- Rate limiting, input validation, Helmet security headers

---

## Setup

### 1. Prerequisites

- Node.js v18 or later
- PostgreSQL running locally

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:

```env
NODE_ENV=development
SESSION_SECRET=your-random-secret

DB_HOST=localhost
DB_PORT=5432
DB_NAME=book_notes
DB_USER=postgres
DB_PASSWORD=yourpassword

RESEND_API_KEY=re_xxxxxxxxxxxx
APP_BASE_URL=http://localhost:3000
```

### 4. Create the database

```bash
psql -U postgres -c "CREATE DATABASE book_notes;"
psql -U postgres -d book_notes -f schema.sql
```

Also create the password resets table:

```sql
CREATE TABLE IF NOT EXISTS password_resets (
  email      TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
```

### 5. Run

```bash
npm run dev    # development — restarts automatically on file changes
npm start      # production
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment (Railway)

1. Push the repo to GitHub
2. Create a new project on [Railway](https://railway.app) and connect your GitHub repo
3. Add a PostgreSQL plugin in Railway
4. Set these environment variables in Railway:

```env
NODE_ENV=production
SESSION_SECRET=your-random-secret
DB_HOST=...
DB_PORT=5432
DB_NAME=...
DB_USER=...
DB_PASSWORD=...
RESEND_API_KEY=re_xxxxxxxxxxxx
APP_BASE_URL=https://your-app.up.railway.app
```

5. Railway auto-deploys on every push to `main`

---

## Schema

```sql
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE books (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  author          VARCHAR(255) NOT NULL,
  isbn            VARCHAR(20),
  genre           VARCHAR(100),
  rating          SMALLINT CHECK (rating BETWEEN 1 AND 10),
  status          VARCHAR(20) DEFAULT 'read',
  date_read       DATE,
  page_count      INTEGER,
  favourite_quote TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE password_resets (
  email      TEXT PRIMARY KEY,
  token      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
```

---

## Project structure

```
book-notes/
├── .env.example
├── .gitignore
├── index.js                  Server — all routes and DB queries
├── schema.sql                Table definitions
├── package.json
├── views/
│   ├── partials/
│   │   ├── head.ejs          Shared HTML head and nav
│   │   └── foot.ejs          Shared footer
│   ├── index.ejs             Home — book grid
│   ├── book.ejs              Book detail
│   ├── form.ejs              Add / edit form
│   ├── stats.ejs             Reading stats page
│   ├── login.ejs             Log in
│   ├── signup.ejs            Sign up
│   ├── reset-request.ejs     Forgot password form
│   ├── reset-sent.ejs        Email sent confirmation
│   ├── reset-form.ejs        New password form
│   ├── reset-success.ejs     Password updated confirmation
│   └── error.ejs
└── public/
    ├── css/style.css
    ├── js/
    │   ├── app.js            Cursor, nav, toasts, animations
    │   ├── main.js           Live search
    │   └── form.js           Open Library lookup and cover preview
    └── images/
        └── no-cover.svg
```

---

## Email (Password Reset)

Uses [Resend](https://resend.com) with a verified custom domain. Reset tokens are stored in PostgreSQL and expire after 1 hour.

To set up:
1. Create a free account at resend.com
2. Verify your domain under Domains
3. Add `RESEND_API_KEY` to your environment variables
4. Set `APP_BASE_URL` to your production URL

---

*Built by [Aadi Jain](https://github.com/Aadi7jain)*