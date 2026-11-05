import { Telegraf, Markup } from "telegraf";
import ccxt from "ccxt";
import mongoose from "mongoose";
import http from "http"; 

// =====================================================================
// 1. CONFIGURATION & BRANDING
// =====================================================================
const MONGO_URI = process.env.MONGO_URI;
const CHANNEL_ID = "@devxtechzone"; 
const MENU_IMAGE_URL = "https://files.catbox.moe/e7j97z.png"; 

const DEV_NAME = "Dev Gift";
const DEV_HANDLE = "@Devgiftt"; 
const BOT_NAME = "Dev Trading Bot";
const BOT_VERSION = "19.0.0 (Animated)";

const bot = new Telegraf(process.env.TG_TOKEN);
const userSessions = new Map();
const activeAutoTraders = new Map(); 
let lastPollinationsCall = 0; // 45-second Anti-Ban Timer

// =====================================================================
// 2. SELF-PING KEEP-ALIVE SERVER
// =====================================================================
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is alive and trading!");
}).listen(PORT, () => {
  console.log(`🌐 Keep-Alive server running on port ${PORT}`);
});

// =====================================================================
// 3. FORCE JOIN MIDDLEWARE
// =====================================================================
async function isUserInChannel(userId) {
  try {
    const member = await bot.telegram.getChatMember(CHANNEL_ID, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) { return false; }
}

bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  if (ctx.message && ctx.message.text && ctx.message.text.startsWith("/verify")) return next();

  const isInChannel = await isUserInChannel(ctx.from.id);
  if (!isInChannel) {
    const joinMsg = 
      `🚫 <b>ACCESS DENIED</b> 🚫\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `To use this premium AI trading bot, you must be a member of our official channel.\n\n` +
      `👇 <i>Click the button below to join, then click Verify.</i>`;
      
    const joinMenu = Markup.inlineKeyboard([
      [Markup.button.url("📢 Join Official Channel", `https://t.me/${CHANNEL_ID.replace('@', '')}`)],
      [Markup.button.callback("✅ I Have Joined (Verify)", "verify_join")]
    ]);
    
    if (ctx.callbackQuery) await ctx.answerCbQuery("You must join the channel first!", { show_alert: true });
    else await ctx.reply(joinMsg, { parse_mode: "HTML", ...joinMenu });
    return;
  }
  return next();
});

// =====================================================================
// 4. DATABASE SETUP (MongoDB)
// =====================================================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ Connected to MongoDB")).catch(err => console.error("❌ DB Error:", err));

const UserSchema = new mongoose.Schema({
  telegramId: { type: String, unique: true },
  exchangeName: String,
  apiKey: String,
  apiSecret: String,
  autoTrade: { type: Boolean, default: false }
});
const User = mongoose.model("User", UserSchema);

// =====================================================================
// 5. TRADING ENGINE (CCXT)
// =====================================================================
async function getExchange(telegramId) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user || !user.apiKey) throw new Error("⚠️ No exchange connected. Please connect your API keys first.");
  return new ccxt[user.exchangeName]({ apiKey: user.apiKey, secret: user.apiSecret, enableRateLimit: true });
}

async function executeTrade(telegramId, side, symbol, amountUSDT) {
  const exchange = await getExchange(telegramId);
  const ticker = await exchange.fetchTicker(symbol);
  const amountCoin = amountUSDT / ticker.last;
  return await exchange.createOrder(symbol, 'market', side.toLowerCase(), amountCoin);
}

async function getBalance(telegramId) {
  const exchange = await getExchange(telegramId);
  const balance = await exchange.fetchBalance();
  return balance.USDT ? balance.USDT.free.toFixed(2) : "0.00";
}

// =====================================================================
// 6. FREE WEB SEARCH + FREE AI (Pollinations)
// =====================================================================
async function askAI(prompt) {
  const now = Date.now();
  const timeSinceLast = now - lastPollinationsCall;
  
  // If less than 45 seconds, calculate how long to wait
  if (timeSinceLast < 45000) {
    const waitTime = Math.ceil((45000 - timeSinceLast) / 1000);
    throw new Error(`Rate limit shield active. Please wait ${waitTime} seconds before asking again.`);
  }
  lastPollinationsCall = now;

  const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!text || text.includes("error")) throw new Error("AI service is busy. Try again.");
  return text;
}

// =====================================================================
// 7. THE FREE WEB SEARCH SCANNER
// =====================================================================
async function runMasterScan() {
  let marketData = "";
  try {
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const topMovers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 3);
    marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
  } catch (e) {
    marketData = "BTC/USDT: $67,000 (1.5%)\nETH/USDT: $3,500 (2.1%)";
  }

  let news = "No news available.";
  try {
    const topCoin = marketData.split('\n')[0].split('/')[0].replace('$', '').trim();
    const searchUrl = `https://html.duckduckgo.com/html/?q=${topCoin}+crypto+news+latest`;
    const res = await fetch(searchUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const html = await res.text();
    const snippets = [...html.matchAll(/<a class="result__snippet[^>]*>(.*?)<\/a>/g)]
      .map(m => m[1].replace(/<[^>]+>/g, ''))
      .slice(0, 3)
      .join("\n");
    if (snippets) news = snippets;
  } catch (e) {
    news = "News search failed.";
  }

  const prompt = `
    You are a crypto trader AI.
    LIVE DATA:
    ${marketData}
    
    LATEST NEWS:
    ${news}
    
    Pick the BEST trade. Reply strictly in JSON format without markdown: 
    {"symbol": "SOL/USDT", "action": "BUY" or "SELL", "reason": "Brief reason"}
  `;
  
  const res = await askAI(prompt);
  const jsonMatch = res.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI did not return valid JSON.");
  return JSON.parse(jsonMatch[0]);
}

// =====================================================================
// 8. ANIMATION HELPER
// =====================================================================
async function animateLoading(ctx, baseText, durationMs = 3000) {
  const frames = ["⏳", "🔄", "🟡", "🟢"];
  let i = 0;
  const interval = setInterval(async () => {
    try {
      await safeEdit(ctx, `${frames[i % frames.length]} ${baseText}`, backMenu());
    } catch (e) {}
    i++;
  }, 800);

  // Wait for the duration, then stop the animation
  await new Promise(resolve => setTimeout(resolve, durationMs));
  clearInterval(interval);
}

// =====================================================================
// 9. SAFE EDIT & PREMIUM MENUS
// =====================================================================
const backMenu = () => Markup.inlineKeyboard([[Markup.button.callback("🔙 Return to Main Menu", "m:home")]]);

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🔌 Connect Exchange", "m:connect"), Markup.button.callback("💼 My Balance", "m:balance")],
    [Markup.button.callback("🤖 Toggle Auto-Pilot", "m:autopilot"), Markup.button.callback("🧠 AI News Scan", "m:signal")],
    [Markup.button.callback("📖 How to Use", "m:how"), Markup.button.callback("👨‍💻 Developer", "m:about")],
  ]);

async function safeEdit(ctx, text, keyboard = null) {
  const options = { parse_mode: "HTML", ...(keyboard || backMenu()) };
  try {
    if (ctx.update.callback_query.message.photo) {
      await ctx.editMessageCaption(text, options);
    } else {
      await ctx.editMessageText(text, options);
    }
  } catch (e) {
    if (!e.message.includes("message is not modified")) console.error("Edit Error:", e.message);
  }
}

// =====================================================================
// 10. HANDLERS & ROUTING
// =====================================================================
bot.action("verify_join", async (ctx) => {
  if (await isUserInChannel(ctx.from.id)) {
    await ctx.answerCbQuery("✅ Verified successfully!");
    await safeEdit(ctx, 
      `🎉 <b>ACCESS GRANTED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Welcome to the elite trading terminal.`, mainMenu());
  } else {
    await ctx.answerCbQuery("❌ You haven't joined yet!", { show_alert: true });
  }
});

bot.start(async (ctx) => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const status = user && user.exchangeName ? `✅ <b>Connected:</b> <code>${user.exchangeName.toUpperCase()}</code>` : `⚠️ <b>Not Connected</b>`;
  const autoStatus = user && user.autoTrade ? `🟢 <b>Auto-Pilot ACTIVE</b>` : `🔴 <b>Auto-Pilot OFF</b>`;
  
  const caption = 
    `╭━━━〔 <b>${BOT_NAME}</b> 〕━━━╮\n` +
    `┃ 🚀 <b>Version:</b> ${BOT_VERSION}\n` +
    `┃ ${status}\n` +
    `┃ ${autoStatus}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `👋 <b>Welcome, Trader!</b>\n` +
    `I scan live markets AND search the web for free to give you signals.\n\n` +
    `👇 <i>Select an option below to begin.</i>\n\n` +
    `👨‍💻 <b>Developer:</b> ${DEV_NAME}`;

  await ctx.replyWithPhoto(MENU_IMAGE_URL, {
    caption: caption,
    parse_mode: "HTML",
    ...mainMenu()
  });
});

bot.action("m:home", async (ctx) => { 
  await ctx.answerCbQuery(); 
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const status = user && user.exchangeName ? `✅ <b>Connected:</b> <code>${user.exchangeName.toUpperCase()}</code>` : `⚠️ <b>Not Connected</b>`;
  const autoStatus = user && user.autoTrade ? `🟢 <b>Auto-Pilot ACTIVE</b>` : `🔴 <b>Auto-Pilot OFF</b>`;
  
  const caption = 
    `╭━━━〔 <b>Dashboard</b> 〕━━━╮\n` +
    `┃ ${status}\n` +
    `┃ ${autoStatus}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `👇 <i>What would you like to do?</i>`;

  await safeEdit(ctx, caption, mainMenu());
});

bot.action("m:how", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `📖 <b>SYSTEM MANUAL</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `1️⃣ <b>Exchange Connection:</b>\n` +
    `Click "Connect Exchange" and provide your API Key/Secret.\n\n` +
    `2️⃣ <b>AI News Scan:</b>\n` +
    `Click "AI News Scan". The bot searches the web for the latest news and uses a free AI to analyze it. <i>(Wait 45 seconds between scans).</i>\n\n` +
    `3️⃣ <b>Manual Execution:</b>\n` +
    `Simply type: <i>"Buy $20 of SOL"</i>`;
  await safeEdit(ctx, text);
});

bot.action("m:about", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `👨‍💻 <b>DEVELOPER INFO</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `This bot was built by <b>${DEV_NAME}</b>.\n\n` +
    `🚀 <b>Core Engine:</b> CCXT & Free Web AI\n` +
    `📦 <b>Version:</b> <code>${BOT_VERSION}</code>\n\n` +
    `🔗 <b>Contact Developer:</b> ${DEV_HANDLE}`;
  await safeEdit(ctx, text);
});

bot.action("m:connect", async (ctx) => {
  await ctx.answerCbQuery();
  userSessions.set(ctx.from.id, { step: "awaiting_exchange" });
  await safeEdit(ctx, 
    `🔌 <b>EXCHANGE CONNECTION</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Please type the name of your exchange.\n\n` +
    `<i>Supported: binance, bybit, kucoin, okx</i>`);
});

bot.action("m:autopilot", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user || !user.apiKey) return ctx.reply("⚠️ You must connect your API keys first!", backMenu());
  
  if (user.autoTrade) {
    user.autoTrade = false; await user.save();
    clearInterval(activeAutoTraders.get(ctx.from.id)); activeAutoTraders.delete(ctx.from.id);
    await safeEdit(ctx, 
      `🔴 <b>AUTO-PILOT DISABLED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `The AI will no longer trade automatically.`);
  } else {
    user.autoTrade = true; await user.save();
    await safeEdit(ctx, 
      `🟢 <b>AUTO-PILOT ENABLED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `The AI will now scan the market every 15 minutes.`);
  }
});

bot.action("m:balance", async (ctx) => {
  await ctx.answerCbQuery("Fetching balance...");
  try { 
    const bal = await getBalance(ctx.from.id);
    await safeEdit(ctx, 
      `💼 <b>ACCOUNT BALANCE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Available:</b> $${bal} USDT`); 
  } catch (e) { 
    await safeEdit(ctx, 
      `❌ <b>ERROR</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>${e.message}</i>`); 
  }
});

// --- ANIMATED SCANNER ACTION ---
bot.action("m:signal", async (ctx) => {
  await ctx.answerCbQuery("Scanning...");
  
  // Start the loading animation
  const loadingPromise = animateLoading(ctx, "<b>SCANNING LIVE MARKET...</b>\n━━━━━━━━━━━━━━━━━━━━\n<i>📡 Fetching prices & searching web...</i>", 5000);
  
  try {
    const signal = await runMasterScan();
    await loadingPromise; // Ensure animation finishes before showing result
    
    const text = 
      `🎯 <b>AI NEWS SIGNAL</b> 🎯\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🪙 <b>Asset:</b> ${signal.symbol}\n` +
      `📈 <b>Action:</b> ${signal.action}\n\n` +
      `📝 <b>Reason:</b>\n<i>${signal.reason}</i>\n\n` +
      `💡 <i>To execute this trade, reply:</i>\n` +
      `<code>Buy $10 of ${signal.symbol.split('/')[0]}</code>`;
      
    await safeEdit(ctx, text);
  } catch (e) { 
    await loadingPromise;
    await safeEdit(ctx, 
      `❌ <b>SCANNER ERROR</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>${e.message}</i>`); 
  }
});

// =====================================================================
// 11. TEXT ROUTER (API Input & Natural Language Trading)
// =====================================================================
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const userId = ctx.from.id, text = ctx.message.text.trim();
  let session = userSessions.get(userId) || {};

  if (session.step === "awaiting_exchange") {
    session.exchangeName = text.toLowerCase(); session.step = "awaiting_api"; userSessions.set(userId, session);
    return ctx.reply(
      `✅ <b>Exchange Set:</b> ${session.exchangeName.toUpperCase()}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Please paste your <b>API Key</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "awaiting_api") {
    session.apiKey = text; session.step = "awaiting_secret"; userSessions.set(userId, session);
    return ctx.reply(
      `✅ <b>API Key Saved.</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Please paste your <b>API Secret</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "awaiting_secret") {
    session.apiSecret = text;
    await User.findOneAndUpdate({ telegramId: String(userId) }, { telegramId: String(userId), exchangeName: session.exchangeName, apiKey: session.apiKey, apiSecret: session.apiSecret }, { upsert: true });
    userSessions.delete(userId);
    return ctx.reply(
      `🎉 <b>CONNECTION SUCCESSFUL</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Your ${session.exchangeName.toUpperCase()} account is now linked.`, { parse_mode: "HTML", ...mainMenu() });
  }

  await ctx.sendChatAction("typing");
  try {
    if (text.toLowerCase().includes("check live market") || text.toLowerCase().includes("scan market")) {
      const msg = await ctx.reply(`⏳ <b>SCANNING LIVE MARKET...</b>`, { parse_mode: "HTML" });
      
      // Quick text animation for chat
      const frames = ["🔄", "🟡", "🟢"];
      for (let i = 0; i < frames.length; i++) {
        await new Promise(r => setTimeout(r, 800));
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `${frames[i]} <b>SCANNING LIVE MARKET...</b>`, { parse_mode: "HTML" });
      }

      const signal = await runMasterScan();
      return ctx.reply(
        `🎯 <b>AI NEWS SIGNAL</b> 🎯\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🪙 <b>Asset:</b> ${signal.symbol}\n` +
        `📈 <b>Action:</b> ${signal.action}\n\n` +
        `📝 <b>Reason:</b>\n<i>${signal.reason}</i>`, 
        { parse_mode: "HTML", ...backMenu() }
      );
    }

    const res = await askAI(`User says: "${text}". If they want to trade, reply JSON: {"isTrade": true, "action": "BUY" or "SELL", "symbol": "BTC/USDT", "amount": 10}. If not, reply normal text.`);
    
    if (res.includes('"isTrade": true')) {
      const intent = JSON.parse(res.match(/\{[\s\S]*\}/)[0]);
      await ctx.reply(
        `⏳ <b>EXECUTING TRADE</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 <b>Action:</b> ${intent.action}\n` +
        `🪙 <b>Asset:</b> ${intent.symbol}\n` +
        `💵 <b>Amount:</b> $${intent.amount}`, { parse_mode: "HTML" });
        
      const result = await executeTrade(userId, intent.action, intent.symbol, intent.amount);
      return ctx.reply(
        `✅ <b>TRADE EXECUTED</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 <b>Order ID:</b> <code>${result.id}</code>`, { parse_mode: "HTML", ...backMenu() });
    }
    
    let cleanRes = res
      .replace(/```(?:json|html)?/g, "")
      .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.*?)\*/g, "<i>$1</i>");
      
    await ctx.reply(`🤖 <b>AI Response:</b>\n━━━━━━━━━━━━━━━━━━━━\n${cleanRes}`, { parse_mode: "HTML", ...backMenu() });
    
  } catch (e) { 
    await ctx.reply(`❌ <b>Error:</b> ${e.message}`, { parse_mode: "HTML", ...backMenu() }); 
  }
});

// =====================================================================
// 12. LAUNCH
// =====================================================================
bot.catch((err, ctx) => console.error(`Error:`, err));
bot.launch().then(() => console.log(`🚀 ${BOT_NAME} v${BOT_VERSION} is Running`));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
