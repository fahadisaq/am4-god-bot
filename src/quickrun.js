// ============================================================
//  AM4 GOD BOT — Self-Loop Mode (for GitHub Actions)
//  Logs in ONCE, loops every 5 min for 5h50m, then exits.
//  GitHub Actions triggers every 6 hours (4x/day).
//  No more unreliable cron delays!
// ============================================================

const puppeteer = require('puppeteer');

// ── Config ──
const EMAIL = process.env.AM4_EMAIL;
const PASSWORD = process.env.AM4_PASSWORD;
const FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 500;
const CO2_THRESHOLD = parseInt(process.env.CO2_THRESHOLD) || 120;
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;

const CYCLE_INTERVAL_MS = 5 * 60 * 1000;          // 5 min between depart cycles
const FUEL_CHECK_INTERVAL_MS = 30 * 60 * 1000;    // 30 min between fuel/CO2 checks
const TOTAL_RUNTIME_MS = (5 * 60 + 50) * 60 * 1000; // 5h50m total

// ── Helpers ──
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// ════════════════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════════════════
async function login(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    ['image','stylesheet','font','media'].includes(req.resourceType()) ? req.abort() : req.continue();
  });

  log('🔑','LOGIN','Navigating to AM4...');
  await page.goto('https://www.airlinemanager.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  log('🔑','LOGIN',`Page: "${await page.title()}" at ${page.url()}`);

  // Dismiss cookie consent
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,div')) {
      const t = (el.textContent||'').toLowerCase();
      if (t.includes('accept')||t.includes('agree')||t.includes('consent')||t.includes('got it')) { el.click(); break; }
    }
  });
  await sleep(1000);

  // Click login button
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,div[onclick],span[onclick]')) {
      const t = (el.textContent||'').toLowerCase().trim();
      if (t==='login'||t==='log in'||t==='sign in'||t.includes('existing')||t==='play now') { el.click(); return; }
    }
    const btns = document.querySelectorAll('button');
    if (btns.length >= 2) btns[1].click();
  });
  await sleep(2000);

  // Wait for login form
  let found = false;
  for (let i = 0; i < 10; i++) {
    found = await page.evaluate(() => !!document.getElementById('lEmail'));
    if (found) break;
    await sleep(1000);
    log('🔑','LOGIN',`Waiting for form... (${i+1}/10)`);
  }
  if (!found) {
    await page.goto('https://www.airlinemanager.com/login.php', { waitUntil: 'networkidle2', timeout: 15000 });
    await sleep(2000);
  }

  // Fill credentials
  await page.evaluate((email, password) => {
    const e = document.getElementById('lEmail');
    const p = document.getElementById('lPass');
    const r = document.getElementById('remember');
    if (e) { e.value = email; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
    if (p) { p.value = password; p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true})); }
    if (r && !r.checked) r.click();
  }, EMAIL, PASSWORD);
  await sleep(500);

  await page.evaluate(() => { const b = document.getElementById('btnLogin'); if (b) b.click(); });
  log('🔑','LOGIN','Submitted — waiting for game...');
  await sleep(8000);

  const loggedIn = await page.evaluate(() =>
    !!document.getElementById('headerAccount') || !!document.getElementById('listDepartAmount')
  );
  if (!loggedIn) throw new Error('Login verification failed');
  log('✅','LOGIN','Login successful!');
  return page;
}

// ════════════════════════════════════════════════════════════
//  DEPART CYCLE (every 5 min)
// ════════════════════════════════════════════════════════════
async function runDepartCycle(page) {
  // Eco campaign
  try {
    await page.evaluate(() => new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.onreadystatechange = () => { if (x.readyState===4) resolve(x.status); };
      x.open('GET','marketing_new.php?type=5&mode=do&c=1',true); x.send();
    }));
    log('✅','CAMPAIGN','Eco campaign started');
  } catch(e) { log('⚠️','CAMPAIGN',e.message); }

  await sleep(rand(800,1500));

  // Reputation campaign
  const hoursLeft = 24 - new Date().getHours();
  const repOption = hoursLeft<=3?1 : hoursLeft<=7?2 : hoursLeft<=11?3 : hoursLeft<=15?4 : 0;
  if (repOption > 0) {
    try {
      await page.evaluate(opt => new Promise(resolve => {
        const x = new XMLHttpRequest();
        x.onreadystatechange = () => { if (x.readyState===4) resolve(x.status); };
        x.open('GET',`marketing_new.php?type=1&c=4&mode=do&d=${opt}`,true); x.send();
      }), repOption);
      log('✅','CAMPAIGN',`Reputation campaign (opt ${repOption}) started`);
    } catch(e) { log('⚠️','CAMPAIGN',e.message); }
  }

  await sleep(rand(1000,2000));

  // Depart
  log('✈️','DEPART','Checking flights...');
  try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); await sleep(500); } catch(e) {}

  let toDepart = await page.evaluate(() => {
    const el = document.getElementById('listDepartAmount');
    return el ? parseInt(el.innerText.trim())||0 : 0;
  });

  if (toDepart > 0) {
    log('✈️','DEPART',`${toDepart} flight(s) ready!`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = toDepart;
      try {
        await page.evaluate(() => {
          const el = document.getElementById('listDepartAmount');
          if (el?.parentElement) {
            window.depAllAirc = true;
            typeof window.Ajax==='function'
              ? window.Ajax('route_depart.php?mode=all&ids=x','runme',el.parentElement)
              : el.parentElement.click();
          }
        });
      } catch(e) { log('⚠️','DEPART',e.message); }

      await sleep(5000);
      toDepart = await page.evaluate(() => {
        const el = document.getElementById('listDepartAmount');
        return el?.innerText.trim() ? parseInt(el.innerText.trim())||0 : 0;
      });
      if (before - toDepart > 0) log('✅','DEPART',`Attempt ${attempt}: Departed ${before-toDepart}!`);
      if (toDepart <= 0) break;
      try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
      await sleep(1500);
    }
    log(toDepart<=0?'✅':'❌','DEPART', toDepart<=0?'All departed!': `${toDepart} failed to depart`);
  } else {
    log('ℹ️','DEPART','No flights to depart');
  }
}

// ════════════════════════════════════════════════════════════
//  FUEL + CO2 CYCLE (every 30 min)
// ════════════════════════════════════════════════════════════
async function runFuelCO2Cycle(page, bankBalance) {
  // FUEL
  log('⛽','FUEL','Checking fuel...');
  try {
    await page.evaluate(() => { if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true); });
    await sleep(2500);
    const fd = await page.evaluate(() => {
      const el = document.getElementById('fuelMain'); if (!el) return null;
      let price=''; for (const b of el.querySelectorAll('b')) { if (b.innerText.includes('$')) { price=b.innerText; break; } }
      const cap = document.getElementById('remCapacity');
      return { price, capacity: cap?cap.innerText:'' };
    });
    if (fd?.price) {
      const price = parseInt(fd.price.replace(/[^0-9]/g,''));
      const cap = parseInt((fd.capacity||'0').replace(/[^0-9]/g,''))||0;
      log('⛽','FUEL',`Price: $${price} | Cap: ${cap.toLocaleString()}`);
      if (price <= FUEL_THRESHOLD && cap > 0) {
        const toBuy = Math.min(Math.floor(Math.max(0,bankBalance-MIN_BANK_BALANCE)/price*1000), cap);
        if (toBuy > 10) {
          await page.evaluate(a => { const i=document.getElementById('amountInput'); if(i){i.value=a; i.dispatchEvent(new Event('input',{bubbles:true}));} }, toBuy);
          await sleep(500);
          await page.evaluate(() => {
            const el=document.getElementById('fuelMain'); if(!el) return;
            const btns=el.querySelectorAll('button');
            for (const b of btns) { if (b.textContent.toLowerCase().includes('buy')||b.classList.contains('btn-success')||b.classList.contains('btn-primary')) { b.click(); return; } }
            if (btns.length) btns[btns.length-1].click();
          });
          await sleep(1500);
          log('✅','FUEL',`Bought ${toBuy.toLocaleString()} lbs!`);
        } else { log('⚠️','FUEL','Budget protection active'); }
      } else { log('ℹ️','FUEL',`$${price} > threshold — skip`); }
    }
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
  } catch(e) {
    log('❌','FUEL',e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
  }

  await sleep(rand(2000,4000));

  // CO2
  log('🌿','CO2','Checking CO2...');
  try {
    await page.evaluate(() => { if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true); });
    await sleep(2000);
    await page.evaluate(() => { const b=document.getElementById('popBtn2'); if(b) b.click(); });
    await sleep(1500);
    const cd = await page.evaluate(() => {
      const el = document.getElementById('co2Main'); if (!el) return null;
      let price=''; for (const b of el.querySelectorAll('b')) { if (b.innerText.includes('$')) { price=b.innerText; break; } }
      const cap = document.getElementById('remCapacity');
      return { price, capacity: cap?cap.innerText:'' };
    });
    if (cd?.price) {
      const price = parseInt(cd.price.replace(/[^0-9]/g,''));
      const cap = parseInt((cd.capacity||'0').replace(/[^0-9]/g,''))||0;
      log('🌿','CO2',`Price: $${price} | Cap: ${cap.toLocaleString()}`);
      if (price <= CO2_THRESHOLD && cap > 0) {
        const toBuy = Math.min(Math.floor(Math.max(0,bankBalance-MIN_BANK_BALANCE)/price*1000), cap);
        if (toBuy > 10) {
          await page.evaluate(a => { const i=document.getElementById('amountInput'); if(i){i.value=a; i.dispatchEvent(new Event('input',{bubbles:true}));} }, toBuy);
          await sleep(500);
          await page.evaluate(() => {
            const el=document.getElementById('co2Main'); if(!el) return;
            const btns=el.querySelectorAll('button');
            for (const b of btns) { if (b.textContent.toLowerCase().includes('buy')||b.classList.contains('btn-success')) { b.click(); return; } }
            if (btns.length) btns[btns.length-1].click();
          });
          await sleep(1500);
          log('✅','CO2',`Bought ${toBuy.toLocaleString()} CO2!`);
        }
      } else { log('ℹ️','CO2',`$${price} > threshold — skip`); }
    }
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
  } catch(e) {
    log('❌','CO2',e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
  }
}

// ════════════════════════════════════════════════════════════
//  MAIN — Self-loop for 5h50m
// ════════════════════════════════════════════════════════════
async function main() {
  log('🚀','BOT','═══════════════════════════════════════════════');
  log('🚀','BOT','  AM4 GOD BOT — Self-Loop Mode');
  log('🚀','BOT','  5h50m runtime | 5min depart | 30min fuel');
  log('🚀','BOT','═══════════════════════════════════════════════');

  if (!EMAIL || !PASSWORD) { log('❌','BOT','Credentials not set!'); process.exit(1); }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
             '--disable-accelerated-2d-canvas','--disable-gpu','--window-size=1920,1080'],
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await login(browser);
    const startTime = Date.now();
    let cycleCount = 0;
    let lastFuelCheck = 0;

    while (Date.now() - startTime < TOTAL_RUNTIME_MS) {
      cycleCount++;
      const elapsed = Math.floor((Date.now()-startTime)/60000);
      const remaining = Math.floor((TOTAL_RUNTIME_MS-(Date.now()-startTime))/60000);
      log('🔄','LOOP',`━━━ Cycle #${cycleCount} | ${elapsed}m elapsed | ${remaining}m left ━━━`);

      const bankBalance = await page.evaluate(() => {
        const el = document.getElementById('headerAccount');
        return el ? parseInt(el.innerText.replace(/[^0-9]/g,''))||0 : 0;
      });
      log('💵','BALANCE',`Bank: $${bankBalance.toLocaleString()}`);

      await runDepartCycle(page);

      if (Date.now() - lastFuelCheck >= FUEL_CHECK_INTERVAL_MS) {
        await runFuelCO2Cycle(page, bankBalance);
        lastFuelCheck = Date.now();
      } else {
        log('ℹ️','FUEL',`Next fuel check in ~${Math.ceil((FUEL_CHECK_INTERVAL_MS-(Date.now()-lastFuelCheck))/60000)}m`);
      }

      const timeLeft = TOTAL_RUNTIME_MS - (Date.now()-startTime);
      if (timeLeft < CYCLE_INTERVAL_MS) { log('🏁','LOOP',`${Math.floor(timeLeft/1000)}s left — ending.`); break; }

      log('😴','LOOP','Sleeping 5 minutes...');
      await sleep(CYCLE_INTERVAL_MS);
    }

    log('🏁','BOT','═══════════════════════════════════════════════');
    log('🏁','BOT',`  Done! ${cycleCount} cycles completed.`);
    log('🏁','BOT','  GitHub retriggering in ~10 minutes.');
    log('🏁','BOT','═══════════════════════════════════════════════');

    await browser.close();
    process.exit(0);
  } catch(err) {
    log('❌','BOT',`FATAL: ${err.message}`);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
