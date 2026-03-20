# Book Notes

A personal reading log. Track books you've read, write notes on them, rate them, and browse your library. Covers pulled automatically from Open Library.
---

## Stack

- Node.js + Express
- PostgreSQL via `pg`
- EJS templating
- Axios for Open Library API requests
- Vanilla CSS and JS, no frontend framework

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

Copy `.env.example` to `.env` and fill in your database password:

```bash
cp .env.example .env
```

Then open `.env` and set `DB_PASSWORD` to whatever you chose during PostgreSQL install.

### 4. Create the database

```bash
psql -U postgres -c "CREATE DATABASE book_notes;"
psql -U postgres -d book_notes -f schema.sql
```

The schema file creates the table and loads five sample books so you have something to look at straight away.

### 5. Run

```bash
npm run dev    # development — restarts automatically on file changes
npm start      # production
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

- Add, edit, and delete books
- Book covers fetched from Open Library by ISBN
- Open Library search on the add form — click a result to fill in title, author, ISBN, and page count automatically
- Sort by most recent, rating, or title
- Filter by reading status (read / currently reading / want to read) and genre
- Live search by title or author, no page reload
- Stats page — books per genre, books per year, top rated, totals
- Reading stats bar on the home page
- Favourite quote per book, displayed as a pull quote on the detail page
- Genre tagging

---

## Schema

```sql
CREATE TABLE books (
  id              SERIAL PRIMARY KEY,
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
```

---

## Project structure

```
book-notes/
├── .env.example            Environment variable template
├── .gitignore
├── index.js                Server — all routes and DB queries
├── schema.sql              Table definition and seed data
├── package.json
├── views/
│   ├── partials/
│   │   ├── head.ejs        Shared HTML head and nav
│   │   └── foot.ejs        Shared footer
│   ├── index.ejs           Home — book grid
│   ├── book.ejs            Book detail
│   ├── form.ejs            Add / edit form
│   ├── stats.ejs           Reading stats page
│   └── error.ejs
└── public/
    ├── css/style.css
    ├── js/
    │   ├── main.js         Live search
    │   └── form.js         Open Library lookup and cover preview
    └── images/
        └── no-cover.svg
```

# Book Notes — Deploy & Environment

Quick guide to deploy this app using Railway and GitHub Actions.

Required environment variables (server):
- NODE_ENV=production
- PORT (optional, default 3000)
- COOKIE_SECRET — strong random secret for cookies/CSRF
- DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD — Postgres connection

GitHub Actions / Railway secrets:
- RAILWAY_API_KEY — (required) add as a repository secret for the workflow to authenticate to Railway
- RAILWAY_PROJECT_ID — (optional) if you want the workflow to link to a specific Railway project
- RAILWAY_SERVICE_ID — (optional) if you manage multiple services and want to target a specific one

How it works:
- Pushing to `main` triggers `.github/workflows/deploy-railway.yml`.
- The action installs dependencies, (optionally) runs `npm run build`, installs the Railway CLI, logs in using `RAILWAY_API_KEY`, optionally links to a project with `RAILWAY_PROJECT_ID` and deploys with `railway up --detach`.

Set up steps (local):
1. Install Railway CLI: `npm i -g @railway/cli`.
2. Create a Railway project and a Postgres plugin (if using Railway for DB).
3. Copy the DB connection details into your environment variables or Railway environment.
4. Create a Railway API key (Account settings) and add it as `RAILWAY_API_KEY` in your GitHub repo Secrets.
5. (Optional) add `RAILWAY_PROJECT_ID` and `RAILWAY_SERVICE_ID` as secrets if you want to target a specific project/service.

Triggering deploy:
- Push to `main` or create a PR merged to `main`.
- The Actions log will show the `railway up` output.

Local test deploy using Railway CLI (example):
- `railway login` (follow interactive prompt), then `railway up` from the project folder.

Notes:
- Ensure `COOKIE_SECRET` is set in production environment for security.
- The app enforces Helmet CSP and HSTS when `NODE_ENV=production`.
