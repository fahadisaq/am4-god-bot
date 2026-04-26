// ============================================================
//  TOP AIRLINE SPY — Learn from the best, copy the winners
//  
//  Scrapes the top airlines from the leaderboard,
//  views their profiles (fleet count, hubs, value),
//  and reports intelligence to Telegram so you can copy their
//  strategy (which hubs, how many planes, etc.)
// ============================================================

const tg = require('./telegram');

let lastSpy = 0;
const SPY_INTERVAL = 6 * 60 * 60 * 1000; // every 6 hours

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [SPY] ${msg}`);
}

/**
 * Get the top airlines from the world leaderboard
 */
async function getTopAirlines(page) {
  try {
    // Open the global leaderboard
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('ranking.php', 'Rankings', false, false, true);
    });
    await sleep(3000);

    const airlines = await page.evaluate(() => {
      const results = [];
      
      // Only look inside the popup container
      const popup = document.getElementById('popMain') 
        || document.querySelector('.popup-content')
        || document.getElementById('popContent');
      
      if (!popup) return [];
      
      const rows = popup.querySelectorAll('tr, [class*="rank"]');
      
      rows.forEach((row, idx) => {
        try {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          
          const text = row.innerText || '';
          const name = cells[1]?.innerText?.trim() || cells[0]?.innerText?.trim() || '';
          
          // Get value/score
          const valMatch = text.match(/\$\s*([\d,]+)/);
          const value = valMatch ? parseInt(valMatch[1].replace(/,/g, '')) : 0;
          
          // Get player/airline ID from links
          let airlineId = '';
          const links = row.querySelectorAll('a[href], [onclick]');
          for (const link of links) {
            const attr = link.getAttribute('href') || link.getAttribute('onclick') || '';
            const idMatch = attr.match(/(?:user|airline|profile)[^0-9]*(\d+)/i);
            if (idMatch) { airlineId = idMatch[1]; break; }
            const numMatch = attr.match(/(\d{4,})/);
            if (numMatch) { airlineId = numMatch[1]; break; }
          }

          // Rank number
          const rankMatch = text.match(/^(\d+)/);
          const rank = rankMatch ? parseInt(rankMatch[1]) : idx;

          if (name && name !== '' && !name.includes('Rank')) {
            results.push({ rank, name, value, airlineId });
          }
        } catch(e) {}
      });

      return results.slice(0, 10); // top 10
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}
    return airlines;
  } catch(e) {
    log('❌', `Leaderboard scan failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
    return [];
  }
}

/**
 * View a specific airline's profile to get intel
 */
async function spyOnAirline(page, airlineId) {
  if (!airlineId) return null;
  
  try {
    const profile = await page.evaluate(async (id) => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) {
            const html = this.responseText;
            
            // Extract data from profile page
            const data = {};
            
            // Fleet size
            const fleetMatch = html.match(/fleet[^0-9]{0,30}(\d+)/i) || html.match(/aircraft[^0-9]{0,30}(\d+)/i);
            data.fleet = fleetMatch ? parseInt(fleetMatch[1]) : 0;
            
            // Hub count
            const hubMatch = html.match(/hub[s]?[^0-9]{0,30}(\d+)/i);
            data.hubs = hubMatch ? parseInt(hubMatch[1]) : 0;
            
            // Value/worth
            const valueMatch = html.match(/value[^$]{0,20}\$\s*([\d,]+)/i) || html.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(?:B|M)/i);
            data.value = valueMatch ? valueMatch[1] : '0';
            
            // Routes count
            const routeMatch = html.match(/route[s]?[^0-9]{0,30}(\d+)/i);
            data.routes = routeMatch ? parseInt(routeMatch[1]) : 0;
            
            // Age/days
            const ageMatch = html.match(/(\d+)\s*(?:day|d)/i);
            data.ageDays = ageMatch ? parseInt(ageMatch[1]) : 0;
            
            // Alliance
            const allianceMatch = html.match(/alliance[^<]{0,50}([A-Z0-9]{2,10})/i);
            data.alliance = allianceMatch ? allianceMatch[1] : '';
            
            // Hub names — look for airport codes (3 letters)
            const hubCodes = html.match(/\b[A-Z]{3}\b/g) || [];
            // Filter to likely airport codes (exclude common words)
            const exclude = ['THE','AND','FOR','BUT','NOT','ALL','ARE','HAS','WAS','HIS','HER','ITS'];
            data.hubList = [...new Set(hubCodes.filter(c => !exclude.includes(c)))].slice(0, 10);
            
            data.htmlSnippet = html.replace(/<[^>]*>/g, ' ').slice(0, 500).trim();
            
            resolve({ status: this.status, data });
          }
        };
        // Try viewing the airline profile
        xhr.open('GET', `airline_profile.php?id=${id}`, true);
        xhr.send();
      });
    }, airlineId);

    return profile.status === 200 ? profile.data : null;
  } catch(e) {
    log('⚠️', `Spy failed on airline ${airlineId}: ${e.message}`);
    return null;
  }
}

/**
 * Main spy function — scan top airlines and report intel
 */
async function spyOnTopAirlines(page) {
  if (Date.now() - lastSpy < SPY_INTERVAL) return;
  lastSpy = Date.now();

  log('🕵️', '═══ TOP AIRLINE INTELLIGENCE REPORT ═══');
  
  const topAirlines = await getTopAirlines(page);
  
  if (topAirlines.length === 0) {
    log('⚠️', 'Could not read leaderboard');
    return;
  }

  log('📊', `Found ${topAirlines.length} top airlines`);

  const intel = [];
  
  // Spy on top 5
  for (const airline of topAirlines.slice(0, 5)) {
    if (airline.airlineId) {
      const profile = await spyOnAirline(page, airline.airlineId);
      if (profile) {
        intel.push({ ...airline, ...profile });
        log('🕵️', `#${airline.rank} ${airline.name}: ${profile.fleet} planes, ${profile.hubs} hubs, ${profile.routes} routes`);
      }
      await sleep(2000); // Don't spam requests
    } else {
      intel.push(airline);
      log('ℹ️', `#${airline.rank} ${airline.name}: No profile ID found`);
    }
  }

  // Build intelligence report for Telegram
  if (intel.length > 0) {
    const report = [
      `🕵️ <b>Top Airline Intelligence</b>`,
      `📊 Scanned: ${intel.length} airlines`,
      ``,
    ];

    for (const a of intel) {
      const line = [
        `🏆 <b>#${a.rank} ${a.name}</b>`,
      ];
      if (a.fleet) line.push(`  ✈️ Fleet: ${a.fleet} aircraft`);
      if (a.hubs) line.push(`  🏢 Hubs: ${a.hubs}`);
      if (a.routes) line.push(`  🗺️ Routes: ${a.routes}`);
      if (a.hubList && a.hubList.length > 0) line.push(`  📍 Hub codes: ${a.hubList.join(', ')}`);
      if (a.ageDays) line.push(`  📅 Age: ${a.ageDays} days`);
      if (a.value && a.value !== '0') line.push(`  💰 Value: $${a.value}`);
      
      report.push(line.join('\n'));
    }

    report.push('');
    report.push(`💡 <i>Copy their hub locations and fleet size to grow faster!</i>`);

    await tg.send(report.join('\n'));
    log('✅', 'Intelligence report sent to Telegram');
  }
}

module.exports = { spyOnTopAirlines };
