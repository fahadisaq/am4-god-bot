// ============================================================
//  LOGIN MODULE — with auto re-login on session expiry
// ============================================================

const tg = require('./telegram');

const EMAIL = process.env.AM4_EMAIL;
const PASSWORD = process.env.AM4_PASSWORD;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
  await page.setRequestInterception(true);
  page.on('request', req => {
    // Only block fonts/media — keep images+CSS so screenshots look correct
    ['font','media'].includes(req.resourceType()) ? req.abort() : req.continue();
  });
  return page;
}

async function doLogin(page) {
  log('🔑','LOGIN','Navigating to AM4...');
  await page.goto('https://www.airlinemanager.com/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(3000);
  log('🔑','LOGIN',`Page: "${await page.title()}"`);

  // Dismiss cookie consent
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,div')) {
      const t = (el.textContent||'').toLowerCase();
      if (t.includes('accept')||t.includes('agree')||t.includes('got it')) { el.click(); break; }
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
    if (e) { e.value=email; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }
    if (p) { p.value=password; p.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('change',{bubbles:true})); }
    if (r && !r.checked) r.click();
  }, EMAIL, PASSWORD);
  await sleep(500);

  await page.evaluate(() => { const b=document.getElementById('btnLogin'); if(b) b.click(); });
  log('🔑','LOGIN','Submitted — waiting for game...');
  await sleep(8000);

  const loggedIn = await page.evaluate(() =>
    !!document.getElementById('headerAccount') || !!document.getElementById('listDepartAmount')
  );

  if (!loggedIn) {
    // Save screenshot for debugging
    try {
      await page.screenshot({ path: '/tmp/am4-login-fail.png', fullPage: true });
      log('📸','DEBUG','Screenshot saved');
    } catch(e) {}
    throw new Error('Login verification failed');
  }

  log('✅','LOGIN','Login successful!');
  return page;
}

// Check if session is still alive
async function isSessionAlive(page) {
  try {
    const alive = await page.evaluate(() =>
      !!document.getElementById('headerAccount') || !!document.getElementById('listDepartAmount')
    );
    return alive;
  } catch(e) {
    return false;
  }
}

// Auto re-login if session expired
async function ensureLoggedIn(browser, page) {
  const alive = await isSessionAlive(page);
  if (alive) return page;

  log('⚠️','LOGIN','Session expired — re-logging in...');
  await tg.relogin();

  try {
    await page.close();
  } catch(e) {}

  const newPage = await setupPage(browser);
  return await doLogin(newPage);
}

async function login(browser) {
  const page = await setupPage(browser);
  return await doLogin(page);
}

module.exports = { login, ensureLoggedIn };
