// ═══════════════════════════════════════════════════════
//  Book Notes — Aadi Jain
//  Production-hardened server
//  Security: Helmet · Rate limiting · CSRF · HPP ·
//            Input validation · Parameterised SQL ·
//            Secure cookies · CSP · HSTS · Compression
// ═══════════════════════════════════════════════════════

import "dotenv/config";
import express        from "express";
import axios          from "axios";
import pg             from "pg";
import path           from "path";
import helmet         from "helmet";
import rateLimit      from "express-rate-limit";
import { body, query, param, validationResult } from "express-validator";
import hpp            from "hpp";
import cookieParser   from "cookie-parser";
import compression    from "compression";
import morgan         from "morgan";
// csrf-csrf: disabled in dev, enable in production
import { fileURLToPath } from "url";
import { randomBytes } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app        = express();
const PORT       = process.env.PORT || 3000;
const IS_PROD    = process.env.NODE_ENV === "production";

// ── Trust proxy (needed for Railway / Heroku) ──────────
app.set("trust proxy", 1);

// ── Database (connection pool for production) ──────────
const db = new pg.Pool({
  host:               process.env.DB_HOST     || "localhost",
  port:               Number(process.env.DB_PORT) || 5432,
  database:           process.env.DB_NAME     || "book_notes",
  user:               process.env.DB_USER     || "postgres",
  password:           process.env.DB_PASSWORD || "postgres",
  ssl:                IS_PROD ? { rejectUnauthorized: false } : false,
  max:                10,       // max pool connections
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 5000,
});

db.connect()
  .then(() => console.log("db connected"))
  .catch((err) => {
    console.error("db connection failed:", err.message);
    process.exit(1); // fail fast — don't serve without a DB
  });

// ── Compression ────────────────────────────────────────
app.use(compression());

// ── HTTP request logging (prod: combined, dev: dev) ────
app.use(morgan(IS_PROD ? "combined" : "dev"));

// ══════════════════════════════════════════════════════
//  SECURITY HEADERS — OWASP A05 Security Misconfiguration
// ══════════════════════════════════════════════════════
app.use(
  helmet({
    // Content Security Policy — allow necessary third-party assets (fonts, OpenLibrary covers)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "https://fonts.googleapis.com", "https://api.fontshare.com", "'unsafe-inline'"],
        fontSrc:    ["'self'", "https://fonts.gstatic.com", "https://api.fontshare.com"],
        imgSrc:     ["'self'", "data:", "https://covers.openlibrary.org"],
        connectSrc: ["'self'", "https://covers.openlibrary.org"],
        frameSrc:   ["'none'"],
        objectSrc:  ["'none'"],
        baseUri:    ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    // HSTS in production
    hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true,
    hidePoweredBy: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: false,
  })
);

// ── HTTP Parameter Pollution protection ───────────────
app.use(hpp());

// ── Body parsing with size limits ─────────────────────
// OWASP A05 — limit request body to prevent DoS
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(express.json({ limit: "10kb" }));

// ── Cookie parser (needed for CSRF) ───────────────────
app.use(cookieParser(process.env.COOKIE_SECRET || "change-this-secret-in-production"));

// ── Static files ──────────────────────────────────────
app.use(
  express.static(path.join(__dirname, "public"), {
    // Security headers on static files
    setHeaders(res) {
      res.set("X-Content-Type-Options", "nosniff");
      res.set("Cache-Control", "public, max-age=86400"); // 1 day cache
    },
  })
);

// ── Templating ────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ══════════════════════════════════════════════════════
//  RATE LIMITING — OWASP A04 Insecure Design / DoS
// ══════════════════════════════════════════════════════
// General limiter — all routes
const generalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              200,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many requests. Please try again later." },
  skip:             (req) => !IS_PROD, // skip in dev
});

// Strict limiter — write operations
const writeLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              30,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many write requests. Please slow down." },
  skip:             (req) => !IS_PROD,
});

// API limiter — search endpoint
const apiLimiter = rateLimit({
  windowMs:         1 * 60 * 1000, // 1 minute
  max:              20,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Too many search requests. Please wait." },
  skip:             (req) => !IS_PROD,
});

app.use(generalLimiter);

// ══════════════════════════════════════════════════════
//  CSRF PROTECTION — Double-submit cookie (enabled in production) ──
let generateToken;
let doubleCsrfProtection;

if (IS_PROD) {
  // Ensure secret is set in production
  if (!process.env.COOKIE_SECRET) {
    console.error('Missing COOKIE_SECRET in production environment. Set COOKIE_SECRET and restart.');
    process.exit(1);
  }

  generateToken = (req, res) => {
    const token = randomBytes(16).toString('hex');
    // Set a readable cookie (not httpOnly) for double-submit pattern.
    // SameSite=Strict and Secure are enforced in production.
    res.cookie('csrf_token', token, { sameSite: 'Strict', secure: true, httpOnly: false, maxAge: 1000 * 60 * 60 });
    return token;
  };

  doubleCsrfProtection = (req, res, next) => {
    const cookieToken = req.cookies && req.cookies['csrf_token'];
    const bodyToken = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!cookieToken || !bodyToken || cookieToken !== String(bodyToken)) {
      const err = new Error('invalid csrf token'); err.code = 'EBADCSRFTOKEN';
      return next(err);
    }
    next();
  };
} else {
  generateToken = (req, res) => 'no-csrf-dev';
  doubleCsrfProtection = (req, res, next) => next();
}

// ── Helpers ────────────────────────────────────────────

function coverUrl(isbn, size = "M") {
  if (!isbn?.trim()) return "/images/no-cover.svg";
  // Only allow valid ISBN chars — strip anything suspicious
  const clean = isbn.trim().replace(/[^0-9X]/gi, "");
  if (!clean) return "/images/no-cover.svg";
  return `https://covers.openlibrary.org/b/isbn/${clean}-${size}.jpg`;
}

function fmtShort(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" });
}

function fmtLong(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function shape(book, size = "M") {
  return { ...book, cover_url: coverUrl(book.isbn, size),
           date_fmt: size === "L" ? fmtLong(book.date_read) : fmtShort(book.date_read) };
}

// Centralised validation error handler
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render("error", {
      message: errors.array().map(e => e.msg).join(" · "),
    });
  }
  next();
}

// ── Book field validators (reused across add + edit) ──
const bookValidators = [
  body("title")
    .trim().notEmpty().withMessage("Title is required.")
    .isLength({ max: 255 }).withMessage("Title must be under 255 characters.")
    .escape(),
  body("author")
    .trim().notEmpty().withMessage("Author is required.")
    .isLength({ max: 255 }).withMessage("Author must be under 255 characters.")
    .escape(),
  body("isbn")
    .optional({ checkFalsy: true })
    .trim()
    .customSanitizer(val => val ? val.replace(/[-\s]/g, "") : val)
    .matches(/^[0-9X]{10}$|^[0-9]{13}$/).withMessage("ISBN must be 10 or 13 digits."),
  body("genre")
    .optional({ checkFalsy: true })
    .trim().isLength({ max: 100 }).withMessage("Genre must be under 100 characters.")
    .escape(),
  body("rating")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 10 }).withMessage("Rating must be between 1 and 10.")
    .toInt(),
  body("status")
    .optional()
    .isIn(["read", "reading", "want"]).withMessage("Invalid status value."),
  body("date_read")
    .optional({ checkFalsy: true })
    .isDate().withMessage("Invalid date format."),
  body("page_count")
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 99999 }).withMessage("Page count must be a positive number.")
    .toInt(),
  body("favourite_quote")
    .optional({ checkFalsy: true })
    .trim().isLength({ max: 2000 }).withMessage("Quote must be under 2000 characters."),
  body("notes")
    .optional({ checkFalsy: true })
    .trim().isLength({ max: 50000 }).withMessage("Notes must be under 50,000 characters."),
];

// ══════════════════════════════════════════════════════
//  ROUTES
// ══════════════════════════════════════════════════════

// ── Home ───────────────────────────────────────────────
app.get("/",
  query("sort").optional().isIn(["rating", "date_read", "title"]),
  query("status").optional().isIn(["", "read", "reading", "want"]),
  query("genre").optional().trim().isLength({ max: 100 }).escape(),
  async (req, res) => {
    const sort   = ["rating", "date_read", "title"].includes(req.query.sort) ? req.query.sort : "date_read";
    const status = ["read", "reading", "want"].includes(req.query.status) ? req.query.status : "";
    const genre  = req.query.genre?.slice(0, 100) || "";

    const sortMap = {
      rating:    "rating DESC NULLS LAST, date_read DESC NULLS LAST",
      date_read: "date_read DESC NULLS LAST, rating DESC NULLS LAST",
      title:     "title ASC",
    };

    const conditions = [], params = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (genre)  { params.push(genre);  conditions.push(`genre  = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    try {
      const [booksRes, statsRes, genresRes] = await Promise.all([
        db.query(`SELECT * FROM books ${where} ORDER BY ${sortMap[sort]}`, params),
        db.query(`SELECT
          COUNT(*)                                                     AS total,
          COUNT(*) FILTER (WHERE status = 'read')                     AS total_read,
          COUNT(*) FILTER (WHERE status = 'reading')                  AS currently_reading,
          COUNT(*) FILTER (WHERE status = 'want')                     AS want_to_read,
          ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL), 1)     AS avg_rating,
          COALESCE(SUM(page_count) FILTER (WHERE status = 'read'), 0) AS total_pages
          FROM books`),
        db.query(`SELECT DISTINCT genre FROM books WHERE genre IS NOT NULL ORDER BY genre`),
      ]);
      res.render("index", {
        books: booksRes.rows.map((b) => shape(b)),
        stats: statsRes.rows[0],
        genres: genresRes.rows.map((r) => r.genre),
        sort, status, genre,
      });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load books." });
    }
  }
);

// ── Book detail ────────────────────────────────────────
app.get("/book/:id",
  param("id").isInt({ min: 1 }).withMessage("Invalid book ID."),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM books WHERE id = $1", [parseInt(req.params.id)]);
      if (!rows.length) return res.status(404).render("error", { message: "Book not found." });
      res.render("book", { book: shape(rows[0], "L"), csrfToken: generateToken(req, res) });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load book." });
    }
  }
);

// ── Stats ──────────────────────────────────────────────
app.get("/stats", async (req, res) => {
  try {
    const [overview, byGenre, byYear, topRated] = await Promise.all([
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'read')                     AS total_read,
        COUNT(*) FILTER (WHERE status = 'reading')                  AS currently_reading,
        COUNT(*) FILTER (WHERE status = 'want')                     AS want_to_read,
        ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL), 1)     AS avg_rating,
        MAX(rating)                                                  AS highest_rating,
        MIN(rating) FILTER (WHERE rating IS NOT NULL)               AS lowest_rating,
        COALESCE(SUM(page_count) FILTER (WHERE status = 'read'), 0) AS total_pages,
        COUNT(DISTINCT genre) FILTER (WHERE genre IS NOT NULL)      AS genre_count
        FROM books`),
      db.query(`SELECT genre, COUNT(*) AS count FROM books
        WHERE genre IS NOT NULL AND status = 'read'
        GROUP BY genre ORDER BY count DESC LIMIT 8`),
      db.query(`SELECT EXTRACT(YEAR FROM date_read) AS year, COUNT(*) AS count,
        ROUND(AVG(rating),1) AS avg_rating FROM books
        WHERE date_read IS NOT NULL AND status = 'read'
        GROUP BY year ORDER BY year DESC LIMIT 6`),
      db.query(`SELECT * FROM books WHERE rating IS NOT NULL
        ORDER BY rating DESC, date_read DESC NULLS LAST LIMIT 5`),
    ]);
    res.render("stats", {
      overview: overview.rows[0], byGenre: byGenre.rows,
      byYear: byYear.rows, topRated: topRated.rows.map((b) => shape(b)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { message: "Could not load stats." });
  }
});

// ── Add book — GET ─────────────────────────────────────
app.get("/add", (req, res) => {
  res.render("form", {
    book: null, action: "/add", heading: "Add a book", error: null,
    csrfToken: generateToken(req, res),
  });
});

// ── Add book — POST ────────────────────────────────────
app.post("/add",
  writeLimiter,
  doubleCsrfProtection,
  bookValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("form", {
        book: req.body, action: "/add", heading: "Add a book",
        error: errors.array()[0].msg,
        csrfToken: generateToken(req, res),
      });
    }
    const f = req.body;
    try {
      await db.query(
        `INSERT INTO books (title,author,isbn,genre,rating,status,date_read,page_count,favourite_quote,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [f.title, f.author, f.isbn||null, f.genre||null, f.rating||null,
         f.status||"read", f.date_read||null, f.page_count||null,
         f.favourite_quote||null, f.notes||null]
      );
      res.redirect("/?added=1");
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not save book." });
    }
  }
);

// ── Edit book — GET ────────────────────────────────────
app.get("/edit/:id",
  param("id").isInt({ min: 1 }),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM books WHERE id = $1", [parseInt(req.params.id)]);
      if (!rows.length) return res.status(404).render("error", { message: "Book not found." });
      res.render("form", {
        book: rows[0], action: `/edit/${req.params.id}`, heading: "Edit book", error: null,
        csrfToken: generateToken(req, res),
      });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load edit form." });
    }
  }
);

// ── Edit book — POST ───────────────────────────────────
app.post("/edit/:id",
  writeLimiter,
  doubleCsrfProtection,
  param("id").isInt({ min: 1 }),
  bookValidators,
  async (req, res) => {
    const id = parseInt(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("form", {
        book: { ...req.body, id }, action: `/edit/${id}`, heading: "Edit book",
        error: errors.array()[0].msg,
        csrfToken: generateToken(req, res),
      });
    }
    const f = req.body;
    try {
      const result = await db.query(
        `UPDATE books SET title=$1,author=$2,isbn=$3,genre=$4,rating=$5,status=$6,
         date_read=$7,page_count=$8,favourite_quote=$9,notes=$10 WHERE id=$11`,
        [f.title, f.author, f.isbn||null, f.genre||null, f.rating||null,
         f.status||"read", f.date_read||null, f.page_count||null,
         f.favourite_quote||null, f.notes||null, id]
      );
      if (result.rowCount === 0) return res.status(404).render("error", { message: "Book not found." });
      res.redirect(`/book/${id}?updated=1`);
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not update book." });
    }
  }
);

// ── Delete book ────────────────────────────────────────
app.post("/delete/:id",
  writeLimiter,
  doubleCsrfProtection,
  param("id").isInt({ min: 1 }),
  handleValidationErrors,
  async (req, res) => {
    try {
      await db.query("DELETE FROM books WHERE id = $1", [parseInt(req.params.id)]);
      res.redirect("/?deleted=1");
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not delete book." });
    }
  }
);

// ── Open Library search proxy — simplified, original behavior restored
app.get("/api/search",
  apiLimiter,
  query("q").trim().notEmpty().isLength({ max: 200 }).escape(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.json({ books: [] });

    const q = req.query.q;
    try {
      const { data } = await axios.get("https://openlibrary.org/search.json", {
        params: { q, limit: 20, fields: "title,author_name,isbn,cover_i,number_of_pages_median" },
        timeout: 8000,
        headers: { "User-Agent": "BookNotes/1.0" },
      });

      // Find the most common author across all results to use as fallback
      const fallbackAuthor = data.docs
        .map(b => b.author_name?.[0])
        .filter(Boolean)[0] ?? "Unknown";

      // Original behaviour: prefer results that include at least one ISBN
      const books = (data.docs || [])
        .filter((b) => b.isbn?.length)
        .slice(0, 8)
        .map((b) => {
          // pick a 13-digit ISBN if available, else the first
          const rawIsbn = (b.isbn.find(i => i.replace(/[-\s]/g, "").length === 13) || b.isbn[0]) || "";
          const isbnClean = String(rawIsbn).replace(/[-\s]/g, "");
          const cover = coverUrl(isbnClean, 'M');
          // Server-side debug log (dev only)
          if (!IS_PROD) console.debug('OL -> cover_url:', cover, 'isbn:', isbnClean, 'title:', (b.title||'').slice(0,40));
          return {
            title:      (b.title || "").slice(0, 255),
            author:     (b.author_name?.[0] ?? fallbackAuthor).slice(0, 255),
            isbn:       isbnClean,
            page_count: b.number_of_pages_median ?? null,
            cover_url:  cover,
          };
        });

      res.json({ books });
    } catch (err) {
      console.error("Open Library:", err.message);
      res.status(500).json({ error: "Could not reach Open Library." });
    }
  }
);

// ── 404 handler — catch all unknown routes ─────────────
app.use((req, res) => {
  res.status(404).render("error", { message: "Page not found." });
});

// ── Global error handler — log and respond with generic message
app.use((err, req, res, next) => {
  console.error("Unexpected error:", err);
  res.status(500).render("error", { message: "An unexpected error occurred." });
});

// ── Start server ───────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});