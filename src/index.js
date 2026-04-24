// ============================================================
//  AM4 GOD BOT — Entry Point
//  Starts bot + web dashboard
// ============================================================

require('dotenv').config();

const AM4Bot = require('./bot');
const createDashboard = require('./dashboard');
const { log } = require('./logger');

// ── Load config from environment ──
const config = {
  email: process.env.AM4_EMAIL,
  password: process.env.AM4_PASSWORD,
  fuelThreshold: parseInt(process.env.FUEL_THRESHOLD) || 500,
  co2Threshold: parseInt(process.env.CO2_THRESHOLD) || 120,
  departIntervalMin: parseInt(process.env.DEPART_INTERVAL_MIN) || 270000,
  departIntervalMax: parseInt(process.env.DEPART_INTERVAL_MAX) || 330000,
  minBankBalance: parseInt(process.env.MIN_BANK_BALANCE) || 500000,
  maintenanceWearThreshold: parseInt(process.env.MAINTENANCE_WEAR_THRESHOLD) || 50,
  nightPauseStart: parseInt(process.env.NIGHT_PAUSE_START) || 2,
  nightPauseEnd: parseInt(process.env.NIGHT_PAUSE_END) || 5,
  scanInterval: parseInt(process.env.SCAN_INTERVAL) || 900000,
  headless: process.env.HEADLESS !== 'false',
};

// ── Validate credentials ──
if (!config.email || !config.password) {
  console.error('\n❌ ERROR: AM4_EMAIL and AM4_PASSWORD must be set!');
  console.error('   Copy .env.example to .env and fill in your credentials.\n');
  process.exit(1);
}

// ── Create bot & dashboard ──
const bot = new AM4Bot(config);
const port = parseInt(process.env.PORT) || 3000;

// Start dashboard first (so cloud platforms see a web server)
createDashboard(bot, port);

// Start bot with small delay (let dashboard bind first)
setTimeout(() => {
  bot.init().catch((err) => {
    log('error', 'CORE', `Fatal: ${err.message}`);
    // Don't exit — dashboard stays alive, bot will retry
    setTimeout(() => bot.init(), 60000);
  });
}, 2000);

// ── Graceful shutdown ──
process.on('SIGINT', async () => {
  log('warn', 'CORE', 'Received SIGINT — shutting down gracefully...');
  await bot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('warn', 'CORE', 'Received SIGTERM — shutting down gracefully...');
  await bot.shutdown();
  process.exit(0);
});

// ── Prevent crash from uncaught errors ──
process.on('uncaughtException', (err) => {
  log('error', 'CORE', `Uncaught exception: ${err.message}`);
  // Don't exit — try to recover
});

process.on('unhandledRejection', (reason) => {
  log('error', 'CORE', `Unhandled rejection: ${reason}`);
});
