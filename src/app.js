require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.set('trust proxy', true); // needed for req.ip to be the real client IP behind Render's proxy
app.use(cors());
app.use(express.json());

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
app.use('/api/test-aliases', require('./routes/test-aliases'));
app.use('/api/test-panels', require('./routes/test-panels'));
app.use('/api/reflex-rules', require('./routes/reflex-rules'));
app.use('/api/organisms', require('./routes/organisms'));
app.use('/api/antibiotics', require('./routes/antibiotics'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/history', require('./routes/history'));

// Serves the frontend (public/index.html) at the same origin as the API — the recommended
// combined deployment. If you're hosting the frontend separately instead, this block is harmless
// (nothing in /public will exist) and you can delete it.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
