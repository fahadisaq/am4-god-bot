// ============================================================
//  FUEL & CO2 MODULE — Smart buying
// ============================================================

const tg = require('./telegram');

const FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 500;
const CO2_THRESHOLD = parseInt(process.env.CO2_THRESHOLD) || 120;
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

// Track price history for smart buying
const priceHistory = { fuel: [], co2: [] };

function recordPrice(type, price) {
  const history = priceHistory[type];
  history.push({ price, time: Date.now() });
  // Keep last 12 readings (1 hour of data)
  if (history.length > 12) history.shift();
}

function isGoodPrice(type, currentPrice) {
  const history = priceHistory[type];
  if (history.length < 3) return true; // not enough data — just buy
  const avg = history.reduce((a,b) => a + b.price, 0) / history.length;
  const isBelow = currentPrice <= avg * 0.9; // 10% below average = good deal
  log('📈', type.toUpperCase(), `Avg price: $${Math.round(avg)} | Current: $${currentPrice} | Good deal: ${isBelow}`);
  return isBelow;
}

async function checkFuel(page, bankBalance) {
  log('⛽','FUEL','Checking fuel...');
  try {
    await page.evaluate(() => { if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true); });
    await sleep(2500);

    const fd = await page.evaluate(() => {
      const el = document.getElementById('fuelMain'); if (!el) return null;
      let price = '';
      for (const b of el.querySelectorAll('b')) { if (b.innerText.includes('$')) { price=b.innerText; break; } }
      const cap = document.getElementById('remCapacity');
      return { price, capacity: cap ? cap.innerText : '' };
    });

    if (!fd?.price) { log('⚠️','FUEL','Could not read fuel data'); return null; }

    const price = parseInt(fd.price.replace(/[^0-9]/g,''));
    const cap = parseInt((fd.capacity||'0').replace(/[^0-9]/g,''))||0;
    log('⛽','FUEL',`Price: $${price} | Cap: ${cap.toLocaleString()} lbs`);

    recordPrice('fuel', price);

    if (price <= FUEL_THRESHOLD && cap > 0) {
      const affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
      const canAfford = Math.floor(affordReserve / price * 1000);
      const toBuy = Math.min(canAfford, cap);

      if (toBuy > 10) {
        log('🛢','FUEL',`BUYING ${toBuy.toLocaleString()} lbs at $${price}!`);
        await page.evaluate(a => {
          const i = document.getElementById('amountInput');
          if (i) { i.value=a; i.dispatchEvent(new Event('input',{bubbles:true})); }
        }, toBuy);
        await sleep(500);
        await page.evaluate(() => {
          const el = document.getElementById('fuelMain'); if (!el) return;
          const btns = el.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.toLowerCase().includes('buy')||b.classList.contains('btn-success')||b.classList.contains('btn-primary')) { b.click(); return; }
          }
          if (btns.length) btns[btns.length-1].click();
        });
        await sleep(1500);
        const cost = Math.round(toBuy * price / 1000);
        log('✅','FUEL',`Bought ${toBuy.toLocaleString()} lbs for $${cost.toLocaleString()}`);
        await tg.fuelBought(toBuy, price, cost);
      } else {
        log('⚠️','FUEL','Budget protection active or cap too low');
      }
    } else {
      log('ℹ️','FUEL',`$${price} > threshold $${FUEL_THRESHOLD} — skip`);
    }

    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
    return price;
  } catch(e) {
    log('❌','FUEL',e.message);
    await tg.error('FUEL', e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
    return null;
  }
}

async function checkCO2(page, bankBalance) {
  log('🌿','CO2','Checking CO2...');
  try {
    await page.evaluate(() => { if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true); });
    await sleep(2000);
    await page.evaluate(() => { const b=document.getElementById('popBtn2'); if(b) b.click(); });
    await sleep(1500);

    const cd = await page.evaluate(() => {
      const el = document.getElementById('co2Main'); if (!el) return null;
      let price = '';
      for (const b of el.querySelectorAll('b')) { if (b.innerText.includes('$')) { price=b.innerText; break; } }
      const cap = document.getElementById('remCapacity');
      return { price, capacity: cap ? cap.innerText : '' };
    });

    if (!cd?.price) { log('⚠️','CO2','Could not read CO2 data'); return null; }

    const price = parseInt(cd.price.replace(/[^0-9]/g,''));
    const cap = parseInt((cd.capacity||'0').replace(/[^0-9]/g,''))||0;
    log('🌿','CO2',`Price: $${price} | Cap: ${cap.toLocaleString()}`);

    recordPrice('co2', price);

    if (price <= CO2_THRESHOLD && cap > 0) {
      const affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
      const canAfford = Math.floor(affordReserve / price * 1000);
      const toBuy = Math.min(canAfford, cap);

      if (toBuy > 10) {
        log('🌍','CO2',`BUYING ${toBuy.toLocaleString()} CO2 at $${price}!`);
        await page.evaluate(a => {
          const i = document.getElementById('amountInput');
          if (i) { i.value=a; i.dispatchEvent(new Event('input',{bubbles:true})); }
        }, toBuy);
        await sleep(500);
        await page.evaluate(() => {
          const el = document.getElementById('co2Main'); if (!el) return;
          const btns = el.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.toLowerCase().includes('buy')||b.classList.contains('btn-success')) { b.click(); return; }
          }
          if (btns.length) btns[btns.length-1].click();
        });
        await sleep(1500);
        const cost = Math.round(toBuy * price / 1000);
        log('✅','CO2',`Bought ${toBuy.toLocaleString()} CO2 for $${cost.toLocaleString()}`);
        await tg.co2Bought(toBuy, price, cost);
      } else {
        log('⚠️','CO2','Budget protection active or cap too low');
      }
    } else {
      log('ℹ️','CO2',`$${price} > threshold $${CO2_THRESHOLD} — skip`);
    }

    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
    return price;
  } catch(e) {
    log('❌','CO2',e.message);
    await tg.error('CO2', e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
    return null;
  }
}

module.exports = { checkFuel, checkCO2 };
