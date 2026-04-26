// ============================================================
//  DEPART MODULE — with Smart Campaign Timing
// ============================================================

const tg = require('./telegram');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function log(icon, module, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [${module}] ${msg}`);
}

// Campaign throttle — run at most once per hour (not every 5-min cycle)
let lastCampaignRun = 0;
const CAMPAIGN_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REP_THRESHOLD = 85;  // Only run if rep below this %
const ECO_THRESHOLD = 85;  // Only run if eco below this %

// Check actual rep and eco scores from the game UI
async function checkScores(page) {
  try {
    const scores = await page.evaluate(() => {
      // AM4 typically shows rep/eco in header or stats panel
      let rep = 100, eco = 100;
      const els = document.querySelectorAll('[id*="rep"], [id*="eco"], [class*="reputation"], [class*="ecology"]');
      for (const el of els) {
        const text = el.innerText || '';
        const match = text.match(/(\d+)%?/);
        if (match) {
          const val = parseInt(match[1]);
          if (el.id?.includes('rep') || el.className?.includes('rep')) rep = val;
          if (el.id?.includes('eco') || el.className?.includes('eco')) eco = val;
        }
      }
      return { rep, eco };
    });
    return scores;
  } catch(e) {
    return { rep: 100, eco: 100 }; // assume full — don't waste money
  }
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

  // ── Smart Campaign Timing (max once per hour, only if needed) ──
  const timeSinceLastCampaign = Date.now() - lastCampaignRun;
  if (timeSinceLastCampaign >= CAMPAIGN_INTERVAL_MS) {
    const scores = await checkScores(page);
    log('📊','CAMPAIGN',`Rep: ${scores.rep}% | Eco: ${scores.eco}%`);

    if (scores.eco < ECO_THRESHOLD) {
      log('🌿','CAMPAIGN',`Eco ${scores.eco}% < ${ECO_THRESHOLD}% — starting eco campaign`);
      await startEcoCampaign(page);
      await sleep(rand(800,1500));
    } else {
      log('ℹ️','CAMPAIGN',`Eco ${scores.eco}% is healthy — skipping eco campaign 💰`);
    }

    if (scores.rep < REP_THRESHOLD) {
      log('⭐','CAMPAIGN',`Rep ${scores.rep}% < ${REP_THRESHOLD}% — starting rep campaign`);
      await startRepCampaign(page);
      await sleep(rand(800,1500));
    } else {
      log('ℹ️','CAMPAIGN',`Rep ${scores.rep}% is healthy — skipping rep campaign 💰`);
    }

    lastCampaignRun = Date.now();
  } else {
    const nextCampaign = Math.ceil((CAMPAIGN_INTERVAL_MS - timeSinceLastCampaign) / 60000);
    log('ℹ️','CAMPAIGN',`Next check in ~${nextCampaign}m`);
  }

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
