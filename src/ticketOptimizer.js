// ============================================================
//  TICKET OPTIMIZER — God-Level Pricing & Seat Configuration
//  
//  The #1 money-making strategy in AM4:
//  Uses routeManager.getRouteStats() to get routes, then:
//  1. Auto-configure seats to match demand
//  2. Apply optimal ticket price multipliers:
//     Economy:  auto-price × 1.10
//     Business: auto-price × 1.08
//     First:    auto-price × 1.06
// ============================================================

const tg = require('./telegram');
const { getRouteStats } = require('./routeManager');

let lastOptimize = 0;
const OPTIMIZE_INTERVAL = 4 * 60 * 60 * 1000; // every 4 hours

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [TICKET] ${msg}`);
}

/**
 * Auto-configure seats on a route to match demand
 */
async function autoConfigureSeats(page, routeId) {
  try {
    const result = await page.evaluate(async (id) => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText.slice(0, 200) });
        };
        xhr.open('GET', `route_config.php?id=${id}&mode=auto`, true);
        xhr.send();
      });
    }, routeId);
    return result.status === 200;
  } catch(e) {
    return false;
  }
}

/**
 * Read a route's config page to get current ticket prices, then apply multipliers
 */
async function optimizeRouteTickets(page, routeId) {
  try {
    // Get the route config page via AJAX
    const result = await page.evaluate(async (id) => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) {
            const html = this.responseText;
            
            // Look for price inputs or displayed prices
            // AM4 shows current prices in input fields or text
            const prices = {};
            
            // Try to find economy/business/first prices from the HTML
            // Common patterns: value="XXX" near economy/business/first labels
            const ecoInput = html.match(/eco[^"]*?"[^"]*?value="?(\d+)/i);
            const busInput = html.match(/bus[^"]*?"[^"]*?value="?(\d+)/i);
            const firstInput = html.match(/first[^"]*?"[^"]*?value="?(\d+)/i);
            
            // Alternative: look for $ amounts near class names
            const ecoPrice = html.match(/economy[^$]{0,50}\$?\s*(\d[\d,]*)/i);
            const busPrice = html.match(/business[^$]{0,50}\$?\s*(\d[\d,]*)/i);
            const firstPrice = html.match(/first\s*class[^$]{0,50}\$?\s*(\d[\d,]*)/i);
            
            prices.eco = ecoInput ? parseInt(ecoInput[1]) : (ecoPrice ? parseInt(ecoPrice[1].replace(/,/g, '')) : 0);
            prices.bus = busInput ? parseInt(busInput[1]) : (busPrice ? parseInt(busPrice[1].replace(/,/g, '')) : 0);
            prices.first = firstInput ? parseInt(firstInput[1]) : (firstPrice ? parseInt(firstPrice[1].replace(/,/g, '')) : 0);
            
            resolve({
              status: this.status,
              prices,
              htmlSnippet: html.slice(0, 500),
            });
          }
        };
        xhr.open('GET', `route_config.php?id=${id}`, true);
        xhr.send();
      });
    }, routeId);

    if (result.status !== 200) return null;

    const { prices } = result;

    // Apply multipliers
    const optEco = prices.eco > 0 ? Math.floor(prices.eco * 1.10) : 0;
    const optBus = prices.bus > 0 ? Math.floor(prices.bus * 1.08) : 0;
    const optFirst = prices.first > 0 ? Math.floor(prices.first * 1.06) : 0;

    if (optEco > 0 || optBus > 0 || optFirst > 0) {
      // Set optimized prices
      await page.evaluate(async (id, eco, bus, first) => {
        return new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function() {
            if (this.readyState === 4) resolve(this.status);
          };
          const params = `id=${id}&ecoPrice=${eco}&busPrice=${bus}&firstPrice=${first}`;
          xhr.open('POST', 'route_config.php?mode=price', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.send(params);
        });
      }, routeId, optEco, optBus, optFirst);

      return { routeId, eco: optEco, bus: optBus, first: optFirst };
    }

    // Log what we found for debugging
    log('🔍', `Route ${routeId}: found prices E$${prices.eco} B$${prices.bus} F$${prices.first}`);
    return null;
  } catch(e) {
    log('⚠️', `Optimize failed for route ${routeId}: ${e.message}`);
    return null;
  }
}

/**
 * Main optimization — uses routeManager's getRouteStats for route IDs
 */
async function optimizeAllRoutes(page) {
  if (Date.now() - lastOptimize < OPTIMIZE_INTERVAL) return;
  lastOptimize = Date.now();

  log('💰', '═══ GOD-LEVEL TICKET OPTIMIZATION ═══');

  // Use routeManager's proven route scanner
  const routes = await getRouteStats(page);
  
  if (routes.length === 0) {
    log('⚠️', 'No routes found');
    return;
  }

  // Filter to routes that have IDs
  const routesWithIds = routes.filter(r => r.routeId);
  log('📊', `Found ${routes.length} routes (${routesWithIds.length} with IDs for optimization)`);

  if (routesWithIds.length === 0) {
    log('⚠️', 'No route IDs found — cannot optimize ticket prices');
    log('ℹ️', `Routes found: ${routes.map(r => r.name).join(', ')}`);
    return;
  }

  let optimized = 0;
  let configured = 0;

  for (const route of routesWithIds) {
    // Step 1: Auto-configure seats
    const seatResult = await autoConfigureSeats(page, route.routeId);
    if (seatResult) configured++;
    await sleep(1500);

    // Step 2: Optimize ticket prices
    const priceResult = await optimizeRouteTickets(page, route.routeId);
    if (priceResult) {
      optimized++;
      log('✅', `${route.name}: E$${priceResult.eco} | B$${priceResult.bus} | F$${priceResult.first}`);
    }
    await sleep(500);
  }

  log('🏆', `Done: ${optimized}/${routesWithIds.length} routes priced, ${configured} seats configured`);

  if (optimized > 0 || configured > 0) {
    await tg.send([
      `💰 <b>Ticket Optimization Complete!</b>`,
      `📊 Routes: ${routes.length} (${routesWithIds.length} optimized)`,
      `💵 Prices set: ${optimized}`,
      `💺 Seats configured: ${configured}`,
      ``,
      `<b>Multipliers:</b>`,
      `  ✈️ Economy: ×1.10`,
      `  🥂 Business: ×1.08`,
      `  👑 First: ×1.06`,
    ].join('\n'));
  }
}

module.exports = { optimizeAllRoutes };
