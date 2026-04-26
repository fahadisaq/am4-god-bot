// ============================================================
//  SCREENSHOT DASHBOARD — Visual Telegram Updates
//  Takes a screenshot every 30 min and sends to Telegram
// ============================================================

const https = require('https');
const fs = require('fs');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const SCREENSHOT_PATH = '/tmp/am4-dashboard.png';
let lastScreenshot = 0;
const SCREENSHOT_INTERVAL = 30 * 60 * 1000; // every 30 min

function log(icon, msg) {
  console.log(`${icon} [${new Date().toISOString().slice(11,19)}] [SCREENSHOT] ${msg}`);
}

function sendPhotoToTelegram(filePath, caption) {
  return new Promise((resolve) => {
    if (!TOKEN || !CHAT_ID) { resolve(); return; }
    if (!fs.existsSync(filePath)) { resolve(); return; }

    const fileData = fs.readFileSync(filePath);
    const boundary = '----AM4BotBoundary' + Date.now();
    const captionEncoded = (caption || '').slice(0, 1024);

    // Build multipart/form-data body
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nHTML`,
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${captionEncoded}`,
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="dashboard.png"\r\nContent-Type: image/png\r\n\r\n`,
    ];

    const textPart = Buffer.from(parts.join('\r\n') + '\r\n', 'utf8');
    const closingPart = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([textPart, fileData, closingPart]);

    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/sendPhoto`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
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

async function sendScreenshot(page, caption) {
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    log('📸', 'Screenshot taken — sending to Telegram...');
    await sendPhotoToTelegram(SCREENSHOT_PATH, caption);
    log('✅', 'Screenshot sent to Telegram!');
  } catch(e) {
    log('⚠️', `Screenshot failed: ${e.message}`);
  }
}

async function checkScreenshotDashboard(page, cycleCount, bankBalance, departures) {
  if (Date.now() - lastScreenshot < SCREENSHOT_INTERVAL) return;
  lastScreenshot = Date.now();

  const caption = [
    `📸 <b>AM4 Live Dashboard</b>`,
    `⏰ ${new Date().toUTCString()}`,
    `💵 Balance: $${bankBalance.toLocaleString()}`,
    `✈️ Flights departed (session): ${departures}`,
    `🔄 Cycle: #${cycleCount}`,
  ].join('\n');

  await sendScreenshot(page, caption);
}

module.exports = { checkScreenshotDashboard, sendScreenshot };
