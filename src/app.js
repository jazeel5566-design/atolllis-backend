require('dotenv').config();
require('./timezone');
require('express-async-errors');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { HttpError } = require('./utils/http-error');

const app = express();
app.set('trust proxy', true); // needed for req.ip to be the real client IP behind Render's proxy

// Security headers. The page is one file with inline script, inline styles and onclick handlers,
// so those are allowed; everything else comes from this origin, except Google Fonts. The report
// PDF opens from a blob: URL.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'self'", 'blob:'],
      frameSrc: ["'self'", 'blob:'],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// The page is served from this same origin, which needs no CORS at all. Another origin is let in
// only when listed in ALLOWED_ORIGINS (comma-separated). The analyser bridge is not a browser and
// is unaffected.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false }));
app.use(express.json());

// Login attempts per network address. Generous, because a whole hospital can share one address at
// shift change; guessing one account's password is stopped by its own lockout (routes/auth.js).
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  validate: { trustProxy: false }, // trust proxy is on deliberately, for Render (see above)
  message: { error: 'Too many login attempts from this network — wait 15 minutes and try again.' },
}));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'AtollLIS backend' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/his', require('./routes/his'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/specimens', require('./routes/specimens'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/users', require('./routes/users'));
app.use('/api/facility-networks', require('./routes/facility-networks'));
app.use('/api/role-capabilities', require('./routes/role-capabilities'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/wards', require('./routes/wards'));
app.use('/api/rejection-reasons', require('./routes/rejection-reasons'));
app.use('/api/test-aliases', require('./routes/test-aliases'));
app.use('/api/test-panels', require('./routes/test-panels'));
app.use('/api/reflex-rules', require('./routes/reflex-rules'));
app.use('/api/organisms', require('./routes/organisms'));
app.use('/api/antibiotics', require('./routes/antibiotics'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/history', require('./routes/history'));
app.use('/api/instruments', require('./routes/instruments'));
app.use('/api/interface', require('./routes/interface'));

// Serves the frontend (public/index.html, public/css, public/js) at the same origin as the API — the recommended
// combined deployment. If you're hosting the frontend separately instead, this block is harmless
// (nothing in /public will exist) and you can delete it.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // A unique key already taken — two people saving the same thing at the same moment.
  if (err && err.code === 'P2002') return res.status(409).json({ error: 'Someone else saved this at the same moment — reload and check before trying again.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
