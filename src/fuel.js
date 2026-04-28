// ============================================================
//  FUEL & CO2 MODULE — v2.1 Smart Buying Strategy
//  ✅ Uses direct fuel.php?mode=do XHR (no brittle UI clicks)
//  ✅ BULK mode: fills tank when price is cheap (<$700)
//  ✅ SURVIVAL mode: buys SMALL amount when tank <20% (any price)
//  ✅ Integrates predictDip() for smart buying
// ============================================================

const tg = require('./telegram');
const priceMemory = require('./priceMemory');

const FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 700;   // Bulk buy only when cheap
const CO2_THRESHOLD = parseInt(process.env.CO2_THRESHOLD) || 110;
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;
const CRITICAL_TANK_PCT = 0.20;   // Below 20% = survival buy kicks in
const SURVIVAL_FILL_PCT = 0.25;   // In survival mode, buy just enough to reach 25% (was 30%)
const SURVIVAL_BANK_FLOOR = 1000000; // NEVER let bank go below $1M for fuel
const SURVIVAL_COOLDOWN = 60 * 60 * 1000; // Only survival-buy once per hour
let lastSurvivalBuy = 0; // Timestamp of last survival purchase

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11, 19)}] [${module}] ${msg}`);
}

/**
 * Read fuel market data by opening the fuel popup and parsing it.
 * Returns { fuelPrice, fuelCapacity, co2Price, co2Capacity, fuelStored, co2Stored }
 */
async function readFuelData(page) {
  // Open fuel popup
  await page.evaluate(() => {
    if (typeof popup === 'function') popup('fuel.php', 'Fuel', false, false, true);
  });
  await sleep(3000);

  const data = await page.evaluate(() => {
    // Look in popup container
    const container = document.getElementById('fuelMain')
      || document.getElementById('popMain')
      || document.querySelector('.popup-content, .modal-body, #popContent');

    if (!container) {
      return { error: 'No fuel container found', debug: document.body.innerText.slice(0, 300) };
    }

    const allText = container.innerText;

    // ── Parse fuel price ──
    let fuelPrice = 0;
    const priceMatch = allText.match(/\$\s*(\d[\d,]*)/);
    if (priceMatch) fuelPrice = parseInt(priceMatch[1].replace(/,/g, ''));
    if (!fuelPrice) {
      for (const b of container.querySelectorAll('b, strong, .price, [class*="price"]')) {
        const m = b.innerText.match(/\$\s*(\d[\d,]*)/);
        if (m) { fuelPrice = parseInt(m[1].replace(/,/g, '')); break; }
      }
    }

    // ── Parse remaining capacity ──
    let fuelCapacity = 0;
    const capEl = document.getElementById('remCapacity');
    if (capEl) {
      fuelCapacity = parseInt(capEl.innerText.replace(/[^0-9]/g, '')) || 0;
    } else {
      const capMatch = allText.match(/(?:remaining|capacity)[:\s]*([\d,]+)/i);
      if (capMatch) fuelCapacity = parseInt(capMatch[1].replace(/,/g, ''));
    }

    // ── Parse stored amount (for critical mode) ──
    let fuelStored = 0;
    const storedMatch = allText.match(/(?:stored|current)[:\s]*([\d,]+)\s*(?:lbs|kg)?/i);
    if (storedMatch) fuelStored = parseInt(storedMatch[1].replace(/,/g, ''));

    // ── Parse total capacity (for % calculation) ──
    let totalCapacity = 0;
    const totalMatch = allText.match(/(?:total|max)\s*(?:capacity)?[:\s]*([\d,]+)/i);
    if (totalMatch) totalCapacity = parseInt(totalMatch[1].replace(/,/g, ''));

    return {
      fuelPrice,
      fuelCapacity,  // remaining capacity (how much MORE we can buy)
      fuelStored,
      totalCapacity,
      containerText: allText.slice(0, 400),
    };
  });

  // Close popup
  try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e) { }

  return data;
}

/**
 * Buy fuel using direct XHR to fuel.php?mode=do
 * This bypasses all the fragile UI button-clicking.
 */
async function buyFuelDirect(page, amount) {
  const result = await page.evaluate(async (qty) => {
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (this.readyState === 4) {
          resolve({
            status: this.status,
            text: this.responseText.slice(0, 500),
            ok: this.status === 200
          });
        }
      };
      // AM4's fuel buy endpoint
      xhr.open('GET', `fuel.php?mode=do&amount=${qty}&fbSig=false`, true);
      xhr.send();
    });
  }, amount);

  return result;
}

/**
 * Buy CO2 using direct XHR to fuel.php (CO2 tab)
 */
async function buyCO2Direct(page, amount) {
  const result = await page.evaluate(async (qty) => {
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.onreadystatechange = function () {
        if (this.readyState === 4) {
          resolve({
            status: this.status,
            text: this.responseText.slice(0, 500),
            ok: this.status === 200
          });
        }
      };
      // AM4's CO2 buy endpoint
      xhr.open('GET', `co2.php?mode=do&amount=${qty}&fbSig=false`, true);
      xhr.send();
    });
  }, amount);

  return result;
}


// ════════════════════════════════════════════════════════════
//  MAIN FUEL CHECK
// ════════════════════════════════════════════════════════════
async function checkFuel(page, bankBalance) {
  log('⛽', 'FUEL', 'Checking fuel...');
  try {
    const fd = await readFuelData(page);

    if (fd?.error) {
      log('⚠️', 'FUEL', fd.error);
      log('🔍', 'FUEL', `Debug: ${fd.debug?.slice(0, 200)}`);
      return null;
    }

    const price = fd.fuelPrice;
    const cap = fd.fuelCapacity;
    const stored = fd.fuelStored;
    const totalCap = fd.totalCapacity || (stored + cap);

    if (!price) {
      log('⚠️', 'FUEL', `Could not read fuel price. Page text: ${fd.containerText?.slice(0, 150)}`);
      return null;
    }

    log('⛽', 'FUEL', `Price: $${price} | Remaining cap: ${cap.toLocaleString()} | Stored: ${stored.toLocaleString()} | Total cap: ${totalCap.toLocaleString()}`);

    // Record to persistent price memory
    priceMemory.recordPrice('fuel', price);

    // ── Decide whether to buy ──
    const tankPct = totalCap > 0 ? stored / totalCap : 1;
    const isCritical = tankPct < CRITICAL_TANK_PCT;
    const isDip = priceMemory.predictDip('fuel', price);
    const isBelowThreshold = price <= FUEL_THRESHOLD;

    // Determine buy mode:
    //   BULK   = price is cheap (or dip) → fill as much as possible
    //   SURVIVAL = price is expensive BUT tank is dangerously low → buy JUST enough to keep flying
    //   SKIP   = price is expensive and tank is fine → wait for cheaper prices
    //   EMERGENCY = bank is broke AND tank is 0% → buy TINY amount just to keep some planes flying
    let buyMode = 'SKIP';
    if ((isBelowThreshold || isDip) && cap > 0) {
      buyMode = 'BULK';
    } else if (isCritical && cap > 0) {
      // SURVIVAL checks:
      // 1. Bank must be above $1M floor for normal survival
      // 2. Must wait 1 hour between survival buys (prevent drain)
      const timeSinceLastSurvival = Date.now() - lastSurvivalBuy;
      if (bankBalance < SURVIVAL_BANK_FLOOR) {
        // Bank is below $1M — but if tank is literally 0%, we MUST buy a tiny amount
        // or the airline dies completely (no flights = no revenue = game over)
        if (stored === 0 && bankBalance > 50000) {
          buyMode = 'EMERGENCY';
          log('🆘', 'FUEL', `EMERGENCY: Bank low ($${bankBalance.toLocaleString()}) but tank is EMPTY! Buying tiny amount to keep airline alive`);
        } else {
          log('🛑', 'FUEL', `Bank $${bankBalance.toLocaleString()} is below $1M floor — REFUSING to buy expensive fuel!`);
          buyMode = 'SKIP';
        }
      } else if (timeSinceLastSurvival < SURVIVAL_COOLDOWN) {
        const minsLeft = Math.round((SURVIVAL_COOLDOWN - timeSinceLastSurvival) / 60000);
        log('⏳', 'FUEL', `Survival cooldown: ${minsLeft}m left — skipping to prevent bank drain`);
        buyMode = 'SKIP';
      } else {
        buyMode = 'SURVIVAL';
      }
    }

    log('📊', 'FUEL', `Tank: ${Math.round(tankPct * 100)}% | Mode: ${buyMode} | Price: $${price} | Bank: $${bankBalance.toLocaleString()} | Threshold: $${FUEL_THRESHOLD}`);

    if (buyMode !== 'SKIP') {
      let toBuy = 0;

      if (buyMode === 'BULK') {
        // BULK: price is good — buy as much as we can afford (keep MIN_BANK_BALANCE reserve)
        let affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
        if (affordReserve === 0 && bankBalance > 10000) {
          affordReserve = Math.floor(bankBalance / 2);
        }
        const canAfford = Math.floor(affordReserve / price * 1000);
        toBuy = Math.min(canAfford, cap);
        log('🛢', 'FUEL', `BULK BUY: Price is good! Buying up to ${toBuy.toLocaleString()} lbs`);

      } else if (buyMode === 'SURVIVAL') {
        // SURVIVAL: price is high but we NEED fuel to keep planes flying
        // Only buy enough to get from current level to 25%
        const targetFuel = Math.floor(totalCap * SURVIVAL_FILL_PCT);
        const needed = Math.max(0, targetFuel - stored);
        // Cap spending at 5% of bank (was 15%) — preserve cash!
        const maxSpend = Math.floor(bankBalance * 0.05);
        // Also enforce the bank floor
        const maxBeforeFloor = Math.max(0, bankBalance - SURVIVAL_BANK_FLOOR);
        const actualMaxSpend = Math.min(maxSpend, maxBeforeFloor);
        const canAfford = Math.floor(actualMaxSpend / price * 1000);
        toBuy = Math.min(needed, canAfford, cap);
        lastSurvivalBuy = Date.now();
        log('🚨', 'FUEL', `SURVIVAL BUY: Tank at ${Math.round(tankPct * 100)}%! Spending max $${actualMaxSpend.toLocaleString()} (5% of bank, floor $1M)`);

      } else if (buyMode === 'EMERGENCY') {
        // EMERGENCY: bank is broke but tank is EMPTY — buy just enough for a few flights
        // Max spend: $50K or 2% of bank, whichever is less
        const emergencyBudget = Math.min(50000, Math.floor(bankBalance * 0.02));
        const canAfford = Math.floor(emergencyBudget / price * 1000);
        toBuy = Math.min(canAfford, cap);
        lastSurvivalBuy = Date.now();
        log('🆘', 'FUEL', `EMERGENCY BUY: Spending max $${emergencyBudget.toLocaleString()} (just enough for a few flights to earn revenue)`);
      }

      if (toBuy > 10) {
        log('🛢', 'FUEL', `BUYING ${toBuy.toLocaleString()} lbs at $${price} [${buyMode}]`);

        // ── Try direct XHR first (reliable) ──
        const xhrResult = await buyFuelDirect(page, toBuy);

        if (xhrResult.ok) {
          const cost = Math.round(toBuy * price / 1000);
          log('✅', 'FUEL', `XHR Buy success! ${toBuy.toLocaleString()} lbs for ~$${cost.toLocaleString()}`);

          // Check if response contains error messages
          if (xhrResult.text.includes('error') || xhrResult.text.includes('fail') || xhrResult.text.includes('insufficient')) {
            log('⚠️', 'FUEL', `Server said: ${xhrResult.text.slice(0, 200)}`);
            log('🔄', 'FUEL', 'Falling back to UI buy method...');
            await buyFuelViaUI(page, toBuy);
          } else {
            await tg.fuelBought(toBuy, price, cost);
          }
        } else {
          log('⚠️', 'FUEL', `XHR returned ${xhrResult.status}: ${xhrResult.text.slice(0, 200)}`);
          log('🔄', 'FUEL', 'Falling back to UI buy method...');
          await buyFuelViaUI(page, toBuy);
        }
      } else {
        log('⚠️', 'FUEL', `Can only afford ${toBuy} lbs — too little to buy`);
      }
    } else {
      log('ℹ️', 'FUEL', `$${price} > threshold $${FUEL_THRESHOLD} and tank at ${Math.round(tankPct * 100)}% (OK) — waiting for cheaper prices`);
    }

    return price;
  } catch (e) {
    log('❌', 'FUEL', e.message);
    await tg.error('FUEL', e.message);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) { }
    return null;
  }
}

/**
 * Fallback: buy fuel through UI interaction (old method)
 */
async function buyFuelViaUI(page, toBuy) {
  try {
    // Re-open fuel popup
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('fuel.php', 'Fuel', false, false, true);
    });
    await sleep(3000);

    // Set amount
    await page.evaluate(amount => {
      const inputs = [
        document.getElementById('amountInput'),
        document.querySelector('#fuelMain input[type="number"]'),
        document.querySelector('#fuelMain input[type="text"]'),
        document.querySelector('#popMain input[type="number"]'),
        document.querySelector('#popMain input[type="text"]'),
        document.querySelector('input[name="amount"]'),
      ];
      for (const i of inputs) {
        if (i) {
          i.value = amount;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          i.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, toBuy);
    await sleep(800);

    // Click buy button
    await page.evaluate(() => {
      const containers = [
        document.getElementById('fuelMain'),
        document.getElementById('popMain'),
        document.querySelector('.popup-content'),
      ].filter(Boolean);

      for (const el of containers) {
        const btns = el.querySelectorAll('button, [onclick]');
        for (const b of btns) {
          const text = (b.textContent || '').toLowerCase();
          if (text.includes('buy') || b.classList.contains('btn-success') || b.classList.contains('btn-primary')) {
            b.click();
            return;
          }
        }
        if (btns.length) { btns[btns.length - 1].click(); return; }
      }
    });
    await sleep(2000);

    log('✅', 'FUEL', `UI fallback buy attempted for ${toBuy.toLocaleString()} lbs`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e) { }
  } catch (e) {
    log('❌', 'FUEL', `UI fallback failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) { }
  }
}


// ════════════════════════════════════════════════════════════
//  CO2 CHECK
// ════════════════════════════════════════════════════════════
async function checkCO2(page, bankBalance) {
  log('🌿', 'CO2', 'Checking CO2...');
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('fuel.php', 'Fuel', false, false, true);
    });
    await sleep(2500);

    // Click CO2 tab
    await page.evaluate(() => {
      const btn = document.getElementById('popBtn2');
      if (btn) btn.click();
      // Fallback: look for CO2 tab
      if (!btn) {
        const tabs = document.querySelectorAll('.nav-link, .tab-link, [data-toggle="tab"]');
        for (const t of tabs) {
          if ((t.textContent || '').toLowerCase().includes('co2')) { t.click(); break; }
        }
      }
    });
    await sleep(2000);

    const cd = await page.evaluate(() => {
      let container = document.getElementById('co2Main') || document.getElementById('popMain');
      if (!container) container = document.querySelector('.popup-content, .modal-body');
      if (!container) return null;

      const allText = container.innerText;
      let price = 0;
      const priceMatch = allText.match(/\$\s*(\d[\d,]*)/);
      if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''));
      if (!price) {
        for (const b of container.querySelectorAll('b, strong')) {
          const m = b.innerText.match(/\$\s*(\d[\d,]*)/);
          if (m) { price = parseInt(m[1].replace(/,/g, '')); break; }
        }
      }

      let capacity = 0;
      const capEl = document.getElementById('remCapacity');
      if (capEl) capacity = parseInt(capEl.innerText.replace(/[^0-9]/g, '')) || 0;

      return { price, capacity, containerText: allText.slice(0, 300) };
    });

    // Close fuel popup
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e) { }

    if (!cd?.price) { log('⚠️', 'CO2', 'Could not read CO2 data'); return null; }

    const price = cd.price;
    const cap = cd.capacity;
    log('🌿', 'CO2', `Price: $${price} | Capacity: ${cap.toLocaleString()}`);

    // Record to persistent price memory
    priceMemory.recordPrice('co2', price);

    const isDip = priceMemory.predictDip('co2', price);
    const isBelowThreshold = price <= CO2_THRESHOLD;

    log('📊', 'CO2', `Below threshold ($${CO2_THRESHOLD}): ${isBelowThreshold} | Dip: ${isDip}`);

    if ((isBelowThreshold || isDip) && cap > 0) {
      let affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
      if (affordReserve === 0 && bankBalance > 10000) {
        affordReserve = Math.floor(bankBalance / 4);
        log('🚨', 'CO2', 'Emergency: Using quarter of cash for CO2!');
      }

      const canAfford = Math.floor(affordReserve / price * 1000);
      const toBuy = Math.min(canAfford, cap);

      if (toBuy > 10) {
        log('🌍', 'CO2', `BUYING ${toBuy.toLocaleString()} CO2 at $${price}! (${isDip ? 'DIP BUY' : 'NORMAL'})`);

        // Try direct XHR first
        const xhrResult = await buyCO2Direct(page, toBuy);

        if (xhrResult.ok && !xhrResult.text.includes('error') && !xhrResult.text.includes('insufficient')) {
          const cost = Math.round(toBuy * price / 1000);
          log('✅', 'CO2', `XHR Buy success! ${toBuy.toLocaleString()} CO2 for ~$${cost.toLocaleString()}`);
          await tg.co2Bought(toBuy, price, cost);
        } else {
          log('⚠️', 'CO2', `XHR result: ${xhrResult.status} — ${xhrResult.text.slice(0, 200)}`);
          // Fallback to UI
          log('🔄', 'CO2', 'Falling back to UI method...');
          await buyco2ViaUI(page, toBuy);
        }
      }
    } else {
      log('ℹ️', 'CO2', `$${price} > threshold $${CO2_THRESHOLD} — skipping`);
    }

    return price;
  } catch (e) {
    log('❌', 'CO2', e.message);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) { }
    return null;
  }
}

/**
 * Fallback: buy CO2 through UI interaction
 */
async function buyco2ViaUI(page, toBuy) {
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('fuel.php', 'Fuel', false, false, true);
    });
    await sleep(2500);

    // Click CO2 tab
    await page.evaluate(() => {
      const btn = document.getElementById('popBtn2');
      if (btn) btn.click();
    });
    await sleep(2000);

    await page.evaluate(amount => {
      const inputs = [
        document.getElementById('amountInput'),
        document.querySelector('input[type="number"]'),
        document.querySelector('input[name="amount"]'),
      ];
      for (const i of inputs) {
        if (i) {
          i.value = amount;
          i.dispatchEvent(new Event('input', { bubbles: true }));
          i.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }, toBuy);
    await sleep(800);

    await page.evaluate(() => {
      const containers = [
        document.getElementById('co2Main'),
        document.getElementById('popMain'),
        document.querySelector('.popup-content'),
      ].filter(Boolean);
      for (const el of containers) {
        const btns = el.querySelectorAll('button');
        for (const b of btns) {
          const text = (b.textContent || '').toLowerCase();
          if (text.includes('buy') || b.classList.contains('btn-success')) { b.click(); return; }
        }
        if (btns.length) { btns[btns.length - 1].click(); return; }
      }
    });
    await sleep(2000);

    log('✅', 'CO2', `UI fallback buy attempted for ${toBuy.toLocaleString()} CO2`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e) { }
  } catch (e) {
    log('❌', 'CO2', `UI fallback failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) { }
  }
}

module.exports = { checkFuel, checkCO2 };
