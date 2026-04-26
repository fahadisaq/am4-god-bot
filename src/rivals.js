// ============================================================
//  RIVALS — Competitor Rank Tracker
//  Scrapes leaderboard, alerts if rivals close in on your rank
// ============================================================

const tg = require('./telegram');

let myLastRank = null;
let rivalHistory = {};

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [RIVALS] ${msg}`);
}

async function checkRanking(page) {
  log('🏆', 'Checking leaderboard...');
  try {
    await page.evaluate(() => {
      if (typeof popup === 'function') popup('alliance.php?mode=score', 'Scores', false, false, true);
    });
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
      // Only look inside the popup container
      const popup = document.getElementById('popMain') 
        || document.querySelector('.popup-content')
        || document.getElementById('popContent');
      
      if (!popup) return { players: [], myName: '' };
      
      const rows = popup.querySelectorAll('tr, .score-row');
      const players = [];
      rows.forEach((row, idx) => {
        const cols = row.querySelectorAll('td');
        if (cols.length < 2) return;
        const name = cols[0]?.innerText?.trim() || '';
        const scoreText = cols[1]?.innerText || cols[2]?.innerText || '';
        const score = parseInt(scoreText.replace(/[^0-9]/g, '')) || 0;
        if (name && score > 0) players.push({ rank: idx + 1, name, score });
      });

      // Also try to find "you" marker
      const youEl = document.querySelector('[class*="me"], [class*="you"], .highlight-row');
      const myName = youEl ? (youEl.querySelector('td')?.innerText?.trim() || '') : '';

      return { players, myName };
    });

    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e) {}

    if (!data.players.length) {
      log('⚠️', 'Could not read leaderboard');
      return;
    }

    // Try to find own entry
    const myEntry = data.players.find(p =>
      p.name === data.myName ||
      (myLastRank && Math.abs(p.rank - myLastRank) <= 2)
    );

    if (myEntry) {
      log('🏆', `Your rank: #${myEntry.rank} (score: ${myEntry.score.toLocaleString()})`);

      // Detect rank drop
      if (myLastRank && myEntry.rank > myLastRank + 2) {
        const dropped = myEntry.rank - myLastRank;
        await tg.send(
          `⚠️ <b>Rank Alert!</b>\n` +
          `📉 You dropped ${dropped} positions!\n` +
          `📊 Now: #${myEntry.rank} (was #${myLastRank})\n` +
          `💡 Bot is working to recover — check your flights!`
        );
      }
      myLastRank = myEntry.rank;

      // Check rivals immediately above and below
      const rivals = data.players.filter(p =>
        p.rank >= myEntry.rank - 3 && p.rank <= myEntry.rank + 3 && p.name !== myEntry.name
      );

      for (const rival of rivals) {
        const gap = Math.abs(rival.score - myEntry.score);
        const prev = rivalHistory[rival.name];

        // Alert if a rival behind you is closing in fast
        if (rival.rank > myEntry.rank && prev && prev.gap < gap * 0.8) {
          await tg.send(
            `🚨 <b>Rival Closing In!</b>\n` +
            `👤 ${rival.name} is gaining on you fast!\n` +
            `📊 Score gap: ${gap.toLocaleString()} (was ${prev.gap.toLocaleString()})\n` +
            `🏆 Their rank: #${rival.rank} | Your rank: #${myEntry.rank}`
          );
        }

        rivalHistory[rival.name] = { gap, rank: rival.rank, score: rival.score };
      }

      // Weekly top-3 report
      const top3 = data.players.slice(0, 3);
      log('🏆', `Top 3: ${top3.map(p => `#${p.rank} ${p.name}`).join(' | ')}`);
    } else {
      log('⚠️', 'Could not identify your position in leaderboard');
    }
  } catch(e) {
    log('⚠️', `Leaderboard check failed: ${e.message}`);
    try { await page.evaluate(() => { if (typeof closePop === 'function') closePop(); }); } catch(e2) {}
  }
}

module.exports = { checkRanking };
