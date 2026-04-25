// ============================================================
//  TELEGRAM NOTIFICATIONS
// ============================================================

const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendMessage(text) {
  return new Promise((resolve) => {
    if (!TOKEN || !CHAT_ID) { resolve(); return; }

    const body = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => resolve());
    });

    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

module.exports = {
  // Bot started
  started: (cycle) => sendMessage(
    `🚀 <b>AM4 God Bot Started</b>\n` +
    `📅 ${new Date().toUTCString()}\n` +
    `🔄 Will run ${cycle} cycles (5h50m)`
  ),

  // Flights departed
  departed: (count) => sendMessage(
    `✈️ <b>Flights Departed!</b>\n` +
    `🛫 ${count} flight(s) departed\n` +
    `⏰ ${new Date().toUTCString()}`
  ),

  // Fuel bought
  fuelBought: (amount, price, cost) => sendMessage(
    `⛽ <b>Fuel Purchased!</b>\n` +
    `🛢 Amount: ${amount.toLocaleString()} lbs\n` +
    `💲 Price: $${price}/1000\n` +
    `💰 Total: $${cost.toLocaleString()}`
  ),

  // CO2 bought
  co2Bought: (amount, price, cost) => sendMessage(
    `🌿 <b>CO2 Purchased!</b>\n` +
    `📦 Amount: ${amount.toLocaleString()} quotas\n` +
    `💲 Price: $${price}/1000\n` +
    `💰 Total: $${cost.toLocaleString()}`
  ),

  // Bonus collected
  bonusCollected: (amount) => sendMessage(
    `🎁 <b>Daily Bonus Collected!</b>\n` +
    `💵 Amount: $${amount.toLocaleString()}`
  ),

  // Alliance contribution
  allianceContributed: () => sendMessage(
    `🤝 <b>Alliance Contribution Done!</b>`
  ),

  // Maintenance done
  maintenanceDone: (count) => sendMessage(
    `🔧 <b>Maintenance Done!</b>\n` +
    `✈️ ${count} aircraft maintained`
  ),

  // Cycle summary (every 30 min)
  cycleSummary: (data) => sendMessage(
    `📊 <b>Bot Status Update</b>\n` +
    `💵 Balance: $${data.balance.toLocaleString()}\n` +
    `✈️ Departed: ${data.departed} flights\n` +
    `⛽ Fuel: $${data.fuelPrice}\n` +
    `🌿 CO2: $${data.co2Price}\n` +
    `🔄 Cycle: #${data.cycle}\n` +
    `⏱ Running: ${data.elapsed}m`
  ),

  // Error alert
  error: (module, msg) => sendMessage(
    `❌ <b>Bot Error!</b>\n` +
    `📍 Module: ${module}\n` +
    `⚠️ Error: ${msg}\n` +
    `⏰ ${new Date().toUTCString()}`
  ),

  // Login failed
  loginFailed: () => sendMessage(
    `🔐 <b>Login Failed!</b>\n` +
    `⚠️ Bot could not log in to AM4\n` +
    `🔄 Will retry next cycle\n` +
    `⏰ ${new Date().toUTCString()}`
  ),

  // Session expired — re-logging in
  relogin: () => sendMessage(
    `🔄 <b>Session Expired — Re-logging in...</b>`
  ),

  // Bot finished
  finished: (cycles, elapsed) => sendMessage(
    `🏁 <b>Bot Session Complete</b>\n` +
    `✅ ${cycles} cycles completed\n` +
    `⏱ Runtime: ${elapsed} minutes\n` +
    `🔄 Next session in ~10 minutes`
  ),
};
