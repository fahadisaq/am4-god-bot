// ============================================================
//  BONUS + MAINTENANCE + ALLIANCE MODULE
//  Real AM4 endpoints (captured from live XHR):
//    maintenance_main.php — opens maintenance popup
//    #popContent — the popup container
//    maintDetails(MAINT_ID) — per-aircraft repair page
//    maint_plan.php — Plan Maintenance
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
    // Step 1: Open maintenance popup (CORRECT URL: maintenance_main.php)
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('maintenance_main.php', 'Maintenance', false, false, true);
    });
    await sleep(3000);

    // Step 2: Read stats from #popContent (CORRECT ID)
    const stats = await page.evaluate(() => {
      const pop = document.getElementById('popContent');
      if (!pop) return { error: 'No #popContent found' };
      
      const text = pop.innerText || '';
      const html = pop.innerHTML || '';
      
      const wornMatch = text.match(/worn\s*a\/?c\s*(\d+)/i);
      const acheckMatch = text.match(/a\s*check\s*due\s*(\d+)/i);
      const fleetMatch = text.match(/fleet\s*size\s*(\d+)/i);
      
      // Extract maintDetails IDs — the real maintenance IDs
      const maintIds = [];
      const maintPattern = /maintDetails\s*\(\s*(\d+)\s*\)/gi;
      let m;
      while ((m = maintPattern.exec(html)) !== null) {
        if (!maintIds.includes(m[1])) maintIds.push(m[1]);
      }
      
      return {
        worn: wornMatch ? parseInt(wornMatch[1]) : 0,
        acheckDue: acheckMatch ? parseInt(acheckMatch[1]) : 0,
        fleetSize: fleetMatch ? parseInt(fleetMatch[1]) : 0,
        hasWarning: text.includes('poorly maintained'),
        maintIds,
      };
    });

    if (stats.error) {
      log('⚠️','MAINT', stats.error);
      return;
    }

    log('🔧','MAINT',`Fleet: ${stats.fleetSize} | Worn: ${stats.worn} | A-check due: ${stats.acheckDue}`);
    log('🔍','MAINT',`maintDetails IDs: [${(stats.maintIds || []).join(', ')}]`);

    if (stats.acheckDue > 0 || stats.worn > 0) {
      log('⚠️','MAINT',`${stats.acheckDue} A-checks needed, ${stats.worn} worn aircraft!`);

      // Strategy 1: Trigger "Plan Maintenance" via XHR
      log('🔧','MAINT','Triggering Plan Maintenance...');
      const planResult = await page.evaluate(() => {
        return new Promise(resolve => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function() {
            if (this.readyState === 4) resolve({ status: this.status, text: this.responseText.slice(0, 500) });
          };
          xhr.open('GET', 'maint_plan.php', true);
          xhr.send();
        });
      });
      log('🔧','MAINT',`Plan response: ${planResult.status} | ${planResult.text.slice(0, 150)}`);
      await sleep(1000);

      // Strategy 2: Open each aircraft's repair page via maint_detail.php
      if (stats.maintIds && stats.maintIds.length > 0) {
        log('🔧','MAINT',`Checking repair pages for ${stats.maintIds.length} aircraft...`);
        
        for (const maintId of stats.maintIds) {
          // Step 1: Load the repair details page (CORRECT URL: maintenance_details.php)
          const detail = await page.evaluate((id) => {
            return new Promise(resolve => {
              const xhr = new XMLHttpRequest();
              xhr.onreadystatechange = function() {
                if (this.readyState === 4) {
                  const text = this.responseText;
                  // Find Ajax endpoints in the response
                  const ajaxUrls = [];
                  const ajaxP = /Ajax\s*\(\s*'([^']+)'/gi;
                  let m;
                  while ((m = ajaxP.exec(text)) !== null) ajaxUrls.push(m[1]);
                  
                  // Find onclick handlers with repair actions
                  const onclicks = [];
                  const ocP = /onclick="([^"]*(?:repair|check|plan)[^"]*)"/gi;
                  while ((m = ocP.exec(text)) !== null) onclicks.push(m[1].slice(0, 200));
                  
                  resolve({
                    status: this.status,
                    snippet: text.slice(0, 500),
                    ajaxUrls,
                    onclicks,
                    hasRepair: text.includes('Bulk repair') || text.includes('Plan repair'),
                    hasBulk: text.includes('Bulk repair'),
                  });
                }
              };
              xhr.open('GET', `maintenance_details.php?id=${id}`, true);
              xhr.send();
            });
          }, maintId);
          
          log('🔧','MAINT',`  ID ${maintId}: ${detail.status} | repair=${detail.hasRepair} | bulk=${detail.hasBulk}`);
          if (detail.ajaxUrls.length > 0) log('🔍','MAINT',`  Ajax URLs: ${detail.ajaxUrls.join(' | ')}`);
          if (detail.onclicks.length > 0) log('🔍','MAINT',`  Onclicks: ${detail.onclicks.join(' | ')}`);
          log('🔍','MAINT',`  Response: ${detail.snippet.slice(0, 200)}`);
          
          // Step 2: If repair page loaded, try to call maintDetails() in the browser
          // This loads the repair UI into the popup, then we can click buttons
          if (detail.status === 200 && detail.hasRepair) {
            log('🔧','MAINT',`  Attempting repair for ID ${maintId}...`);
            await page.evaluate((id) => {
              if (typeof maintDetails === 'function') maintDetails(id);
            }, parseInt(maintId));
            await sleep(2000);
            
            // Click any "Plan repair" or "Bulk repair" buttons that appeared
            const repairClick = await page.evaluate(() => {
              const pop = document.getElementById('popContent') || document.getElementById('maintAction');
              if (!pop) return { clicked: 0 };
              let clicked = 0;
              pop.querySelectorAll('button, [onclick]').forEach(b => {
                const t = (b.textContent || '').toLowerCase();
                if (t.includes('plan repair') || t.includes('bulk repair')) {
                  b.click();
                  clicked++;
                }
              });
              return { clicked };
            });
            if (repairClick.clicked > 0) {
              log('✅','MAINT',`  Repair triggered! Clicked ${repairClick.clicked} button(s) for ID ${maintId}`);
            }
          }
          
          await sleep(500);
        }
      }

      // Strategy 3: Click "Plan Maintenance" in the popup UI
      await page.evaluate(() => {
        const pop = document.getElementById('popContent');
        if (!pop) return;
        pop.querySelectorAll('button').forEach(b => {
          const t = (b.textContent || '').toLowerCase();
          if (t.includes('show detail')) b.click();
        });
      });
      await sleep(1500);
      
      const uiClicks = await page.evaluate(() => {
        const pop = document.getElementById('popContent');
        if (!pop) return { clicked: 0 };
        let clicked = 0;
        pop.querySelectorAll('button, [onclick]').forEach(b => {
          const t = (b.textContent || '').toLowerCase();
          const oc = (b.getAttribute('onclick') || '');
          if (t.includes('plan maintenance') || t.includes('plan repair') ||
              t.includes('bulk repair') || oc.includes('maint_plan')) {
            b.click();
            clicked++;
          }
        });
        return { clicked };
      });
      log('🔧','MAINT',`UI buttons clicked: ${uiClicks.clicked}`);

      await tg.send([
        `🔧 <b>Maintenance Report</b>`,
        `✈️ Fleet: ${stats.fleetSize} | ⚠️ Worn: ${stats.worn} | A-check: ${stats.acheckDue}`,
        `🔧 IDs found: ${stats.maintIds?.length || 0} | UI clicks: ${uiClicks.clicked}`,
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

// ── FREE AD REWARD (yodo.php) ─────────────────────────────────
// Captured from: Ajax('yodo.php?reward=4','runme')
// Claims video ad reward without needing to watch the ad
async function claimAdReward(page) {
  log('🎬','AD-REWARD','Claiming free ad reward...');
  try {
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText.slice(0, 300) });
        };
        xhr.open('GET', 'yodo.php?reward=4', true);
        xhr.send();
      });
    });
    
    if (result.status === 200 && result.text.length > 5) {
      log('💰','AD-REWARD',`Reward claimed! Response: ${result.text.slice(0, 150)}`);
    } else {
      log('ℹ️','AD-REWARD',`Status: ${result.status} | ${result.text.slice(0, 100)}`);
    }
  } catch(e) {
    log('⚠️','AD-REWARD',e.message);
  }
}

// ── EVENT REWARDS ─────────────────────────────────────────────
// Check events page for any claimable rewards
async function checkEvents(page) {
  log('🎉','EVENTS','Checking for event rewards...');
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('events_main.php', 'Events');
    });
    await sleep(3000);
    
    const result = await page.evaluate(() => {
      const pop = document.getElementById('popContent');
      if (!pop) return { error: 'No popup' };
      
      const text = pop.innerText || '';
      const html = pop.innerHTML || '';
      
      // Click any "Claim" or "Collect" buttons
      let claimed = 0;
      pop.querySelectorAll('button, [onclick]').forEach(b => {
        const t = (b.textContent || '').toLowerCase();
        const oc = (b.getAttribute('onclick') || '');
        if (t.includes('claim') || t.includes('collect') || t.includes('reward') ||
            oc.includes('claim') || oc.includes('collect')) {
          b.click();
          claimed++;
        }
      });
      
      return {
        text: text.slice(0, 300),
        claimed,
        hasEvents: text.includes('event') || text.includes('Event'),
      };
    });
    
    if (result.error) {
      log('⚠️','EVENTS', result.error);
    } else if (result.claimed > 0) {
      log('🎉','EVENTS',`Claimed ${result.claimed} event reward(s)!`);
    } else {
      log('ℹ️','EVENTS','No claimable rewards found');
    }
    
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
  } catch(e) {
    log('⚠️','EVENTS',e.message);
  }
}

// ── MYSTERY ENDPOINT ──────────────────────────────────────────
// Captured from: Ajax('def227_j22.php','runme')
// Unknown purpose — log response to figure out what it does
async function mysteryEndpoint(page) {
  log('🕵️','MYSTERY','Calling def227_j22.php...');
  try {
    const result = await page.evaluate(() => {
      return new Promise(resolve => {
        const xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
          if (this.readyState === 4) resolve({ status: this.status, text: this.responseText.slice(0, 300) });
        };
        xhr.open('GET', 'def227_j22.php', true);
        xhr.send();
      });
    });
    log('🕵️','MYSTERY',`Status: ${result.status} | Response: ${result.text.slice(0, 200)}`);
  } catch(e) {
    log('⚠️','MYSTERY',e.message);
  }
}

module.exports = { collectBonus, doMaintenance, contributeAlliance, doResearch, claimAdReward, checkEvents, mysteryEndpoint };
