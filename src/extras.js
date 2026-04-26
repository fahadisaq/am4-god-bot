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

    // Check maintenance status and click repair
    const result = await page.evaluate(() => {
      // Try multiple containers
      const containers = [
        document.getElementById('maintMain'),
        document.getElementById('popMain'),
        document.querySelector('.popup-content'),
        document.querySelector('.modal-body'),
      ].filter(Boolean);

      if (containers.length === 0) return { count: 0, error: 'No container found' };

      const container = containers[0];
      const text = container.innerText || '';

      // Count aircraft needing maintenance
      const needsMaint = container.querySelectorAll(
        '.maint-needed, .text-danger, [data-maint="needed"], .warning, .text-warning, tr.danger'
      );
      
      // Also check text for percentage indicators < 100%
      const percentMatches = text.match(/\d+%/g) || [];
      const lowPercent = percentMatches.filter(p => parseInt(p) < 80).length;

      const count = Math.max(needsMaint.length, lowPercent);

      // Try to find and click maintain-all button
      let clicked = false;
      const allBtns = container.querySelectorAll('button, a.btn, [onclick]');
      for (const b of allBtns) {
        const btnText = (b.textContent || '').toLowerCase();
        if (btnText.includes('maintain all') || btnText.includes('fix all') ||
            btnText.includes('repair all') || btnText.includes('check all') ||
            (btnText.includes('all') && btnText.includes('maint'))) {
          b.click();
          clicked = true;
          break;
        }
      }

      return { count, clicked, debug: text.slice(0, 200) };
    });

    if (result.count > 0) {
      log('🔧','MAINT',`${result.count} aircraft need maintenance (clicked: ${result.clicked})`);
      if (result.clicked) {
        await sleep(2000);
        log('✅','MAINT','Maintenance done!');
        await tg.maintenanceDone(result.count);
      }
    } else {
      log('ℹ️','MAINT','All aircraft in good condition');
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
