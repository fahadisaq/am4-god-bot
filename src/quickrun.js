// ============================================================
//  AM4 GOD BOT — Quick Run Mode (for GitHub Actions)
//  Logs in, performs all actions, exits. Runs every 20 min.
// ============================================================

const puppeteer = require('puppeteer');

// ── Config from environment ──
const EMAIL = process.env.AM4_EMAIL;
const PASSWORD = process.env.AM4_PASSWORD;
const FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 500;
const CO2_THRESHOLD = parseInt(process.env.CO2_THRESHOLD) || 120;
const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;

// ── Logging ──
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11, 19)}] [${module}] ${msg}`);
}

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function typeHuman(element, text) {
  for (const char of text) {
    await element.type(char);
    await sleep(rand(30, 120));
  }
}

// ════════════════════════════════════════════════════════════
//  MAIN — Single Cycle Run
// ════════════════════════════════════════════════════════════

async function main() {
  log('🚀', 'BOT', '═══════════════════════════════════════════════');
  log('🚀', 'BOT', '  AM4 GOD BOT — Quick Run (GitHub Actions)');
  log('🚀', 'BOT', '═══════════════════════════════════════════════');

  if (!EMAIL || !PASSWORD) {
    log('❌', 'BOT', 'AM4_EMAIL and AM4_PASSWORD not set!');
    process.exit(1);
  }

  let browser;
  try {
    // Launch headless browser
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
      ],
      defaultViewport: { width: 1920, height: 1080 },
    });

    const page = await browser.newPage();

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );

    // Block heavy resources to speed up
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // ── LOGIN ──
    log('🔑', 'LOGIN', `Navigating to AM4...`);
    await page.goto('https://www.airlinemanager.com/', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    await sleep(3000);

    // Log current page state for debugging
    const pageTitle = await page.title();
    const pageUrl = page.url();
    log('🔑', 'LOGIN', `Page: "${pageTitle}" at ${pageUrl}`);

    // Dismiss cookie consent if present
    await page.evaluate(() => {
      const cookieBtns = document.querySelectorAll('button, a, div');
      for (const el of cookieBtns) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes('accept') || text.includes('agree') || text.includes('consent') || text.includes('got it')) {
          el.click();
          break;
        }
      }
    });
    await sleep(1000);

    // Click ALL possible login/sign-in buttons on landing page
    log('🔑', 'LOGIN', 'Looking for login button...');
    await page.evaluate(() => {
      // Try clicking buttons with login-related text
      const allClickables = document.querySelectorAll('button, a, div[onclick], span[onclick]');
      for (const el of allClickables) {
        const text = (el.textContent || '').toLowerCase().trim();
        if (text === 'login' || text === 'log in' || text === 'sign in' ||
            text.includes('existing') || text === 'play now') {
          el.click();
          return;
        }
      }
      // Specific AM4 landing page button indices from original bot
      // The login button is typically the 2nd button
      const buttons = document.querySelectorAll('button');
      if (buttons.length >= 2) {
        buttons[1].click();
      }
    });
    await sleep(2000);

    // Fill credentials using evaluate (avoids "not clickable" errors)
    log('🔑', 'LOGIN', `Logging in as: ${EMAIL}`);

    // Wait for login form to appear
    let loginFormFound = false;
    for (let i = 0; i < 10; i++) {
      loginFormFound = await page.evaluate(() => !!document.getElementById('lEmail'));
      if (loginFormFound) break;
      await sleep(1000);
      log('🔑', 'LOGIN', `Waiting for login form... (${i + 1}/10)`);
    }

    if (!loginFormFound) {
      // Log what's on the page for debugging
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || 'empty');
      log('⚠️', 'LOGIN', `Login form not found. Page content: ${bodyText.substring(0, 200)}`);

      // Try direct URL to login page
      log('🔑', 'LOGIN', 'Trying direct navigation to login...');
      await page.goto('https://www.airlinemanager.com/login.php', {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
      await sleep(2000);

      loginFormFound = await page.evaluate(() => !!document.getElementById('lEmail'));
    }

    // Use page.evaluate to fill in the form (works even if elements are overlaid)
    await page.evaluate((email, password) => {
      const emailInput = document.getElementById('lEmail');
      const passInput = document.getElementById('lPass');
      const rememberBox = document.getElementById('remember');

      if (emailInput) {
        emailInput.value = email;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
        emailInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (passInput) {
        passInput.value = password;
        passInput.dispatchEvent(new Event('input', { bubbles: true }));
        passInput.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (rememberBox && !rememberBox.checked) {
        rememberBox.click();
      }
    }, EMAIL, PASSWORD);

    await sleep(500);

    // Click login button
    await page.evaluate(() => {
      const loginBtn = document.getElementById('btnLogin');
      if (loginBtn) loginBtn.click();
    });

    log('🔑', 'LOGIN', 'Credentials submitted, waiting for game to load...');
    await sleep(8000);

    // Verify login
    const loggedIn = await page.evaluate(() => {
      return !!document.getElementById('headerAccount') ||
             !!document.getElementById('listDepartAmount');
    });

    if (!loggedIn) {
      log('❌', 'LOGIN', 'Login failed — game elements not found');

      // Take screenshot for debugging
      try {
        await page.screenshot({ path: '/tmp/am4-login-debug.png', fullPage: true });
        log('📸', 'DEBUG', 'Screenshot saved to /tmp/am4-login-debug.png');
      } catch (e) {}

      throw new Error('Login verification failed');
    }

    log('✅', 'LOGIN', 'Login successful!');

    // ── READ BANK BALANCE ──
    const balance = await page.evaluate(() => {
      const el = document.getElementById('headerAccount');
      return el ? el.innerText : '0';
    });
    const bankBalance = parseInt(balance.replace(/[^0-9]/g, '')) || 0;
    log('💵', 'BALANCE', `Bank: $${bankBalance.toLocaleString()}`);

    // ── START ECO-FRIENDLY CAMPAIGN ──
    log('🌱', 'CAMPAIGN', 'Starting eco-friendly campaign...');
    try {
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function () {
            if (this.readyState === 4) resolve(this.status);
          };
          xhr.open('GET', 'marketing_new.php?type=5&mode=do&c=1', true);
          xhr.send();
        });
      });
      log('✅', 'CAMPAIGN', 'Eco-friendly campaign started');
    } catch (e) {
      log('⚠️', 'CAMPAIGN', `Eco campaign: ${e.message}`);
    }

    await sleep(rand(800, 1500));

    // ── START REPUTATION CAMPAIGN ──
    const hoursLeft = 24 - new Date().getHours();
    let repOption = 0;
    if (hoursLeft <= 3) repOption = 1;
    else if (hoursLeft <= 7) repOption = 2;
    else if (hoursLeft <= 11) repOption = 3;
    else if (hoursLeft <= 15) repOption = 4;

    if (repOption > 0) {
      log('⭐', 'CAMPAIGN', `Starting reputation campaign (option ${repOption})...`);
      try {
        await page.evaluate((opt) => {
          return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function () {
              if (this.readyState === 4) resolve(this.status);
            };
            xhr.open('GET', `marketing_new.php?type=1&c=4&mode=do&d=${opt}`, true);
            xhr.send();
          });
        }, repOption);
        log('✅', 'CAMPAIGN', 'Reputation campaign started');
      } catch (e) {
        log('⚠️', 'CAMPAIGN', `Rep campaign: ${e.message}`);
      }
    }

    await sleep(rand(1000, 2000));

    // ── DEPART ALL FLIGHTS ──
    log('✈️', 'DEPART', 'Checking flights to depart...');

    // Close any popups first
    try {
      await page.evaluate(() => {
        if (typeof closePop === 'function') closePop();
        const closeBtn = document.querySelector('#popup .close, .popup-close');
        if (closeBtn) closeBtn.click();
      });
      await sleep(500);
    } catch (e) {}

    let planesToDepart = await page.evaluate(() => {
      const el = document.getElementById('listDepartAmount');
      return el ? parseInt(el.innerText.trim()) || 0 : 0;
    });

    if (planesToDepart > 0) {
      log('✈️', 'DEPART', `${planesToDepart} flight(s) ready — departing all!`);

      // We loop a few times to make sure everything departs
      for (let attempt = 1; attempt <= 3; attempt++) {
        const initialCount = planesToDepart;
        
        // Exact logic from original userscript:
        await page.evaluate(() => {
          const numberSpan = document.getElementById("listDepartAmount");
          if (numberSpan && numberSpan.parentElement) {
             numberSpan.parentElement.click();
          }
        });

        // Slight delay to allow server to process departure
        await sleep(4000);

        planesToDepart = await page.evaluate(() => {
          const el = document.getElementById('listDepartAmount');
          return el && el.innerText.trim() !== '' ? parseInt(el.innerText.trim()) || 0 : 0;
        });

        const departedThisAttempt = initialCount - planesToDepart;
        if (departedThisAttempt > 0) {
           log('✅', 'DEPART', `Attempt ${attempt}: Departed ${departedThisAttempt} flight(s)!`);
        }

        if (planesToDepart <= 0) break;
        
        log('⚠️', 'DEPART', `${planesToDepart} flight(s) still remaining, retrying...`);
        // Try closing any popup that might have opened instead
        try {
          await page.evaluate(() => { if (typeof closePop === 'function') closePop(); });
        } catch (e) {}
        await sleep(1500);
      }
      
      if (planesToDepart <= 0 || isNaN(planesToDepart)) {
        log('✅', 'DEPART', 'All flights departed successfully!');
      } else {
        log('❌', 'DEPART', `Failed to depart ${planesToDepart} flight(s). Waiting for next cycle.`);
      }
    } else {
      log('ℹ️', 'DEPART', 'No flights to depart');
    }

    await sleep(rand(1500, 3000));

    // ── CHECK FUEL ──
    log('⛽', 'FUEL', 'Checking fuel price...');
    try {
      await page.evaluate(() => {
        if (typeof popup === 'function') {
          popup('fuel.php', 'Fuel', false, false, true);
        }
      });
      await sleep(2500);

      const fuelData = await page.evaluate(() => {
        const mainEl = document.getElementById('fuelMain');
        if (!mainEl) return null;

        let priceText = '';
        const bolds = mainEl.querySelectorAll('b');
        for (const b of bolds) {
          if (b.innerText.includes('$')) { priceText = b.innerText; break; }
        }

        let capacityText = '';
        const capEl = document.getElementById('remCapacity');
        if (capEl) capacityText = capEl.innerText;

        return { price: priceText, capacity: capacityText };
      });

      if (fuelData && fuelData.price) {
        const fuelPrice = parseInt(fuelData.price.replace(/[^0-9]/g, ''));
        const fuelCap = parseInt((fuelData.capacity || '0').replace(/[^0-9]/g, '')) || 0;

        log('⛽', 'FUEL', `Price: $${fuelPrice} | Capacity: ${fuelCap.toLocaleString()} lbs`);

        if (fuelPrice <= FUEL_THRESHOLD && fuelCap > 0) {
          const affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
          const canAfford = Math.floor(affordReserve / fuelPrice * 1000);
          const toBuy = Math.min(canAfford, fuelCap);

          if (toBuy > 100) {
            log('🛢', 'FUEL', `BUYING ${toBuy.toLocaleString()} lbs at $${fuelPrice}!`);

            await page.evaluate((amount) => {
              const input = document.getElementById('amountInput');
              if (input) {
                input.value = '';
                input.value = amount;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, toBuy);
            await sleep(500);

            await page.evaluate(() => {
              const fuelMain = document.getElementById('fuelMain');
              if (fuelMain) {
                const btns = fuelMain.querySelectorAll('button');
                for (const btn of btns) {
                  if (btn.textContent.toLowerCase().includes('buy') ||
                      btn.classList.contains('btn-success') ||
                      btn.classList.contains('btn-primary')) {
                    btn.click(); return;
                  }
                }
                if (btns.length) btns[btns.length - 1].click();
              }
            });
            await sleep(1500);

            log('✅', 'FUEL', `Bought ${toBuy.toLocaleString()} lbs for ~$${Math.round(toBuy * fuelPrice / 1000).toLocaleString()}`);
          } else {
            log('⚠️', 'FUEL', 'Price is good but can\'t afford enough (budget protection)');
          }
        } else {
          log('ℹ️', 'FUEL', `Price $${fuelPrice} > threshold $${FUEL_THRESHOLD} — skipping`);
        }
      } else {
        log('⚠️', 'FUEL', 'Could not read fuel data');
      }

      // Close fuel popup
      try {
        await page.evaluate(() => {
          if (typeof closePop === 'function') closePop();
        });
      } catch (e) {}

    } catch (e) {
      log('❌', 'FUEL', `Fuel check failed: ${e.message}`);
      try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) {}
    }

    await sleep(rand(2000, 4000));

    // ── CHECK CO2 ──
    log('🌿', 'CO2', 'Checking CO2 price...');
    try {
      await page.evaluate(() => {
        if (typeof popup === 'function') {
          popup('fuel.php', 'Fuel', false, false, true);
        }
      });
      await sleep(2000);

      // Switch to CO2 tab
      await page.evaluate(() => {
        const co2Btn = document.getElementById('popBtn2');
        if (co2Btn) co2Btn.click();
      });
      await sleep(1500);

      const co2Data = await page.evaluate(() => {
        const mainEl = document.getElementById('co2Main');
        if (!mainEl) return null;

        let priceText = '';
        const bolds = mainEl.querySelectorAll('b');
        for (const b of bolds) {
          if (b.innerText.includes('$')) { priceText = b.innerText; break; }
        }

        let capacityText = '';
        const capEl = document.getElementById('remCapacity');
        if (capEl) capacityText = capEl.innerText;

        return { price: priceText, capacity: capacityText };
      });

      if (co2Data && co2Data.price) {
        const co2Price = parseInt(co2Data.price.replace(/[^0-9]/g, ''));
        const co2Cap = parseInt((co2Data.capacity || '0').replace(/[^0-9]/g, '')) || 0;

        log('🌿', 'CO2', `Price: $${co2Price} | Capacity: ${co2Cap.toLocaleString()}`);

        if (co2Price <= CO2_THRESHOLD && co2Cap > 0) {
          const affordReserve = Math.max(0, bankBalance - MIN_BANK_BALANCE);
          const canAfford = Math.floor(affordReserve / co2Price * 1000);
          const toBuy = Math.min(canAfford, co2Cap);

          if (toBuy > 100) {
            log('🌍', 'CO2', `BUYING ${toBuy.toLocaleString()} CO2 at $${co2Price}!`);

            await page.evaluate((amount) => {
              const input = document.getElementById('amountInput');
              if (input) {
                input.value = '';
                input.value = amount;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }, toBuy);
            await sleep(500);

            await page.evaluate(() => {
              const co2Main = document.getElementById('co2Main');
              if (co2Main) {
                const btns = co2Main.querySelectorAll('button');
                for (const btn of btns) {
                  if (btn.textContent.toLowerCase().includes('buy') ||
                      btn.classList.contains('btn-success')) {
                    btn.click(); return;
                  }
                }
                if (btns.length) btns[btns.length - 1].click();
              }
            });
            await sleep(1500);

            log('✅', 'CO2', `Bought ${toBuy.toLocaleString()} CO2 for ~$${Math.round(toBuy * co2Price / 1000).toLocaleString()}`);
          }
        } else {
          log('ℹ️', 'CO2', `Price $${co2Price} > threshold $${CO2_THRESHOLD} — skipping`);
        }
      }

      // Close popup
      try {
        await page.evaluate(() => {
          if (typeof closePop === 'function') closePop();
        });
      } catch (e) {}

    } catch (e) {
      log('❌', 'CO2', `CO2 check failed: ${e.message}`);
      try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch (e2) {}
    }

    // ── DONE ──
    log('🏁', 'BOT', '═══════════════════════════════════════════════');
    log('🏁', 'BOT', '  Cycle complete! Next run in ~20 minutes.');
    log('🏁', 'BOT', '═══════════════════════════════════════════════');

    await browser.close();
    process.exit(0);

  } catch (err) {
    log('❌', 'BOT', `FATAL ERROR: ${err.message}`);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
