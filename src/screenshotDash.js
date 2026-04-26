// ============================================================
//  SCREENSHOT DASHBOARD — with proper Telegram error logging
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
    if (!TOKEN || !CHAT_ID) { log('⚠️', 'No Telegram token/chat ID'); resolve(); return; }
    if (!fs.existsSync(filePath)) { log('⚠️', `File not found: ${filePath}`); resolve(); return; }

    const fileData = fs.readFileSync(filePath);
    const fileSize = fileData.length;
    log('📤', `Uploading screenshot (${Math.round(fileSize/1024)}KB)...`);

    const boundary = '----AM4Bot' + Date.now();
    const captionText = (caption || '').slice(0, 1024);

    // Build multipart body properly
    const header = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="chat_id"\r\n\r\n`,
      `${CHAT_ID}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="parse_mode"\r\n\r\n`,
      `HTML\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="caption"\r\n\r\n`,
      `${captionText}\r\n`,
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="photo"; filename="dashboard.png"\r\n`,
      `Content-Type: image/png\r\n\r\n`,
    ].join('');

    const footer = `\r\n--${boundary}--\r\n`;

    const headerBuf = Buffer.from(header, 'utf8');
    const footerBuf = Buffer.from(footer, 'utf8');
    const body = Buffer.concat([headerBuf, fileData, footerBuf]);

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
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          log('✅', 'Screenshot sent to Telegram!');
        } else {
          log('❌', `Telegram API error ${res.statusCode}: ${responseData.slice(0, 200)}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      log('❌', `Upload error: ${e.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}

async function sendScreenshot(page, caption) {
  try {
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    const stats = fs.statSync(SCREENSHOT_PATH);
    log('📸', `Screenshot taken (${Math.round(stats.size/1024)}KB)`);
    await sendPhotoToTelegram(SCREENSHOT_PATH, caption);
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
