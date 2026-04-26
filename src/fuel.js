// ============================================================
//  FUEL & CO2 MODULE — Smart buying with better selectors
// ============================================================

const tg = require('./telegram');

const FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 700;
const CO2_THRESHOLD = parseInt(process.env.CO2_THRESHOLD) || 140;
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

async function checkFuel(page, bankBalance) {
  log('⛽','FUEL','Checking fuel...');
  try {
    // Navigate to fuel page
    await page.evaluate(() => {
      if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true);
    });
    await sleep(3000);

    // Read fuel data — try multiple selector strategies
    const fd = await page.evaluate(() => {
      // Strategy 1: Look in #fuelMain
      let container = document.getElementById('fuelMain');
      // Strategy 2: Look in popup
      if (!container) container = document.getElementById('popMain');
      // Strategy 3: Any visible popup content
      if (!container) container = document.querySelector('.popup-content, .modal-body, #popContent');
      
      if (!container) {
        // Log what we CAN see for debugging
        const bodyText = document.body.innerText.slice(0, 500);
        return { error: 'No fuel container found', debug: bodyText };
      }

      // Find price — look for $ sign in bold or span elements
      let price = '';
      const allText = container.innerText;
      
      // Try to find price pattern like "$XXX" or "$ XXX"
      const priceMatch = allText.match(/\$\s*(\d[\d,]*)/);
      if (priceMatch) price = priceMatch[0];
      
      // Fallback: look in bold elements
      if (!price) {
        for (const b of container.querySelectorAll('b, strong, .price, [class*="price"]')) {
          if (b.innerText.includes('$')) { price = b.innerText; break; }
        }
      }

      // Find capacity
      let capacity = '';
      const capEl = document.getElementById('remCapacity');
      if (capEl) {
        capacity = capEl.innerText;
      } else {
        // Look for capacity text
        const capMatch = allText.match(/capacity[:\s]*(\d[\d,]*)/i);
        if (capMatch) capacity = capMatch[1];
      }

      // Find the amount input
      const amountInput = document.getElementById('amountInput') 
        || container.querySelector('input[type="number"]')
        || container.querySelector('input[type="text"]');
      
      return { 
        price, 
        capacity,
        hasInput: !!amountInput,
        containerText: allText.slice(0, 300)
      };
    });

    if (fd?.error) {
      log('⚠️','FUEL', fd.error);
      log('🔍','FUEL', `Debug: ${fd.debug?.slice(0, 200)}`);
      try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
      return null;
    }

    if (!fd?.price) {
      log('⚠️','FUEL',`Could not read fuel price. Page text: ${fd?.containerText?.slice(0,150)}`);
      try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
      return null;
    }

    const price = parseInt(fd.price.replace(/[^0-9]/g,''));
    const cap = parseInt((fd.capacity||'0').replace(/[^0-9]/g,''))||0;
    log('⛽','FUEL',`Price: $${price} | Capacity: ${cap.toLocaleString()} lbs | Has input: ${fd.hasInput}`);

    if (price <= FUEL_THRESHOLD && cap > 0) {
      // Calculate how much we can buy
      let affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
      
      // EMERGENCY: If bank is low but we NEED fuel to fly, use half of what's left
      if (affordReserve === 0 && bankBalance > 10000) {
        affordReserve = Math.floor(bankBalance / 2);
        log('🚨','FUEL','Emergency: Using half of remaining cash for fuel!');
      }

      const canAfford = Math.floor(affordReserve / price * 1000);
      const toBuy = Math.min(canAfford, cap);

      if (toBuy > 10) {
        log('🛢','FUEL',`BUYING ${toBuy.toLocaleString()} lbs at $${price}!`);
        
        // Set amount — try multiple input strategies
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
              i.dispatchEvent(new Event('input', {bubbles:true}));
              i.dispatchEvent(new Event('change', {bubbles:true}));
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
            // Last resort: click last button
            if (btns.length) { btns[btns.length-1].click(); return; }
          }
        });
        await sleep(2000);

        const cost = Math.round(toBuy * price / 1000);
        log('✅','FUEL',`Bought ${toBuy.toLocaleString()} lbs for $${cost.toLocaleString()}`);
        await tg.fuelBought(toBuy, price, cost);
      } else {
        log('⚠️','FUEL',`Can only afford ${toBuy} lbs — too little to buy`);
      }
    } else if (price > FUEL_THRESHOLD) {
      log('ℹ️','FUEL',`$${price} > threshold $${FUEL_THRESHOLD} — skipping`);
    } else {
      log('ℹ️','FUEL','No capacity to buy fuel');
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
    await page.evaluate(() => {
      if (typeof popup==='function') popup('fuel.php','Fuel',false,false,true);
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
      let price = '';
      const priceMatch = allText.match(/\$\s*(\d[\d,]*)/);
      if (priceMatch) price = priceMatch[0];
      if (!price) {
        for (const b of container.querySelectorAll('b, strong')) {
          if (b.innerText.includes('$')) { price = b.innerText; break; }
        }
      }

      let capacity = '';
      const capEl = document.getElementById('remCapacity');
      if (capEl) capacity = capEl.innerText;

      return { price, capacity };
    });

    if (!cd?.price) { log('⚠️','CO2','Could not read CO2 data'); return null; }

    const price = parseInt(cd.price.replace(/[^0-9]/g,''));
    const cap = parseInt((cd.capacity||'0').replace(/[^0-9]/g,''))||0;
    log('🌿','CO2',`Price: $${price} | Capacity: ${cap.toLocaleString()}`);

    if (price <= CO2_THRESHOLD && cap > 0) {
      let affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
      if (affordReserve === 0 && bankBalance > 10000) {
        affordReserve = Math.floor(bankBalance / 4);
        log('🚨','CO2','Emergency: Using quarter of cash for CO2!');
      }

      const canAfford = Math.floor(affordReserve / price * 1000);
      const toBuy = Math.min(canAfford, cap);

      if (toBuy > 10) {
        log('🌍','CO2',`BUYING ${toBuy.toLocaleString()} CO2 at $${price}!`);
        await page.evaluate(amount => {
          const inputs = [
            document.getElementById('amountInput'),
            document.querySelector('input[type="number"]'),
            document.querySelector('input[name="amount"]'),
          ];
          for (const i of inputs) {
            if (i) {
              i.value = amount;
              i.dispatchEvent(new Event('input', {bubbles:true}));
              i.dispatchEvent(new Event('change', {bubbles:true}));
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
            if (btns.length) { btns[btns.length-1].click(); return; }
          }
        });
        await sleep(2000);

        const cost = Math.round(toBuy * price / 1000);
        log('✅','CO2',`Bought ${toBuy.toLocaleString()} CO2 for $${cost.toLocaleString()}`);
        await tg.co2Bought(toBuy, price, cost);
      }
    } else {
      log('ℹ️','CO2',`$${price} > threshold $${CO2_THRESHOLD} — skipping`);
    }

    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e) {}
    return price;
  } catch(e) {
    log('❌','CO2',e.message);
    try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); } catch(e2) {}
    return null;
  }
}

module.exports = { checkFuel, checkCO2 };
