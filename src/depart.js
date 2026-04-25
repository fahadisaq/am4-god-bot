// ============================================================
//  DEPART MODULE
// ============================================================

const tg = require('./telegram');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

async function startEcoCampaign(page) {
  try {
    await page.evaluate(() => new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.onreadystatechange = () => { if (x.readyState===4) resolve(x.status); };
      x.open('GET','marketing_new.php?type=5&mode=do&c=1',true); x.send();
    }));
    log('✅','CAMPAIGN','Eco campaign started');
  } catch(e) { log('⚠️','CAMPAIGN',e.message); }
}

async function startRepCampaign(page) {
  const hoursLeft = 24 - new Date().getHours();
  const repOption = hoursLeft<=3?1 : hoursLeft<=7?2 : hoursLeft<=11?3 : hoursLeft<=15?4 : 0;
  if (repOption === 0) return;
  try {
    await page.evaluate(opt => new Promise(resolve => {
      const x = new XMLHttpRequest();
      x.onreadystatechange = () => { if (x.readyState===4) resolve(x.status); };
      x.open('GET',`marketing_new.php?type=1&c=4&mode=do&d=${opt}`,true); x.send();
    }), repOption);
    log('✅','CAMPAIGN',`Reputation campaign (opt ${repOption}) started`);
  } catch(e) { log('⚠️','CAMPAIGN',e.message); }
}

async function departAll(page) {
  log('✈️','DEPART','Checking flights...');

  // Start campaigns first
  await startEcoCampaign(page);
  await sleep(rand(800,1500));
  await startRepCampaign(page);
  await sleep(rand(1000,2000));

  // Close any open popups
  try { await page.evaluate(() => { if (typeof closePop==='function') closePop(); }); await sleep(500); } catch(e) {}

  let toDepart = await page.evaluate(() => {
    const el = document.getElementById('listDepartAmount');
    return el ? parseInt(el.innerText.trim())||0 : 0;
  });

  if (toDepart === 0) {
    log('ℹ️','DEPART','No flights to depart');
    return 0;
  }

  log('✈️','DEPART',`${toDepart} flight(s) ready!`);
  const originalCount = toDepart;

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

  const departed = originalCount - toDepart;
  if (departed > 0) {
    log('✅','DEPART',`Total departed: ${departed}`);
    await tg.departed(departed);
  }
  if (toDepart > 0) log('❌','DEPART',`${toDepart} failed to depart`);

  return departed;
}

module.exports = { departAll };
