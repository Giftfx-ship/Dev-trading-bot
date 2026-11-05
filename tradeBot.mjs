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
const DEV_HANDLE = "@Devgiftt"; 
const BOT_NAME = "Dev Trading Bot";
const BOT_VERSION = "12.0.0 (Gemini Live)";

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
// 6. GEMINI AI ENGINE (Text & Vision)
// =====================================================================
async function askGemini(prompt, imageBase64 = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const parts = [{ text: prompt }];
  if (imageBase64) parts.push({ inlineData: { mimeType: "image/jpeg", data: imageBase64 } });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: parts }],
      tools: [{ googleSearch: {} }]
    })
  });
  
  const data = await res.json();
  if (data.error) throw new Error(`Gemini API Error: ${data.error.message}`);
  if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) throw new Error("Invalid AI response format.");
  
  return data.candidates[0].content.parts[0].text;
}

async function aiAutoTrade(userId, chatId) {
  try {
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    const topMovers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 5);
    const marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
    
    const prompt = `You are an elite crypto trader AI. Look at this live market data:\n${marketData}\n\nSearch the web for the latest news on these specific coins. Pick the BEST trade. Reply strictly in JSON format without markdown formatting: {"decision": "BUY" or "SELL" or "HOLD", "symbol": "SOL/USDT", "reason": "Brief reason"}`;
    
    const res = await askGemini(prompt);
    const jsonMatch = res.match(/\{.*\}/s);
    if (!jsonMatch) throw new Error("AI did not return valid JSON.");
    
    const decisionData = JSON.parse(jsonMatch[0]);

    if (decisionData.decision === "BUY" || decisionData.decision === "SELL") {
      await bot.telegram.sendMessage(chatId, 
        `🤖 <b>AUTO-PILOT TRIGGERED</b> 🤖\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `📈 <b>Action:</b> ${decisionData.decision}\n` +
        `🪙 <b>Asset:</b> ${decisionData.symbol}\n` +
        `📝 <b>Reason:</b> <i>${decisionData.reason}</i>\n\n` +
        `⏳ <i>Executing $10 trade...</i>`, { parse_mode: "HTML" });
        
      const result = await executeTrade(userId, decisionData.decision, decisionData.symbol, 10); 
      await bot.telegram.sendMessage(chatId, 
        `✅ <b>TRADE EXECUTED</b> ✅\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 <b>Order ID:</b> <code>${result.id}</code>\n` +
        `💵 <b>Status:</b> Filled`, { parse_mode: "HTML" });
    } else {
      await bot.telegram.sendMessage(chatId, 
        `🤖 <b>AUTO-PILOT</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `⏸️ <b>Action:</b> HOLD\n` +
        `📝 <b>Reason:</b> <i>${decisionData.reason}</i>`, { parse_mode: "HTML" });
    }
  } catch (e) { console.error("Auto-Pilot Error:", e.message); }
}

// =====================================================================
// 7. SAFE EDIT & PREMIUM MENUS
// =====================================================================
const backMenu = () => Markup.inlineKeyboard([[Markup.button.callback("🔙 Return to Main Menu", "m:home")]]);

const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🔌 Connect Exchange", "m:connect"), Markup.button.callback("💼 My Balance", "m:balance")],
    [Markup.button.callback("🤖 Toggle Auto-Pilot", "m:autopilot"), Markup.button.callback("🧠 Manual Scan", "m:signal")],
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
// 8. HANDLERS & ROUTING
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
    `I am your fully autonomous AI trading assistant. I can scan live markets, execute trades, and answer any trading questions you have.\n\n` +
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
    `2️⃣ <b>Auto-Pilot:</b>\n` +
    `Turn it ON. The AI will scan the market every 15 minutes and execute trades on its own.\n\n` +
    `3️⃣ <b>Manual Execution:</b>\n` +
    `Simply type what you want in the chat!\n` +
    `<i>Example: "Buy $20 of SOL"</i>\n\n` +
    `4️⃣ <b>Vision Analysis:</b>\n` +
    `Send a screenshot of your MT5 or TradingView chart for instant technical analysis.`;
  await safeEdit(ctx, text);
});

bot.action("m:about", async (ctx) => {
  await ctx.answerCbQuery();
  const text = 
    `👨‍💻 <b>DEVELOPER INFO</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `This bot was built by <b>${DEV_NAME}</b>.\n\n` +
    `🚀 <b>Core Engine:</b> CCXT & Gemini 3.8 Flash\n` +
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
      `The AI will now scan the market and execute trades every 15 minutes.`);
    aiAutoTrade(ctx.from.id, ctx.chat.id);
    activeAutoTraders.set(ctx.from.id, setInterval(() => aiAutoTrade(ctx.from.id, ctx.chat.id), 15 * 60 * 1000));
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
  await safeEdit(ctx, `🔄 <b>SCANNING LIVE MARKET</b>\n━━━━━━━━━━━━━━━━━━━━\n<i>📡 Connecting to exchange...</i>`);
  
  try {
    const scanner = new ccxt.kucoin();
    const tickers = await scanner.fetchTickers();
    
    const topMovers = Object.values(tickers)
      .filter(t => t.symbol.endsWith('/USDT'))
      .sort((a, b) => Math.abs(b.percentage) - Math.abs(a.percentage))
      .slice(0, 5);
      
    const marketData = topMovers.map(t => `${t.symbol}: $${t.last} (${t.percentage}%)`).join("\n");
    
    await safeEdit(ctx, `🔄 <b>SCANNING LIVE MARKET</b>\n━━━━━━━━━━━━━━━━━━━━\n<i>🧠 AI analyzing news & price action...</i>`);

    const prompt = `You are an elite crypto trader AI. Look at this live market data:\n${marketData}\n\nSearch the web for news on these coins. Pick the absolute BEST trade. Reply strictly in JSON format without markdown formatting: {"symbol": "SOL/USDT", "action": "BUY" or "SELL", "reason": "Brief reason"}`;
    const res = await askGemini(prompt);
    
    const jsonMatch = res.match(/\{.*\}/s);
    if (!jsonMatch) throw new Error("AI did not return valid JSON.");
    const signal = JSON.parse(jsonMatch[0]);
    
    const text = 
      `🎯 <b>AI TRADE SIGNAL</b> 🎯\n` +
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
// 9. TEXT ROUTER (API Input & Natural Language Trading)
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
    const res = await askGemini(`User says: "${text}". If they want to trade, reply JSON: {"isTrade": true, "action": "BUY" or "SELL", "symbol": "BTC/USDT", "amount": 10}. If not, reply normal text.`);
    
    if (res.includes('"isTrade": true')) {
      const intent = JSON.parse(res.match(/\{.*\}/s)[0]);
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
// 10. IMAGE VISION
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
    await ctx.reply(`📈 <b>VISION ANALYSIS:</b>\n━━━━━━━━━━━━━━━━━━━━\n${analysis}`, { parse_mode: "HTML", ...backMenu() });
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
