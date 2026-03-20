-- Book Notes — Database Schema

DROP TABLE IF EXISTS books;

CREATE TABLE books (
  id              SERIAL PRIMARY KEY,
  title           VARCHAR(255)  NOT NULL,
  author          VARCHAR(255)  NOT NULL,
  isbn            VARCHAR(20),
  genre           VARCHAR(100),
  rating          SMALLINT      CHECK (rating BETWEEN 1 AND 10),
  status          VARCHAR(20)   NOT NULL DEFAULT 'read'
                                CHECK (status IN ('read', 'reading', 'want')),
  date_read       DATE,
  page_count      INTEGER       CHECK (page_count > 0),
  favourite_quote TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX idx_books_rating    ON books (rating DESC);
CREATE INDEX idx_books_date_read ON books (date_read DESC);
CREATE INDEX idx_books_title     ON books (title ASC);
CREATE INDEX idx_books_status    ON books (status);

INSERT INTO books (title, author, isbn, genre, rating, status, date_read, page_count, favourite_quote, notes) VALUES
(
  'Thinking, Fast and Slow',
  'Daniel Kahneman',
  '9780374533557',
  'Psychology',
  9, 'read', '2024-01-15', 499,
  'Nothing in life is as important as you think it is, while you are thinking about it.',
  'A rigorous account of the two systems that govern how we think. System 1 operates automatically and quickly; System 2 allocates attention to effortful mental activities.

The section on cognitive ease was particularly unsettling — the idea that when something feels familiar, we treat it as true. Repetition breeds belief.

Highly recommended for anyone who makes decisions, which is everyone.'
),
(
  'The Pragmatic Programmer',
  'David Thomas',
  '9780135957059',
  'Software',
  10, 'read', '2024-02-20', 352,
  'Care about your craft. Why spend your life developing software unless you care about doing it well?',
  'The broken windows theory — do not leave bad code unattended because it signals that standards have slipped — is something I think about every time I am tempted to leave a TODO comment and move on.

The chapter on tracer bullets versus prototypes clarified something I had always done intuitively but could never articulate. Tracer bullets are part of the final system; prototypes are disposable.

Required reading. Re-read every few years.'
),
(
  'Deep Work',
  'Cal Newport',
  '9781455586691',
  'Productivity',
  8, 'read', '2024-03-10', 304,
  'The ability to perform deep work is becoming increasingly rare at exactly the same time it is becoming increasingly valuable.',
  'Newport''s central argument: distraction is the enemy of value creation, and people who can focus for sustained periods will have a large advantage over those who cannot.

The distinction between deep work and shallow work was the most useful framework. Most email and meeting culture is shallow work masquerading as productivity.

I restructured my mornings after reading this.'
),
(
  'Atomic Habits',
  'James Clear',
  '9780735211292',
  'Self-improvement',
  9, 'read', '2024-04-05', 320,
  'You do not rise to the level of your goals. You fall to the level of your systems.',
  'The identity framing is the insight I keep returning to. Instead of wanting to run a marathon, the shift is to becoming a runner. Habits become evidence of who you are rather than steps toward a goal.

The four laws — make it obvious, attractive, easy, satisfying — are simple enough to remember and specific enough to act on.

Clear writes accessibly without being shallow. The book earns its popularity.'
),
(
  'The Design of Everyday Things',
  'Don Norman',
  '9780465050659',
  'Design',
  8, 'read', '2024-05-18', 368,
  'Good design is actually a lot harder to notice than poor design, in part because good designs fit our needs so well that the design is invisible.',
  'This book permanently altered how I experience the built world. Norman''s vocabulary — affordances, signifiers, mappings, feedback, conceptual models — gives language to something you already knew but could not name.

The door example opens the book and ruins you for doors forever. A door that requires instruction has failed. That principle extends to every interface.

Essential for anyone building things for humans to use.'
),
(
  'A Philosophy of Software Design',
  'John Ousterhout',
  '9781732102201',
  'Software',
  9, 'reading', NULL, 190,
  'The greatest limitation in writing software is our ability to understand the systems we are creating.',
  'Ousterhout''s central thesis — that complexity is the root cause of nearly all software problems — feels obvious once stated but is unpacked with real precision.

The chapter on deep versus shallow modules is excellent. A deep module has a simple interface that hides significant complexity. Most bad abstractions are shallow.

Still reading — will update notes when finished.'
);