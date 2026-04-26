// ============================================================
//  LOANS — Smart Loan Manager
//  Takes short-term loans when fuel prices are extremely low
//  Repays automatically when bank balance recovers
// ============================================================

const tg = require('./telegram');

const MIN_BANK_BALANCE = parseInt(process.env.MIN_BANK_BALANCE) || 500000;
const LOAN_FUEL_THRESHOLD = parseInt(process.env.FUEL_THRESHOLD) || 500;
const EXTREME_DIP_MULTIPLIER = 0.75; // Only take loans if fuel is 25% below threshold (truly great deal)

let activeLoan = null; // { amount, takenAt, repayTarget }
let lastLoanCheck = 0;
const LOAN_CHECK_INTERVAL = 30 * 60 * 1000; // Check every 30 min

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [LOANS] ${msg}`);
}

async function getLoanOffers(page) {
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('bank.php', 'Bank', false, false, true);
    });
    await new Promise(r => setTimeout(r, 2500));

    const offers = await page.evaluate(() => {
      const items = document.querySelectorAll('.loan-item, [class*="loan"], #bankMain tr');
      const results = [];
      items.forEach(item => {
        const text = item.innerText || '';
        const amountMatch = text.match(/\$?([\d,]+)/);
        const rateMatch = text.match(/([\d.]+)%/);
        if (amountMatch && rateMatch) {
          results.push({
            amount: parseInt(amountMatch[1].replace(/,/g, '')),
            rate: parseFloat(rateMatch[1]),
            element: item.innerText.slice(0, 50)
          });
        }
      });
      return results;
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}
    return offers;
  } catch(e) {
    log('⚠️', `Could not read loan offers: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
    return [];
  }
}

async function takeLoan(page, offer) {
  log('🏦', `Taking loan of $${offer.amount.toLocaleString()} at ${offer.rate}%`);
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('bank.php', 'Bank', false, false, true);
    });
    await new Promise(r => setTimeout(r, 2000));

    const taken = await page.evaluate(() => {
      const btns = document.querySelectorAll('button, [onclick]');
      for (const btn of btns) {
        const text = (btn.textContent || '').toLowerCase();
        if (text.includes('take loan') || text.includes('borrow') || text.includes('apply')) {
          btn.click();
          return true;
        }
      }
      return false;
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}

    if (taken) {
      activeLoan = {
        amount: offer.amount,
        takenAt: Date.now(),
        repayTarget: Date.now() + (6 * 60 * 60 * 1000) // try to repay within 6 hours
      };
      await tg.send(
        `🏦 <b>Smart Loan Taken!</b>\n` +
        `💵 Amount: $${offer.amount.toLocaleString()}\n` +
        `📊 Rate: ${offer.rate}%\n` +
        `💡 Using to buy cheap fuel — will repay after revenue cycle`
      );
      log('✅', `Loan taken: $${offer.amount.toLocaleString()}`);
      return true;
    }
    return false;
  } catch(e) {
    log('⚠️', `Loan failed: ${e.message}`);
    return false;
  }
}

async function checkAndRepayLoan(page, bankBalance) {
  if (!activeLoan) return;

  const repayThreshold = MIN_BANK_BALANCE * 3; // repay when we're well above buffer
  if (bankBalance >= repayThreshold) {
    log('🏦', `Bank healthy ($${bankBalance.toLocaleString()}) — attempting loan repayment`);
    try {
      await page.evaluate(() => {
        if (typeof popup === 'function') popup('bank.php', 'Bank', false, false, true);
      });
      await new Promise(r => setTimeout(r, 2000));

      const repaid = await page.evaluate(() => {
        const btns = document.querySelectorAll('button, [onclick]');
        for (const btn of btns) {
          const text = (btn.textContent || '').toLowerCase();
          if (text.includes('repay') || text.includes('pay back') || text.includes('payoff')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}

      if (repaid) {
        await tg.send(`✅ <b>Loan Repaid!</b>\n💰 Balance: $${bankBalance.toLocaleString()}\n📈 Profit from loan cycle complete!`);
        activeLoan = null;
        log('✅', 'Loan repaid successfully!');
      }
    } catch(e) {
      log('⚠️', `Repay attempt failed: ${e.message}`);
    }
  }
}

async function checkSmartLoan(page, bankBalance, currentFuelPrice) {
  if (Date.now() - lastLoanCheck < LOAN_CHECK_INTERVAL) return;
  lastLoanCheck = Date.now();

  // Don't take more than 1 loan at a time
  if (activeLoan) {
    await checkAndRepayLoan(page, bankBalance);
    return;
  }

  // Only take a loan if fuel price is an EXTREME dip (>25% below threshold — truly rare)
  const extremeDipPrice = LOAN_FUEL_THRESHOLD * EXTREME_DIP_MULTIPLIER;
  if (!currentFuelPrice || currentFuelPrice > extremeDipPrice) {
    log('ℹ️', `Fuel $${currentFuelPrice} not extreme enough for loan strategy (need <$${extremeDipPrice})`);
    return;
  }

  log('🚨', `EXTREME fuel price $${currentFuelPrice}! Checking loan options...`);
  const offers = await getLoanOffers(page);

  if (!offers.length) {
    log('ℹ️', 'No loan offers available');
    return;
  }

  // Pick lowest rate loan
  const bestOffer = offers.sort((a, b) => a.rate - b.rate)[0];
  log('🏦', `Best loan offer: $${bestOffer.amount.toLocaleString()} at ${bestOffer.rate}%`);

  // Take it only if rate is reasonable (< 5%)
  if (bestOffer.rate < 5) {
    await takeLoan(page, bestOffer);
  } else {
    log('ℹ️', `Rate ${bestOffer.rate}% too high — skipping loan`);
  }
}

module.exports = { checkSmartLoan, checkAndRepayLoan };
