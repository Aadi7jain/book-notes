// Book Notes — Aadi Jain

import "dotenv/config";
import express   from "express";
import axios     from "axios";
import pg        from "pg";
import path      from "path";
import helmet    from "helmet";
import rateLimit from "express-rate-limit";
import { body, query, param, validationResult } from "express-validator";
import hpp            from "hpp";
import cookieParser   from "cookie-parser";
import compression    from "compression";
import morgan         from "morgan";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app     = express();
const PORT    = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);

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
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders(res) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Cache-Control", "public, max-age=86400");
  },
}));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
  skip: () => !IS_PROD,
});

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many write requests. Please slow down." },
  skip: () => !IS_PROD,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many search requests. Please wait." },
  skip: () => !IS_PROD,
});

app.use(generalLimiter);

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
  if (!errors.isEmpty()) return res.status(400).render("error", { message: errors.array().map(e => e.msg).join(" · ") });
  next();
}

const bookValidators = [
  body("title").trim().notEmpty().withMessage("Title is required.")
    .isLength({ max: 255 }).withMessage("Title must be under 255 characters.").escape(),
  body("author").trim().notEmpty().withMessage("Author is required.")
    .isLength({ max: 255 }).withMessage("Author must be under 255 characters.").escape(),
  body("isbn").optional({ checkFalsy: true }).trim()
    .customSanitizer(val => val ? val.replace(/[-\s]/g, "") : val)
    .matches(/^[0-9X]{10}$|^[0-9]{13}$/).withMessage("ISBN must be 10 or 13 digits."),
  body("genre").optional({ checkFalsy: true }).trim()
    .isLength({ max: 100 }).withMessage("Genre must be under 100 characters.").escape(),
  body("rating").optional({ checkFalsy: true })
    .isInt({ min: 1, max: 10 }).withMessage("Rating must be between 1 and 10.").toInt(),
  body("status").optional().isIn(["read", "reading", "want"]).withMessage("Invalid status."),
  body("date_read").optional({ checkFalsy: true }).isDate().withMessage("Invalid date format."),
  body("page_count").optional({ checkFalsy: true })
    .isInt({ min: 1, max: 99999 }).withMessage("Page count must be a positive number.").toInt(),
  body("favourite_quote").optional({ checkFalsy: true }).trim()
    .isLength({ max: 2000 }).withMessage("Quote must be under 2000 characters."),
  body("notes").optional({ checkFalsy: true }).trim()
    .isLength({ max: 50000 }).withMessage("Notes must be under 50,000 characters."),
];

app.get("/",
  query("sort").optional().isIn(["rating", "date_read", "title"]),
  query("status").optional().isIn(["", "read", "reading", "want"]),
  query("genre").optional().trim().isLength({ max: 100 }).escape(),
  async (req, res) => {
    const sort   = ["rating","date_read","title"].includes(req.query.sort) ? req.query.sort : "date_read";
    const status = ["read","reading","want"].includes(req.query.status)    ? req.query.status : "";
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
        books:  booksRes.rows.map((b) => shape(b)),
        stats:  statsRes.rows[0],
        genres: genresRes.rows.map((r) => r.genre),
        sort, status, genre,
      });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load books." });
    }
  }
);

app.get("/book/:id",
  param("id").isInt({ min: 1 }).withMessage("Invalid book ID."),
  handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM books WHERE id = $1", [parseInt(req.params.id)]);
      if (!rows.length) return res.status(404).render("error", { message: "Book not found." });
      res.render("book", { book: shape(rows[0], "L") });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load book." });
    }
  }
);

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

app.get("/add", (req, res) => {
  res.render("form", { book: null, action: "/add", heading: "Add a book", error: null });
});

app.post("/add", writeLimiter, bookValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).render("form", {
      book: req.body, action: "/add", heading: "Add a book",
      error: errors.array()[0].msg,
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
});

app.get("/edit/:id",
  param("id").isInt({ min: 1 }), handleValidationErrors,
  async (req, res) => {
    try {
      const { rows } = await db.query("SELECT * FROM books WHERE id = $1", [parseInt(req.params.id)]);
      if (!rows.length) return res.status(404).render("error", { message: "Book not found." });
      res.render("form", { book: rows[0], action: `/edit/${req.params.id}`, heading: "Edit book", error: null });
    } catch (err) {
      console.error(err);
      res.status(500).render("error", { message: "Could not load edit form." });
    }
  }
);

app.post("/edit/:id",
  writeLimiter, param("id").isInt({ min: 1 }), bookValidators,
  async (req, res) => {
    const id = parseInt(req.params.id);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).render("form", {
        book: { ...req.body, id }, action: `/edit/${id}`, heading: "Edit book",
        error: errors.array()[0].msg,
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

app.post("/delete/:id",
  writeLimiter, param("id").isInt({ min: 1 }), handleValidationErrors,
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

app.get("/api/search",
  apiLimiter,
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

app.use((req, res) => res.status(404).render("error", { message: "Page not found." }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render("error", { message: IS_PROD ? "Something went wrong." : err.message });
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));