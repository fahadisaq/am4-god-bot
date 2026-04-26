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
      
      // Parse the stats: "Fleet size 97  At hub 11  Worn A/C 18  A check due 3"
      const wornMatch = text.match(/worn\s*a\/?c\s*(\d+)/i);
      const acheckMatch = text.match(/a\s*check\s*due\s*(\d+)/i);
      const fleetMatch = text.match(/fleet\s*size\s*(\d+)/i);
      
      return {
        worn: wornMatch ? parseInt(wornMatch[1]) : 0,
        acheckDue: acheckMatch ? parseInt(acheckMatch[1]) : 0,
        fleetSize: fleetMatch ? parseInt(fleetMatch[1]) : 0,
        hasWarning: text.toLowerCase().includes('poorly maintained') || text.toLowerCase().includes('warning'),
        textSnippet: text.slice(0, 300),
      };
    });

    log('🔧','MAINT',`Fleet: ${stats.fleetSize} | Worn: ${stats.worn} | A-check due: ${stats.acheckDue}`);

    if (stats.acheckDue > 0 || stats.worn > 0) {
      log('⚠️','MAINT',`${stats.acheckDue} A-checks needed, ${stats.worn} worn aircraft!`);
      
      // Step 2: Click "Show details" to expand the list
      await page.evaluate(() => {
        const popup = document.getElementById('popMain') || document.querySelector('.popup-content');
        if (!popup) return;
        
        const btns = popup.querySelectorAll('button, a, [onclick], .btn');
        for (const b of btns) {
          const t = (b.textContent || '').toLowerCase();
          if (t.includes('show detail') || t.includes('details')) {
            b.click();
            break;
          }
        }
      });
      await sleep(2000);
      
      // Step 3: Click all A-check / repair buttons
      const repairResult = await page.evaluate(() => {
        const popup = document.getElementById('popMain') || document.querySelector('.popup-content');
        if (!popup) return { clicked: 0 };
        
        let clicked = 0;
        const btns = popup.querySelectorAll('button, a.btn, [onclick], .btn');
        
        for (const b of btns) {
          const t = (b.textContent || '').toLowerCase();
          const onclick = (b.getAttribute('onclick') || '').toLowerCase();
          
          // Click any A-check, repair, or maintain button
          if (t.includes('a-check') || t.includes('a check') || 
              t.includes('repair') || t.includes('maintain') ||
              onclick.includes('acheck') || onclick.includes('maintenance') ||
              onclick.includes('repair')) {
            b.click();
            clicked++;
          }
        }
        
        return { clicked };
      });
      
      log('🔧','MAINT',`Clicked ${repairResult.clicked} repair/A-check buttons`);
      await sleep(2000);
      
      // Step 4: Also try the bulk A-check AJAX endpoint
      const bulkResult = await page.evaluate(() => {
        return new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function() {
            if (this.readyState === 4) {
              resolve({ status: this.status, text: this.responseText.slice(0, 200) });
            }
          };
          // Try bulk A-check endpoint
          xhr.open('GET', 'maintenance.php?mode=do_all', true);
          xhr.send();
        });
      });
      
      log('🔧','MAINT',`Bulk A-check response: ${bulkResult.status}`);
      
      await tg.send([
        `🔧 <b>Maintenance Alert!</b>`,
        `✈️ Fleet: ${stats.fleetSize} aircraft`,
        `⚠️ Worn: ${stats.worn}`,
        `🔧 A-checks due: ${stats.acheckDue}`,
        `✅ Repair buttons clicked: ${repairResult.clicked}`,
        `📊 Bulk repair status: ${bulkResult.status}`,
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
