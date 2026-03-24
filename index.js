// Book Notes — Aadi Jain
// Full multi-user auth + mobile responsive

import "dotenv/config";
import express      from "express";
import axios        from "axios";
import pg           from "pg";
import path         from "path";
import helmet       from "helmet";
import rateLimit    from "express-rate-limit";
import { body, query, param, validationResult } from "express-validator";
import hpp          from "hpp";
import compression  from "compression";
import morgan       from "morgan";
import session      from "express-session";
import pgSession    from "connect-pg-simple";
import bcrypt       from "bcrypt";
import { fileURLToPath } from "url";
import { randomBytes } from "crypto";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app     = express();
const PORT    = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

const resend = new Resend(process.env.RESEND_API_KEY);

app.set("trust proxy", 1);

// ── Database ───────────────────────────────────────────
const db = new pg.Pool({
  host:                    process.env.DB_HOST     || "localhost",
  port:                    Number(process.env.DB_PORT) || 5432,
  database:                process.env.DB_NAME     || "book_notes",
  user:                    process.env.DB_USER     || "postgres",
  password:                process.env.DB_PASSWORD || "postgres",
  ssl:                     IS_PROD ? { rejectUnauthorized: false } : false,
  max:                     10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000,
});

db.connect()
  .then(() => console.log("db connected"))
  .catch((err) => { console.error("db connection failed:", err.message); process.exit(1); });

// ── Middleware ─────────────────────────────────────────
app.use(compression());
app.use(morgan(IS_PROD ? "combined" : "dev"));

app.use(helmet({
  contentSecurityPolicy:        false,
  hsts:                         false,
  noSniff:                      true,
  frameguard:                   { action: "deny" },
  xssFilter:                    true,
  hidePoweredBy:                true,
  referrerPolicy:               { policy: "strict-origin-when-cross-origin" },
  permittedCrossDomainPolicies: false,
}));

app.use(hpp());
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(express.json({ limit: "10kb" }));

// ── Sessions ───────────────────────────────────────────
const PgStore = pgSession(session);
app.use(session({
  store: new PgStore({
    pool: db,
    tableName: "session",
    createTableIfMissing: false,
  }),
  secret:            process.env.SESSION_SECRET || "change-this-secret",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   IS_PROD,
    httpOnly: true,
    sameSite: "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "public, max-age=86400");
  },
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Rate limiters ──────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  skip: () => !IS_PROD,
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  skip: () => !IS_PROD,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: "Too many attempts. Please try again in 15 minutes.",
  skip: () => !IS_PROD,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  skip: () => !IS_PROD,
});

app.use(generalLimiter);

// ── Auth middleware ────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.redirect("/login");
  next();
}

// ── Helpers ────────────────────────────────────────────
function coverUrl(isbn, size = "M") {
  if (!isbn?.trim()) return "/images/no-cover.svg";
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

function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).render("error", { message: errors.array().map(e => e.msg).join(" · "), user: req.session?.userName });
  next();
}

const bookValidators = [
  body("title").trim().notEmpty().withMessage("Title is required.")
    .isLength({ max: 255 }).escape(),
  body("author").trim().notEmpty().withMessage("Author is required.")
    .isLength({ max: 255 }).escape(),
  body("isbn").optional({ checkFalsy: true }).trim()
    .customSanitizer(val => val ? val.replace(/[-\s]/g, "") : val)
    .matches(/^[0-9X]{10}$|^[0-9]{13}$/).withMessage("ISBN must be 10 or 13 digits."),
  body("genre").optional({ checkFalsy: true }).trim().isLength({ max: 100 }).escape(),
  body("rating").optional({ checkFalsy: true })
    .isInt({ min: 1, max: 10 }).withMessage("Rating must be between 1 and 10.").toInt(),
  body("status").optional().isIn(["read", "reading", "want"]),
  body("date_read").optional({ checkFalsy: true }).isDate(),
  body("page_count").optional({ checkFalsy: true })
    .isInt({ min: 1, max: 99999 }).toInt(),
  body("favourite_quote").optional({ checkFalsy: true }).trim().isLength({ max: 2000 }),
  body("notes").optional({ checkFalsy: true }).trim().isLength({ max: 50000 }),
];

// ══════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════

// Signup
app.get("/signup", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("signup", { error: null });
});

app.post("/signup", authLimiter,
  body("name").trim().notEmpty().withMessage("Name is required.").isLength({ max: 100 }).escape(),
  body("email").trim().isEmail().withMessage("Valid email is required.").normalizeEmail(),
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("signup", { error: errors.array()[0].msg });
    }
    const { name, email, password } = req.body;
    try {
      const existing = await db.query("SELECT id FROM users WHERE email = $1", [email]);
      if (existing.rows.length) {
        return res.status(400).render("signup", { error: "An account with that email already exists." });
      }
      const hash = await bcrypt.hash(password, 12);
      const result = await db.query(
        "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name",
        [name, email, hash]
      );
      req.session.userId   = result.rows[0].id;
      req.session.userName = result.rows[0].name;
      res.redirect("/");
    } catch (err) {
      console.error(err);
      res.status(500).render("signup", { error: "Something went wrong. Please try again." });
    }
  }
);

// Login
app.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("login", { error: null });
});

app.post("/login", authLimiter,
  body("email").trim().isEmail().normalizeEmail(),
  body("password").notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("login", { error: "Please enter a valid email and password." });
    }
    const { email, password } = req.body;
    try {
      const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);
      if (!result.rows.length) {
        return res.status(400).render("login", { error: "Incorrect email or password." });
      }
      const user  = result.rows[0];
      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(400).render("login", { error: "Incorrect email or password." });
      }
      req.session.userId   = user.id;
      req.session.userName = user.name;
      res.redirect("/");
    } catch (err) {
      console.error(err);
      res.status(500).render("login", { error: "Something went wrong. Please try again." });
    }
  }
);

// Logout
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ══════════════════════════════════════════════════════
//  PASSWORD RESET
// ══════════════════════════════════════════════════════

// Show reset request form
app.get("/reset", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("reset-request", { error: null });
});

// Handle reset request — generate token, send email
app.post("/reset", authLimiter,
  body("email").trim().isEmail().withMessage("Please enter a valid email address.").normalizeEmail(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("reset-request", { error: errors.array()[0].msg });
    }
    const email = req.body.email;
    try {
      const userRes = await db.query("SELECT id FROM users WHERE email = $1", [email]);
      if (userRes.rows.length) {
        const token   = randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await db.query(
          `INSERT INTO password_resets (email, token, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET token = $2, expires_at = $3`,
          [email, token, expires]
        );
        const resetUrl = `${process.env.APP_BASE_URL || "http://localhost:" + PORT}/reset/${token}`;
        await resend.emails.send({
          from:    "Book Notes <noreply@book-notes-aadi-jain.me>",
          to:      email,
          subject: "Reset your Book Notes password",
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
              <h2 style="margin:0 0 8px">Reset your password</h2>
              <p style="color:#555;margin:0 0 24px">Click the button below to choose a new password. This link expires in 1 hour.</p>
              <a href="${resetUrl}"
                 style="display:inline-block;background:#9B6E52;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600">
                Reset password
              </a>
              <p style="color:#999;font-size:13px;margin-top:24px">
                If you didn't request this, you can safely ignore this email.
              </p>
            </div>
          `,
        });
      }
      // Always render sent — never leak whether email exists
      res.render("reset-sent", { email });
    } catch (err) {
      console.error("Reset request failed:", err);
      res.status(500).render("error", { message: "Could not send reset email. Please try again.", user: null });
    }
  }
);

// Show new password form
app.get("/reset/:token", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()",
      [req.params.token]
    );
    if (!rows.length) {
      return res.status(400).render("error", { message: "This reset link is invalid or has expired. Please request a new one.", user: null });
    }
    res.render("reset-form", { token: req.params.token, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { message: "Something went wrong.", user: null });
  }
});

// Handle new password submission
app.post("/reset/:token", authLimiter,
  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters."),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render("reset-form", { token: req.params.token, error: errors.array()[0].msg });
    }
    try {
      const { rows } = await db.query(
        "SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW()",
        [req.params.token]
      );
      if (!rows.length) {
        return res.status(400).render("error", { message: "This reset link is invalid or has expired. Please request a new one.", user: null });
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      await db.query("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, rows[0].email]);
      await db.query("DELETE FROM password_resets WHERE token = $1", [req.params.token]);
      res.render("reset-success");
    } catch (err) {
      console.error("Password reset failed:", err);
      res.status(500).render("error", { message: "Could not reset password. Please try again.", user: null });
    }
  }
);

// ══════════════════════════════════════════════════════
//  BOOK ROUTES — all require auth, all filtered by user
// ══════════════════════════════════════════════════════

app.get("/", requireAuth,
  query("sort").optional().isIn(["rating", "date_read", "title"]),
  query("status").optional().isIn(["", "read", "reading", "want"]),
  query("genre").optional().trim().isLength({ max: 100 }).escape(),
  async (req, res) => {
    const uid    = req.session.userId;
    const sort   = ["rating","date_read","title"].includes(req.query.sort) ? req.query.sort : "date_read";
    const status = ["read","reading","want"].includes(req.query.status)    ? req.query.status : "";
    const genre  = req.query.genre?.slice(0, 100) || "";
    const sortMap = {
      rating:    "rating DESC NULLS LAST, date_read DESC NULLS LAST",
      date_read: "date_read DESC NULLS LAST, rating DESC NULLS LAST",
      title:     "title ASC",
    };
    const conditions = ["user_id = $1"], params = [uid];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (genre)  { params.push(genre);  conditions.push(`genre  = $${params.length}`); }
    const where = `WHERE ${conditions.join(" AND ")}`;
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
          FROM books WHERE user_id = $1`, [uid]),
        db.query(`SELECT DISTINCT genre FROM books WHERE user_id = $1 AND genre IS NOT NULL ORDER BY genre`, [uid]),
      ]);
      res.render("index", {
        books:  booksRes.rows.map((b) => shape(b)),
        stats:  statsRes.rows[0],
        genres: genresRes.rows.map((r) => r.genre),
        sort, status, genre,
        user: req.session.userName,
      });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load books.", user: req.session.userName });
    }
  }
);

app.get("/book/:id", requireAuth,
  param("id").isInt({ min: 1 }), handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM books WHERE id = $1 AND user_id = $2",
        [parseInt(req.params.id), req.session.userId]
      );
      if (!rows.length) return res.status(404).render("error", { message: "Book not found.", user: req.session.userName });
      res.render("book", { book: shape(rows[0], "L"), user: req.session.userName });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load book.", user: req.session.userName });
    }
  }
);

app.get("/stats", requireAuth, async (req, res) => {
  const uid = req.session.userId;
  try {
    const [overview, byGenre, byYear, topRated] = await Promise.all([
      db.query(`SELECT
        COUNT(*) FILTER (WHERE status = 'read')                     AS total_read,
        COUNT(*) FILTER (WHERE status = 'reading')                  AS currently_reading,
        COUNT(*) FILTER (WHERE status = 'want')                     AS want_to_read,
        ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL), 1)     AS avg_rating,
        MAX(rating)                                                  AS highest_rating,
        COALESCE(SUM(page_count) FILTER (WHERE status = 'read'), 0) AS total_pages,
        COUNT(DISTINCT genre) FILTER (WHERE genre IS NOT NULL)      AS genre_count
        FROM books WHERE user_id = $1`, [uid]),
      db.query(`SELECT genre, COUNT(*) AS count FROM books
        WHERE user_id = $1 AND genre IS NOT NULL AND status = 'read'
        GROUP BY genre ORDER BY count DESC LIMIT 8`, [uid]),
      db.query(`SELECT EXTRACT(YEAR FROM date_read) AS year, COUNT(*) AS count,
        ROUND(AVG(rating),1) AS avg_rating FROM books
        WHERE user_id = $1 AND date_read IS NOT NULL AND status = 'read'
        GROUP BY year ORDER BY year DESC LIMIT 6`, [uid]),
      db.query(`SELECT * FROM books WHERE user_id = $1 AND rating IS NOT NULL
        ORDER BY rating DESC, date_read DESC NULLS LAST LIMIT 5`, [uid]),
    ]);
    res.render("stats", {
      overview: overview.rows[0], byGenre: byGenre.rows,
      byYear: byYear.rows, topRated: topRated.rows.map((b) => shape(b)),
      user: req.session.userName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { message: "Could not load stats.", user: req.session.userName });
  }
});

app.get("/add", requireAuth, (req, res) => {
  res.render("form", { book: null, action: "/add", heading: "Add a book", error: null, user: req.session.userName });
});

app.post("/add", requireAuth, writeLimiter, bookValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render("form", {
      book: req.body, action: "/add", heading: "Add a book",
      error: errors.array()[0].msg, user: req.session.userName,
    });
  }
  const f = req.body;
  try {
    await db.query(
      `INSERT INTO books (user_id,title,author,isbn,genre,rating,status,date_read,page_count,favourite_quote,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [req.session.userId, f.title, f.author, f.isbn||null, f.genre||null, f.rating||null,
       f.status||"read", f.date_read||null, f.page_count||null,
       f.favourite_quote||null, f.notes||null]
    );
    res.redirect("/?added=1");
  } catch (err) {
    console.error(err);
    res.status(500).render("error", { message: "Could not save book.", user: req.session.userName });
  }
});

app.get("/edit/:id", requireAuth,
  param("id").isInt({ min: 1 }), handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query(
        "SELECT * FROM books WHERE id = $1 AND user_id = $2",
        [parseInt(req.params.id), req.session.userId]
      );
      if (!rows.length) return res.status(404).render("error", { message: "Book not found.", user: req.session.userName });
      res.render("form", { book: rows[0], action: `/edit/${req.params.id}`, heading: "Edit book", error: null, user: req.session.userName });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load edit form.", user: req.session.userName });
    }
  }
);

app.post("/edit/:id", requireAuth, writeLimiter,
  param("id").isInt({ min: 1 }), bookValidators,
  async (req, res) => {
    const id = parseInt(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("form", {
        book: { ...req.body, id }, action: `/edit/${id}`, heading: "Edit book",
        error: errors.array()[0].msg, user: req.session.userName,
      });
    }
    const f = req.body;
    try {
      const result = await db.query(
        `UPDATE books SET title=$1,author=$2,isbn=$3,genre=$4,rating=$5,status=$6,
         date_read=$7,page_count=$8,favourite_quote=$9,notes=$10
         WHERE id=$11 AND user_id=$12`,
        [f.title, f.author, f.isbn||null, f.genre||null, f.rating||null,
         f.status||"read", f.date_read||null, f.page_count||null,
         f.favourite_quote||null, f.notes||null, id, req.session.userId]
      );
      if (result.rowCount === 0) return res.status(404).render("error", { message: "Book not found.", user: req.session.userName });
      res.redirect(`/book/${id}?updated=1`);
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not update book.", user: req.session.userName });
    }
  }
);

app.post("/delete/:id", requireAuth, writeLimiter,
  param("id").isInt({ min: 1 }), handleValidationErrors,
  async (req, res) => {
    try {
      await db.query("DELETE FROM books WHERE id = $1 AND user_id = $2", [parseInt(req.params.id), req.session.userId]);
      res.redirect("/?deleted=1");
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not delete book.", user: req.session.userName });
    }
  }
);

app.get("/api/search", requireAuth, apiLimiter,
  query("q").trim().notEmpty().isLength({ max: 200 }).escape(),
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.json({ books: [] });
    const q = req.query.q;
    try {
      const { data } = await axios.get("https://openlibrary.org/search.json", {
        params: { q, limit: 20, fields: "title,author_name,isbn,cover_i,number_of_pages_median" },
        timeout: 8000,
        headers: { "User-Agent": "BookNotes/1.0" },
      });
      const fallbackAuthor = data.docs.map(b => b.author_name?.[0]).filter(Boolean)[0] ?? "Unknown";
      const books = (data.docs || [])
        .filter((b) => b.isbn?.length && b.cover_i)
        .slice(0, 8)
        .map((b) => ({
          title:      (b.title || "").slice(0, 255),
          author:     (b.author_name?.[0] ?? fallbackAuthor).slice(0, 255),
          isbn:       (b.isbn.find(i => i.replace(/[-\s]/g, "").length === 13) || b.isbn[0]).replace(/[-\s]/g, ""),
          page_count: b.number_of_pages_median ?? null,
          cover_url:  `https://covers.openlibrary.org/b/id/${parseInt(b.cover_i)}-M.jpg`,
        }));
      res.json({ books });
    } catch (err) {
      console.error("Open Library:", err.message);
      res.status(500).json({ error: "Could not reach Open Library." });
    }
  }
);

// ── 404 & error handlers ───────────────────────────────
app.use((req, res) => res.status(404).render("error", { message: "Page not found.", user: req.session?.userName }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render("error", { message: IS_PROD ? "Something went wrong." : err.message, user: req.session?.userName });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));