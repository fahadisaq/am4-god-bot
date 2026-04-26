// ============================================================
//  ROUTES — Revenue-Per-Route Intelligence
//  Scrapes route list + earnings, ranks by profitability
// ============================================================

const tg = require('./telegram');

let rankedRoutes = [];
let lastScrape = 0;

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [ROUTES] ${msg}`);
}

async function scrapeRoutes(page) {
  log('🗺️', 'Scraping route data...');
  try {
    // Navigate to routes list
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('route_list.php', 'Routes', false, false, true);
    });
    await new Promise(r => setTimeout(r, 3000));

    const routes = await page.evaluate(() => {
      const rows = document.querySelectorAll('#routeList tr, .route-row, [class*="route"]');
      const results = [];

      rows.forEach(row => {
        try {
          const cols = row.querySelectorAll('td');
          if (cols.length < 3) return;

          // Extract route name (usually first col)
          const name = cols[0]?.innerText?.trim() || '';
          if (!name || name === '') return;

          // Extract earnings (look for $ amounts)
          let earnings = 0;
          for (const col of cols) {
            const text = col.innerText || '';
            if (text.includes('$')) {
              const match = text.match(/\$?([\d,]+)/);
              if (match) {
                const val = parseInt(match[1].replace(/,/g, ''));
                if (val > earnings) earnings = val;
              }
            }
          }

          // Extract destination
          const dest = cols[1]?.innerText?.trim() || '';

          if (name && earnings > 0) {
            results.push({ name, dest, earnings });
          }
        } catch(e) {}
      });

      return results;
    });

    if (routes.length > 0) {
      // Sort by earnings descending
      rankedRoutes = routes.sort((a, b) => b.earnings - a.earnings);
      lastScrape = Date.now();
      log('✅', `Scraped ${rankedRoutes.length} routes. Best: ${rankedRoutes[0]?.name} ($${rankedRoutes[0]?.earnings?.toLocaleString()})`);
    } else {
      log('⚠️', 'Could not read route data from page (may need to check selectors)');
    }

    try {
      await page.evaluate(() => { if (typeof closePop === 'function') closePop(); });
    } catch(e) {}

    return rankedRoutes;
  } catch(e) {
    log('⚠️', `Route scrape failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
    return [];
  }
}

function getRankedRoutes() {
  return rankedRoutes;
}

function getRouteReport() {
  if (rankedRoutes.length === 0) {
    return '⚠️ No route data available yet. Will scan on next session.';
  }

  const top5 = rankedRoutes.slice(0, 5);
  const bottom5 = rankedRoutes.slice(-5).reverse();

  const lines = [
    `🗺️ <b>Route Intelligence Report</b>`,
    `📊 Total routes tracked: ${rankedRoutes.length}`,
    ``,
    `🏆 <b>Top 5 Money Makers:</b>`,
    ...top5.map((r, i) => `  ${i+1}. ${r.name} — $${r.earnings.toLocaleString()}`),
    ``,
    `📉 <b>Bottom 5 Underperformers:</b>`,
    ...bottom5.map((r, i) => `  ${i+1}. ${r.name} — $${r.earnings.toLocaleString()}`),
  ];

  return lines.join('\n');
}

// Returns age of last scrape in minutes
function lastScrapeMinutesAgo() {
  if (!lastScrape) return Infinity;
  return Math.floor((Date.now() - lastScrape) / 60000);
}

module.exports = { scrapeRoutes, getRankedRoutes, getRouteReport, lastScrapeMinutesAgo };
