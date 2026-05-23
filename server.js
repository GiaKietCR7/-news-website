require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

let db;

async function initDatabase() {
  const SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const dbFilePath = path.join(DATA_DIR, 'database.sqlite');

  // Load existing database or create new one
  if (fs.existsSync(dbFilePath)) {
    const buffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      summary TEXT,
      content TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      image TEXT,
      video TEXT,
      author TEXT DEFAULT 'Admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL,
      label TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6b7280',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add slug column to articles if not exists
  try {
    db.run('ALTER TABLE articles ADD COLUMN slug TEXT DEFAULT ""');
  } catch(e) { /* column already exists */ }

  // Add views column to articles if not exists
  try {
    db.run('ALTER TABLE articles ADD COLUMN views INTEGER DEFAULT 0');
  } catch(e) { /* column already exists */ }

  // Add video column to articles if not exists
  try {
    db.run('ALTER TABLE articles ADD COLUMN video TEXT DEFAULT NULL');
  } catch(e) { /* column already exists */ }

  // Insert default categories if empty
  const catCount = db.exec("SELECT COUNT(*) FROM categories");
  if (catCount[0].values[0][0] === 0) {
    const defaultCats = [
      { name: 'World', slug: 'world', color: '#dc2626' },
      { name: 'Technology', slug: 'technology', color: '#7c3aed' },
      { name: 'Business', slug: 'business', color: '#059669' },
      { name: 'Sports', slug: 'sports', color: '#d97706' },
      { name: 'Health', slug: 'health', color: '#0891b2' },
      { name: 'Entertainment', slug: 'entertainment', color: '#db2777' },
      { name: 'Science', slug: 'science', color: '#4f46e5' },
      { name: 'General', slug: 'general', color: '#6b7280' }
    ];
    const catStmt = db.prepare('INSERT INTO categories (name, slug, color) VALUES (?, ?, ?)');
    defaultCats.forEach(c => catStmt.run([c.name, c.slug, c.color]));
    catStmt.free();
  }

  // Create default admin if not exists
  const adminResult = db.exec("SELECT id FROM users WHERE username = 'admin'");
  if (adminResult.length === 0) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    db.run("INSERT INTO users (username, password, role) VALUES (?, ?, ?)", ['admin', hashedPassword, 'admin']);
  }

  // Insert sample articles if empty
  const countResult = db.exec("SELECT COUNT(*) as count FROM articles");
  const count = countResult[0].values[0][0];

  if (count === 0) {
    const sampleArticles = [
      {
        title: 'Breaking: Global Climate Summit Reaches Historic Agreement',
        summary: 'World leaders have agreed on unprecedented measures to combat climate change, setting ambitious targets for carbon reduction by 2030.',
        content: '<p>In a landmark decision that could reshape global environmental policy, representatives from over 190 countries have signed a binding agreement to reduce carbon emissions by 50% before 2030.</p><p>The agreement, reached after two weeks of intense negotiations, includes provisions for financial support to developing nations and strict monitoring mechanisms.</p><p>"This is a turning point for humanity," said the UN Secretary-General. "We have shown that when we work together, we can overcome even the greatest challenges."</p>',
        category: 'World',
        author: 'John Smith'
      },
      {
        title: 'Tech Giants Unveil Next-Generation AI Assistants',
        summary: 'Major technology companies showcase their latest AI innovations at the annual tech conference, promising to revolutionize daily life.',
        content: '<p>The annual Global Tech Conference opened today with several major announcements from leading technology companies. The spotlight was on artificial intelligence, with multiple firms demonstrating AI assistants capable of complex reasoning and creative tasks.</p><p>Industry analysts predict these developments will transform sectors from healthcare to education within the next five years.</p>',
        category: 'Technology',
        author: 'Sarah Johnson'
      },
      {
        title: 'Stock Markets Hit Record Highs Amid Economic Recovery',
        summary: 'Global markets surge as economic indicators point to strong recovery, with tech and green energy sectors leading the charge.',
        content: '<p>Stock markets around the world reached new all-time highs today as investors responded positively to the latest economic data showing robust growth across multiple sectors.</p><p>The technology sector led gains with a 3.2% increase, followed closely by renewable energy stocks which rose 2.8%. Analysts attribute the rally to strong corporate earnings and improving consumer confidence.</p>',
        category: 'Business',
        author: 'Michael Chen'
      },
      {
        title: 'Championship Finals: Underdogs Stun Favorites in Dramatic Upset',
        summary: 'In one of the most thrilling finals in recent memory, the underdog team clinches victory in overtime.',
        content: '<p>Sports fans witnessed history last night as the underdog team completed one of the greatest upsets in championship history, defeating the heavily favored opponents 3-2 in overtime.</p><p>The dramatic victory was sealed with a last-minute goal that sent the stadium into a frenzy. "We never stopped believing," said the team captain in the post-match interview.</p>',
        category: 'Sports',
        author: 'David Williams'
      },
      {
        title: 'New Study Reveals Benefits of Mediterranean Diet for Brain Health',
        summary: 'Research shows that following a Mediterranean diet can significantly reduce the risk of cognitive decline in older adults.',
        content: '<p>A comprehensive study published in the Journal of Neurology has found that adults who closely follow a Mediterranean diet have a 35% lower risk of developing cognitive decline compared to those with other dietary patterns.</p><p>The study, which followed over 10,000 participants for 12 years, adds to growing evidence that diet plays a crucial role in brain health and aging.</p>',
        category: 'Health',
        author: 'Emily Davis'
      }
    ];

    const stmt = db.prepare("INSERT INTO articles (title, summary, content, category, image, author) VALUES (?, ?, ?, ?, ?, ?)");
    for (const article of sampleArticles) {
      stmt.run([article.title, article.summary, article.content, article.category, null, article.author]);
    }
    stmt.free();
  }

  saveDatabase();
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dbFilePath = path.join(DATA_DIR, 'database.sqlite');
  fs.writeFileSync(dbFilePath, buffer);
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.use('/videos', express.static(path.join(__dirname, 'public', 'videos')));
app.use(session({
  secret: 'news-website-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// Ensure directories exist
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const VIDEOS_DIR = path.join(DATA_DIR, 'videos');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(VIDEOS_DIR)) fs.mkdirSync(VIDEOS_DIR, { recursive: true });

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/videos', express.static(VIDEOS_DIR));

// ============ GEO BLOCK: Block Vietnam IPs (Simple IP Prefix Matching) ============
const VN_IP_PREFIXES = [
  '14.', '42.', '101.', '102.', '103.', '106.', '111.', '112.', '113.', '115.',
  '116.', '117.', '118.', '119.', '171.', '175.', '203.', '210.', '222.', '223.'
];

function isVietnameseIP(ip) {
  if (!ip) return false;
  const cleanIP = ip.replace(/^::ffff:/, '').split(':')[0];
  for (const prefix of VN_IP_PREFIXES) {
    if (cleanIP.startsWith(prefix)) return true;
  }
  return false;
}

app.use((req, res, next) => {
  if (req.path.startsWith('/secret-admin-panel') || req.path === '/health') {
    return next();
  }
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress;
  if (isVietnameseIP(ip)) {
    return res.status(403).send(`
      <html><head><title>Access Denied</title></head>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5;">
        <div style="text-align: center; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
          <h1 style="color: #dc2626; margin-bottom: 1rem;">403 - Access Denied</h1>
          <p style="color: #666;">This website is not available in your region.</p>
        </div>
      </body></html>
    `);
  }
  next();
});
// ==============================================

// Multer config for all uploads (images and videos)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const isVideo = /mp4|webm|mov|avi|mkv/.test(path.extname(file.originalname).toLowerCase());
    const folder = isVideo ? VIDEOS_DIR : UPLOADS_DIR;
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max for all uploads
  fileFilter: (req, file, cb) => {
    const allowedImages = /jpeg|jpg|png|gif|webp/;
    const allowedVideos = /mp4|webm|mov|avi|mkv/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;

    if (allowedImages.test(ext) && allowedImages.test(mime)) cb(null, true);
    else if (allowedVideos.test(ext) && allowedVideos.test(mime)) cb(null, true);
    else cb(new Error('Only image (jpeg, png, gif, webp) and video (mp4, webm, mov, avi, mkv) files are allowed'));
  }
});

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    next();
  } else {
    res.redirect('/secret-admin-panel/login');
  }
}

// Helper: query all rows
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: query single row
function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

// Pre-defined journalist avatars (real-looking US people from UI Faces / randomuser)
const JOURNALIST_AVATARS = [
  { name: 'James Mitchell', avatar: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { name: 'Sarah Thompson', avatar: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { name: 'Michael Chen', avatar: 'https://randomuser.me/api/portraits/men/75.jpg' },
  { name: 'Emily Rodriguez', avatar: 'https://randomuser.me/api/portraits/women/65.jpg' },
  { name: 'David Williams', avatar: 'https://randomuser.me/api/portraits/men/22.jpg' },
  { name: 'Jessica Parker', avatar: 'https://randomuser.me/api/portraits/women/28.jpg' },
  { name: 'Robert Anderson', avatar: 'https://randomuser.me/api/portraits/men/46.jpg' },
  { name: 'Amanda Foster', avatar: 'https://randomuser.me/api/portraits/women/33.jpg' },
  { name: 'Christopher Lee', avatar: 'https://randomuser.me/api/portraits/men/61.jpg' },
  { name: 'Rachel Green', avatar: 'https://randomuser.me/api/portraits/women/17.jpg' },
  { name: 'Daniel Harris', avatar: 'https://randomuser.me/api/portraits/men/15.jpg' },
  { name: 'Olivia Martinez', avatar: 'https://randomuser.me/api/portraits/women/52.jpg' },
  { name: 'Andrew Cooper', avatar: 'https://randomuser.me/api/portraits/men/53.jpg' },
  { name: 'Sophia Bennett', avatar: 'https://randomuser.me/api/portraits/women/71.jpg' },
  { name: 'Nathan Brooks', avatar: 'https://randomuser.me/api/portraits/men/86.jpg' }
];

function getRandomJournalist() {
  return JOURNALIST_AVATARS[Math.floor(Math.random() * JOURNALIST_AVATARS.length)];
}

function getJournalistByName(name) {
  return JOURNALIST_AVATARS.find(j => j.name.toLowerCase() === (name || '').toLowerCase()) || null;
}

// API: Get journalist avatars list
app.get('/api/journalists', (req, res) => {
  res.json(JOURNALIST_AVATARS);
});

// Helper: generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 80)
    .replace(/^-|-$/g, '');
}

// ============ PUBLIC ROUTES ============

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

// Static pages
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pages', 'about.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pages', 'contact.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pages', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pages', 'terms.html')));

// Article page by slug
app.get('/news/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'article.html'));
});

// Article page by id (backward compatible)
app.get('/article/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'article.html'));
});

// Helper: generate fake view count based on article id and age
function getFakeViews(article) {
  const age = Math.max(1, Math.floor((Date.now() - new Date(article.created_at).getTime()) / (1000 * 60 * 60)));
  const seed = article.id * 137 + 42;
  const base = (seed % 500) + 200;
  const views = (article.views || 0) + base + Math.floor(age * (1 + (seed % 10) / 5));
  return Math.min(views, 99999);
}

// API: Get articles
app.get('/api/articles', (req, res) => {
  const { category, limit, offset, page, pageSize } = req.query;
  let query = 'SELECT * FROM articles';
  let countQuery = 'SELECT COUNT(*) as total FROM articles';
  const params = [];
  const countParams = [];

  if (category && category !== 'All') {
    query += ' WHERE category = ?';
    countQuery += ' WHERE category = ?';
    params.push(category);
    countParams.push(category);
  }

  query += ' ORDER BY created_at DESC';

  // Pagination support
  const pg = parseInt(page) || 1;
  const ps = parseInt(pageSize) || parseInt(limit) || 20;
  const off = parseInt(offset) || (pg - 1) * ps;

  query += ' LIMIT ? OFFSET ?';
  params.push(ps, off);

  const articles = queryAll(query, params);
  const totalResult = db.exec(countParams.length > 0 
    ? `SELECT COUNT(*) FROM articles WHERE category = '${countParams[0]}'`
    : 'SELECT COUNT(*) FROM articles');
  const total = totalResult[0].values[0][0];

  // Attach avatar and fake views to each article
  const articlesWithMeta = articles.map(a => {
    const journalist = getJournalistByName(a.author) || JOURNALIST_AVATARS[a.id % JOURNALIST_AVATARS.length];
    return { ...a, author_avatar: journalist.avatar, views: getFakeViews(a) };
  });

  res.set('X-Total-Count', String(total));
  res.json(articlesWithMeta);
});

// API: Search articles
app.get('/api/articles/search/:query', (req, res) => {
  const q = '%' + req.params.query + '%';
  const articles = queryAll(
    'SELECT * FROM articles WHERE title LIKE ? OR summary LIKE ? OR content LIKE ? ORDER BY created_at DESC LIMIT 20',
    [q, q, q]
  );
  const articlesWithMeta = articles.map(a => {
    const journalist = getJournalistByName(a.author) || JOURNALIST_AVATARS[a.id % JOURNALIST_AVATARS.length];
    return { ...a, author_avatar: journalist.avatar, views: getFakeViews(a) };
  });
  res.json(articlesWithMeta);
});

// API: Get single article (by id or slug) + increment view
app.get('/api/articles/:idOrSlug', (req, res) => {
  const param = req.params.idOrSlug;
  let article;
  if (/^\d+$/.test(param)) {
    article = queryOne('SELECT * FROM articles WHERE id = ?', [parseInt(param)]);
  } else {
    article = queryOne('SELECT * FROM articles WHERE slug = ?', [param]);
  }
  if (!article) return res.status(404).json({ error: 'Article not found' });

  // Increment real view count
  db.run('UPDATE articles SET views = views + 1 WHERE id = ?', [article.id]);
  saveDatabase();

  // Attach avatar and fake views
  const journalist = getJournalistByName(article.author) || JOURNALIST_AVATARS[article.id % JOURNALIST_AVATARS.length];
  article.author_avatar = journalist.avatar;
  article.views = getFakeViews(article);

  // Related articles (same category, exclude current)
  const related = queryAll(
    'SELECT * FROM articles WHERE category = ? AND id != ? ORDER BY created_at DESC LIMIT 3',
    [article.category, article.id]
  );
  const relatedWithMeta = related.map(a => {
    const j = getJournalistByName(a.author) || JOURNALIST_AVATARS[a.id % JOURNALIST_AVATARS.length];
    return { ...a, author_avatar: j.avatar, views: getFakeViews(a) };
  });
  article.related = relatedWithMeta;

  res.json(article);
});

// API: Get categories (public)
app.get('/api/categories', (req, res) => {
  const categories = queryAll('SELECT * FROM categories ORDER BY name');
  // Add article count for each category
  const result = categories.map(cat => {
    const countRes = db.exec(`SELECT COUNT(*) FROM articles WHERE category = '${cat.name}'`);
    return { ...cat, article_count: countRes[0].values[0][0] };
  });
  res.json(result);
});

// ============ ADMIN ROUTES ============

// Admin login page
app.get('/secret-admin-panel/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin', 'login.html'));
});

// Admin dashboard
app.get('/secret-admin-panel', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin', 'dashboard.html'));
});

// Admin login API
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true });
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Admin: Create article
app.post('/api/admin/articles', requireAuth, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), (req, res) => {
  const { title, summary, content, category, author, existing_image, existing_video, created_at } = req.body;
  const image = req.files?.['image']?.[0] ? '/uploads/' + req.files['image'][0].filename : (existing_image || null);
  const video = req.files?.['video']?.[0] ? '/videos/' + req.files['video'][0].filename : (existing_video || null);
  const publishDate = created_at || new Date().toISOString();
  const slug = generateSlug(title);

  db.run(
    'INSERT INTO articles (title, summary, content, category, image, video, author, created_at, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [title, summary, content, category || 'General', image, video, author || 'Admin', publishDate, slug]
  );
  saveDatabase();

  const result = db.exec('SELECT last_insert_rowid() as id');
  const id = result[0].values[0][0];
  res.json({ success: true, id, slug });
});

// Admin: Update article
app.put('/api/admin/articles/:id', requireAuth, upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }]), (req, res) => {
  const { title, summary, content, category, author } = req.body;
  const article = queryOne('SELECT * FROM articles WHERE id = ?', [parseInt(req.params.id)]);

  if (!article) return res.status(404).json({ error: 'Article not found' });

  const image = req.files?.['image']?.[0] ? '/uploads/' + req.files['image'][0].filename : article.image;
  const video = req.files?.['video']?.[0] ? '/videos/' + req.files['video'][0].filename : (req.body.existing_video !== undefined ? req.body.existing_video : article.video);

  db.run(
    'UPDATE articles SET title = ?, summary = ?, content = ?, category = ?, image = ?, video = ?, author = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [title, summary, content, category, image, video, author, parseInt(req.params.id)]
  );
  saveDatabase();

  res.json({ success: true });
});

// Admin: Delete article
app.delete('/api/admin/articles/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM articles WHERE id = ?', [parseInt(req.params.id)]);
  saveDatabase();
  res.json({ success: true });
});

// Admin: Upload image (for content editor)
app.post('/api/admin/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: '/uploads/' + req.file.filename });
});

// ============ API KEYS MANAGEMENT ============

// Get all API keys
app.get('/api/admin/api-keys', requireAuth, (req, res) => {
  const keys = queryAll('SELECT id, key_value, label, is_active, created_at FROM api_keys ORDER BY created_at DESC');
  // Mask key values for display
  const masked = keys.map(k => ({
    ...k,
    key_masked: k.key_value.substring(0, 10) + '...' + k.key_value.substring(k.key_value.length - 4)
  }));
  res.json(masked);
});

// Add API key
app.post('/api/admin/api-keys', requireAuth, (req, res) => {
  const { key_value, label } = req.body;
  if (!key_value || !key_value.trim()) return res.status(400).json({ error: 'API key is required' });

  db.run('INSERT INTO api_keys (key_value, label) VALUES (?, ?)', [key_value.trim(), label || '']);
  saveDatabase();
  res.json({ success: true });
});

// Bulk save API keys (replace all keys with new list)
app.post('/api/admin/api-keys/bulk', requireAuth, (req, res) => {
  const { keys_text } = req.body;
  if (!keys_text || !keys_text.trim()) return res.status(400).json({ error: 'No keys provided' });

  // Parse keys from text (one per line, ignore empty lines and comments)
  const lines = keys_text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  const validKeys = lines.filter(l => l.startsWith('AIza'));

  if (validKeys.length === 0) {
    return res.status(400).json({ error: 'No valid API keys found. Keys should start with "AIza".' });
  }

  // Delete all existing keys and insert new ones
  db.run('DELETE FROM api_keys');
  const stmt = db.prepare('INSERT INTO api_keys (key_value, label, is_active) VALUES (?, ?, 1)');
  validKeys.forEach((key, i) => {
    stmt.run([key, `Key ${i + 1}`]);
  });
  stmt.free();
  saveDatabase();

  res.json({ success: true, count: validKeys.length });
});

// Get raw keys for textarea
app.get('/api/admin/api-keys/raw', requireAuth, (req, res) => {
  const keys = queryAll('SELECT key_value FROM api_keys WHERE is_active = 1 ORDER BY id');
  const text = keys.map(k => k.key_value).join('\n');
  res.json({ text, count: keys.length });
});

// Delete API key
app.delete('/api/admin/api-keys/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM api_keys WHERE id = ?', [parseInt(req.params.id)]);
  saveDatabase();
  res.json({ success: true });
});

// Toggle API key active/inactive
app.put('/api/admin/api-keys/:id/toggle', requireAuth, (req, res) => {
  const key = queryOne('SELECT * FROM api_keys WHERE id = ?', [parseInt(req.params.id)]);
  if (!key) return res.status(404).json({ error: 'Key not found' });
  db.run('UPDATE api_keys SET is_active = ? WHERE id = ?', [key.is_active ? 0 : 1, parseInt(req.params.id)]);
  saveDatabase();
  res.json({ success: true });
});

// Admin: Settings page
app.get('/secret-admin-panel/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin', 'settings.html'));
});

// Admin: Categories page
app.get('/secret-admin-panel/categories', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin', 'categories.html'));
});

// ============ CATEGORIES MANAGEMENT ============

// Admin: Create category
app.post('/api/admin/categories', requireAuth, (req, res) => {
  const { name, description, color } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Category name is required' });

  const slug = generateSlug(name);
  try {
    db.run('INSERT INTO categories (name, slug, description, color) VALUES (?, ?, ?, ?)',
      [name.trim(), slug, description || '', color || '#6b7280']);
    saveDatabase();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Category already exists' });
  }
});

// Admin: Update category
app.put('/api/admin/categories/:id', requireAuth, (req, res) => {
  const { name, description, color } = req.body;
  const cat = queryOne('SELECT * FROM categories WHERE id = ?', [parseInt(req.params.id)]);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  const oldName = cat.name;
  const newName = name ? name.trim() : oldName;
  const slug = generateSlug(newName);

  db.run('UPDATE categories SET name = ?, slug = ?, description = ?, color = ? WHERE id = ?',
    [newName, slug, description || cat.description, color || cat.color, parseInt(req.params.id)]);

  // Update articles with old category name
  if (oldName !== newName) {
    db.run('UPDATE articles SET category = ? WHERE category = ?', [newName, oldName]);
  }
  saveDatabase();
  res.json({ success: true });
});

// Admin: Delete category
app.delete('/api/admin/categories/:id', requireAuth, (req, res) => {
  const cat = queryOne('SELECT * FROM categories WHERE id = ?', [parseInt(req.params.id)]);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  // Move articles to General
  db.run("UPDATE articles SET category = 'General' WHERE category = ?", [cat.name]);
  db.run('DELETE FROM categories WHERE id = ?', [parseInt(req.params.id)]);
  saveDatabase();
  res.json({ success: true });
});

// ============ AI GENERATE ============

// Admin: AI Generate content from image
app.post('/api/admin/ai-generate', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  // Get active API keys from database
  const apiKeys = queryAll('SELECT key_value FROM api_keys WHERE is_active = 1');
  if (apiKeys.length === 0) {
    return res.status(400).json({ 
      error: 'No API keys configured. Please go to Settings and add at least one Gemini API key first.',
      needsConfig: true
    });
  }

  try {
    // Read image and convert to base64
    const imagePath = req.file.path;
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = req.file.mimetype;

    const prompt = `You are a professional news journalist. Analyze this image and generate a complete news article about it. 

Return your response in this exact JSON format (no markdown, no code blocks, just pure JSON):
{
  "title": "A compelling news headline (max 100 characters)",
  "summary": "A brief 1-2 sentence summary of the article (max 200 characters)",
  "category": "One of: World, Technology, Business, Sports, Health, Entertainment, Science, General",
  "content": "Full article content in HTML format with <p> tags for paragraphs, <h2> for subheadings, <blockquote> for quotes. Write at least 3-4 paragraphs with detailed, engaging content.",
  "author": "A realistic journalist name"
}

Important: Write in English. Make the content informative, engaging, and professional. The article should be at least 200 words.`;

    const requestBody = JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Image } },
          { text: prompt }
        ]
      }]
    });

    // Try each API key with multiple models
    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    let response = null;
    let lastError = '';

    for (const keyObj of apiKeys) {
      const apiKey = keyObj.key_value;
      for (const model of models) {
        console.log(`Trying key ...${apiKey.slice(-4)} with model: ${model}`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        try {
          const attempt = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBody
          });

          if (attempt.ok) {
            response = attempt;
            console.log(`Success with key ...${apiKey.slice(-4)}, model: ${model}`);
            break;
          }

          const errText = await attempt.text();
          lastError = errText;
          
          if (attempt.status === 429) {
            console.log(`Key ...${apiKey.slice(-4)} model ${model} quota exceeded, trying next...`);
            continue;
          }
          
          // For 400/403 errors (invalid key), skip to next key
          if (attempt.status === 400 || attempt.status === 403) {
            console.log(`Key ...${apiKey.slice(-4)} invalid or forbidden, trying next key...`);
            break;
          }

          console.error(`Key ...${apiKey.slice(-4)} model ${model} error (${attempt.status})`);
        } catch (fetchErr) {
          console.error(`Fetch error:`, fetchErr.message);
          lastError = fetchErr.message;
        }
      }
      if (response) break;
    }

    if (!response) {
      console.error('All keys/models failed. Last error:', lastError);
      return res.status(429).json({ 
        error: 'All API keys have exceeded their quota. Please add more keys in Settings or wait a few minutes for quota to reset.' 
      });
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!textContent) {
      return res.status(500).json({ error: 'AI returned empty response. Please try again.' });
    }

    // Parse JSON from response (handle potential markdown code blocks)
    let articleData;
    try {
      // Remove markdown code blocks if present
      let cleanJson = textContent.trim();
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      articleData = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.error('Failed to parse AI response:', textContent);
      return res.status(500).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    // Return generated content + uploaded image URL
    res.json({
      success: true,
      article: {
        title: articleData.title || '',
        summary: articleData.summary || '',
        category: articleData.category || 'General',
        content: articleData.content || '',
        author: articleData.author || 'Admin',
        image: '/uploads/' + req.file.filename
      }
    });

  } catch (err) {
    console.error('AI generation error:', err);
    res.status(500).json({ error: 'Failed to generate content. Please try again.' });
  }
});

// Health check for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
async function start() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  News website running at http://localhost:${PORT}`);
    console.log(`  Admin panel: http://localhost:${PORT}/secret-admin-panel/login`);
    console.log(`  Default admin credentials: admin / admin123\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
