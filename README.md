# ✈️ AM4 God Bot — 24/7 Cloud Automation

A god-level Airline Manager 4 bot that runs **24/7 on the cloud** — even when your computer is off. Comes with a beautiful web dashboard to monitor and control everything from your phone.

> ⚠️ **Disclaimer**: Using bots in AM4 is against the Terms of Service. Use at your own risk, for educational purposes only.

## 🚀 Features

| Module | Description |
|--------|-------------|
| ✈️ **Auto-Depart** | Departs all flights every 4-6 minutes with random timing |
| ⛽ **Smart Fuel Buyer** | Buys fuel when price drops below threshold, tracks price history |
| 🌿 **Smart CO2 Buyer** | Same for CO2 quotas with budget protection |
| 📊 **Campaign Manager** | Auto-starts eco-friendly + reputation campaigns |
| 🔧 **A-Check Maintenance** | Monitors aircraft wear and schedules maintenance |
| 🛡️ **Anti-Detection** | Gaussian random delays, night mode pause, human-like behavior |
| 🌐 **Web Dashboard** | Beautiful real-time dashboard accessible from anywhere |
| 📈 **Price Charts** | Tracks fuel/CO2 prices over time with visual graphs |
| 💵 **Balance Tracker** | Monitors bank balance and spending |
| 🔄 **Auto-Recovery** | Handles crashes, session expiry, connection loss automatically |

## 📱 Dashboard Preview

Access the dashboard from your phone/browser at your deployment URL:
- Live stats (balance, departures, fuel/CO2 prices)
- Price history charts
- Bot controls (pause/resume, force depart, force fuel check)
- Configurable settings
- Live activity log

---

## 🧑‍💻 Setup — Local (on your Mac)

```bash
# 1. Go to the bot directory
cd ~/Downloads/am4-god-bot

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env

# 4. Edit .env with your AM4 credentials
nano .env   # or open in any editor

# 5. Run the bot
npm start
```

Dashboard will be at: `http://localhost:3000`

---

## ☁️ Deploy to Cloud (FREE — Runs 24/7)

### Option 1: Render.com (Easiest, Free)

1. Create account at [render.com](https://render.com) (no credit card needed)
2. Push this code to a GitHub repo:
   ```bash
   cd ~/Downloads/am4-god-bot
   git init
   git add .
   git commit -m "AM4 God Bot"
   # Create repo on GitHub, then:
   git remote add origin https://github.com/YOUR_USERNAME/am4-god-bot.git
   git push -u origin main
   ```
3. On Render → **New** → **Web Service** → Connect your GitHub repo
4. Settings:
   - **Runtime**: Docker
   - **Plan**: Free
5. Add **Environment Variables**:
   - `AM4_EMAIL` = your AM4 email
   - `AM4_PASSWORD` = your AM4 password
   - `DASHBOARD_PASSWORD` = any password for the dashboard
6. Click **Deploy**
7. Your dashboard URL will be: `https://am4-god-bot.onrender.com`

> Note: Render free tier may spin down after 15 min of no web traffic. The bot has a built-in self-ping to prevent this.

---

### Option 2: Fly.io (Free tier, always-on)

```bash
# Install flyctl
brew install flyctl

# Login
fly auth login

# Launch
cd ~/Downloads/am4-god-bot
fly launch --name am4-god-bot --region iad --no-deploy

# Set secrets
fly secrets set AM4_EMAIL=your_email@example.com
fly secrets set AM4_PASSWORD=your_password
fly secrets set DASHBOARD_PASSWORD=your_dashboard_pass

# Deploy
fly deploy
```

Dashboard: `https://am4-god-bot.fly.dev`

---

### Option 3: Oracle Cloud (Best — Always Free VPS)

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (credit card for verification only, never charged)
2. Create an **Always Free** ARM instance (4 cores, 24GB RAM!)
3. SSH into the instance
4. Install Node.js & Chrome:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm chromium-browser
   ```
5. Clone your repo and set up:
   ```bash
   git clone https://github.com/YOUR_USERNAME/am4-god-bot.git
   cd am4-god-bot
   npm install
   cp .env.example .env
   nano .env  # fill in credentials
   ```
6. Run with PM2 (process manager, auto-restart):
   ```bash
   sudo npm install -g pm2
   pm2 start src/index.js --name am4-bot
   pm2 save
   pm2 startup  # auto-start on server reboot
   ```

Dashboard: `http://YOUR_SERVER_IP:3000`

---

## ⚙️ Configuration

All settings can be changed in `.env` or via the web dashboard:

| Setting | Default | Description |
|---------|---------|-------------|
| `FUEL_THRESHOLD` | 500 | Buy fuel below this price |
| `CO2_THRESHOLD` | 120 | Buy CO2 below this price |
| `MIN_BANK_BALANCE` | 500000 | Never spend below this |
| `MAINTENANCE_WEAR_THRESHOLD` | 50 | A-check at this wear % |
| `DEPART_INTERVAL_MIN` | 270000 | Min ms between depart checks (4.5 min) |
| `DEPART_INTERVAL_MAX` | 330000 | Max ms between depart checks (5.5 min) |
| `SCAN_INTERVAL` | 900000 | Fuel/CO2 check interval (15 min) |
| `NIGHT_PAUSE_START` | 2 | UTC hour to pause (anti-detection) |
| `NIGHT_PAUSE_END` | 5 | UTC hour to resume |
| `DASHBOARD_PASSWORD` | changeme123 | Password for web dashboard |

---

## 🛡️ Anti-Detection Features

- **Gaussian random delays** between all actions (not uniform random)
- **Night mode pause** — bot sleeps during configurable hours
- **Human-like typing** — credentials typed character by character with variable delays
- **Random cycle intervals** — 4.5-5.5 minutes between depart checks
- **Resource blocking** — doesn't load images/CSS (reduces server requests)
- **Realistic user agent** — mimics Chrome on Windows
- **Session recovery** — re-logs in when session expires instead of spamming requests

## 📝 License

MIT — Educational purposes only.
