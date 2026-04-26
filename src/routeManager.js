// ============================================================
//  ROUTE MANAGER — Auto-configure seats & fix empty planes
//  Checks pax demand vs seat config on all routes.
//  Uses AM4's built-in auto-configure to fill seats properly.
// ============================================================

const tg = require('./telegram');

let lastRouteCheck = 0;
const ROUTE_CHECK_INTERVAL = 2 * 60 * 60 * 1000; // every 2 hours

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [ROUTE-MGR] ${msg}`);
}

/**
 * Get all routes with their current load/demand info
 */
async function getRouteStats(page) {
  try {
    // Open route list
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('route_list.php', 'Routes', false, false, true);
    });
    await sleep(3000);

    const routes = await page.evaluate(() => {
      const results = [];
      
      // IMPORTANT: Only look inside the popup, not the whole page!
      const popup = document.getElementById('popMain') 
        || document.querySelector('.popup-content')
        || document.querySelector('.modal-body')
        || document.getElementById('popContent');
      
      if (!popup) return [];
      
      const rows = popup.querySelectorAll('tr, [class*="route"], .route-row');
      
      rows.forEach((row, idx) => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          
          const text = row.innerText || '';
          const name = cells[0]?.innerText?.trim() || `Route ${idx}`;
          
          // Load percentage
          const loadMatch = text.match(/(\d+)\s*%/);
          const load = loadMatch ? parseInt(loadMatch[1]) : -1;
          
          // Pax count
          const paxMatch = text.match(/(\d[\d,]*)\s*(?:pax|passengers)/i);
          const pax = paxMatch ? parseInt(paxMatch[1].replace(/,/g, '')) : -1;
          
          // Revenue
          const revMatch = text.match(/\$\s*([\d,]+)/);
          const revenue = revMatch ? parseInt(revMatch[1].replace(/,/g, '')) : 0;
          
          // === AGGRESSIVE Route ID extraction ===
          let routeId = '';
          
          // Strategy 1: Check row's own onclick
          const rowOnclick = row.getAttribute('onclick') || '';
          
          // Strategy 2: Check all child elements with onclick or href
          const clickables = row.querySelectorAll('a[href], [onclick], button, [data-id], [data-route]');
          
          // Strategy 3: Check data attributes on the row itself
          const rowDataId = row.getAttribute('data-id') || row.getAttribute('data-route') || '';
          
          // Collect all attribute strings to search
          const attrStrings = [rowOnclick, rowDataId];
          
          clickables.forEach(el => {
            attrStrings.push(el.getAttribute('onclick') || '');
            attrStrings.push(el.getAttribute('href') || '');
            attrStrings.push(el.getAttribute('data-id') || '');
            attrStrings.push(el.getAttribute('data-route') || '');
          });
          
          // Strategy 4: Check the innerHTML for popup() calls
          const rowHtml = row.innerHTML || '';
          const popupMatch = rowHtml.match(/popup\s*\(\s*['"]([^'"]*id=(\d+)[^'"]*)['"]/i);
          if (popupMatch) attrStrings.push(popupMatch[1]);
          
          // Now search all collected strings for an ID
          for (const str of attrStrings) {
            if (!str) continue;
            // Pattern 1: id=NNN
            const m1 = str.match(/id[=:](\d+)/i);
            if (m1) { routeId = m1[1]; break; }
            // Pattern 2: route_detail.php or similar with number
            const m2 = str.match(/route[^'"]*?(\d+)/i);
            if (m2) { routeId = m2[1]; break; }
            // Pattern 3: popup('something', ..., NNN) 
            const m3 = str.match(/popup\([^)]*?(\d{2,})/i);
            if (m3) { routeId = m3[1]; break; }
            // Pattern 4: any standalone number 2+ digits
            const m4 = str.match(/\b(\d{2,})\b/);
            if (m4) { routeId = m4[1]; break; }
          }
          
          // Debug: for first route, dump what we see
          const debug = idx < 2 ? {
            rowOnclick: rowOnclick.slice(0, 100),
            firstChildOnclick: (clickables[0]?.getAttribute('onclick') || '').slice(0, 100),
            firstChildHref: (clickables[0]?.getAttribute('href') || '').slice(0, 100),
            rowDataId,
            popupMatch: popupMatch ? popupMatch[0].slice(0, 100) : '',
            htmlSnippet: rowHtml.slice(0, 200),
            clickableCount: clickables.length,
          } : null;
          
          results.push({ name, load, pax, revenue, routeId, index: idx, debug });
        } catch(e) {}
      });
      
      return results;
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}
    
    // Debug: log what we found for the first route
    if (routes.length > 0 && routes[0].debug) {
      log('🔍', `DEBUG Route[0] "${routes[0].name}":`);
      log('🔍', `  onclick: ${routes[0].debug.rowOnclick || '(none)'}`);
      log('🔍', `  child onclick: ${routes[0].debug.firstChildOnclick || '(none)'}`);
      log('🔍', `  child href: ${routes[0].debug.firstChildHref || '(none)'}`);
      log('🔍', `  data-id: ${routes[0].debug.rowDataId || '(none)'}`);
      log('🔍', `  popup: ${routes[0].debug.popupMatch || '(none)'}`);
      log('🔍', `  clickables: ${routes[0].debug.clickableCount}`);
      log('🔍', `  HTML: ${routes[0].debug.htmlSnippet}`);
      log('🔍', `  routeId: ${routes[0].routeId || '(none found)'}`);
    }
    
    return routes;
  } catch(e) {
    log('❌', `Failed to get route stats: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
    return [];
  }
}

/**
 * Auto-configure seat layout for a specific route using AM4's built-in optimizer
 */
async function autoConfigureRoute(page, routeId) {
  if (!routeId) return false;
  
  try {
    log('🔧', `Auto-configuring route ${routeId}...`);
    
    // Use AM4's AJAX endpoint for auto-configuration
    const result = await page.evaluate(async (id) => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) {
            resolve({ status: this.status, text: this.responseText.slice(0, 200) });
          }
        };
        // AM4's auto-configure endpoint
        xhr.open('GET', `route_config.php?id=${id}&mode=auto`, true);
        xhr.send();
      });
    }, routeId);
    
    if (result.status === 200) {
      log('✅', `Route ${routeId} auto-configured!`);
      return true;
    } else {
      log('⚠️', `Auto-config returned ${result.status}: ${result.text}`);
      return false;
    }
  } catch(e) {
    log('❌', `Auto-config failed for route ${routeId}: ${e.message}`);
    return false;
  }
}

/**
 * Check all routes and fix any with low/zero load
 */
async function checkAndFixRoutes(page) {
  if (Date.now() - lastRouteCheck < ROUTE_CHECK_INTERVAL) return;
  lastRouteCheck = Date.now();
  
  log('🗺️', 'Checking all routes...');
  
  const routes = await getRouteStats(page);
  
  if (routes.length === 0) {
    log('⚠️', 'Could not read route data');
    return;
  }
  
  log('📊', `Found ${routes.length} routes`);
  
  // Find routes with problems (load < 50% or 0 pax)
  const problemRoutes = routes.filter(r => 
    (r.load >= 0 && r.load < 50) || (r.pax === 0)
  );
  
  const goodRoutes = routes.filter(r => r.load >= 50 || r.load === -1);
  
  if (problemRoutes.length > 0) {
    log('⚠️', `${problemRoutes.length} routes have low/zero load!`);
    
    let fixed = 0;
    for (const route of problemRoutes) {
      log('🔧', `Fixing: ${route.name} (load: ${route.load}%, pax: ${route.pax})`);
      
      if (route.routeId) {
        const success = await autoConfigureRoute(page, route.routeId);
        if (success) fixed++;
        await sleep(2000);
      } else {
        log('⚠️', `No route ID found for: ${route.name} — cannot auto-configure`);
      }
    }
    
    // Report to Telegram
    const report = [
      `🗺️ <b>Route Health Report</b>`,
      `📊 Total routes: ${routes.length}`,
      `✅ Healthy: ${goodRoutes.length}`,
      `⚠️ Problem routes: ${problemRoutes.length}`,
      `🔧 Auto-fixed: ${fixed}`,
      ``,
      `<b>Problem routes:</b>`,
      ...problemRoutes.slice(0, 5).map(r => 
        `  ❌ ${r.name} — Load: ${r.load}% | Pax: ${r.pax}`
      ),
    ];
    
    if (problemRoutes.length > 5) {
      report.push(`  ... and ${problemRoutes.length - 5} more`);
    }
    
    await tg.send(report.join('\n'));
  } else {
    log('✅', `All ${routes.length} routes look healthy`);
  }
}

/**
 * Do a full maintenance check on all aircraft
 */
async function repairAllAircraft(page) {
  log('🔧', 'Running aircraft repair check...');
  try {
    // Use AM4's maintenance endpoint to check + repair
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) {
            resolve({ status: this.status, text: this.responseText.slice(0, 300) });
          }
        };
        // Try the bulk maintenance endpoint
        xhr.open('GET', 'maintenance.php?mode=all', true);
        xhr.send();
      });
    });
    
    if (result.status === 200) {
      // Check if any aircraft were repaired
      const repairMatch = result.text.match(/(\d+)\s*(?:aircraft|plane)/i);
      const count = repairMatch ? parseInt(repairMatch[1]) : 0;
      if (count > 0) {
        log('✅', `Repaired ${count} aircraft`);
        await tg.maintenanceDone(count);
      } else {
        log('✅', 'All aircraft in good condition');
      }
    }
  } catch(e) {
    log('⚠️', `Repair check failed: ${e.message}`);
  }
}

module.exports = { checkAndFixRoutes, repairAllAircraft, getRouteStats };
