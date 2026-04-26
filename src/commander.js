// ============================================================
//  COMMANDER — Two-Way Telegram Command System
//  Poll Telegram for incoming commands every cycle
//  Commands: /status /balance /pause /resume /buyfuel /report /routes
// ============================================================

const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

let lastUpdateId = 0;
let paused = false;

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [COMMANDER] ${msg}`);
}

function tlgRequest(method, body = {}) {
  return new Promise((resolve) => {
    if (!TOKEN) { resolve(null); return; }
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

function sendReply(text) {
  if (!TOKEN || !CHAT_ID) return Promise.resolve();
  return tlgRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML' });
}

// Poll Telegram for new commands
async function pollCommands() {
  if (!TOKEN || !CHAT_ID) return [];

  const result = await tlgRequest('getUpdates', {
    offset: lastUpdateId + 1,
    timeout: 2,
    allowed_updates: ['message']
  });

  if (!result?.ok || !result.result?.length) return [];

  const commands = [];
  for (const update of result.result) {
    lastUpdateId = Math.max(lastUpdateId, update.update_id);
    const msg = update.message;
    // Only accept commands from your own chat
    if (!msg || String(msg.chat.id) !== String(CHAT_ID)) continue;
    const text = (msg.text || '').trim().toLowerCase();
    if (text.startsWith('/')) {
      commands.push(text.split(' ')[0]); // strip params for now
      log('📩', `Received command: ${text}`);
    }
  }
  return commands;
}

// Execute a command from Telegram
async function executeCommand(cmd, page, state, reporter, routes) {
  switch(cmd) {
    case '/pause':
      paused = true;
      await sendReply('⏸ <b>Bot paused!</b>\nDepartures will be skipped until you send /resume');
      log('⏸', 'Bot paused by Telegram command');
      break;

    case '/resume':
      paused = false;
      await sendReply('▶️ <b>Bot resumed!</b>\nBack to normal departures.');
      log('▶️', 'Bot resumed by Telegram command');
      break;

    case '/status': {
      const s = state;
      const uptime = Math.floor((Date.now() - s.startTime) / 60000);
      const remaining = Math.floor((s.totalRuntime - (Date.now() - s.startTime)) / 60000);
      await sendReply([
        `🤖 <b>Bot Status</b>`,
        `💵 Balance: $${(s.bankBalance||0).toLocaleString()}`,
        `✈️ Departed (session): ${s.totalDeparted}`,
        `🔄 Cycle: #${s.cycleCount}`,
        `⏱ Uptime: ${uptime}m | Remaining: ${remaining}m`,
        `⏸ Paused: ${paused ? 'YES' : 'NO'}`,
      ].join('\n'));
      break;
    }

    case '/balance':
      await sendReply(`💵 <b>Current Balance</b>\n$${(state.bankBalance||0).toLocaleString()}`);
      break;

    case '/buyfuel':
      await sendReply('⛽ <b>Forced fuel buy triggered!</b>\nWill execute on next cycle.');
      state.forceFuelBuy = true;
      break;

    case '/report':
      if (reporter) {
        await reporter.sendInstantReport();
      } else {
        await sendReply('⚠️ Reporter not available.');
      }
      break;

    case '/routes':
      if (routes) {
        const report = routes.getRouteReport();
        await sendReply(report || '⚠️ No route data yet.');
      } else {
        await sendReply('⚠️ Route data not available yet — will be ready after first scan.');
      }
      break;

    default:
      await sendReply(`❓ Unknown command: ${cmd}\n\nAvailable: /status /balance /pause /resume /buyfuel /report /routes`);
  }
}

function isPaused() { return paused; }

module.exports = { pollCommands, executeCommand, isPaused, sendReply };
