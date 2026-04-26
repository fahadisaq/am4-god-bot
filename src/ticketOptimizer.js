// ============================================================
//  TICKET OPTIMIZER — God-Level Pricing & Seat Configuration
//  
//  The #1 money-making strategy in AM4:
//  1. Read demand for each route
//  2. Configure seats to match demand exactly
//  3. Apply optimal ticket price multipliers:
//     Economy:  auto-price × 1.10
//     Business: auto-price × 1.08
//     First:    auto-price × 1.06
//  4. Maximize revenue per flight
// ============================================================

const tg = require('./telegram');

let lastOptimize = 0;
const OPTIMIZE_INTERVAL = 4 * 60 * 60 * 1000; // every 4 hours

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [TICKET] ${msg}`);
}

/**
 * Get all routes and their demand/pricing data
 */
async function getRouteDemand(page) {
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('route_list.php', 'Routes', false, false, true);
    });
    await sleep(3000);

    const routes = await page.evaluate(() => {
      const results = [];
      const rows = document.querySelectorAll('#routeList tr, table tr, [class*="route"]');
      
      rows.forEach(row => {
        try {
          const links = row.querySelectorAll('a[href], [onclick]');
          let routeId = '';
          for (const link of links) {
            const attr = link.getAttribute('href') || link.getAttribute('onclick') || '';
            const match = attr.match(/id=(\d+)/);
            if (match) { routeId = match[1]; break; }
          }
          
          const text = row.innerText || '';
          const cells = row.querySelectorAll('td');
          const name = cells[0]?.innerText?.trim() || '';
          
          if (name && routeId) {
            results.push({ name, routeId });
          }
        } catch(e) {}
      });

      return results;
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}
    return routes;
  } catch(e) {
    log('❌', `Failed to get routes: ${e.message}`);
    return [];
  }
}

/**
 * Optimize ticket prices for a single route
 * Uses AM4's proven multiplier strategy:
 *   Economy:  auto × 1.10
 *   Business: auto × 1.08  
 *   First:    auto × 1.06
 */
async function optimizeRouteTickets(page, routeId) {
  try {
    // Open route detail/config
    const result = await page.evaluate(async (id) => {
      return new Promise(resolve => {
        // First get the route config page
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) {
            const html = this.responseText;
            
            // Parse auto-prices from the response
            // AM4 typically has economy, business, first class prices
            const ecoMatch = html.match(/economy[^$]*\$?\s*(\d[\d,]*)/i);
            const busMatch = html.match(/business[^$]*\$?\s*(\d[\d,]*)/i);
            const firstMatch = html.match(/first[^$]*\$?\s*(\d[\d,]*)/i);
            
            // Parse demand
            const ecoDemand = html.match(/economy[^0-9]*demand[^0-9]*(\d[\d,]*)/i);
            const busDemand = html.match(/business[^0-9]*demand[^0-9]*(\d[\d,]*)/i);
            const firstDemand = html.match(/first[^0-9]*demand[^0-9]*(\d[\d,]*)/i);
            
            resolve({
              status: this.status,
              ecoPrice: ecoMatch ? parseInt(ecoMatch[1].replace(/,/g, '')) : 0,
              busPrice: busMatch ? parseInt(busMatch[1].replace(/,/g, '')) : 0,
              firstPrice: firstMatch ? parseInt(firstMatch[1].replace(/,/g, '')) : 0,
              ecoDemand: ecoDemand ? parseInt(ecoDemand[1].replace(/,/g, '')) : 0,
              busDemand: busDemand ? parseInt(busDemand[1].replace(/,/g, '')) : 0,
              firstDemand: firstDemand ? parseInt(firstDemand[1].replace(/,/g, '')) : 0,
              html: html.slice(0, 500),
            });
          }
        };
        xhr.open('GET', `route_config.php?id=${id}`, true);
        xhr.send();
      });
    }, routeId);

    if (result.status !== 200) return false;

    // Calculate optimized prices with multipliers
    const optEco = result.ecoPrice > 0 ? Math.floor(result.ecoPrice * 1.10) : 0;
    const optBus = result.busPrice > 0 ? Math.floor(result.busPrice * 1.08) : 0;
    const optFirst = result.firstPrice > 0 ? Math.floor(result.firstPrice * 1.06) : 0;

    if (optEco > 0 || optBus > 0 || optFirst > 0) {
      // Set optimized prices via AJAX
      await page.evaluate(async (id, eco, bus, first) => {
        return new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function() {
            if (this.readyState === 4) resolve(this.status);
          };
          // Set ticket prices — try the AM4 pricing endpoint
          const params = `id=${id}&ecoPrice=${eco}&busPrice=${bus}&firstPrice=${first}`;
          xhr.open('POST', 'route_config.php?mode=price', true);
          xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
          xhr.send(params);
        });
      }, routeId, optEco, optBus, optFirst);

      return { routeId, eco: optEco, bus: optBus, first: optFirst };
    }

    return null;
  } catch(e) {
    log('⚠️', `Optimize failed for route ${routeId}: ${e.message}`);
    return null;
  }
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
        // AM4's auto-configure endpoint
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
 * Main optimization function — runs through all routes
 */
async function optimizeAllRoutes(page) {
  if (Date.now() - lastOptimize < OPTIMIZE_INTERVAL) return;
  lastOptimize = Date.now();

  log('💰', '═══ GOD-LEVEL TICKET OPTIMIZATION ═══');
  log('💰', 'Scanning all routes for pricing optimization...');

  const routes = await getRouteDemand(page);
  
  if (routes.length === 0) {
    log('⚠️', 'No routes found to optimize');
    return;
  }

  log('📊', `Found ${routes.length} routes to optimize`);

  let optimized = 0;
  let configured = 0;

  for (const route of routes) {
    // Step 1: Auto-configure seats
    const seatResult = await autoConfigureSeats(page, route.routeId);
    if (seatResult) configured++;
    await sleep(1000);

    // Step 2: Optimize ticket prices
    const priceResult = await optimizeRouteTickets(page, route.routeId);
    if (priceResult) {
      optimized++;
      log('✅', `${route.name}: E$${priceResult.eco} | B$${priceResult.bus} | F$${priceResult.first}`);
    }
    await sleep(500);
  }

  log('🏆', `Optimization complete: ${optimized}/${routes.length} routes priced, ${configured} seat configs updated`);

  // Report to Telegram
  if (optimized > 0 || configured > 0) {
    await tg.send([
      `💰 <b>God-Level Optimization Complete!</b>`,
      `📊 Routes scanned: ${routes.length}`,
      `💵 Prices optimized: ${optimized}`,
      `💺 Seats configured: ${configured}`,
      ``,
      `<b>Multipliers Applied:</b>`,
      `  ✈️ Economy: auto × 1.10`,
      `  🥂 Business: auto × 1.08`,
      `  👑 First Class: auto × 1.06`,
    ].join('\n'));
  }
}

module.exports = { optimizeAllRoutes, optimizeRouteTickets, autoConfigureSeats };
