import { Telegraf, Markup } from "telegraf";
import ccxt from "ccxt";
import mongoose from "mongoose";
import http from "http";

// =====================================================================
// 1. CONFIGURATION & BRANDING
// =====================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const CHANNEL_ID = "@devxtechzone";
const MENU_IMAGE_URL = "https://files.catbox.moe/e7j97z.png"; 

const DEV_NAME = "Dev Gift";
const BOT_NAME = "Dev Trading Terminal";

const bot = new Telegraf(process.env.TG_TOKEN);
const userSessions = new Map();

// =====================================================================
// 2. KEEP-ALIVE SERVER
// =====================================================================
const PORT = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Terminal is alive.");
}).listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// =====================================================================
// 3. FORCE JOIN
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
    const joinMenu = Markup.inlineKeyboard([
      [Markup.button.url("📢 Join Official Channel", `https://t.me/${CHANNEL_ID.replace('@', '')}`)],
      [Markup.button.callback("✅ Verify Access", "verify_join")]
    ]);
    if (ctx.callbackQuery) await ctx.answerCbQuery("Join the channel first!", { show_alert: true });
    else await ctx.reply(`⛔ <b>ACCESS DENIED</b>\n━━━━━━━━━━━━━━━━━━━━\nYou must join the official channel to use this terminal.`, { parse_mode: "HTML", ...joinMenu });
    return;
  }
  return next();
});

// =====================================================================
// 4. DATABASE & TRADING ENGINE
// =====================================================================
mongoose.connect(MONGO_URI).then(() => console.log("✅ MongoDB Connected")).catch(err => console.error("❌ DB Error:", err));

const User = mongoose.model("User", new mongoose.Schema({
  telegramId: { type: String, unique: true },
  exchangeName: String,
  apiKey: String,
  apiSecret: String,
}));

async function executeTrade(telegramId, side, symbol, amountUSDT) {
  const user = await User.findOne({ telegramId: String(telegramId) });
  if (!user || !user.apiKey) throw new Error("No exchange connected.");
  
  const exchange = new ccxt[user.exchangeName]({ apiKey: user.apiKey, secret: user.apiSecret, enableRateLimit: true });
  const ticker = await exchange.fetchTicker(symbol);
  return await exchange.createOrder(symbol, 'market', side.toLowerCase(), amountUSDT / ticker.last);
}

// =====================================================================
// 5. GEMINI AI (WITH RELIABLE PROXY & FALLBACK)
// =====================================================================
async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  let fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    })
  };

  try {
    // Reliable Proxy Bypass
    const proxyUrl = "https://corsproxy.io/?";
    const proxiedUrl = proxyUrl + encodeURIComponent(url);
    
    const res = await fetch(proxiedUrl, fetchOptions);
    const data = await res.json();
    
    if (data.error) throw new Error(data.error.message);
    return data.candidates[0].content.parts[0].text;
    
  } catch (error) {
    console.log("Proxy failed, trying direct connection...", error.message);
    
    // Direct Fallback
    try {
      const res = await fetch(url, fetchOptions);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.candidates[0].content.parts[0].text;
    } catch (directError) {
      throw new Error(`Connection failed. Google may be blocking this IP. Please wait a minute and try again.`);
    }
  }
}

// =====================================================================
// 6. REAL ANIMATION ENGINE
// =====================================================================
async function animateScan(ctx, messageId) {
  const spinner = ["⏳", "🔄", "🟡", "🟢"];
  const dots = ["⬛⬜⬜", "⬛⬛⬜", "⬛⬛⬛"];
  let step = 0;

  const interval = setInterval(async () => {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, 
        `${spinner[step % 4]} <b>SCANNING LIVE MARKET</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📡 Fetching top gainers... ${dots[step % 3]}\n` +
        `🧠 Searching web for news... ${dots[(step+1) % 3]}\n` +
        `⚙️ Analyzing sentiment... ${dots[(step+2) % 3]}`, 
        { parse_mode: "HTML" }
      );
      step++;
    } catch (e) {} 
  }, 1000);

  return interval;
}

// =====================================================================
// 7. PREMIUM MENUS
// =====================================================================
const mainMenu = () => Markup.inlineKeyboard([
  [Markup.button.callback("🔌 Connect Exchange", "m:connect"), Markup.button.callback("💼 My Balance", "m:balance")],
  [Markup.button.callback("🧠 AI Market Scan", "m:signal")],
]);

const backMenu = () => Markup.inlineKeyboard([[Markup.button.callback("⬅️ Return to Terminal", "m:home")]]);

async function safeEditCaption(ctx, text, keyboard) {
  try {
    await ctx.editMessageCaption(text, { parse_mode: "HTML", ...keyboard });
  } catch (e) {
    try { await ctx.editMessageText(text, { parse_mode: "HTML", ...keyboard }); } catch (err) {}
  }
}

// =====================================================================
// 8. HANDLERS
// =====================================================================
bot.action("verify_join", async (ctx) => {
  if (await isUserInChannel(ctx.from.id)) {
    await ctx.answerCbQuery("✅ Access Granted");
    await safeEditCaption(ctx, 
      `🟢 <b>ACCESS GRANTED</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `Welcome to the Trading Terminal.`, mainMenu());
  } else {
    await ctx.answerCbQuery("❌ Join the channel first!", { show_alert: true });
  }
});

bot.start(async (ctx) => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const status = user ? `🟢 <b>CONNECTED:</b> <code>${user.exchangeName.toUpperCase()}</code>` : `🔴 <b>NOT CONNECTED</b>`;
  
  const caption = 
    `╭━━━〔 <b>${BOT_NAME}</b> 〕━━━╮\n` +
    `┃ 👨‍💻 <b>Developer:</b> ${DEV_NAME}\n` +
    `┃ 📡 <b>Status:</b> ${status}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `Welcome to the ultimate AI trading engine. I read live news and analyze market data to give you the best signals.\n\n` +
    `👇 <i>Select an option below to begin.</i>`;

  await ctx.replyWithPhoto(MENU_IMAGE_URL, {
    caption: caption,
    parse_mode: "HTML",
    ...mainMenu()
  });
});

bot.action("m:home", async (ctx) => { 
  await ctx.answerCbQuery(); 
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const status = user ? `🟢 <b>CONNECTED:</b> <code>${user.exchangeName.toUpperCase()}</code>` : `🔴 <b>NOT CONNECTED</b>`;
  
  await safeEditCaption(ctx, 
    `╭━━━〔 <b>DASHBOARD</b> 〕━━━╮\n` +
    `┃ 📡 <b>Status:</b> ${status}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `👇 <i>Select an option:</i>`, mainMenu());
});

bot.action("m:connect", async (ctx) => {
  await ctx.answerCbQuery();
  userSessions.set(ctx.from.id, { step: "exchange" });
  await safeEditCaption(ctx, 
    `🔌 <b>EXCHANGE CONNECTION</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Type the name of your exchange:\n` +
    `<i>(binance, bybit, kucoin, okx)</i>`, backMenu());
});

bot.action("m:balance", async (ctx) => {
  await ctx.answerCbQuery("Fetching...");
  try {
    const user = await User.findOne({ telegramId: String(ctx.from.id) });
    if (!user) throw new Error("No exchange connected.");
    const exchange = new ccxt[user.exchangeName]({ apiKey: user.apiKey, secret: user.apiSecret });
    const bal = await exchange.fetchBalance();
    await safeEditCaption(ctx, 
      `💼 <b>ACCOUNT BALANCE</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💵 <b>Available:</b> <code>$${bal.USDT?.free.toFixed(2) || "0.00"} USDT</code>`, backMenu());
  } catch (e) { 
    await safeEditCaption(ctx, `❌ <b>Error:</b> ${e.message}`, backMenu()); 
  }
});

// --- ANIMATED SCANNER ---
bot.action("m:signal", async (ctx) => {
  await ctx.answerCbQuery("Initializing...");
  
  const msg = await ctx.reply(`⏳ <b>INITIALIZING SCAN...</b>`, { parse_mode: "HTML" });
  const animationInterval = await animateScan(ctx, msg.message_id);

  try {
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const topMovers = Object.values(tickers).filter(t => t.symbol.endsWith('/USDT')).sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage)).slice(0, 3);
    const marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
    
    const prompt = `Live Data:\n${marketData}\n\nSearch the web for news on these coins. Pick the BEST trade. Reply strictly JSON: {"symbol": "SOL/USDT", "action": "BUY" or "SELL", "reason": "Brief reason"}`;
    const res = await askGemini(prompt);
    const signal = JSON.parse(res.match(/\{[\s\S]*\}/)[0]);
    
    clearInterval(animationInterval); 
    
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined,
      `🎯 <b>AI TRADE SIGNAL</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🪙 <b>Asset:</b> <code>${signal.symbol}</code>\n` +
      `📈 <b>Action:</b> <code>${signal.action}</code>\n\n` +
      `📝 <b>Analysis:</b>\n<i>${signal.reason}</i>\n\n` +
      `👉 <i>To execute, type:</i>\n` +
      `<code>Buy $10 of ${signal.symbol.split('/')[0]}</code>`, 
      { parse_mode: "HTML", ...backMenu() }
    );
  } catch (e) { 
    clearInterval(animationInterval); 
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ <b>SCAN FAILED</b>\n${e.message}`, { parse_mode: "HTML", ...backMenu() });
  }
});

// =====================================================================
// 9. TEXT ROUTER
// =====================================================================
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const userId = ctx.from.id, text = ctx.message.text.trim();
  let session = userSessions.get(userId) || {};

  if (session.step === "exchange") {
    session.exchangeName = text.toLowerCase(); session.step = "api"; userSessions.set(userId, session);
    return ctx.reply(`🔑 Paste your <b>API Key</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "api") {
    session.apiKey = text; session.step = "secret"; userSessions.set(userId, session);
    return ctx.reply(`🔑 Paste your <b>API Secret</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "secret") {
    session.apiSecret = text;
    await User.findOneAndUpdate({ telegramId: String(userId) }, { telegramId: String(userId), exchangeName: session.exchangeName, apiKey: session.apiKey, apiSecret: session.apiSecret }, { upsert: true });
    userSessions.delete(userId);
    return ctx.reply(`✅ <b>EXCHANGE CONNECTED SUCCESSFULLY</b>`, { parse_mode: "HTML", ...mainMenu() });
  }

  await ctx.sendChatAction("typing");
  try {
    const res = await askGemini(`User says: "${text}". If they want to trade, reply JSON: {"isTrade": true, "action": "BUY" or "SELL", "symbol": "BTC/USDT", "amount": 10}. If not, reply normal text.`);
    if (res.includes('"isTrade": true')) {
      const intent = JSON.parse(res.match(/\{[\s\S]*\}/)[0]);
      const result = await executeTrade(userId, intent.action, intent.symbol, intent.amount);
      return ctx.reply(`✅ <b>TRADE EXECUTED</b>\nID: <code>${result.id}</code>`, { parse_mode: "HTML", ...backMenu() });
    }
    
    let cleanRes = res.replace(/```(?:json|html)?/g, "").replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/\*(.*?)\*/g, "<i>$1</i>");
    await ctx.reply(`🤖 <b>AI RESPONSE</b>\n━━━━━━━━━━━━━━━━━━━━\n${cleanRes}`, { parse_mode: "HTML", ...backMenu() });
  } catch (e) { 
    await ctx.reply(`❌ <b>Error:</b> ${e.message}`, { parse_mode: "HTML", ...backMenu() }); 
  }
});

bot.launch().then(() => console.log("🚀 Terminal Running"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
