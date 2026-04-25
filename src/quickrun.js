// ============================================================
//  AM4 GOD BOT — Ultimate Edition
//  ✅ Auto depart every 5 min
//  ✅ Auto fuel & CO2 every 30 min
//  ✅ Auto daily bonus
//  ✅ Auto maintenance
//  ✅ Auto alliance contribution
//  ✅ Telegram notifications
//  ✅ Auto re-login on session expiry
//  ✅ Screenshot on error
//  ✅ Smart price tracking
//  ✅ Self-loop 5h50m (4 GitHub triggers/day)
// ============================================================

const puppeteer = require('puppeteer');
const { login, ensureLoggedIn } = require('./login');
const { departAll } = require('./depart');
const { checkFuel, checkCO2 } = require('./fuel');
const { collectBonus, doMaintenance, contributeAlliance } = require('./extras');
const tg = require('./telegram');

// ── Config ──
const CYCLE_INTERVAL_MS      = 5  * 60 * 1000;  // 5 min
const FUEL_CHECK_INTERVAL_MS = 30 * 60 * 1000;  // 30 min
const EXTRAS_INTERVAL_MS     = 60 * 60 * 1000;  // 60 min
const SUMMARY_INTERVAL_MS    = 30 * 60 * 1000;  // 30 min
const TOTAL_RUNTIME_MS       = (5 * 60 + 50) * 60 * 1000; // 5h50m

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  log('🚀','BOT','═══════════════════════════════════════════════');
  log('🚀','BOT','  AM4 GOD BOT — Ultimate Edition');
  log('🚀','BOT','  5h50m runtime | All features enabled');
  log('🚀','BOT','═══════════════════════════════════════════════');

  if (!process.env.AM4_EMAIL || !process.env.AM4_PASSWORD) {
    log('❌','BOT','Credentials not set!');
    process.exit(1);
  }

  // Calculate total cycles for Telegram message
  const totalCycles = Math.floor(TOTAL_RUNTIME_MS / CYCLE_INTERVAL_MS);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas','--disable-gpu','--window-size=1920,1080',
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    // Login once
    let page = await login(browser);
    await tg.started(totalCycles);

    const startTime = Date.now();
    let cycleCount = 0;
    let totalDeparted = 0;
    let lastFuelCheck = 0;
    let lastExtrasCheck = 0;
    let lastSummary = 0;
    let lastFuelPrice = 0;
    let lastCO2Price = 0;

    // ── Run extras once at start ──
    log('🎯','BOT','Running startup tasks...');
    await collectBonus(page);
    await sleep(2000);
    await contributeAlliance(page);
    await sleep(2000);
    await doMaintenance(page);
    lastExtrasCheck = Date.now();

    // ── MAIN LOOP ──
    while (Date.now() - startTime < TOTAL_RUNTIME_MS) {
      cycleCount++;
      const elapsed = Math.floor((Date.now()-startTime)/60000);
      const remaining = Math.floor((TOTAL_RUNTIME_MS-(Date.now()-startTime))/60000);
      log('🔄','LOOP',`━━━ Cycle #${cycleCount} | ${elapsed}m elapsed | ${remaining}m left ━━━`);

      // ── Ensure session is alive (auto re-login) ──
      try {
        page = await ensureLoggedIn(browser, page);
      } catch(e) {
        log('❌','LOGIN',`Re-login failed: ${e.message}`);
        await tg.loginFailed();
        await sleep(60000); // wait 1 min before retrying
        continue;
      }

      // ── Get bank balance ──
      const bankBalance = await page.evaluate(() => {
        const el = document.getElementById('headerAccount');
        return el ? parseInt(el.innerText.replace(/[^0-9]/g,''))||0 : 0;
      });
      log('💵','BALANCE',`Bank: $${bankBalance.toLocaleString()}`);

      // ── Depart flights (every cycle) ──
      try {
        const departed = await departAll(page);
        totalDeparted += departed;
      } catch(e) {
        log('❌','DEPART',e.message);
        await tg.error('DEPART', e.message);
        try {
          await page.screenshot({ path: '/tmp/am4-error.png', fullPage: true });
        } catch(se) {}
      }

      // ── Fuel & CO2 (every 30 min) ──
      if (Date.now() - lastFuelCheck >= FUEL_CHECK_INTERVAL_MS) {
        try {
          lastFuelPrice = await checkFuel(page, bankBalance) || lastFuelPrice;
          await sleep(2000);
          lastCO2Price = await checkCO2(page, bankBalance) || lastCO2Price;
          lastFuelCheck = Date.now();
        } catch(e) {
          log('❌','FUEL/CO2',e.message);
          await tg.error('FUEL/CO2', e.message);
        }
      } else {
        const nextFuel = Math.ceil((FUEL_CHECK_INTERVAL_MS-(Date.now()-lastFuelCheck))/60000);
        log('ℹ️','FUEL',`Next check in ~${nextFuel}m`);
      }

      // ── Extras: bonus, maintenance, alliance (every 60 min) ──
      if (Date.now() - lastExtrasCheck >= EXTRAS_INTERVAL_MS) {
        try {
          await collectBonus(page);
          await sleep(1000);
          await contributeAlliance(page);
          await sleep(1000);
          await doMaintenance(page);
          lastExtrasCheck = Date.now();
        } catch(e) {
          log('⚠️','EXTRAS',e.message);
        }
      }

      // ── Telegram summary (every 30 min) ──
      if (Date.now() - lastSummary >= SUMMARY_INTERVAL_MS) {
        await tg.cycleSummary({
          balance: bankBalance,
          departed: totalDeparted,
          fuelPrice: lastFuelPrice,
          co2Price: lastCO2Price,
          cycle: cycleCount,
          elapsed: elapsed
        });
        lastSummary = Date.now();
      }

      // ── Check time remaining ──
      const timeLeft = TOTAL_RUNTIME_MS - (Date.now()-startTime);
      if (timeLeft < CYCLE_INTERVAL_MS) {
        log('🏁','LOOP',`Only ${Math.floor(timeLeft/1000)}s left — ending loop.`);
        break;
      }

      log('😴','LOOP','Sleeping 5 minutes...');
      await sleep(CYCLE_INTERVAL_MS);
    }

    const totalElapsed = Math.floor((Date.now()-startTime)/60000);
    log('🏁','BOT','═══════════════════════════════════════════════');
    log('🏁','BOT',`  Done! ${cycleCount} cycles | ${totalDeparted} flights departed`);
    log('🏁','BOT',`  Runtime: ${totalElapsed} minutes`);
    log('🏁','BOT','═══════════════════════════════════════════════');

    await tg.finished(cycleCount, totalElapsed);
    await browser.close();
    process.exit(0);

  } catch(err) {
    log('❌','BOT',`FATAL: ${err.message}`);
    await tg.error('FATAL', err.message);
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages[0]) await pages[0].screenshot({ path: '/tmp/am4-fatal.png', fullPage: true });
      } catch(se) {}
      await browser.close();
    }
    process.exit(1);
  }
}

main();
