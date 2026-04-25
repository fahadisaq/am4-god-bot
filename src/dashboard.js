// ============================================================
//  AM4 GOD BOT — Web Dashboard Server
//  Monitor and control the bot from your phone/browser
// ============================================================

const express = require('express');
const path = require('path');
const { log } = require('./logger');

function createDashboard(bot, port) {
  const app = express();
  app.use(express.json());

  const DASH_PASS = process.env.DASHBOARD_PASSWORD || 'am4god';

  // Simple auth middleware
  function auth(req, res, next) {
    const token = req.headers['x-auth'] || req.query.token;
    if (token === DASH_PASS) return next();

    // Allow unauthenticated access to login page
    if (req.path === '/' || req.path === '/login') return next();

    res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Serve dashboard HTML ──
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── API Routes ──
  app.get('/api/status', auth, (req, res) => {
    res.json(bot.getStatus());
  });

  app.post('/api/pause', auth, (req, res) => {
    bot.pause();
    res.json({ ok: true, paused: true });
  });

  app.post('/api/resume', auth, (req, res) => {
    bot.resume();
    res.json({ ok: true, paused: false });
  });

  app.post('/api/depart', auth, async (req, res) => {
    await bot.forceDepartNow();
    res.json({ ok: true });
  });

  app.post('/api/fuel-check', auth, async (req, res) => {
    await bot.forceFuelCheck();
    res.json({ ok: true });
  });

  app.post('/api/config', auth, (req, res) => {
    bot.updateConfig(req.body);
    res.json({ ok: true, config: bot.config });
  });

  app.post('/api/restart', auth, async (req, res) => {
    res.json({ ok: true, message: 'Restarting...' });
    setTimeout(() => bot.restart(), 1000);
  });

  // ── Health check (keeps Render/Koyeb alive) ──
  app.get('/health', (req, res) => {
    res.json({ status: 'alive', uptime: process.uptime() });
  });

  // ── Self-ping to prevent cloud platform spin-down ──
  setInterval(() => {
    try {
      const http = require('http');
      const url = `http://localhost:${port}/health`;
      http.get(url, () => {});
    } catch (e) {}
  }, 10 * 60 * 1000); // Every 10 minutes

  app.listen(port, '0.0.0.0', () => {
    log('success', 'DASHBOARD', `🌐 Dashboard running at http://localhost:${port}`);
    log('info', 'DASHBOARD', `   Password: ${DASH_PASS}`);
  });

  return app;
}

module.exports = createDashboard;
