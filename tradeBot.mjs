import { Telegraf, Markup } from "telegraf";
import ccxt from "ccxt";
import mongoose from "mongoose";
import http from "http"; 

// =====================================================================
// 1. CONFIGURATION
// =====================================================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGO_URI = process.env.MONGO_URI;
const CHANNEL_ID = "@devxtechzone"; 

const MENU_IMAGE_URL = "https://files.catbox.moe/e7j97z.png"; 

const DEV_NAME = "Dev Gift";
const DEV_HANDLE = "@Devgiftt"; 
const BOT_NAME = "Dev Trading Bot";
const BOT_VERSION = "2.1.0";

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
    const joinMsg = `⚠️ <b>Access Denied</b>\n\nYou must join our official channel to use this bot.`;
    const joinMenu = Markup.inlineKeyboard([
      [Markup.button.url("📢 Join Channel", `https://t.me/${CHANNEL_ID.replace('@', '')}`)],
      [Markup.button.callback("✅ Verify Join", "verify_join")]
    ]);
    if (ctx.callbackQuery) await ctx.answerCbQuery("You haven't joined yet!", { show_alert: true });
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
  if (!user || !user.apiKey) throw new Error("⚠️ No exchange connected. Type /start to connect.");
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
// 6. GEMINI AI (3.8-FLASH)
// =====================================================================
async function askGemini(prompt, imageBase64 = null, history = []) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });
  const contents = [...history, { role: "user", parts: parts }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: contents,
      tools: [{ googleSearch: {} }],
      systemInstruction: { 
        parts: [{ text: `You are ${BOT_NAME}, an elite Master Trading Mentor created by ${DEV_NAME} (${DEV_HANDLE}). You teach Crypto, MT5, and Forex. You are precise, analytical, and helpful.` }] 
      }
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

async function aiAutoTrade(userId, chatId) {
  try {
    // CHANGED TO KUCOIN
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const topMovers = Object.values(tickers).filter(t => t.symbol.endsWith('/USDT')).sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage)).slice(0, 5);
    const marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
    
    const prompt = `Live Data:\n${marketData}\nSearch news. Reply strictly JSON: {"decision": "BUY" or "SELL" or "HOLD", "symbol": "SOL/USDT", "reason": "Brief reason"}`;
    const res = await askGemini(prompt);
    const decisionData = JSON.parse(res.match(/\{.*\}/s)[0]);

    if (decisionData.decision === "BUY" || decisionData.decision === "SELL") {
      await bot.telegram.sendMessage(chatId, `🤖 <b>Auto-Pilot:</b> ${decisionData.decision} Signal!\nReason: ${decisionData.reason}\nExecuting trade...`, { parse_mode: "HTML" });
      const result = await executeTrade(userId, decisionData.decision, decisionData.symbol, 10); 
      await bot.telegram.sendMessage(chatId, `✅ <b>Auto-Trade Executed!</b>\nOrder ID: <code>${result.id}</code>`, { parse_mode: "HTML" });
    } else {
      await bot.telegram.sendMessage(chatId, `🤖 <b>Auto-Pilot:</b> HOLD\nReason: ${decisionData.reason}`, { parse_mode: "HTML" });
    }
  } catch (e) { console.error("Auto-Pilot Error:", e.message); }
}

// =====================================================================
// 7. SAFE EDIT & MENUS
// =====================================================================
const backMenu = () => Markup.inlineKeyboard([[Markup.button.callback("⬅️ Main Menu", "m:home")]]);

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🔌 Connect Exchange", "m:connect"), Markup.button.callback("💼 My Balance", "m:balance")],
    [Markup.button.callback("🤖 Toggle Auto-Pilot", "m:autopilot"), Markup.button.callback("🧠 Manual Scan", "m:signal")],
    [Markup.button.callback("📖 How to Use", "m:how"), Markup.button.callback("ℹ️ About", "m:about")],
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
// 8. HANDLERS & ROUTING
// =====================================================================
bot.action("verify_join", async (ctx) => {
  if (await isUserInChannel(ctx.from.id)) {
    await ctx.answerCbQuery("✅ Verified!");
    await safeEdit(ctx, `🎉 <b>Welcome!</b> You now have full access.`, mainMenu());
  } else {
    await ctx.answerCbQuery("❌ Join the channel first!", { show_alert: true });
  }
});

bot.start(async (ctx) => {
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  const status = user && user.exchangeName ? `✅ <b>Connected:</b> <code>${user.exchangeName.toUpperCase()}</code>` : `⚠️ <b>Not Connected</b>`;
  const autoStatus = user && user.autoTrade ? `🟢 <b>Auto-Pilot ACTIVE</b>` : `🔴 <b>Auto-Pilot OFF</b>`;
  
  const caption = 
    `╭━━━〔 <b>${BOT_NAME}</b> 〕━━━╮\n` +
    `┃ 📊 <b>Status:</b>\n` +
    `┃ ${status}\n` +
    `┃ ${autoStatus}\n` +
    `╰━━━━━━━━━━━━━━━━━━━━╯\n\n` +
    `💡 <i>I can trade automatically, answer your questions, or analyze MT5/Crypto charts.</i>\n\n` +
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
    `╭━━━〔 <b>Main Menu</b> 〕━━━╮\n` +
    `┃ ${status}\n` +
    `┃ ${autoStatus}\n` +
    `╰━━━━━━━━━━━━━━━━━╯\n\n` +
    `<i>Select an option below:</i>`;

  await safeEdit(ctx, caption, mainMenu());
});

bot.action("m:how", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `📖 <b>How to Use</b>\n\n` +
    `1️⃣ <b>Connect:</b> Click Connect, type your exchange name, API key, and secret.\n\n` +
    `2️⃣ <b>Auto-Pilot:</b> Turn it ON. The AI will scan the market every 15 minutes and execute trades on its own.\n\n` +
    `3️⃣ <b>Manual:</b> Just type <i>"Buy $20 of SOL"</i>.\n\n` +
    `4️⃣ <b>MT5 Vision:</b> Send a screenshot of your MT5 or TradingView chart for instant analysis.`;
  await safeEdit(ctx, text);
});

bot.action("m:about", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `ℹ️ <b>About ${BOT_NAME}</b>\n\n` +
    `Version: <code>${BOT_VERSION}</code>\n\n` +
    `Powered by CCXT & Google Gemini. Fully autonomous and capable of analyzing MT5 and Crypto charts.\n\n` +
    `👨‍💻 <b>Developer:</b> ${DEV_NAME}\n` +
    `🔗 <b>Contact:</b> ${DEV_HANDLE}`;
  await safeEdit(ctx, text);
});

bot.action("m:connect", async (ctx) => {
  await ctx.answerCbQuery();
  userSessions.set(ctx.from.id, { step: "awaiting_exchange" });
  await safeEdit(ctx, `🔌 <b>Type the name of your exchange:</b>\n<i>(Examples: binance, bybit, kucoin, okx)</i>`);
});

bot.action("m:autopilot", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await User.findOne({ telegramId: String(ctx.from.id) });
  if (!user || !user.apiKey) return ctx.reply("⚠️ Connect API keys first!", backMenu());
  
  if (user.autoTrade) {
    user.autoTrade = false; await user.save();
    clearInterval(activeAutoTraders.get(ctx.from.id)); activeAutoTraders.delete(ctx.from.id);
    await safeEdit(ctx, `🔴 <b>Auto-Pilot DISABLED.</b>`);
  } else {
    user.autoTrade = true; await user.save();
    await safeEdit(ctx, `🟢 <b>Auto-Pilot ENABLED.</b>\nI will now trade for you automatically.`);
    aiAutoTrade(ctx.from.id, ctx.chat.id);
    activeAutoTraders.set(ctx.from.id, setInterval(() => aiAutoTrade(ctx.from.id, ctx.chat.id), 15 * 60 * 1000));
  }
});

bot.action("m:balance", async (ctx) => {
  await ctx.answerCbQuery("Fetching...");
  try { 
    const bal = await getBalance(ctx.from.id);
    await safeEdit(ctx, `💵 <b>Balance:</b> $${bal} USDT`); 
  } catch (e) { 
    await safeEdit(ctx, `❌ <b>Error:</b> ${e.message}`); 
  }
});

bot.action("m:signal", async (ctx) => {
  await ctx.answerCbQuery("Scanning...");
  await safeEdit(ctx, `🔄 <b>Scanning live market and reading news...</b>\n<i>Please wait...</i>`);
  
  try {
    // CHANGED TO KUCOIN
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const topMovers = Object.values(tickers).filter(t => t.symbol.endsWith('/USDT')).sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage)).slice(0, 5);
    const marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
    
    const prompt = `Live Market Data:\n${marketData}\n\nSearch the web for news on these coins. Pick the BEST trade. Reply strictly JSON: {"symbol": "SOL/USDT", "action": "BUY" or "SELL", "reason": "Brief reason"}`;
    const res = await askGemini(prompt);
    const signal = JSON.parse(res.match(/\{.*\}/s)[0]);
    
    const text = 
      `🎯 <b>Live AI Signal</b>\n\n` +
      `🪙 <b>Coin:</b> ${signal.symbol}\n` +
      `📈 <b>Action:</b> ${signal.action}\n\n` +
      `📝 <b>Reason:</b> ${signal.reason}\n\n` +
      `💡 <i>To execute, reply:</i> "Buy $10 of ${signal.symbol.split('/')[0]}"`;
      
    await safeEdit(ctx, text);
  } catch (e) { 
    await safeEdit(ctx, `❌ <b>Scanner Error:</b> ${e.message}`); 
  }
});

// =====================================================================
// 9. TEXT ROUTER (API Input & Natural Language Trading)
// =====================================================================
bot.on("text", async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
  const userId = ctx.from.id, text = ctx.message.text.trim();
  let session = userSessions.get(userId) || {};

  if (session.step === "awaiting_exchange") {
    session.exchangeName = text.toLowerCase(); session.step = "awaiting_api"; userSessions.set(userId, session);
    return ctx.reply(`✅ Exchange set.\n\nPaste your <b>API Key</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "awaiting_api") {
    session.apiKey = text; session.step = "awaiting_secret"; userSessions.set(userId, session);
    return ctx.reply(`✅ API Key saved.\n\nPaste your <b>API Secret</b>:`, { parse_mode: "HTML", ...backMenu() });
  }
  if (session.step === "awaiting_secret") {
    session.apiSecret = text;
    await User.findOneAndUpdate({ telegramId: String(userId) }, { telegramId: String(userId), exchangeName: session.exchangeName, apiKey: session.apiKey, apiSecret: session.apiSecret }, { upsert: true });
    userSessions.delete(userId);
    return ctx.reply(`🎉 <b>Success!</b> Connected to ${session.exchangeName.toUpperCase()}.`, { parse_mode: "HTML", ...mainMenu() });
  }

  await ctx.sendChatAction("typing");
  try {
    const res = await askGemini(`User says: "${text}". If they want to trade, reply JSON: {"isTrade": true, "action": "BUY" or "SELL", "symbol": "BTC/USDT", "amount": 10}. If not, reply normal text.`);
    if (res.includes('"isTrade": true')) {
      const intent = JSON.parse(res.match(/\{.*\}/s)[0]);
      await ctx.reply(`⏳ Executing ${intent.action} for $${intent.amount} of ${intent.symbol}...`);
      const result = await executeTrade(userId, intent.action, intent.symbol, intent.amount);
      return ctx.reply(`✅ <b>Trade Executed!</b>\nOrder ID: <code>${result.id}</code>`, { parse_mode: "HTML", ...backMenu() });
    }
    await ctx.reply(res, { parse_mode: "HTML", ...backMenu() });
  } catch (e) { 
    await ctx.reply(`❌ <b>Error:</b> ${e.message}`, { parse_mode: "HTML", ...backMenu() }); 
  }
});

// =====================================================================
// 10. IMAGE VISION (MT5 & Crypto Charts)
// =====================================================================
bot.on("photo", async (ctx) => {
  await ctx.sendChatAction("typing");
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    const arrayBuffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const caption = ctx.message.caption || "Analyze this chart. Give me the trend, support, and resistance levels.";
    const analysis = await askGemini(caption, base64);
    await ctx.reply(`📈 <b>Vision Analysis:</b>\n\n${analysis}`, { parse_mode: "HTML", ...backMenu() });
  } catch (e) { 
    await ctx.reply(`❌ <b>Error:</b> ${e.message}`, { parse_mode: "HTML" }); 
  }
});

// =====================================================================
// 11. LAUNCH
// =====================================================================
bot.catch((err, ctx) => console.error(`Error:`, err));
bot.launch().then(() => console.log(`🚀 ${BOT_NAME} v${BOT_VERSION} is Running`));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
