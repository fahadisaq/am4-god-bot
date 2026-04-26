// ============================================================
//  FLEET — Auto Fleet Expansion
//  When bank crosses AUTO_BUY_THRESHOLD, buy cheapest aircraft
// ============================================================

const tg = require('./telegram');

const AUTO_BUY_THRESHOLD = parseInt(process.env.AUTO_BUY_THRESHOLD) || 0; // 0 = disabled
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;

let lastExpansionCheck = 0;
const EXPANSION_CHECK_INTERVAL = 60 * 60 * 1000; // once per hour

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [FLEET] ${msg}`);
}

async function findCheapestAircraft(page) {
  log('🔍', 'Scanning aircraft market...');
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('aircraft.php?mode=market', 'Market', false, false, true);
    });
    await new Promise(r => setTimeout(r, 3000));

    const aircraft = await page.evaluate(() => {
      const items = document.querySelectorAll('.aircraft-item, .market-item, [class*="aircraft"]');
      const results = [];
      items.forEach(item => {
        try {
          const priceEl = item.querySelector('[class*="price"], b, strong');
          const nameEl = item.querySelector('[class*="name"], h4, h3');
          const idAttr = item.getAttribute('data-id') || item.getAttribute('id') || '';

          if (!priceEl || !nameEl) return;
          const priceText = priceEl.innerText || '';
          const price = parseInt(priceText.replace(/[^0-9]/g, ''));
          const name = nameEl.innerText?.trim() || '';

          if (price > 0 && name) {
            results.push({ name, price, id: idAttr });
          }
        } catch(e) {}
      });
      return results.sort((a, b) => a.price - b.price);
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}

    if (aircraft.length === 0) {
      log('⚠️', 'No aircraft found on market page');
      return null;
    }

    log('✅', `Found ${aircraft.length} aircraft. Cheapest: ${aircraft[0].name} at $${aircraft[0].price.toLocaleString()}`);
    return aircraft[0];
  } catch(e) {
    log('❌', `Market scrape failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
    return null;
  }
}

async function purchaseAircraft(page, aircraft) {
  log('🛒', `Attempting to purchase: ${aircraft.name} for $${aircraft.price.toLocaleString()}`);
  try {
    // Click buy on this specific aircraft
    const purchased = await page.evaluate((aircraftId) => {
      // Look for buy button for this aircraft
      const allBtns = document.querySelectorAll('button, [onclick]');
      for (const btn of allBtns) {
        const text = (btn.textContent || '').toLowerCase();
        if (text.includes('buy') || text.includes('purchase')) {
          btn.click();
          return true;
        }
      }
      return false;
    }, aircraft.id);

    if (purchased) {
      await new Promise(r => setTimeout(r, 2000));
      log('✅', `Purchased ${aircraft.name}!`);
      await tg.send(
        `✈️ <b>Fleet Expanded!</b>\n` +
        `🛒 Purchased: ${aircraft.name}\n` +
        `💰 Cost: $${aircraft.price.toLocaleString()}\n` +
        `🏦 Remaining balance after purchase will update next cycle`
      );
      return true;
    } else {
      log('⚠️', 'Could not find buy button for aircraft');
      return false;
    }
  } catch(e) {
    log('❌', `Purchase failed: ${e.message}`);
    return false;
  }
}

async function checkFleetExpansion(page, bankBalance) {
  // Feature is disabled if threshold is 0 or not set
  if (!AUTO_BUY_THRESHOLD || AUTO_BUY_THRESHOLD === 0) {
    return; // Silently skip — user hasn't set threshold
  }

  // Only check once per hour
  if (Date.now() - lastExpansionCheck < EXPANSION_CHECK_INTERVAL) return;
  lastExpansionCheck = Date.now();

  log('✈️', `Fleet expansion check — balance: $${bankBalance.toLocaleString()} | threshold: $${AUTO_BUY_THRESHOLD.toLocaleString()}`);

  if (bankBalance < AUTO_BUY_THRESHOLD) {
    log('ℹ️', `Balance below threshold ($${AUTO_BUY_THRESHOLD.toLocaleString()}) — skipping expansion`);
    return;
  }

  log('💰', `Balance above threshold! Looking for aircraft to buy...`);
  const cheapest = await findCheapestAircraft(page);

  if (!cheapest) {
    log('⚠️', 'No aircraft available for purchase');
    return;
  }

  // Safety: make sure we still have enough left after purchase + MIN_BANK_BALANCE buffer
  const balanceAfter = bankBalance - cheapest.price;
  if (balanceAfter < MIN_BANK_BALANCE * 2) {
    log('⚠️', `Purchase would leave balance too low ($${balanceAfter.toLocaleString()}) — skipping`);
    return;
  }

  await purchaseAircraft(page, cheapest);
}

module.exports = { checkFleetExpansion };
