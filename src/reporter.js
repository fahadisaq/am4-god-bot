// ============================================================
//  REPORTER — Daily P&L Tracker + Telegram Report
//  Persists data/daily-stats.json across sessions
// ============================================================

const fs = require('fs');
const path = require('path');
const tg = require('./telegram');

const STATS_FILE = path.join(__dirname, '..', 'data', 'daily-stats.json');

let stats = {
  date: '',           // YYYY-MM-DD of current period
  startBalance: 0,
  endBalance: 0,
  totalDeparted: 0,
  totalFuelCost: 0,
  totalCO2Cost: 0,
  sessions: 0,
  lastReportSent: 0,  // timestamp of last daily report
};

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [REPORTER] ${msg}`);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const raw = fs.readFileSync(STATS_FILE, 'utf8');
      const loaded = JSON.parse(raw);
      // If it's a new day, reset stats
      if (loaded.date !== todayStr()) {
        log('📅', `New day detected (${todayStr()}) — resetting daily stats`);
        stats.date = todayStr();
        stats.startBalance = 0;
        stats.endBalance = 0;
        stats.totalDeparted = 0;
        stats.totalFuelCost = 0;
        stats.totalCO2Cost = 0;
        stats.sessions = 0;
        stats.lastReportSent = loaded.lastReportSent || 0;
      } else {
        stats = loaded;
        log('📂', `Loaded daily stats: ${stats.totalDeparted} flights, ${stats.sessions} sessions today`);
      }
    }
  } catch(e) {
    log('⚠️', `Could not load stats: ${e.message}`);
  }
}

function saveStats() {
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    stats.date = todayStr();
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch(e) {
    log('⚠️', `Could not save stats: ${e.message}`);
  }
}

function recordSessionStart(balance) {
  if (stats.startBalance === 0) {
    stats.startBalance = balance;
    log('📊', `Session start balance: $${balance.toLocaleString()}`);
  }
  stats.sessions++;
  saveStats();
}

function recordSessionEnd(balance, departed, fuelCost, co2Cost) {
  stats.endBalance = balance;
  stats.totalDeparted += departed;
  stats.totalFuelCost += (fuelCost || 0);
  stats.totalCO2Cost += (co2Cost || 0);
  log('📊', `Session end — balance: $${balance.toLocaleString()} | departed: ${departed}`);
  saveStats();
}

function recordFuelPurchase(cost) {
  stats.totalFuelCost += cost;
  saveStats();
}

function recordCO2Purchase(cost) {
  stats.totalCO2Cost += cost;
  saveStats();
}

// Check if we should send a daily report (midnight UTC or first run of day)
async function checkDailyReport() {
  const now = Date.now();
  const hourUTC = new Date().getUTCHours();
  const sinceLastReport = now - (stats.lastReportSent || 0);
  const oneDayMs = 24 * 60 * 60 * 1000;

  // Send if it's 00:00-00:30 UTC and we haven't sent in 20+ hours
  if (hourUTC === 0 && sinceLastReport > 20 * 60 * 60 * 1000) {
    await sendDailyReport();
  }
}

async function sendDailyReport() {
  const netProfit = stats.endBalance - stats.startBalance;
  const totalSpent = stats.totalFuelCost + stats.totalCO2Cost;
  const profitEmoji = netProfit >= 0 ? '📈' : '📉';

  const report = [
    `🏦 <b>AM4 Daily P&L Report</b>`,
    `📅 <b>${todayStr()}</b>`,
    ``,
    `💰 <b>Financials</b>`,
    `  Start balance: $${stats.startBalance.toLocaleString()}`,
    `  End balance:   $${stats.endBalance.toLocaleString()}`,
    `  ${profitEmoji} Net profit:   $${netProfit.toLocaleString()}`,
    ``,
    `✈️ <b>Operations</b>`,
    `  Flights departed: ${stats.totalDeparted}`,
    `  Bot sessions: ${stats.sessions}`,
    ``,
    `🛢 <b>Costs</b>`,
    `  Fuel purchased: $${stats.totalFuelCost.toLocaleString()}`,
    `  CO2 purchased:  $${stats.totalCO2Cost.toLocaleString()}`,
    `  Total spent:    $${totalSpent.toLocaleString()}`,
  ].join('\n');

  log('📊', 'Sending daily P&L report...');
  await tg.send(report);
  stats.lastReportSent = Date.now();
  saveStats();
}

// Instant report on /report command
async function sendInstantReport() {
  return sendDailyReport();
}

function getCurrentStats() {
  return { ...stats };
}

module.exports = {
  loadStats,
  saveStats,
  recordSessionStart,
  recordSessionEnd,
  recordFuelPurchase,
  recordCO2Purchase,
  checkDailyReport,
  sendInstantReport,
  getCurrentStats,
};
