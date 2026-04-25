// ============================================================
//  AM4 GOD BOT — Main Bot Engine
//  Fully automated Airline Manager 4 player
// ============================================================

const puppeteer = require('puppeteer');
const { log, getLogs } = require('./logger');

class AM4Bot {
  constructor(config) {
    // ── Config ──────────────────────────────────────────────
    this.config = {
      email: config.email,
      password: config.password,
      fuelThreshold: config.fuelThreshold || 500,
      co2Threshold: config.co2Threshold || 120,
      departIntervalMin: config.departIntervalMin || 270000,
      departIntervalMax: config.departIntervalMax || 330000,
      minBankBalance: config.minBankBalance || 500000,
      maintenanceWearThreshold: config.maintenanceWearThreshold || 50,
      nightPauseStart: config.nightPauseStart || 2,
      nightPauseEnd: config.nightPauseEnd || 5,
      scanInterval: config.scanInterval || 900000,
      headless: config.headless !== false,
    };

    // ── State ───────────────────────────────────────────────
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.isPaused = false;
    this.lastError = null;
    this.loginAttempts = 0;
    this.maxLoginRetries = 5;

    // ── Stats ───────────────────────────────────────────────
    this.stats = {
      startTime: null,
      totalDepartures: 0,
      totalFuelBought: 0,
      totalCO2Bought: 0,
      totalFuelSpent: 0,
      totalCO2Spent: 0,
      campaignsStarted: 0,
      aChecksPerformed: 0,
      cyclesCompleted: 0,
      errors: 0,
      lastDepart: null,
      lastFuelBuy: null,
      lastCO2Buy: null,
      lastCampaign: null,
      lastACheck: null,
      currentFuelPrice: null,
      currentCO2Price: null,
      bankBalance: null,
      planesToDepart: 0,
      fuelPriceHistory: [],
      co2PriceHistory: [],
      balanceHistory: [],
    };
  }

  // ════════════════════════════════════════════════════════════
  //  INITIALIZATION
  // ════════════════════════════════════════════════════════════

  async init() {
    log('info', 'CORE', '═══════════════════════════════════════════');
    log('info', 'CORE', '   AM4 GOD BOT v2.0 — Starting Up...');
    log('info', 'CORE', '═══════════════════════════════════════════');

    try {
      // Launch browser
      const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
      ];

      const launchOpts = {
        headless: this.config.headless ? 'new' : false,
        args: launchArgs,
        defaultViewport: { width: 1920, height: 1080 },
        protocolTimeout: 60000,
      };

      // Use system Chrome if available (Docker / cloud)
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      }

      this.browser = await puppeteer.launch(launchOpts);
      this.page = await this.browser.newPage();

      // Set realistic user agent
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
      );

      // Block unnecessary resources to save bandwidth
      await this.page.setRequestInterception(true);
      this.page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      log('success', 'CORE', 'Browser launched successfully');

      // Login
      await this.login();

      this.stats.startTime = new Date();
      this.isRunning = true;

      log('success', 'CORE', '🚀 Bot initialized — entering main loop');

      // Start the main loop
      this.mainLoop();

      // Start fuel/CO2 scanner on separate interval
      this.consumableLoop();

    } catch (err) {
      log('error', 'CORE', `Init failed: ${err.message}`);
      this.lastError = err.message;
      this.stats.errors++;
      // Retry after 30 seconds
      setTimeout(() => this.init(), 30000);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  LOGIN
  // ════════════════════════════════════════════════════════════

  async login() {
    log('info', 'LOGIN', 'Navigating to Airline Manager 4...');

    try {
      await this.page.goto('https://www.airlinemanager.com/', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });

      await this.sleep(2000);

      // Click the login button on the landing page
      log('info', 'LOGIN', 'Looking for login button...');
      const loginBtnXpath = 'button:has-text("Login"), button:has-text("Sign In"), .btn-login';

      // Try clicking a login/sign-in button if on landing page
      try {
        // The AM4 landing page has buttons - find the login one
        await this.page.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            if (btn.textContent.toLowerCase().includes('log') ||
                btn.textContent.toLowerCase().includes('sign')) {
              btn.click();
              return;
            }
          }
          // Try the specific xpath from original bot
          const loginArea = document.querySelector('.login-area, .auth-area, #loginBtn');
          if (loginArea) loginArea.click();
        });
      } catch (e) {
        // May already be on login form
      }

      await this.sleep(1500);

      // Fill in credentials
      log('info', 'LOGIN', `Logging in as: ${this.config.email}`);

      // Wait for email field
      await this.page.waitForSelector('#lEmail', { timeout: 15000 }).catch(() => {});

      // Type email
      const emailField = await this.page.$('#lEmail');
      if (emailField) {
        await emailField.click({ clickCount: 3 });
        await this.typeHuman(emailField, this.config.email);
      }

      await this.sleep(500);

      // Type password
      const passField = await this.page.$('#lPass');
      if (passField) {
        await passField.click({ clickCount: 3 });
        await this.typeHuman(passField, this.config.password);
      }

      await this.sleep(300);

      // Click remember me
      const rememberCb = await this.page.$('#remember');
      if (rememberCb) {
        await rememberCb.click();
      }

      await this.sleep(500);

      // Click login button
      const authBtn = await this.page.$('#btnLogin');
      if (authBtn) {
        await authBtn.click();
      }

      // Wait for navigation / game to load
      await this.sleep(5000);

      // Verify we're logged in by checking for game elements
      const loggedIn = await this.page.evaluate(() => {
        return !!document.getElementById('headerAccount') ||
               !!document.getElementById('listDepartAmount');
      });

      if (loggedIn) {
        log('success', 'LOGIN', '✅ Login successful!');
        this.loginAttempts = 0;

        // Read initial bank balance
        await this.updateBankBalance();
      } else {
        throw new Error('Login verification failed — game elements not found');
      }

    } catch (err) {
      this.loginAttempts++;
      log('error', 'LOGIN', `Login failed (attempt ${this.loginAttempts}): ${err.message}`);

      if (this.loginAttempts < this.maxLoginRetries) {
        log('warn', 'LOGIN', `Retrying in 15 seconds...`);
        await this.sleep(15000);
        return this.login();
      } else {
        throw new Error(`Login failed after ${this.maxLoginRetries} attempts`);
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  //  MAIN LOOP — Depart + Marketing + Maintenance
  // ════════════════════════════════════════════════════════════

  async mainLoop() {
    while (this.isRunning) {
      try {
        // Night pause check
        if (this.isNightTime()) {
          const resumeIn = this.getTimeUntilResume();
          log('info', 'CORE', `💤 Night mode — pausing for ${Math.round(resumeIn / 60000)} minutes`);
          await this.sleep(resumeIn);
          continue;
        }

        // Pause check
        if (this.isPaused) {
          log('info', 'CORE', '⏸ Bot is paused');
          await this.sleep(30000);
          continue;
        }

        // Check if page is still alive
        await this.ensureConnection();

        // ── Step 1: Update bank balance ──
        await this.updateBankBalance();

        // ── Step 2: Start marketing campaigns ──
        await this.startEcoCampaign();
        await this.randomDelay(500, 1500);

        // ── Step 3: Depart all planes ──
        await this.departAll();
        await this.randomDelay(1000, 3000);

        // ── Step 4: Check maintenance (every 3rd cycle) ──
        if (this.stats.cyclesCompleted % 3 === 0) {
          await this.checkMaintenance();
          await this.randomDelay(1000, 2000);
        }

        // ── Step 5: Start reputation campaign (every 5th cycle) ──
        if (this.stats.cyclesCompleted % 5 === 0) {
          await this.startReputationCampaign();
        }

        this.stats.cyclesCompleted++;

        // Random wait for next cycle (4-6 minutes)
        const nextIn = this.randomBetween(
          this.config.departIntervalMin,
          this.config.departIntervalMax
        );
        log('info', 'CORE',
          `⏱ Cycle #${this.stats.cyclesCompleted} done — next in ${Math.round(nextIn / 60000)}m ${Math.round((nextIn % 60000) / 1000)}s`
        );
        await this.sleep(nextIn);

      } catch (err) {
        this.stats.errors++;
        log('error', 'CORE', `Main loop error: ${err.message}`);
        this.lastError = err.message;

        // Try to recover
        try {
          await this.ensureConnection();
        } catch (reconnectErr) {
          log('error', 'CORE', 'Connection lost — attempting full restart in 60s');
          await this.sleep(60000);
          await this.restart();
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  //  CONSUMABLE LOOP — Fuel & CO2 buying
  // ════════════════════════════════════════════════════════════

  async consumableLoop() {
    while (this.isRunning) {
      try {
        if (!this.isPaused && !this.isNightTime()) {
          await this.checkFuel();
          await this.randomDelay(2000, 4000);
          await this.checkCO2();
        }
      } catch (err) {
        log('error', 'FUEL/CO2', `Consumable check error: ${err.message}`);
        this.stats.errors++;
      }

      // Scan every 15-20 minutes
      const scanWait = this.config.scanInterval + this.randomBetween(0, 300000);
      log('info', 'FUEL/CO2', `Next scan in ${Math.round(scanWait / 60000)} minutes`);
      await this.sleep(scanWait);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  AUTO-DEPART
  // ════════════════════════════════════════════════════════════

  async departAll() {
    try {
      const result = await this.page.evaluate(() => {
        const amountEl = document.getElementById('listDepartAmount');
        if (!amountEl) return { count: '0', error: 'Element not found' };
        return { count: amountEl.innerText.trim() };
      });

      this.stats.planesToDepart = parseInt(result.count) || 0;

      if (this.stats.planesToDepart > 0) {
        log('depart', 'DEPART', `✈️  ${this.stats.planesToDepart} flight(s) ready to depart!`);

        // Close any popups first
        await this.closePopups();
        await this.sleep(500);

        // Click depart all
        await this.page.evaluate(() => {
          const departBtn = document.querySelector('#listDepartAll button:last-child') ||
                           document.getElementById('listDepartAmount')?.parentElement;
          if (departBtn) departBtn.click();
        });

        await this.sleep(2000);

        // Check if there are more to depart
        const remaining = await this.page.evaluate(() => {
          const el = document.getElementById('listDepartAmount');
          return el ? el.innerText.trim() : '0';
        });

        const departed = this.stats.planesToDepart - (parseInt(remaining) || 0);
        this.stats.totalDepartures += departed;
        this.stats.lastDepart = new Date();

        log('success', 'DEPART', `✅ Departed ${departed} flights (total: ${this.stats.totalDepartures})`);
      } else {
        log('info', 'DEPART', 'No flights to depart');
      }
    } catch (err) {
      log('error', 'DEPART', `Depart failed: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  FUEL BUYING
  // ════════════════════════════════════════════════════════════

  async checkFuel() {
    try {
      log('fuel', 'FUEL', '🔍 Checking fuel prices...');

      // Open fuel popup via game function
      await this.page.evaluate(() => {
        if (typeof popup === 'function') {
          popup('fuel.php', 'Fuel', false, false, true);
        }
      });

      await this.sleep(2000);

      // Read fuel data
      const fuelData = await this.page.evaluate(() => {
        const mainEl = document.getElementById('fuelMain');
        if (!mainEl) return null;

        // Get price — try multiple selectors
        let priceText = '';
        const priceEl = mainEl.querySelector('.span2 b, div:nth-child(1) span:nth-child(2) b');
        if (priceEl) priceText = priceEl.innerText;
        else {
          // Fallback: search for $ in text content
          const spans = mainEl.querySelectorAll('b');
          for (const s of spans) {
            if (s.innerText.includes('$')) { priceText = s.innerText; break; }
          }
        }

        // Get capacity
        let capacityText = '';
        const capEl = document.getElementById('remCapacity') ||
                      mainEl.querySelector('[id*="apacity"]');
        if (capEl) capacityText = capEl.innerText;

        return { price: priceText, capacity: capacityText };
      });

      if (!fuelData) {
        log('warn', 'FUEL', 'Could not read fuel data');
        await this.closePopups();
        return;
      }

      const price = parseInt(fuelData.price.replace(/[^0-9]/g, ''));
      const capacity = parseInt(fuelData.capacity.replace(/[^0-9]/g, '')) || 0;

      this.stats.currentFuelPrice = price;
      this.stats.fuelPriceHistory.push({ time: Date.now(), price });
      if (this.stats.fuelPriceHistory.length > 200) this.stats.fuelPriceHistory.shift();

      log('fuel', 'FUEL', `💰 Fuel price: $${price} | Capacity: ${capacity.toLocaleString()} lbs`);

      if (price <= this.config.fuelThreshold && capacity > 0) {
        // Calculate how much we can buy
        const balance = this.stats.bankBalance || 0;
        const affordReserve = Math.max(0, balance - this.config.minBankBalance);
        const canAfford = Math.floor(affordReserve / price * 1000);
        const toBuy = Math.min(canAfford, capacity);

        if (toBuy > 100) {
          log('action', 'FUEL', `🛢 BUYING ${toBuy.toLocaleString()} lbs of fuel at $${price}!`);

          await this.page.evaluate((amount) => {
            const input = document.getElementById('amountInput');
            if (input) {
              input.value = '';
              input.value = amount;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, toBuy);

          await this.sleep(500);

          // Click buy button
          await this.page.evaluate(() => {
            const fuelMain = document.getElementById('fuelMain');
            if (fuelMain) {
              const buyBtns = fuelMain.querySelectorAll('button');
              for (const btn of buyBtns) {
                if (btn.textContent.toLowerCase().includes('buy') ||
                    btn.classList.contains('btn-success') ||
                    btn.classList.contains('btn-primary')) {
                  btn.click();
                  return;
                }
              }
              // Fallback — click last button in the buy area
              const lastBtn = buyBtns[buyBtns.length - 1];
              if (lastBtn) lastBtn.click();
            }
          });

          await this.sleep(1500);

          const cost = Math.round(toBuy * price / 1000);
          this.stats.totalFuelBought += toBuy;
          this.stats.totalFuelSpent += cost;
          this.stats.lastFuelBuy = new Date();

          log('success', 'FUEL', `✅ Bought ${toBuy.toLocaleString()} lbs for $${cost.toLocaleString()}`);
        } else {
          log('warn', 'FUEL', `Price is good but can't afford enough (budget reserve: $${this.config.minBankBalance.toLocaleString()})`);
        }
      } else if (price > this.config.fuelThreshold) {
        log('info', 'FUEL', `Price too high ($${price} > $${this.config.fuelThreshold}) — skipping`);
      }

      await this.sleep(500);
      await this.closePopups();

    } catch (err) {
      log('error', 'FUEL', `Fuel check failed: ${err.message}`);
      await this.closePopups();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  CO2 BUYING
  // ════════════════════════════════════════════════════════════

  async checkCO2() {
    try {
      log('fuel', 'CO2', '🔍 Checking CO2 prices...');

      // Open fuel popup first, then switch to CO2 tab
      await this.page.evaluate(() => {
        if (typeof popup === 'function') {
          popup('fuel.php', 'Fuel', false, false, true);
        }
      });

      await this.sleep(2000);

      // Click CO2 tab
      await this.page.evaluate(() => {
        const co2Btn = document.getElementById('popBtn2');
        if (co2Btn) co2Btn.click();
      });

      await this.sleep(1500);

      // Read CO2 data
      const co2Data = await this.page.evaluate(() => {
        const mainEl = document.getElementById('co2Main');
        if (!mainEl) return null;

        let priceText = '';
        const spans = mainEl.querySelectorAll('b');
        for (const s of spans) {
          if (s.innerText.includes('$')) { priceText = s.innerText; break; }
        }

        let capacityText = '';
        const capEl = document.getElementById('remCapacity');
        if (capEl) capacityText = capEl.innerText;

        return { price: priceText, capacity: capacityText };
      });

      if (!co2Data) {
        log('warn', 'CO2', 'Could not read CO2 data');
        await this.closePopups();
        return;
      }

      const price = parseInt(co2Data.price.replace(/[^0-9]/g, ''));
      const capacity = parseInt(co2Data.capacity.replace(/[^0-9]/g, '')) || 0;

      this.stats.currentCO2Price = price;
      this.stats.co2PriceHistory.push({ time: Date.now(), price });
      if (this.stats.co2PriceHistory.length > 200) this.stats.co2PriceHistory.shift();

      log('fuel', 'CO2', `🌿 CO2 price: $${price} | Capacity: ${capacity.toLocaleString()}`);

      if (price <= this.config.co2Threshold && capacity > 0) {
        const balance = this.stats.bankBalance || 0;
        const affordReserve = Math.max(0, balance - this.config.minBankBalance);
        const canAfford = Math.floor(affordReserve / price * 1000);
        const toBuy = Math.min(canAfford, capacity);

        if (toBuy > 100) {
          log('action', 'CO2', `🌍 BUYING ${toBuy.toLocaleString()} CO2 at $${price}!`);

          await this.page.evaluate((amount) => {
            const input = document.getElementById('amountInput');
            if (input) {
              input.value = '';
              input.value = amount;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }, toBuy);

          await this.sleep(500);

          await this.page.evaluate(() => {
            const co2Main = document.getElementById('co2Main');
            if (co2Main) {
              const buyBtns = co2Main.querySelectorAll('button');
              for (const btn of buyBtns) {
                if (btn.textContent.toLowerCase().includes('buy') ||
                    btn.classList.contains('btn-success')) {
                  btn.click();
                  return;
                }
              }
              const lastBtn = buyBtns[buyBtns.length - 1];
              if (lastBtn) lastBtn.click();
            }
          });

          await this.sleep(1500);

          const cost = Math.round(toBuy * price / 1000);
          this.stats.totalCO2Bought += toBuy;
          this.stats.totalCO2Spent += cost;
          this.stats.lastCO2Buy = new Date();

          log('success', 'CO2', `✅ Bought ${toBuy.toLocaleString()} CO2 for $${cost.toLocaleString()}`);
        }
      } else if (price > this.config.co2Threshold) {
        log('info', 'CO2', `Price too high ($${price} > $${this.config.co2Threshold}) — skipping`);
      }

      await this.sleep(500);
      await this.closePopups();

    } catch (err) {
      log('error', 'CO2', `CO2 check failed: ${err.message}`);
      await this.closePopups();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  MARKETING CAMPAIGNS
  // ════════════════════════════════════════════════════════════

  async startEcoCampaign() {
    try {
      const result = await this.page.evaluate(() => {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function () {
            if (this.readyState === 4) {
              resolve({ status: this.status, response: this.responseText.substring(0, 100) });
            }
          };
          xhr.open('GET', 'marketing_new.php?type=5&mode=do&c=1', true);
          xhr.send();
        });
      });

      if (result.status === 200) {
        this.stats.campaignsStarted++;
        this.stats.lastCampaign = new Date();
        log('success', 'MARKETING', '🌱 Eco-friendly campaign started');
      }
    } catch (err) {
      log('warn', 'MARKETING', `Eco campaign: ${err.message}`);
    }
  }

  async startReputationCampaign() {
    try {
      // Calculate optimal duration based on time until midnight
      const now = new Date();
      const hoursLeft = 24 - now.getHours();
      let option;
      if (hoursLeft <= 3) option = 1;
      else if (hoursLeft <= 7) option = 2;
      else if (hoursLeft <= 11) option = 3;
      else if (hoursLeft <= 15) option = 4;
      else return; // Too early, waste of money

      const result = await this.page.evaluate((opt) => {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function () {
            if (this.readyState === 4) {
              resolve({ status: this.status });
            }
          };
          xhr.open('GET', `marketing_new.php?type=1&c=4&mode=do&d=${opt}`, true);
          xhr.send();
        });
      }, option);

      if (result.status === 200) {
        this.stats.campaignsStarted++;
        log('success', 'MARKETING', `⭐ Reputation campaign started (option ${option})`);
      }
    } catch (err) {
      log('warn', 'MARKETING', `Rep campaign: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  A-CHECK MAINTENANCE
  // ════════════════════════════════════════════════════════════

  async checkMaintenance() {
    try {
      log('info', 'MAINT', '🔧 Checking aircraft maintenance...');

      // Navigate to maintenance via game's internal routing
      await this.page.evaluate(() => {
        if (typeof popup === 'function') {
          popup('maintenance.php', 'Maintenance');
        }
      });

      await this.sleep(2500);

      // Read maintenance data
      const maintenanceData = await this.page.evaluate(() => {
        const rows = document.querySelectorAll('#maintenanceList tr, .maintenance-row, [class*="maint"] tr');
        const aircraft = [];
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 3) {
            const name = cells[0]?.innerText?.trim();
            const wearText = row.innerText;
            // Look for percentage in the row
            const wearMatch = wearText.match(/(\d+)\s*%/);
            const wear = wearMatch ? parseInt(wearMatch[1]) : null;
            if (name && wear !== null) {
              aircraft.push({ name, wear });
            }
          }
        });
        return aircraft;
      });

      if (maintenanceData && maintenanceData.length > 0) {
        const needsCheck = maintenanceData.filter(
          (a) => a.wear >= this.config.maintenanceWearThreshold
        );

        log('info', 'MAINT', `${maintenanceData.length} aircraft scanned, ${needsCheck.length} need A-check`);

        if (needsCheck.length > 0) {
          // Try to use bulk check
          await this.page.evaluate(() => {
            const bulkBtn = document.querySelector('[onclick*="bulk"], .bulk-check, button:has-text("Bulk")');
            if (bulkBtn) bulkBtn.click();

            // Also try clicking individual check buttons
            const checkBtns = document.querySelectorAll('.btn-check, [onclick*="acheck"], button[onclick*="maintenance"]');
            checkBtns.forEach((btn) => btn.click());
          });

          await this.sleep(2000);

          this.stats.aChecksPerformed += needsCheck.length;
          this.stats.lastACheck = new Date();

          log('success', 'MAINT', `✅ Scheduled A-checks for ${needsCheck.length} aircraft`);

          for (const ac of needsCheck) {
            log('info', 'MAINT', `  → ${ac.name}: ${ac.wear}% wear`);
          }
        }
      } else {
        log('info', 'MAINT', 'No maintenance data found (popup may have different structure)');
      }

      await this.closePopups();

    } catch (err) {
      log('warn', 'MAINT', `Maintenance check: ${err.message}`);
      await this.closePopups();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  UTILITY METHODS
  // ════════════════════════════════════════════════════════════

  async updateBankBalance() {
    try {
      const balance = await this.page.evaluate(() => {
        const el = document.getElementById('headerAccount');
        return el ? el.innerText : '0';
      });

      this.stats.bankBalance = parseInt(balance.replace(/[^0-9]/g, '')) || 0;
      this.stats.balanceHistory.push({ time: Date.now(), balance: this.stats.bankBalance });
      if (this.stats.balanceHistory.length > 200) this.stats.balanceHistory.shift();

      log('money', 'BALANCE', `💵 Bank: $${this.stats.bankBalance.toLocaleString()}`);
    } catch (err) {
      // Non-critical
    }
  }

  async closePopups() {
    try {
      await this.page.evaluate(() => {
        // Try multiple close methods
        const closeBtn = document.querySelector('#popup .close, .popup-close, [onclick*="closePop"]');
        if (closeBtn) closeBtn.click();

        if (typeof closePop === 'function') closePop();
      });
      await this.sleep(300);
    } catch (e) {
      // Ignore
    }
  }

  async ensureConnection() {
    try {
      const isAlive = await this.page.evaluate(() => {
        return !!document.getElementById('headerAccount');
      });

      if (!isAlive) {
        log('warn', 'CORE', 'Page seems dead — refreshing...');
        await this.page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
        await this.sleep(3000);

        // Check if we need to re-login
        const needLogin = await this.page.evaluate(() => {
          return !!document.getElementById('lEmail') || !document.getElementById('headerAccount');
        });

        if (needLogin) {
          log('warn', 'CORE', 'Session expired — re-logging in...');
          await this.login();
        }
      }
    } catch (err) {
      throw new Error('Connection check failed: ' + err.message);
    }
  }

  async restart() {
    log('warn', 'CORE', '🔄 Full restart initiated...');
    try {
      if (this.browser) await this.browser.close();
    } catch (e) {}

    this.browser = null;
    this.page = null;
    this.loginAttempts = 0;

    await this.sleep(5000);
    await this.init();
  }

  async typeHuman(element, text) {
    for (const char of text) {
      await element.type(char);
      await this.sleep(this.randomBetween(30, 150));
    }
  }

  isNightTime() {
    const hour = new Date().getUTCHours();
    return hour >= this.config.nightPauseStart && hour < this.config.nightPauseEnd;
  }

  getTimeUntilResume() {
    const now = new Date();
    const resumeHour = this.config.nightPauseEnd;
    const resume = new Date(now);
    resume.setUTCHours(resumeHour, 0, 0, 0);
    if (resume <= now) resume.setUTCDate(resume.getUTCDate() + 1);
    return resume - now;
  }

  randomBetween(min, max) {
    // Gaussian-ish distribution (sum of 3 uniforms)
    const u1 = Math.random();
    const u2 = Math.random();
    const u3 = Math.random();
    const avg = (u1 + u2 + u3) / 3;
    return Math.floor(min + avg * (max - min));
  }

  async randomDelay(min = 800, max = 2500) {
    const delay = this.randomBetween(min, max);
    await this.sleep(delay);
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ════════════════════════════════════════════════════════════
  //  EXTERNAL CONTROLS (called from dashboard)
  // ════════════════════════════════════════════════════════════

  pause() {
    this.isPaused = true;
    log('warn', 'CORE', '⏸ Bot PAUSED by user');
  }

  resume() {
    this.isPaused = false;
    log('success', 'CORE', '▶️ Bot RESUMED by user');
  }

  async forceDepartNow() {
    log('action', 'CORE', '⚡ Force depart triggered by user');
    await this.startEcoCampaign();
    await this.sleep(1000);
    await this.departAll();
  }

  async forceFuelCheck() {
    log('action', 'CORE', '⚡ Force fuel check triggered by user');
    await this.checkFuel();
    await this.sleep(2000);
    await this.checkCO2();
  }

  getStatus() {
    const uptime = this.stats.startTime
      ? Math.round((Date.now() - this.stats.startTime.getTime()) / 1000)
      : 0;

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      uptime,
      lastError: this.lastError,
      config: {
        fuelThreshold: this.config.fuelThreshold,
        co2Threshold: this.config.co2Threshold,
        minBankBalance: this.config.minBankBalance,
        maintenanceWearThreshold: this.config.maintenanceWearThreshold,
      },
      stats: { ...this.stats },
      logs: getLogs(150),
    };
  }

  updateConfig(newConfig) {
    if (newConfig.fuelThreshold) this.config.fuelThreshold = parseInt(newConfig.fuelThreshold);
    if (newConfig.co2Threshold) this.config.co2Threshold = parseInt(newConfig.co2Threshold);
    if (newConfig.minBankBalance) this.config.minBankBalance = parseInt(newConfig.minBankBalance);
    if (newConfig.maintenanceWearThreshold) this.config.maintenanceWearThreshold = parseInt(newConfig.maintenanceWearThreshold);
    log('success', 'CONFIG', `⚙️ Config updated: ${JSON.stringify(newConfig)}`);
  }

  async shutdown() {
    log('warn', 'CORE', '🛑 Shutting down...');
    this.isRunning = false;
    try {
      if (this.browser) await this.browser.close();
    } catch (e) {}
  }
}

module.exports = AM4Bot;
