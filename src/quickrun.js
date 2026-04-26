// ============================================================
//  AM4 GOD BOT — Ultimate Edition v3.0
//  ✅ Auto depart every 5 min
//  ✅ Auto fuel & CO2 (smart price + dip prediction)
//  ✅ Auto daily bonus
//  ✅ Auto maintenance
//  ✅ Telegram two-way commands (/status /pause /buyfuel etc)
//  ✅ Persistent price memory (7-day rolling average)
//  ✅ Daily P&L report (midnight UTC)
//  ✅ Revenue-per-route intelligence
//  ✅ Smart campaign timing (only when needed, once/hour)
//  ✅ Auto fleet expansion (when configured)
//  ✅ Auto re-login on session expiry
//  ✅ Self-loop 5h50m (4 GitHub triggers/day)
// ============================================================

const puppeteer = require('puppeteer');
const { login, ensureLoggedIn } = require('./login');
const { departAll } = require('./depart');
const { checkFuel, checkCO2 } = require('./fuel');
const { collectBonus, doMaintenance, contributeAlliance } = require('./extras');
const { checkFleetExpansion } = require('./fleet');
const { scrapeRoutes, getRouteReport } = require('./routes');
const { checkRanking } = require('./rivals');
// const { checkSmartLoan, checkAndRepayLoan } = require('./loans'); // DISABLED — user has no loan
const { checkScreenshotDashboard } = require('./screenshotDash');
const { checkAndFixRoutes, repairAllAircraft } = require('./routeManager');
const { optimizeAllRoutes } = require('./ticketOptimizer');
const priceMemory = require('./priceMemory');
const reporter = require('./reporter');
const commander = require('./commander');
const tg = require('./telegram');

// ── Config ──
const MIN_CYCLE_MS           = 4  * 60 * 1000 + 20 * 1000; // 4m 20s
const MAX_CYCLE_MS           = 5  * 60 * 1000 + 40 * 1000; // 5m 40s
const FUEL_CHECK_INTERVAL_MS = 30 * 60 * 1000;  // 30 min
const EXTRAS_INTERVAL_MS     = 60 * 60 * 1000;  // 60 min
const SUMMARY_INTERVAL_MS    = 30 * 60 * 1000;  // 30 min
const ROUTE_SCRAPE_INTERVAL  = 2  * 60 * 60 * 1000; // 2 hours
const ROUTE_FIX_INTERVAL     = 2  * 60 * 60 * 1000; // 2 hours
const FLEET_CHECK_INTERVAL   = 60 * 60 * 1000;  // 1 hour
const RIVALS_CHECK_INTERVAL  = 2  * 60 * 60 * 1000; // 2 hours
const TOTAL_RUNTIME_MS       = (5 * 60 + 50) * 60 * 1000; // 5h50m

// Anti-detection: randomise sleep between 4m20s and 5m40s
function randomCycleSleep() {
  const ms = Math.floor(Math.random() * (MAX_CYCLE_MS - MIN_CYCLE_MS + 1)) + MIN_CYCLE_MS;
  const secs = Math.round(ms / 1000);
  log('😴','LOOP',`Anti-detection sleep: ${Math.floor(secs/60)}m ${secs%60}s`);
  return sleep(ms);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

// ════════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════════
async function main() {
  log('🚀','BOT','═══════════════════════════════════════════════');
  log('🚀','BOT','  AM4 GOD BOT — Ultimate Edition v3.0');
  log('🚀','BOT','  5h50m runtime | All god-tier features enabled');
  log('🚀','BOT','═══════════════════════════════════════════════');

  if (!process.env.AM4_EMAIL || !process.env.AM4_PASSWORD) {
    log('❌','BOT','Credentials not set!');
    process.exit(1);
  }

  // ── Load persistent data ──
  priceMemory.loadHistory();
  reporter.loadStats();

  const totalCycles = Math.floor(TOTAL_RUNTIME_MS / ((MIN_CYCLE_MS + MAX_CYCLE_MS) / 2));

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

    let page = await login(browser);
    await tg.started(totalCycles);

    const startTime = Date.now();
    let cycleCount = 0;
    let totalDeparted = 0;
    let lastFuelCheck = 0;
    let lastExtrasCheck = 0;
    let lastSummary = 0;
    let lastRouteScrape = 0;
    let lastRivalsCheck = 0;
    let lastRouteFix = 0;
    let lastFuelPrice = 0;
    let lastCO2Price = 0;

    // Shared state object for commander
    const state = {
      startTime,
      totalRuntime: TOTAL_RUNTIME_MS,
      bankBalance: 0,
      cycleCount: 0,
      totalDeparted: 0,
      forceFuelBuy: false,
    };

    // ── Run startup tasks ──
    log('🎯','BOT','Running startup tasks...');
    await collectBonus(page);
    await sleep(2000);
    await doMaintenance(page);
    await sleep(1000);
    await repairAllAircraft(page);
    await sleep(1000);
    // Fix empty planes on startup
    await checkAndFixRoutes(page);
    await sleep(1000);
    // God-level ticket pricing on startup
    await optimizeAllRoutes(page);
    lastRouteFix = Date.now();
    lastExtrasCheck = Date.now();

    // Initial balance read for reporter
    const startBalance = await page.evaluate(() => {
      const el = document.getElementById('headerAccount');
      return el ? parseInt(el.innerText.replace(/[^0-9]/g,''))||0 : 0;
    });
    reporter.recordSessionStart(startBalance);

    // ── Scrape routes once at start ──
    try {
      await scrapeRoutes(page);
      lastRouteScrape = Date.now();
    } catch(e) {
      log('⚠️','ROUTES',`Initial scrape failed: ${e.message}`);
    }

    // ── MAIN LOOP ──
    while (Date.now() - startTime < TOTAL_RUNTIME_MS) {
      cycleCount++;
      state.cycleCount = cycleCount;
      const elapsed = Math.floor((Date.now()-startTime)/60000);
      const remaining = Math.floor((TOTAL_RUNTIME_MS-(Date.now()-startTime))/60000);
      log('🔄','LOOP',`━━━ Cycle #${cycleCount} | ${elapsed}m elapsed | ${remaining}m left ━━━`);

      // ── Poll Telegram commands ──
      try {
        const commands = await commander.pollCommands();
        for (const cmd of commands) {
          await commander.executeCommand(cmd, page, state, reporter, { getRouteReport });
        }
      } catch(e) {
        log('⚠️','COMMANDER',`Command poll failed: ${e.message}`);
      }

      // ── Skip departures if paused ──
      if (commander.isPaused()) {
        log('⏸','LOOP','Bot is paused — skipping departures this cycle');
        await sleep(60000); // wait 1 min before retrying
        continue;
      }

      // ── Ensure session is alive ──
      try {
        page = await ensureLoggedIn(browser, page);
      } catch(e) {
        log('❌','LOGIN',`Re-login failed: ${e.message}`);
        await tg.loginFailed();
        await sleep(60000);
        continue;
      }

      // ── Get bank balance ──
      const bankBalance = await page.evaluate(() => {
        const el = document.getElementById('headerAccount');
        return el ? parseInt(el.innerText.replace(/[^0-9]/g,''))||0 : 0;
      });
      log('💵','BALANCE',`Bank: $${bankBalance.toLocaleString()}`);
      state.bankBalance = bankBalance;

      // ── Depart flights ──
      try {
        const departed = await departAll(page);
        totalDeparted += departed;
        state.totalDeparted = totalDeparted;
      } catch(e) {
        log('❌','DEPART',e.message);
        await tg.error('DEPART', e.message);
        try { await page.screenshot({ path: '/tmp/am4-error.png', fullPage: true }); } catch(se) {}
      }

      // ── Fuel & CO2 (every 30 min, or forced) ──
      if (state.forceFuelBuy || Date.now() - lastFuelCheck >= FUEL_CHECK_INTERVAL_MS) {
        state.forceFuelBuy = false;
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

      // ── Extras: bonus, maintenance (every 60 min) ──
      if (Date.now() - lastExtrasCheck >= EXTRAS_INTERVAL_MS) {
        try {
          await collectBonus(page);
          await sleep(1000);
          await doMaintenance(page);
          await sleep(1000);
          await contributeAlliance(page);
          lastExtrasCheck = Date.now();
        } catch(e) {
          log('⚠️','EXTRAS',e.message);
        }
      }

      // ── Route intelligence (every 2 hours) ──
      if (Date.now() - lastRouteScrape >= ROUTE_SCRAPE_INTERVAL) {
        try {
          await scrapeRoutes(page);
          lastRouteScrape = Date.now();
        } catch(e) {
          log('⚠️','ROUTES',e.message);
        }
      }

      // ── Competitor rank tracking (every 2 hours) ──
      if (Date.now() - lastRivalsCheck >= RIVALS_CHECK_INTERVAL) {
        try {
          await checkRanking(page);
          lastRivalsCheck = Date.now();
        } catch(e) {
          log('⚠️','RIVALS',e.message);
        }
      }

      // ── Auto fleet expansion (every hour) ──
      try {
        await checkFleetExpansion(page, bankBalance);
      } catch(e) {
        log('⚠️','FLEET',e.message);
      }

      // ── Route health check & seat config fix (every 2 hours) ──
      if (Date.now() - lastRouteFix >= ROUTE_FIX_INTERVAL) {
        try {
          await checkAndFixRoutes(page);
          await sleep(1000);
          await repairAllAircraft(page);
          await sleep(1000);
          // God-level ticket pricing optimization
          await optimizeAllRoutes(page);
          lastRouteFix = Date.now();
        } catch(e) {
          log('⚠️','ROUTES',e.message);
        }
      }

      // ── Screenshot dashboard (every 30 min) ──
      try {
        await checkScreenshotDashboard(page, cycleCount, bankBalance, totalDeparted);
      } catch(e) {
        log('⚠️','SCREENSHOT',e.message);
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
        // Also append market intelligence
        await tg.send(priceMemory.getMarketSummary());
        lastSummary = Date.now();
      }

      // ── Daily P&L report (check once per cycle) ──
      try {
        await reporter.checkDailyReport();
      } catch(e) {
        log('⚠️','REPORTER',e.message);
      }

      // ── Check time remaining ──
      const timeLeft = TOTAL_RUNTIME_MS - (Date.now()-startTime);
      if (timeLeft < MAX_CYCLE_MS) {
        log('🏁','LOOP',`Only ${Math.floor(timeLeft/1000)}s left — ending loop.`);
        break;
      }

      await randomCycleSleep();
    }

    // ── Shutdown ──
    const totalElapsed = Math.floor((Date.now()-startTime)/60000);
    log('🏁','BOT','═══════════════════════════════════════════════');
    log('🏁','BOT',`  Done! ${cycleCount} cycles | ${totalDeparted} flights departed`);
    log('🏁','BOT',`  Runtime: ${totalElapsed} minutes`);
    log('🏁','BOT','═══════════════════════════════════════════════');

    // Final balance read
    const endBalance = await page.evaluate(() => {
      const el = document.getElementById('headerAccount');
      return el ? parseInt(el.innerText.replace(/[^0-9]/g,''))||0 : 0;
    }).catch(() => 0);

    reporter.recordSessionEnd(endBalance, totalDeparted, 0, 0);

    // ── Save persistent data ──
    priceMemory.saveHistory();
    reporter.saveStats();

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
    // Still save data on crash
    priceMemory.saveHistory();
    reporter.saveStats();
    process.exit(1);
  }
}

main();
