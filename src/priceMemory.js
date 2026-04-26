// ============================================================
//  PRICE MEMORY — Persistent cross-session fuel intelligence
//  Saves data/price-history.json back to repo after each run
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'price-history.json');
const MAX_ENTRIES = 2016; // 7 days × 48 readings/day (every 30 min)
const DIP_THRESHOLD = 0.08; // 8% below average = "dip"

let history = { fuel: [], co2: [] };

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [PRICEMEM] ${msg}`);
}

// Load history from disk (call once at bot start)
function loadHistory() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      history = JSON.parse(raw);
      const fuelCount = history.fuel?.length || 0;
      const co2Count = history.co2?.length || 0;
      log('📂', `Loaded price history: ${fuelCount} fuel, ${co2Count} CO2 readings`);
    } else {
      log('📂', 'No price history found — starting fresh');
      history = { fuel: [], co2: [] };
    }
  } catch(e) {
    log('⚠️', `Could not load price history: ${e.message}`);
    history = { fuel: [], co2: [] };
  }
}

// Save history to disk (call at end of session)
function saveHistory() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
    log('💾', `Price history saved: ${history.fuel.length} fuel, ${history.co2.length} CO2`);
  } catch(e) {
    log('⚠️', `Could not save price history: ${e.message}`);
  }
}

// Record a new price reading
function recordPrice(type, price) {
  if (!history[type]) history[type] = [];
  history[type].push({ price, time: Date.now() });
  // Trim to max entries
  if (history[type].length > MAX_ENTRIES) {
    history[type] = history[type].slice(-MAX_ENTRIES);
  }
}

// Get 7-day rolling average
function getAverage(type) {
  const entries = history[type] || [];
  if (entries.length === 0) return null;
  // Only use last 7 days
  const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const recent = entries.filter(e => e.time >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((sum, e) => sum + e.price, 0) / recent.length;
}

// Get 24-hour low
function get24hLow(type) {
  const entries = history[type] || [];
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  const recent = entries.filter(e => e.time >= cutoff);
  if (recent.length === 0) return null;
  return Math.min(...recent.map(e => e.price));
}

// Predict if current price is a real dip (true = buy now!)
function predictDip(type, currentPrice) {
  const avg = getAverage(type);
  if (avg === null) return true; // No data yet — always buy

  const dipPrice = avg * (1 - DIP_THRESHOLD);
  const isDip = currentPrice <= dipPrice;

  const trend = getTrend(type);
  log('📈', `${type.toUpperCase()} — 7d avg: $${Math.round(avg)} | current: $${currentPrice} | dip threshold: $${Math.round(dipPrice)} | isDip: ${isDip} | trend: ${trend}`);

  return isDip;
}

// Get price trend (rising/falling/stable)
function getTrend(type) {
  const entries = history[type] || [];
  if (entries.length < 6) return 'unknown';
  const last6 = entries.slice(-6);
  const first3avg = (last6[0].price + last6[1].price + last6[2].price) / 3;
  const last3avg = (last6[3].price + last6[4].price + last6[5].price) / 3;
  const delta = ((last3avg - first3avg) / first3avg) * 100;
  if (delta > 3) return '📈 rising';
  if (delta < -3) return '📉 falling';
  return '➡️ stable';
}

// Market summary for Telegram
function getMarketSummary() {
  const fuelAvg = getAverage('fuel');
  const co2Avg = getAverage('co2');
  const fuel24Low = get24hLow('fuel');
  const co224Low = get24hLow('co2');
  const fuelTrend = getTrend('fuel');
  const co2Trend = getTrend('co2');
  const fuelReadings = (history.fuel || []).length;
  const co2Readings = (history.co2 || []).length;

  return [
    `📊 <b>Market Intelligence</b>`,
    `⛽ Fuel 7d avg: $${fuelAvg ? Math.round(fuelAvg) : 'N/A'} | 24h low: $${fuel24Low || 'N/A'} | ${fuelTrend}`,
    `🌿 CO2 7d avg: $${co2Avg ? Math.round(co2Avg) : 'N/A'} | 24h low: $${co224Low || 'N/A'} | ${co2Trend}`,
    `📈 Data points: ${fuelReadings} fuel, ${co2Readings} CO2 readings`,
  ].join('\n');
}

module.exports = { loadHistory, saveHistory, recordPrice, predictDip, getAverage, get24hLow, getTrend, getMarketSummary };
