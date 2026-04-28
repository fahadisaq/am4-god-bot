// ============================================================
//  BONUS + MAINTENANCE + ALLIANCE MODULE
// ============================================================

const tg = require('./telegram');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

// ── DAILY BONUS ──────────────────────────────────────────────
async function collectBonus(page) {
  log('🎁','BONUS','Checking daily bonus...');
  try {
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText });
        };
        xhr.open('GET', 'bonus.php?mode=collect', true);
        xhr.send();
      });
    });

    if (result.text && result.text.includes('success')) {
      // Try to extract bonus amount
      const match = result.text.match(/\$?([\d,]+)/);
      const amount = match ? parseInt(match[1].replace(/,/g,'')) : 0;
      log('✅','BONUS',`Daily bonus collected! $${amount.toLocaleString()}`);
      await tg.bonusCollected(amount);
    } else if (result.text && result.text.includes('already')) {
      log('ℹ️','BONUS','Already collected today');
    } else {
      log('ℹ️','BONUS',`Response: ${result.status}`);
    }
  } catch(e) {
    log('⚠️','BONUS',e.message);
  }
}

// ── MAINTENANCE ───────────────────────────────────────────────
async function doMaintenance(page) {
  log('🔧','MAINT','Checking aircraft maintenance...');
  try {
    // Open maintenance page
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('maintenance.php', 'Maintenance', false, false, true);
    });
    await sleep(3000);

    // Step 1: Read the maintenance summary from the popup
    const stats = await page.evaluate(() => {
      const popup = document.getElementById('popMain') 
        || document.querySelector('.popup-content')
        || document.getElementById('popContent');
      
      if (!popup) return { error: 'No popup found' };
      
      const text = popup.innerText || '';
      const html = popup.innerHTML || '';
      
      // Parse the stats: "Fleet size 97  At hub 11  Worn A/C 18  A check due 3"
      const wornMatch = text.match(/worn\s*a\/?c\s*(\d+)/i);
      const acheckMatch = text.match(/a\s*check\s*due\s*(\d+)/i);
      const fleetMatch = text.match(/fleet\s*size\s*(\d+)/i);
      
      // Extract aircraft IDs from the maintenance popup HTML
      // Look for patterns like: maintenance.php?id=124103883, aircraft ID references, onclick handlers
      const aircraftIds = [];
      const idPatterns = [
        /maintenance\.php\?[^'"]*id=(\d+)/gi,
        /acheck[^'"]*?(\d{6,})/gi,
        /repair[^'"]*?(\d{6,})/gi,
        /doCheck\s*\(\s*(\d+)/gi,
        /doRepair\s*\(\s*(\d+)/gi,
        /aircraft[^'"]*?(\d{6,})/gi,
      ];
      
      for (const pattern of idPatterns) {
        let match;
        while ((match = pattern.exec(html)) !== null) {
          if (!aircraftIds.includes(match[1])) aircraftIds.push(match[1]);
        }
      }
      
      // Also look for ALL onclick attributes containing IDs
      const allOnclicks = [];
      popup.querySelectorAll('[onclick]').forEach(el => {
        allOnclicks.push(el.getAttribute('onclick'));
      });
      
      // Find all buttons with their text + onclick for debugging
      const buttons = [];
      popup.querySelectorAll('button, a.btn, [onclick], .btn, a[href]').forEach(b => {
        buttons.push({
          text: (b.textContent || '').trim().slice(0, 50),
          onclick: (b.getAttribute('onclick') || '').slice(0, 100),
          href: (b.getAttribute('href') || '').slice(0, 100),
          tag: b.tagName,
          classes: b.className || '',
        });
      });
      
      return {
        worn: wornMatch ? parseInt(wornMatch[1]) : 0,
        acheckDue: acheckMatch ? parseInt(acheckMatch[1]) : 0,
        fleetSize: fleetMatch ? parseInt(fleetMatch[1]) : 0,
        hasWarning: text.toLowerCase().includes('poorly maintained') || text.toLowerCase().includes('warning'),
        textSnippet: text.slice(0, 500),
        htmlSnippet: html.slice(0, 1000),
        aircraftIds,
        buttons: buttons.slice(0, 20),
        onclicks: allOnclicks.slice(0, 10),
      };
    });

    if (stats.error) {
      log('⚠️','MAINT', stats.error);
      return;
    }

    log('🔧','MAINT',`Fleet: ${stats.fleetSize} | Worn: ${stats.worn} | A-check due: ${stats.acheckDue}`);
    log('🔍','MAINT',`Found ${stats.aircraftIds?.length || 0} aircraft IDs in popup`);
    log('🔍','MAINT',`Found ${stats.buttons?.length || 0} buttons in popup`);
    
    // Debug: log what buttons exist
    if (stats.buttons?.length > 0) {
      stats.buttons.slice(0, 5).forEach((b, i) => {
        log('🔍','MAINT',`  Button[${i}]: "${b.text}" | onclick="${b.onclick}" | tag=${b.tag}`);
      });
    }
    
    // Debug: log onclick handlers
    if (stats.onclicks?.length > 0) {
      stats.onclicks.slice(0, 3).forEach((oc, i) => {
        log('🔍','MAINT',`  Onclick[${i}]: ${oc}`);
      });
    }

    if (stats.acheckDue > 0 || stats.worn > 0) {
      log('⚠️','MAINT',`${stats.acheckDue} A-checks needed, ${stats.worn} worn aircraft!`);
      
      let totalRepaired = 0;

      // ── Strategy 1: Try bulk endpoints ──
      const bulkEndpoints = [
        'maintenance.php?mode=do_all',
        'maintenance.php?mode=doAll',
        'maintenance.php?mode=do_all&fbSig=false',
        'maintenance.php?mode=check_all&fbSig=false',
      ];
      
      for (const endpoint of bulkEndpoints) {
        const result = await page.evaluate((url) => {
          return new Promise(resolve => {
            const xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function() {
              if (this.readyState === 4) {
                resolve({ status: this.status, text: this.responseText.slice(0, 500) });
              }
            };
            xhr.open('GET', url, true);
            xhr.send();
          });
        }, endpoint);
        
        log('🔧','MAINT',`Endpoint ${endpoint}: status=${result.status} response="${result.text.slice(0, 150)}"`);
        
        // If response contains success indicators, count it
        if (result.status === 200 && !result.text.includes('error') && result.text.length > 10) {
          totalRepaired++;
        }
        await sleep(500);
      }

      // ── Strategy 2: Repair individual aircraft by ID ──
      if (stats.aircraftIds && stats.aircraftIds.length > 0) {
        log('🔧','MAINT',`Attempting individual repairs for ${stats.aircraftIds.length} aircraft...`);
        
        for (const acId of stats.aircraftIds.slice(0, 40)) { // Cap at 40 to avoid rate limiting
          const repairResult = await page.evaluate((id) => {
            return new Promise(resolve => {
              const xhr = new XMLHttpRequest();
              xhr.onreadystatechange = function() {
                if (this.readyState === 4) {
                  resolve({ status: this.status, text: this.responseText.slice(0, 200) });
                }
              };
              xhr.open('GET', `maintenance.php?mode=do&id=${id}&fbSig=false`, true);
              xhr.send();
            });
          }, acId);
          
          if (repairResult.status === 200 && !repairResult.text.includes('error')) {
            totalRepaired++;
          }
          await sleep(300); // Small delay between repairs
        }
        log('🔧','MAINT',`Individual repairs attempted: ${stats.aircraftIds.length}`);
      }

      // ── Strategy 3: Click any repair/A-check buttons in the UI ──
      // First try expanding the list
      await page.evaluate(() => {
        const popup = document.getElementById('popMain') || document.querySelector('.popup-content');
        if (!popup) return;
        const btns = popup.querySelectorAll('button, a, [onclick], .btn');
        for (const b of btns) {
          const t = (b.textContent || '').toLowerCase();
          if (t.includes('show') || t.includes('detail') || t.includes('expand') || t.includes('list')) {
            b.click();
            break;
          }
        }
      });
      await sleep(2000);
      
      const clickResult = await page.evaluate(() => {
        const popup = document.getElementById('popMain') || document.querySelector('.popup-content') || document.body;
        let clicked = 0;
        
        // Click ALL buttons that look like repair/maintenance actions
        const allElements = popup.querySelectorAll('button, a, [onclick], .btn, [class*="btn"]');
        for (const b of allElements) {
          const t = (b.textContent || '').toLowerCase();
          const oc = (b.getAttribute('onclick') || '').toLowerCase();
          const href = (b.getAttribute('href') || '').toLowerCase();
          
          if (t.includes('a-check') || t.includes('a check') || t.includes('check all') ||
              t.includes('repair') || t.includes('maintain') || t.includes('fix') ||
              oc.includes('acheck') || oc.includes('docheck') || oc.includes('repair') ||
              oc.includes('maintenance') || oc.includes('do_all') ||
              href.includes('maintenance') || href.includes('acheck')) {
            b.click();
            clicked++;
          }
        }
        return { clicked };
      });
      
      log('🔧','MAINT',`UI buttons clicked: ${clickResult.clicked}`);
      
      await tg.send([
        `🔧 <b>Maintenance Report</b>`,
        `✈️ Fleet: ${stats.fleetSize} aircraft`,
        `⚠️ Worn: ${stats.worn} | A-checks due: ${stats.acheckDue}`,
        `🔧 Aircraft IDs found: ${stats.aircraftIds?.length || 0}`,
        `✅ Bulk endpoints tried: ${bulkEndpoints.length}`,
        `✅ Individual repairs: ${stats.aircraftIds?.length || 0}`,
        `✅ UI buttons clicked: ${clickResult.clicked}`,
      ].join('\n'));
    } else {
      log('✅','MAINT','All aircraft in good condition');
    }

    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
  } catch(e) {
    log('⚠️','MAINT',e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
  }
}

// ── ALLIANCE CONTRIBUTION ─────────────────────────────────────
async function contributeAlliance(page) {
  log('🤝','ALLIANCE','Checking alliance contribution...');
  try {
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText });
        };
        xhr.open('GET', 'alliance.php?mode=contribute', true);
        xhr.send();
      });
    });

    if (result.status === 200) {
      log('✅','ALLIANCE','Alliance contribution done!');
      await tg.allianceContributed();
    } else {
      log('ℹ️','ALLIANCE',`Status: ${result.status}`);
    }
  } catch(e) {
    log('⚠️','ALLIANCE',e.message);
  }
}

// ── AUTO RESEARCH ─────────────────────────────────────────────
async function doResearch(page) {
  log('🔬','RESEARCH','Checking R&D points...');
  try {
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText });
        };
        xhr.open('GET', 'research.php?mode=auto', true);
        xhr.send();
      });
    });
    log('ℹ️','RESEARCH',`Status: ${result.status}`);
  } catch(e) {
    log('⚠️','RESEARCH',e.message);
  }
}

module.exports = { collectBonus, doMaintenance, contributeAlliance, doResearch };
