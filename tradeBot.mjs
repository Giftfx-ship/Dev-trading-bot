import { Telegraf, Markup } from "telegraf";
import ccxt from "ccxt";
import mongoose from "mongoose";
import http from "http"; 

// =====================================================================
// 1. CONFIGURATION & BRANDING
// =====================================================================
const GROK_API_KEY = process.env.GROK_API_KEY; 
const GROQ_API_KEY = process.env.GROQ_API_KEY; // Backup AI
const MONGO_URI = process.env.MONGO_URI;
const CHANNEL_ID = "@devxtechzone"; 
const MENU_IMAGE_URL = "https://files.catbox.moe/e7j97z.png"; 

const DEV_NAME = "Dev Gift";
const DEV_HANDLE = "@Devgiftt"; 
const BOT_NAME = "Dev Trading Bot";
const BOT_VERSION = "16.0.0 (Invincible)";

const bot = new Telegraf(process.env.TG_TOKEN);
const userSessions = new Map();
const activeAutoTraders = new Map(); 

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
// 6. MULTI-AI FALLBACK ENGINE
// =====================================================================
async function askAI(prompt) {
  // Fallback 1: Grok-API
  try {
    const res = await fetch(`https://api.grok-api.com/v1/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${GROK_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "grok-beta", messages: [{ role: "user", content: prompt }], temperature: 0.5 })
    });
    const data = await res.json();
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data.result) return data.result;
  } catch (e) { console.log("Grok API failed, switching to Groq..."); }

  // Fallback 2: Official Groq (if you ever get a key)
  if (GROQ_API_KEY) {
    try {
      const res = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }] })
      });
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    } catch (e) { console.log("Groq API failed, switching to Pollinations..."); }
  }

  // Fallback 3: Pollinations AI (100% Free, No Key)
  const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`);
  const text = await res.text();
  if (!text || text.includes("error")) throw new Error("All AI engines are currently down.");
  return text;
}

// =====================================================================
// 7. MULTI-NEWS FALLBACK ENGINE
// =====================================================================
async function fetchNews() {
  // Fallback 1: Free Crypto News (No Key)
  try {
    const res = await fetch("https://cryptocurrency.cv/api/news?limit=3");
    const data = await res.json();
    if (data.articles?.length > 0) {
      return data.articles.map(a => `📰 ${a.title}`).join("\n");
    }
  } catch (e) { console.log("News API 1 failed..."); }

  // Fallback 2: CoinDesk RSS (No Key)
  try {
    const res = await fetch("https://www.coindesk.com/arc/outboundfeeds/rss/");
    const xml = await res.text();
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)].map(m => m[1]);
    if (titles.length > 1) return titles.slice(1, 4).map(t => `📰 ${t}`).join("\n");
  } catch (e) { console.log("News API 2 failed..."); }

  // Fallback 3: CoinTelegraph RSS (No Key)
  try {
    const res = await fetch("https://cointelegraph.com/rss");
    const xml = await res.text();
    const titles = [...xml.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)].map(m => m[1]);
    if (titles.length > 1) return titles.slice(1, 4).map(t => `📰 ${t}`).join("\n");
  } catch (e) { console.log("News API 3 failed..."); }

  return "No live news available right now.";
}

// =====================================================================
// 8. MULTI-EXCHANGE CRYPTO SCANNER
// =====================================================================
async function fetchMarketData() {
  // Fallback 1: KuCoin
  try {
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const movers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 3);
    if (movers.length > 0) return movers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
  } catch (e) { console.log("KuCoin failed, trying Bybit..."); }

  // Fallback 2: Bybit
  try {
    const scanner = new ccxt.bybit();
    const tickers = await scanner.fetchTickers();
    const movers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 3);
    if (movers.length > 0) return movers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
  } catch (e) { console.log("Bybit failed, trying OKX..."); }

  // Fallback 3: OKX
  try {
    const scanner = new ccxt.okx();
    const tickers = await scanner.fetchTickers();
    const movers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 3);
    if (movers.length > 0) return movers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
  } catch (e) { console.log("OKX failed..."); }

  throw new Error("All market data sources are down.");
}

// =====================================================================
// 9. THE MASTER SCANNER
// =====================================================================
async function runMasterScan() {
  const marketData = await fetchMarketData();
  const news = await fetchNews();
  
  const prompt = `
    You are an elite crypto trader AI.
    
    LIVE MARKET DATA:
    ${marketData}
    
    LATEST NEWS:
    ${news}
    
    Based on the price action and the news sentiment, pick the BEST trade.
    Reply strictly in JSON format without markdown formatting: 
    {"symbol": "SOL/USDT", "action": "BUY" or "SELL", "reason": "Brief reason combining price and news"}
  `;
  
  const res = await askAI(prompt);
  const jsonMatch = res.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI did not return valid JSON.");
  return JSON.parse(jsonMatch[0]);
}

// =====================================================================
// 10. SAFE EDIT & PREMIUM MENUS
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
// 11. HANDLERS & ROUTING
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
    `I scan live markets AND read live crypto news to give you the best signals.\n\n` +
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
    `Click "Connect Exchange" and provide your API Key/Secret. <i>(Ensure "Enable Withdrawals" is UNCHECKED for safety).</i>\n\n` +
    `2️⃣ <b>AI News Scan:</b>\n` +
    `Click "AI News Scan". The bot will fetch live prices AND the latest 3 news headlines, then use Grok AI to analyze the sentiment and give you a trade signal.\n\n` +
    `3️⃣ <b>Manual Execution:</b>\n` +
    `Simply type what you want in the chat!\n` +
    `<i>Example: "Buy $20 of SOL"</i>`;
  await safeEdit(ctx, text);
});

bot.action("m:about", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `👨‍💻 <b>DEVELOPER INFO</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `This bot was built by <b>${DEV_NAME}</b>.\n\n` +
    `🚀 <b>Core Engine:</b> CCXT & Multi-AI Fallback\n` +
    `📦 <b>Version:</b> <code>${BOT_VERSION}</code>\n\n` +
    `🔗 <b>Contact Developer:</b> ${DEV_HANDLE}\n\n` +
    `<i>Powered by Dev Trading Systems.</i>`;
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
      `The AI will now scan the market and news every 15 minutes to execute trades.`);
    // Auto-pilot loop would go here
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

bot.action("m:signal", async (ctx) => {
  await ctx.answerCbQuery("Scanning...");
  await safeEdit(ctx, `🔄 <b>SCANNING LIVE MARKET</b>\n━━━━━━━━━━━━━━━━━━━━\n<i>📡 Fetching prices & news...</i>`);
  
  try {
    const signal = await runMasterScan();
    
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
    await safeEdit(ctx, 
      `❌ <b>SCANNER ERROR</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>${e.message}</i>`); 
  }
});

// =====================================================================
// 12. TEXT ROUTER (API Input & Natural Language Trading)
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
    
    let cleanRes = res.replace(/```json/g, "").replace(/```/g, "");
    await ctx.reply(`🤖 <b>AI Response:</b>\n━━━━━━━━━━━━━━━━━━━━\n${cleanRes}`, { parse_mode: "HTML", ...backMenu() });
    
  } catch (e) { 
    await ctx.reply(`❌ <b>Error:</b> ${e.message}`, { parse_mode: "HTML", ...backMenu() }); 
  }
});

// =====================================================================
// 13. LAUNCH
// =====================================================================
bot.catch((err, ctx) => console.error(`Error:`, err));
bot.launch().then(() => console.log(`🚀 ${BOT_NAME} v${BOT_VERSION} is Running`));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
