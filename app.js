const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const express = require('express');
const { Telegraf } = require('telegraf');
const app = express();
const axios = require('axios');
const winston = require('winston');
const { PakasirClient } = require('pakasir-client'); 

// --- KONSTANTA PAKASIR & UMUM ---
const PAKASIR_API_KEY = 'nnzphsnFdNhY60jIWXgu7v87CtljahsL'; 
const PAKASIR_PROJECT_SLUG = 'botvpn';
const PAKASIR_WEBHOOK_URL = 'https://sagivpn.my.id/webhook/pakasir';
const MIN_DEPOSIT_AMOUNT = 10000;
const RESELLER_PRICE = 30000; 
const RESELLER_DISCOUNT_PERCENT = 40;
// PASTIKAN SUDAH DIGANTI DENGAN USERNAME ADMIN TELEGRAM ANDA!
const ADMIN_USERNAME_TEMBAK_PAKET = '@rahmarie'; 
const TRIAL_EXPIRY_DAYS = 0.125; // 3 Jam (3/24)
// --- KONSTANTA TRIAL LIMIT ---
const MEMBER_TRIAL_LIMIT = 3;
const RESELLER_TRIAL_LIMIT = 10;


// --- INICIALISASI PAKASIR CLIENT ---
const pakasir = new PakasirClient({
  project: PAKASIR_PROJECT_SLUG,
  apiKey: PAKASIR_API_KEY
});

// --- LOGGER & CONFIGURATION ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'bot-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'bot-combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

app.use(express.json()); 
app.use(express.urlencoded({ extended: true }));
// --- MODULES IMPORTS ---
const { 
  createssh, createvmess, createvless, createtrojan, createshadowsocks 
} = require('./modules/create');
const { 
  renewssh, renewvmess, renewvless, renewtrojan, renewshadowsocks 
} = require('./modules/renew');
const { 
    trialssh, trialvmess, trialvless, trialtrojan, trialshadowsocks 
} = require('./modules/trial');
const { 
  delssh, delvmess, delvless, deltrojan, delshadowsocks 
} = require('./modules/del'); 
const {
  lockssh, lockvmess, lockvless, locktrojan, lockshadowsocks 
} = require('./modules/lock');
const {
  unlockssh, unlockvmess, unlockvless, unlocktrojan, unlockshadowsocks 
} = require('./modules/unlock');
const { checkvmess } = require('./modules/checkvmess');
const { checkvless } = require('./modules/checkvless');
const { checktrojan } = require('./modules/checktrojan');
const { checkssh } = require('./modules/checkssh');
const { checkshadowsocks } = require('./modules/checkshadowsock'); // Perhatikan nama file 'checkshadowsock.js'

// --- MODULE BUAT RAHMARIE ---
const cron = require('node-cron'); 
const fs = require('fs');
const path = require('path');
const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

const BOT_TOKEN = vars.BOT_TOKEN;
const port = vars.PORT || 50124;
const ADMIN = vars.USER_ID; 
const NAMA_STORE = vars.NAMA_STORE;
const GROUP_ID = vars.GROUP_ID;

const bot = new Telegraf(BOT_TOKEN);
const adminIds = Array.isArray(ADMIN) ? ADMIN : [ADMIN]; 
logger.info('Bot initialized');

const db = new sqlite3.Database('./sellvpn.db', (err) => {
  if (err) { logger.error('Kesalahan koneksi SQLite3:', err.message); } 
  else { logger.info('Terhubung ke SQLite3'); }
});

const userState = {};
global.processedTransactions = new Set();
logger.info('User state initialized');

// --- INICIALISASI TABEL DATABASE ---
db.run(`CREATE TABLE IF NOT EXISTS Server (
  id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, auth TEXT, harga INTEGER, nama_server TEXT, quota INTEGER, iplimit INTEGER, 
  batas_create_akun INTEGER, total_create_akun INTEGER
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel Server:', err.message); } });

db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE, saldo INTEGER DEFAULT 0, role TEXT DEFAULT 'member', 
  daily_trial_count INTEGER DEFAULT 0, 
  last_trial_date TEXT DEFAULT '',
  CONSTRAINT unique_user_id UNIQUE (user_id)
)`, (err) => {
  if (err) { logger.error('Kesalahan membuat tabel users:', err.message); return; }
  db.get("PRAGMA table_info(users)", (err, rows) => {
    if (err) return;
    // Pengecekan dan penambahan kolom 'role', 'daily_trial_count', dan 'last_trial_date' jika belum ada
    if (!rows.some(row => row.name === 'role')) {
      db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'member'", (err) => { if (!err) logger.info('Kolom role berhasil ditambahkan'); });
    }
    if (!rows.some(row => row.name === 'daily_trial_count')) {
      db.run("ALTER TABLE users ADD COLUMN daily_trial_count INTEGER DEFAULT 0", (err) => { if (!err) logger.info('Kolom daily_trial_count berhasil ditambahkan'); });
    }
    if (!rows.some(row => row.name === 'last_trial_date')) {
      db.run("ALTER TABLE users ADD COLUMN last_trial_date TEXT DEFAULT ''", (err) => { if (!err) logger.info('Kolom last_trial_date berhasil ditambahkan'); });
    }
  });
});

db.run(`CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, type TEXT, reference_id TEXT, timestamp INTEGER, 
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel transactions:', err.message); } });

// --- TABEL BARU UNTUK PAKASIR ---
db.run(`CREATE TABLE IF NOT EXISTS pending_deposits_pakasir (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, order_id TEXT UNIQUE, amount INTEGER, status TEXT DEFAULT 'pending', 
  payment_method TEXT, payment_data TEXT, expired_at TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, (err) => { if (err) { logger.error('Kesalahan membuat tabel pending_deposits_pakasir:', err.message); } });

// --- FUNGSI UTILITY ---
async function getUserDetails(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT saldo, role FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (err) { reject(err); } 
      else { resolve(row || { saldo: 0, role: 'member' }); }
    });
  });
}

function calculatePrice(basePrice, role) {
  if (role === 'reseller') {
    const discount = basePrice * (RESELLER_DISCOUNT_PERCENT / 100);
    return Math.max(0, basePrice - discount); 
  }
  return basePrice;
}

async function updateUserBalance(userId, amount) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, userId], function (err) {
      if (err) { logger.error('⚠️ Kesalahan saat menambahkan saldo user:', err.message); reject(err); } 
      else { resolve(); }
    });
  });
}

async function updateServerField(serverId, value, query) {
  return new Promise((resolve, reject) => {
    db.run(query, [value, serverId], function (err) {
      if (err) { logger.error(`⚠️ Kesalahan saat mengupdate server field:`, err.message); reject(err); } 
      else { resolve(); }
    });
  });
}

async function recordAccountTransaction(userId, type) {
  return new Promise((resolve, reject) => {
    const referenceId = `account-${type}-${userId}-${Date.now()}`;
    db.run('INSERT INTO transactions (user_id, type, reference_id, timestamp) VALUES (?, ?, ?, ?)',
      [userId, type, referenceId, Date.now()], (err) => {
        if (err) { logger.error('Error recording account transaction:', err.message); reject(err); } 
        else { resolve(); }
      }
    );
  });
}

// Keyboard functions (omitted for brevity, assume correct)
function keyboard_nomor() {
  const alphabet = '1234567890'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}
function keyboard_abc() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}
function keyboard_full() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'; const buttons = [];
  for (let i = 0; i < alphabet.length; i += 3) {
    const row = alphabet.slice(i, i + 3).split('').map(char => ({ text: char, callback_data: char }));
    buttons.push(row);
  }
  buttons.push([{ text: '🔙 Hapus', callback_data: 'delete' }, { text: '✅ Konfirmasi', callback_data: 'confirm' }]);
  buttons.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]); return buttons;
}

// --- FUNGSI PAKASIR ---
async function generatePakasirPayment(userId, amount) {
    const orderId = `PKS-${userId}-${Date.now()}`;
    const redirectUrl = PAKASIR_WEBHOOK_URL.replace('/webhook/pakasir', '/topup-success'); 
    
    const paymentUrl = pakasir.generatePaymentUrl({
        orderId: orderId, amount: amount, redirect: redirectUrl, qrisOnly: true 
    });

    await new Promise((resolve, reject) => {
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); 
        db.run(`INSERT INTO pending_deposits_pakasir (user_id, order_id, amount, status, payment_method, payment_data, expired_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, orderId, amount, 'pending', 'qris', paymentUrl, expiresAt], 
            (err) => {
                if (err) { logger.error('Error saving pending deposit:', err.message); return reject(err); }
                resolve();
            }
        );
    });
    return { orderId, paymentUrl, amount };
}
// --- WEBHOOK HANDLER PAKASIR ---

async function handlePakasirWebhook(payload, botInstance) {
    const { order_id, amount, status, project } = payload;
    
    if (status !== 'completed' || project !== PAKASIR_PROJECT_SLUG) {
        logger.warn(`Webhook received but status is not completed or project mismatch. Order ID: ${order_id}, Status: ${status}`);
        return;
    }

    if (global.processedTransactions.has(order_id)) {
        logger.warn(`Webhook received but transaction already processed: ${order_id}`);
        return;
    }
    global.processedTransactions.add(order_id);

    db.get('SELECT user_id, status FROM pending_deposits_pakasir WHERE order_id = ? AND status = ?', [order_id, 'pending'], async (err, row) => {
        if (err) { logger.error(`Error querying pending_deposits for webhook ${order_id}: ${err.message}`); return; }
        if (!row) { logger.warn(`Pending deposit not found or already completed for Order ID: ${order_id}`); return; }
        
        const userId = row.user_id;
        
        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, userId], (err) => {
            if (err) { db.run('ROLLBACK'); logger.error(`Error updating user balance for webhook ${order_id}: ${err.message}`); return; }

            db.run('UPDATE pending_deposits_pakasir SET status = ? WHERE order_id = ?', ['completed', order_id], (err) => {
                if (err) { db.run('ROLLBACK'); logger.error(`Error updating pending_deposits status for webhook ${order_id}: ${err.message}`); return; }
                
                db.run('COMMIT');
                logger.info(`✅ Saldo user ${userId} berhasil ditambahkan via Pakasir Webhook. Amount: ${amount}`);

                const messageText = 
                    `🎉 <b>TOP UP SALDO BERHASIL (OTOMATIS)</b> 🎉\n\n` +
                    `Invoice: <code>${order_id}</code>\n` +
                    `Jumlah ditambahkan: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                    `Metode: ${payload.payment_method || 'QRIS'}\n\n` +
                    `Saldo Anda telah diupdate. Terima kasih!`;
                
                botInstance.telegram.sendMessage(userId, messageText, { parse_mode: 'HTML' }).catch(e => logger.error(`Failed to notify user ${userId}: ${e.message}`));
                
                botInstance.telegram.sendMessage(GROUP_ID, 
                    `📢 <b>NOTIFIKASI TOP UP PAKASIR</b>\n\n` +
                    `✅ *Top Up Berhasil*\n` +
                    `User ID: <code>${userId}</code>\n` +
                    `Order ID: <code>${order_id}</code>\n` +
                    `Jumlah: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                    `Metode: ${payload.payment_method || 'QRIS'}`,
                    { parse_mode: 'HTML' }
                ).catch(e => logger.error(`Failed to notify admin group: ${e.message}`));
            });
        });
    });
}

// Pasang endpoint webhook di Express
app.post('/webhook/pakasir', (req, res) => {
    const payload = req.body;
    logger.info(`Webhook received. Payload: ${JSON.stringify(payload)}`);

    if (payload && payload.order_id && payload.amount && payload.status) {
        handlePakasirWebhook(payload, bot);
        res.json({ received: true });
    } else {
        res.status(400).json({ error: 'Invalid webhook payload structure.' });
    }
});

// Endpoint dummy untuk redirect sukses
app.get('/topup-success', (req, res) => {
    res.send('Pembayaran Anda sedang diverifikasi. Silakan kembali ke Telegram bot untuk melihat saldo.');
});
// --- MAIN COMMANDS ---
bot.command(['start', 'menu'], async (ctx) => {
  logger.info('Start or Menu command received');
  const userId = ctx.from.id;
  db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
    if (err) { logger.error('Kesalahan saat memeriksa user_id:', err.message); return; }
    if (!row) { db.run('INSERT INTO users (user_id, role) VALUES (?, ?)', [userId, 'member'], (err) => { if (!err) logger.info(`User ID ${userId} berhasil disimpan sebagai member`); }); }
  });
  await sendMainMenu(ctx);
});

bot.command('admin', async (ctx) => {
  logger.info('Admin menu requested');
  if (!adminIds.includes(ctx.from.id)) { await ctx.reply('🚫 Anda tidak memiliki izin untuk mengakses menu admin.'); return; }
  await sendAdminMenu(ctx);
});

async function sendMainMenu(ctx) {
  const userId = ctx.from.id;
  const userName = ctx.from.first_name || '-';
  let user;
  try { user = await getUserDetails(userId); } 
  catch (e) { user = { saldo: 0, role: 'member' }; }
  const saldo = user.saldo;
  const role = user.role;
  const roleText = role === 'reseller' ? '💰 RESELLER' : '👤 MEMBER';

  // Statistik user
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let userToday = 0, userWeek = 0, userMonth = 0;
  let globalToday = 0, globalWeek = 0, globalMonth = 0;
  try {
    userToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    userWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    userMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [userId, monthStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [monthStart], (err, row) => resolve(row ? row.count : 0));
    });
  } catch (e) {}

  const messageText = `
╭─ <b>⚡ WELCOME DI ${NAMA_STORE} ⚡</b>
├ Bot VPN Premium dengan sistem otomatis
├ Kami Menjaga Kualitas daripada Kuantitas!
└ Dapatkan harga murah dengan menjadi Reseller!

<b>Hai, <code>${userName}</code>!</b>
ID: <code>${userId}</code>
Status: <b>${roleText}</b>
Saldo: <code>Rp ${saldo.toLocaleString('id-ID')}</code>

<blockquote>ðŸ“Š <b>Statistik Anda</b>
â€¢ Hari Ini    : ${userToday} akun
â€¢ Minggu Ini  : ${userWeek} akun
â€¢ Bulan Ini   : ${userMonth} akun

ðŸŒ <b>Statistik Global</b>
â€¢ Hari Ini    : ${globalToday} akun
â€¢ Minggu Ini  : ${globalWeek} akun
â€¢ Bulan Ini   : ${globalMonth} akun
</blockquote>

👥 Pengguna BOT: ${jumlahPengguna}
⏱️ Latency: ${latency} ms
──────────────────────────────`;

  let resellerButton = (role === 'reseller') 
    ? { text: '⚙️ Menu Reseller', callback_data: 'menu_reseller' } 
    : { text: `👑 Upgrade Reseller (Rp${RESELLER_PRICE.toLocaleString('id-ID')})`, callback_data: 'upgrade_reseller_confirm' };

  const keyboard = [
    [{ text: '➕ Create Akun', callback_data: 'service_create' }, { text: '🆓 Trial Akun', callback_data: 'trial_account' }],
    [{ text: '💰 Top Up Saldo', callback_data: 'topup_saldo' }, { text: '♻️ Renew Akun', callback_data: 'service_renew' }],
    [{ text: '🚀 Tembak Paket', url: `https://t.me/${ADMIN_USERNAME_TEMBAK_PAKET.replace('@', '')}` }],
    [resellerButton]
  ];

  if (adminIds.includes(userId)) { keyboard.unshift([{ text: '🛠️ Menu Admin', callback_data: 'admin_menu' }]); }

  try {
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText(messageText, options); } 
    else { await ctx.reply(messageText, options); }
  } catch (error) { logger.error('Error saat mengirim/mengedit menu utama:', error); }
}

// --- LOGIKA UPGRADE RESELLER ---
bot.action('upgrade_reseller_confirm', async (ctx) => {
    const userId = ctx.from.id; await ctx.answerCbQuery();
    await ctx.editMessageText(
        '⚠️ <b>VALIDASI UPGRADE RESELLER</b>\n\n' +
        `Apakah kamu yakin ingin menjadi reseller? Saldo akan terpotong sebesar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n\n` +
        '<b>Manfaat menjadi reseller:</b>\n' +
        '• Harga pembelian layanan lebih murah (Diskon 40%)\n' +
        '• Akses ke Menu Reseller (Kelola Akun Member, Check, Delete).\n\n' +
        'Lanjutkan?',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '✅ Ya, Saya Yakin', callback_data: 'upgrade_reseller_execute' }],
            [{ text: '❌ Tidak, Kembali', callback_data: 'send_main_menu' }]
        ] }}
    );
});

bot.action('upgrade_reseller_execute', async (ctx) => {
    const userId = ctx.from.id; await ctx.answerCbQuery();
    let user; try { user = await getUserDetails(userId); } catch (e) { return ctx.reply('❌ GAGAL: Terjadi kesalahan saat mengambil detail akun Anda.', { parse_mode: 'Markdown' }); }

    if (user.role === 'reseller') { return ctx.reply('⚠️ Anda sudah menjadi Reseller! Tidak perlu upgrade lagi.', { parse_mode: 'Markdown' }); }
    if (user.saldo < RESELLER_PRICE) { return ctx.reply(`❌ GAGAL: Saldo Anda tidak mencukupi. Saldo saat ini: Rp${user.saldo.toLocaleString('id-ID')}. Diperlukan: Rp${RESELLER_PRICE.toLocaleString('id-ID')}.`, { parse_mode: 'Markdown' }); }

    db.run('BEGIN TRANSACTION');
    db.run('UPDATE users SET saldo = saldo - ?, role = ? WHERE user_id = ?', [RESELLER_PRICE, 'reseller', userId], async function (err) {
        if (err) { db.run('ROLLBACK'); return ctx.reply('❌ GAGAL: Terjadi kesalahan saat memproses upgrade Reseller. Saldo tidak terpotong.', { parse_mode: 'Markdown' }); }
        db.run('COMMIT');
        
        await ctx.reply('🎉 <b>SELAMAT! Anda telah berhasil menjadi Reseller!</b>\n\n' + `Saldo Anda terpotong sebesar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n` + `Nikmati harga layanan yang lebih murah (Diskon ${RESELLER_DISCOUNT_PERCENT}%) dan akses ke <b>Menu Reseller</b>.`, { parse_mode: 'HTML' });

        const userInfo = await bot.telegram.getChat(userId).catch(() => ({ first_name: 'Unknown User' }));
        const username = userInfo.username ? `@${userInfo.username}` : (userInfo.first_name || userId);
        await bot.telegram.sendMessage(GROUP_ID, `<blockquote>👑 <b>UPGRADE RESELLER BERHASIL</b>\n👤 User: <b>${username}</b>\nID: <code>${userId}</code>\nNominal Terpotong: <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>\nSelamat datang Reseller baru!</blockquote>`, { parse_mode: 'HTML' });

        await sendMainMenu(ctx);
    });
});
// --- MENU RESELLER ---
bot.action('menu_reseller', async (ctx) => {
    await ctx.answerCbQuery();
    let user;
    try { user = await getUserDetails(ctx.from.id); } catch (e) { user = { role: 'member' }; }
    if (user.role !== 'reseller') { return ctx.reply('🚫 Anda bukan Reseller. Silakan upgrade terlebih dahulu.', { parse_mode: 'Markdown' }); }

    const resellerKeyboard = [
        [{ text: '❌ Delete Akun', callback_data: 'reseller_delete_menu' }],
        [{ text: '🔒 Lock Akun', callback_data: 'reseller_lock_menu' }, { text: '🔓 Unlock Akun', callback_data: 'reseller_unlock_menu' }],
        [{ text: '🔍 Check Akun', callback_data: 'reseller_check_menu' }],
        [{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]
    ];

    await ctx.editMessageText(
        '👑 <b>MENU RESELLER</b>\n\nSelamat datang di Menu Khusus Reseller!\nKelola dan pantau akun member Anda dengan fitur berikut:',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: resellerKeyboard } }
    );
});

// --- SUBMENU RESELLER ACTIONS ---
bot.action('reseller_delete_menu', async (ctx) => { await handleResellerAction(ctx, 'del'); });
bot.action('reseller_lock_menu', async (ctx) => { await handleResellerAction(ctx, 'lock'); });
bot.action('reseller_unlock_menu', async (ctx) => { await handleResellerAction(ctx, 'unlock'); });
bot.action('reseller_check_menu', async (ctx) => { await handleResellerAction(ctx, 'check'); });

// Fungsi untuk menampilkan Submenu Reseller
async function handleResellerAction(ctx, action) {
    await ctx.answerCbQuery();
    const typeMap = { 'del': 'hapus', 'lock': 'kunci', 'unlock': 'buka kunci', 'check': 'cek' };
    const actionText = typeMap[action] || action;
    
    const keyboard = [
      [{ text: `${actionText} Ssh/Ovpn`, callback_data: `${action}_ssh` }],      
      [{ text: `${actionText} Vmess`, callback_data: `${action}_vmess` }, { text: `${actionText} Vless`, callback_data: `${action}_vless` }],
      [{ text: `${actionText} Trojan`, callback_data: `${action}_trojan` }, { text: `${actionText} Shadowsocks`, callback_data: `${action}_shadowsocks` }],
      [{ text: '🔙 Kembali ke Menu Reseller', callback_data: 'menu_reseller' }]
    ];
    
    await ctx.editMessageText(`👑 *MENU RESELLER: ${actionText.toUpperCase()}* \n\nPilih jenis akun yang ingin di-${actionText} oleh Reseller:`, {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}

// --- MENU TRIAL ---
bot.action('trial_account', async (ctx) => { await handleTrialMenu(ctx); });

async function handleTrialMenu(ctx) {
    await ctx.answerCbQuery();
    const keyboard = [
      [{ text: 'Trial Ssh/Ovpn', callback_data: 'trial_ssh' }],      
      [{ text: 'Trial Vmess', callback_data: 'trial_vmess' }, { text: 'Trial Vless', callback_data: 'trial_vless' }],
      [{ text: 'Trial Trojan', callback_data: 'trial_trojan' }, { text: 'Trial Shadowsocks', callback_data: 'trial_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
    ];
    await ctx.editMessageText('🆓 *Pilih jenis Trial Akun (Masa Aktif 3 Jam):*', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}

// --- FUNGSI TAMPILAN SERVER (CREATE/RENEW) ---
async function startSelectServer(ctx, action, type, page = 0) {
  try {
    const user = await getUserDetails(ctx.from.id);
    const userRole = user.role;

    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) { return ctx.reply('⚠️ <b>PERHATIAN!</b> Tidak ada server yang tersedia saat ini. Coba lagi nanti!', { parse_mode: 'HTML' }); }
      if (servers.length === 0) { return ctx.reply('⚠️ <b>PERHATIAN!</b> Tidak ada server yang tersedia saat ini. Coba lagi nanti!', { parse_mode: 'HTML' }); }

      const serversPerPage = 6;
      const totalPages = Math.ceil(servers.length / serversPerPage);
      const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
      const start = currentPage * serversPerPage;
      const end = start + serversPerPage;
      const currentServers = servers.slice(start, end);

      const keyboard = [];
      for (let i = 0; i < currentServers.length; i += 2) {
        const row = [];
        const server1 = currentServers[i];
        const server2 = currentServers[i + 1];
        row.push({ text: server1.nama_server, callback_data: `${action}_username_${type}_${server1.id}` });
        if (server2) { row.push({ text: server2.nama_server, callback_data: `${action}_username_${type}_${server2.id}` }); }
        keyboard.push(row);
      }

      const navButtons = [];
      if (totalPages > 1) { 
        if (currentPage > 0) { navButtons.push({ text: '⬅️ Back', callback_data: `Maps_${action}_${type}_${currentPage - 1}` }); }
        if (currentPage < totalPages - 1) { navButtons.push({ text: '➡️ Next', callback_data: `Maps_${action}_${type}_${currentPage + 1}` }); }
      }
      if (navButtons.length > 0) { keyboard.push(navButtons); }
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);

      const serverList = currentServers.map(server => {
        const normalPrice = server.harga;
        const pricePerDay = calculatePrice(normalPrice, userRole);
        const pricePer30Days = pricePerDay * 30;
        const isFull = server.total_create_akun >= server.batas_create_akun;
        
        let priceText = `💰 Harga per hari: Rp${pricePerDay.toLocaleString('id-ID')}\n`;
        priceText += `📅 Harga per 30 hari: Rp${pricePer30Days.toLocaleString('id-ID')}\n`;
        if (userRole === 'reseller') { priceText += `(Harga Normal: Rp${normalPrice.toLocaleString('id-ID')}/hari)`; }

        return `🌐 *${server.nama_server}* (${server.domain})\n` + priceText + 
               `\n📊 Quota: ${server.quota}GB\n` + `🔢 Limit IP: ${server.iplimit} IP\n` +
               (isFull ? `⚠️ *Server Penuh*` : `👥 Total Create Akun: ${server.total_create_akun}/${server.batas_create_akun}`);
      }).join('\n\n');

      const options = { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' };
      if (ctx.updateType === 'callback_query') { ctx.editMessageText(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages}):*\n\n${serverList}`, options); } 
      else { ctx.reply(`📋 *List Server (Halaman ${currentPage + 1} dari ${totalPages}):*\n\n${serverList}`, options); }
      userState[ctx.chat.id] = { step: `${action}_username_${type}`, page: currentPage };
    });
  } catch (error) { logger.error(`❌ Error saat memulai proses ${action} untuk ${type}:`, error); await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.`, { parse_mode: 'Markdown' }); }
}

// --- ACTION UNTUK MEMULAI CREATE/RENEW ---
bot.action('service_create', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [[{ text: 'Buat Ssh/Ovpn', callback_data: 'create_ssh' }],      
      [{ text: 'Buat Vmess', callback_data: 'create_vmess' }, { text: 'Buat Vless', callback_data: 'create_vless' }],
      [{ text: 'Buat Trojan', callback_data: 'create_trojan' }, { text: 'Buat Shadowsocks', callback_data: 'create_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]];
    await ctx.editMessageText('➕ *Pilih jenis akun yang ingin Anda buat:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});
bot.action('service_renew', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [[{ text: 'Perpanjang Ssh/Ovpn', callback_data: 'renew_ssh' }],      
      [{ text: 'Perpanjang Vmess', callback_data: 'renew_vmess' }, { text: 'Perpanjang Vless', callback_data: 'renew_vless' }],
      [{ text: 'Perpanjang Trojan', callback_data: 'renew_trojan' }, { text: 'Perpanjang Shadowsocks', callback_data: 'renew_shadowsocks' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]];
    await ctx.editMessageText('♻️ *Pilih jenis akun yang ingin Anda perpanjang:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});

// --- ACTION UNTUK MEMILIH SERVER (CREATE & RENEW) ---
bot.action(/navigate_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match; await startSelectServer(ctx, action, type, parseInt(page, 10));
});
bot.action(/(create|renew)_(vmess|vless|trojan|shadowsocks|ssh)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2]; await startSelectServer(ctx, action, type, 0);
});
bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh)_(.+)/, async (ctx) => {
  const action = ctx.match[1]; const type = ctx.match[2]; const serverId = ctx.match[3];
  userState[ctx.chat.id] = { step: `username_${action}_${type}`, serverId, type, action };

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) { return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' }); }
    if (!server) { return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' }); }
    if (server.total_create_akun >= server.batas_create_akun) { return ctx.reply('❌ *Server penuh. Tidak dapat membuat akun baru di server ini.*', { parse_mode: 'Markdown' }); }
    await ctx.reply('👤 *Masukkan username:*', { parse_mode: 'Markdown' });
  });
});

// --- ACTION UNTUK MEMULAI TRIAL ---
bot.action(/(trial)_(vmess|vless|trojan|shadowsocks|ssh)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2];
    userState[ctx.chat.id] = { step: `username_${action}_${type}`, action, type, serverId: null }; 
    await ctx.reply('👤 *Masukkan username untuk Trial Akun (Masa Aktif 3 Jam):*', { parse_mode: 'Markdown' });
});

// --- ACTION UNTUK MEMULAI RESELLER ACTIONS (DELETE, LOCK, UNLOCK, CHECK) ---
bot.action(/(del|lock|unlock|check)_(vmess|vless|trojan|shadowsocks|ssh)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2];
    userState[ctx.chat.id] = { step: `reseller_action_${action}_${type}`, action, type }; 
    await ctx.reply(`👤 *RESELLER: Masukkan Username/UUID Akun yang ingin di-${action.toUpperCase()}:*`, { parse_mode: 'Markdown' });
});

// --- ACTION UNTUK TOP UP SALDO BARU ---
bot.action('topup_saldo', async (ctx) => {
    try {
        await ctx.answerCbQuery(); 
        userState[ctx.chat.id] = { step: 'request_pakasir_amount', amount: '' };
        await ctx.editMessageText(
            `💰 *TOP UP SALDO (OTOMATIS)*\n\n` +
            `Silakan masukkan jumlah nominal saldo (hanya angka) yang Anda ingin tambahkan ke akun Anda.\n` +
            `Minimal Top Up adalah *Rp ${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}*.\n\n` +
            `_Contoh: 50000_`, 
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        logger.error('❌ Kesalahan saat memulai proses top-up saldo otomatis:', error);
        await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    }
});

// --- TEXT HANDLER UTAMA ---
bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id]; if (!state) return; 
  const text = ctx.message.text.trim();

  // --- 1. FLOW CREATE/RENEW ---
  if (state.step.startsWith('username_') && state.action !== 'trial') {
    state.username = text;
    if (!state.username || state.username.length < 3 || state.username.length > 20 || /[A-Z]/.test(state.username) || /[^a-z0-9]/.test(state.username)) { return ctx.reply('❌ *Username tidak valid. Gunakan 3-20 karakter, huruf kecil, dan angka saja.*', { parse_mode: 'Markdown' }); }
    const { type, action } = state;
    if (action === 'create' && type === 'ssh') { state.step = `password_${state.action}_${state.type}`; await ctx.reply('🔑 *Masukkan password:*', { parse_mode: 'Markdown' }); } 
    else { state.step = `exp_${state.action}_${state.type}`; await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' }); }
  } else if (state.step.startsWith('password_')) {
    state.password = text;
    if (!state.password || state.password.length < 6 || /[^a-zA-Z0-9]/.test(state.password)) { return ctx.reply('❌ *Password tidak valid. Gunakan minimal 6 karakter (huruf/angka).*', { parse_mode: 'Markdown' }); }
    state.step = `exp_${state.action}_${state.type}`; await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  } else if (state.step.startsWith('exp_')) {
    const exp = parseInt(text, 10);
    if (isNaN(exp) || exp <= 0 || exp > 365) { return ctx.reply('❌ *Masa aktif tidak valid. Masukkan angka yang valid (1-365 hari).*', { parse_mode: 'Markdown' }); }
    state.exp = exp;
    
    db.get('SELECT quota, iplimit, harga FROM Server WHERE id = ?', [state.serverId], async (err, server) => {
      if (err || !server) { return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' }); }
      state.quota = server.quota; state.iplimit = server.iplimit;

      const user = await getUserDetails(ctx.from.id);
      const pricePerDay = calculatePrice(server.harga, user.role);
      const totalHarga = pricePerDay * state.exp; 

      if (user.saldo < totalHarga) { return ctx.reply(`❌ *Saldo Anda tidak mencukupi. Harga total: Rp${totalHarga.toLocaleString('id-ID')}*.`, { parse_mode: 'Markdown' }); }
      
      let msg; const { username, password, exp, quota, iplimit, serverId, type, action } = state;
      if (action === 'create') {
          if (type === 'vmess') { msg = await createvmess(username, exp, quota, iplimit, serverId); } else if (type === 'vless') { msg = await createvless(username, exp, quota, iplimit, serverId); } else if (type === 'trojan') { msg = await createtrojan(username, exp, quota, iplimit, serverId); } else if (type === 'shadowsocks') { msg = await createshadowsocks(username, exp, quota, iplimit, serverId); } else if (type === 'ssh') { msg = await createssh(username, password, exp, iplimit, serverId); }
      } else if (action === 'renew') {
          if (type === 'vmess') { msg = await renewvmess(username, exp, quota, iplimit, serverId); } else if (type === 'vless') { msg = await renewvless(username, exp, quota, iplimit, serverId); } else if (type === 'trojan') { msg = await renewtrojan(username, exp, quota, iplimit, serverId); } else if (type === 'shadowsocks') { msg = await renewshadowsocks(username, exp, quota, iplimit, serverId); } else if (type === 'ssh') { msg = await renewssh(username, exp, iplimit, serverId); }
      }
      await recordAccountTransaction(ctx.from.id, type);
      logger.info(`Account ${action} and transaction recorded for user ${ctx.from.id}, type: ${type}`);

      db.run('BEGIN TRANSACTION');
      db.run('UPDATE users SET saldo = saldo - ? WHERE user_id = ?', [totalHarga, ctx.from.id], (err) => {
        if (err) { db.run('ROLLBACK'); return ctx.reply('❌ *Terjadi kesalahan saat mengurangi saldo pengguna. Transaksi dibatalkan.*', { parse_mode: 'Markdown' }); }
        db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId], (err) => {
          if (err) { db.run('ROLLBACK'); return ctx.reply('❌ *Terjadi kesalahan saat menambahkan total_create_akun. Transaksi dibatalkan.*', { parse_mode: 'Markdown' }); }
          db.run('COMMIT');
          ctx.reply(`✅ *Transaksi Berhasil!* Saldo terpotong: Rp${totalHarga.toLocaleString('id-ID')}.\n\n` + msg, { parse_mode: 'Markdown' });
          delete userState[ctx.chat.id];
        });
      });
    });
  }
  
  // --- 2. FLOW TRIAL ---
  else if (state.step.startsWith('username_') && state.action === 'trial') {
    state.username = text;
    if (!state.username || state.username.length < 3 || state.username.length > 20 || /[A-Z]/.test(state.username) || /[^a-z0-9]/.test(state.username)) { return ctx.reply('❌ *Username Trial tidak valid. Gunakan 3-20 karakter, huruf kecil, dan angka saja.*', { parse_mode: 'Markdown' }); }

    const { username, type } = state; let msg;
    db.all('SELECT id FROM Server', [], async (err, servers) => {
        if (err || servers.length === 0) { return ctx.reply('❌ *GAGAL!* Tidak ada server yang tersedia untuk Trial.', { parse_mode: 'Markdown' }); }
        
        const serverId = servers[0].id; // Asumsi dikirim ke server pertama
        const iplimit = 1; 
        const quota = 0;   
        const password = 'trial'; 

        if (type === 'vmess') { msg = await trialvmess(username, TRIAL_EXPIRY_DAYS, quota, iplimit, serverId); } 
        else if (type === 'vless') { msg = await trialvless(username, TRIAL_EXPIRY_DAYS, quota, iplimit, serverId); } 
        else if (type === 'trojan') { msg = await trialtrojan(username, TRIAL_EXPIRY_DAYS, quota, iplimit, serverId); } 
        else if (type === 'shadowsocks') { msg = await trialshadowsocks(username, TRIAL_EXPIRY_DAYS, quota, iplimit, serverId); } 
        else if (type === 'ssh') { msg = await trialssh(username, password, TRIAL_EXPIRY_DAYS, iplimit, serverId); }
        
        ctx.reply(`✅ *Trial Akun Berhasil Dibuat!* (Masa Aktif 3 Jam)\n\n` + msg, { parse_mode: 'Markdown' });
        delete userState[ctx.chat.id];
    });
  }

  // --- 3. FLOW RESELLER ACTIONS (DELETE, LOCK, UNLOCK, CHECK) ---
  else if (state.step.startsWith('reseller_action_')) {
    state.target = text; 
    const [,, action, type] = state.step.split('_'); 
    
    db.all('SELECT id FROM Server', [], async (err, servers) => {
        if (err || servers.length === 0) { return ctx.reply('❌ *GAGAL!* Tidak ada server tersedia.', { parse_mode: 'Markdown' }); }

        let finalMsg = `❌ Aksi ${action.toUpperCase()} GAGAL. Akun \`${state.target}\` tidak ditemukan di semua server.`;
        
        for (const server of servers) {
            const serverId = server.id;
            const username = state.target;
            let msg;

            if (action === 'del') {
                if (type === 'vmess') { msg = await delvmess(username, 0, 0, 0, serverId); } else if (type === 'vless') { msg = await delvless(username, 0, 0, 0, serverId); } else if (type === 'trojan') { msg = await deltrojan(username, 0, 0, 0, serverId); } else if (type === 'shadowsocks') { msg = await delshadowsocks(username, 0, 0, 0, serverId); } else if (type === 'ssh') { msg = await delssh(username, 'pw', 0, 0, serverId); }
            } else if (action === 'lock') {
                if (type === 'vmess') { msg = await lockvmess(username, 0, 0, 0, serverId); } else if (type === 'vless') { msg = await lockvless(username, 0, 0, 0, serverId); } else if (type === 'trojan') { msg = await locktrojan(username, 0, 0, 0, serverId); } else if (type === 'shadowsocks') { msg = await lockshadowsocks(username, 0, 0, 0, serverId); } else if (type === 'ssh') { msg = await lockssh(username, 'pw', 0, 0, serverId); }
            } else if (action === 'unlock') {
                if (type === 'vmess') { msg = await unlockvmess(username, 0, 0, 0, serverId); } else if (type === 'vless') { msg = await unlockvless(username, 0, 0, 0, serverId); } else if (type === 'trojan') { msg = await unlocktrojan(username, 0, 0, 0, serverId); } else if (type === 'shadowsocks') { msg = await unlockshadowsocks(username, 0, 0, 0, serverId); } else if (type === 'ssh') { msg = await unlockssh(username, 'pw', 0, 0, serverId); }
            } else if (action === 'check') {
                if (type === 'vmess') { msg = await checkvmess(username, 0, 0, 0, serverId); } else if (type === 'vless') { msg = await checkvless(username, 0, 0, 0, serverId); } else if (type === 'trojan') { msg = await checktrojan(username, 0, 0, 0, serverId); } else if (type === 'shadowsocks') { msg = await checkshadowsocks(username, 0, 0, 0, serverId); } else if (type === 'ssh') { msg = await checkssh(username, 0, 0, 0, serverId); }
            }

            if (msg.startsWith('✅') || action === 'check') {
                finalMsg = msg; // Ambil pesan sukses atau pesan check
                break; 
            }
        }

        ctx.reply(`👑 *RESELLER AKSI ${action.toUpperCase()}*\n\n` + finalMsg, { parse_mode: 'Markdown' });
        delete userState[ctx.chat.id];
    });
  }

  // --- 4. FLOW TOP UP PAKASIR (Konfirmasi Nominal) ---
  else if (state.step === 'request_pakasir_amount') { 
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) { return ctx.reply(`❌ *Nominal tidak valid.* Masukkan angka yang valid (minimal Rp${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}).`, { parse_mode: 'Markdown' }); }
    
    await ctx.reply(`📝 *Konfirmasi Top Up Saldo Otomatis:*\n\n💰 Jumlah Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n\nTekan tombol di bawah untuk membuat tautan pembayaran QRIS Pakasir.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: `💳 Buat Pembayaran Rp ${amount.toLocaleString('id-ID')}`, callback_data: `create_pakasir_payment_${amount}` }],
                [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
            ]
        },
        parse_mode: 'Markdown'
    });
    delete userState[ctx.chat.id];
  } 

  // --- 5. FLOW ADMIN ADD SERVER ---
  else if (state.step === 'addserver' || state.step.startsWith('addserver_')) {
    if (state.step === 'addserver') {
        const domain = text; if (!domain) { return ctx.reply('⚠️ *Domain tidak boleh kosong.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_auth'; state.domain = domain; await ctx.reply('🔑 *Silakan masukkan auth server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_auth') {
        const auth = text; if (!auth) { return ctx.reply('⚠️ *Auth tidak boleh kosong.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_nama_server'; state.auth = auth; await ctx.reply('🏷️ *Silakan masukkan nama server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_nama_server') {
        const nama_server = text; if (!nama_server) { return ctx.reply('⚠️ *Nama server tidak boleh kosong.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_quota'; state.nama_server = nama_server; await ctx.reply('📊 *Silakan masukkan quota server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_quota') {
        const quota = parseInt(text, 10); if (isNaN(quota)) { return ctx.reply('⚠️ *Quota tidak valid.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_iplimit'; state.quota = quota; await ctx.reply('🔢 *Silakan masukkan limit IP server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_iplimit') {
        const iplimit = parseInt(text, 10); if (isNaN(iplimit)) { return ctx.reply('⚠️ *Limit IP tidak valid.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_batas_create_akun'; state.iplimit = iplimit; await ctx.reply('🔢 *Silakan masukkan batas create akun server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_batas_create_akun') {
        const batas_create_akun = parseInt(text, 10); if (isNaN(batas_create_akun)) { return ctx.reply('⚠️ *Batas create akun tidak valid.*', { parse_mode: 'Markdown' }); } state.step = 'addserver_harga'; state.batas_create_akun = batas_create_akun; await ctx.reply('💰 *Silakan masukkan harga server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_harga') {
        const harga = parseFloat(text); if (isNaN(harga) || harga <= 0) { return ctx.reply('⚠️ *Harga tidak valid.*', { parse_mode: 'Markdown' }); }
        const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;
        try {
          db.run('INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0], function(err) {
            if (err) { logger.error('Error saat menambahkan server:', err.message); ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' }); } 
            else { ctx.reply(`✅ *Server baru dengan domain ${domain} telah berhasil ditambahkan.*\n\n📄 *Detail Server:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama Server: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create Akun: ${batas_create_akun}\n- Harga: Rp ${harga.toLocaleString('id-ID')}`, { parse_mode: 'Markdown' }); }
          });
        } catch (error) { logger.error('Error saat menambahkan server:', error); await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' }); }
        delete userState[ctx.chat.id];
    }
  }
});

// --- ACTION HANDLERS PAKASIR ---

bot.action(/create_pakasir_payment_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    await ctx.answerCbQuery('Membuat tautan pembayaran Pakasir...');

    try {
        const { orderId, paymentUrl } = await generatePakasirPayment(userId, amount);

        const expiryDate = new Date(Date.now() + 60 * 60 * 1000); 
        const expiryText = expiryDate.toLocaleTimeString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const message = 
            `✅ *TAUTAN PEMBAYARAN TERSEDIA*\n\n` +
            `Invoice ID: \`${orderId}\`\n` +
            `Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n` +
            `Metode: *QRIS*\n` +
            `Kadaluarsa: ${expiryText} WIB\n\n` +
            `Klik tombol di bawah untuk membayar menggunakan QRIS. Saldo akan ditambahkan otomatis setelah pembayaran berhasil dikonfirmasi Pakasir (via Webhook).\n\n` +
            ``;

        await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💳 Klik Untuk Bayar (QRIS)', url: paymentUrl }],
                    [{ text: '🔄 Cek Status Transaksi', callback_data: `check_pakasir_status_${orderId}` }],
                    [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
                ]
            }
        });
    } catch (error) {
        logger.error('❌ Error creating Pakasir payment:', error.message);
        await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat membuat tautan pembayaran. Coba lagi nanti.', { parse_mode: 'Markdown' });
    }
});

bot.action(/check_pakasir_status_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    await ctx.answerCbQuery('Mengecek status pembayaran...');
    
    try {
        const pending = await new Promise((resolve, reject) => {
            db.get('SELECT amount FROM pending_deposits_pakasir WHERE order_id = ? AND status = ?', [orderId, 'pending'], (err, row) => { if (err) return reject(err); resolve(row); });
        });

        if (!pending) { return ctx.reply('✅ *Transaksi sudah selesai atau tidak ditemukan.* Silakan cek saldo Anda.', { parse_mode: 'Markdown' }); }

        const amount = pending.amount;
        const statusResponse = await pakasir.checkTransactionStatus(orderId, amount);
        const status = statusResponse.transaction.status;

        if (status === 'completed') {
            await handlePakasirWebhook({ order_id: orderId, amount: amount, project: PAKASIR_PROJECT_SLUG, status: 'completed', payment_method: 'qris' }, bot);
            return ctx.reply('✅ *Pembayaran berhasil dikonfirmasi!* Saldo Anda telah ditambahkan secara otomatis.', { parse_mode: 'Markdown' });
        } else if (status === 'pending') {
            return ctx.reply(`⏳ *Status Transaksi: Menunggu Pembayaran*\n\nInvoice: \`${orderId}\`\nNominal: *Rp ${amount.toLocaleString('id-ID')}*\n\nMohon selesaikan pembayaran sebelum batas waktu.`, { parse_mode: 'Markdown' });
        } else { 
            return ctx.reply(`❌ *Status Transaksi: ${status.toUpperCase()}*\n\nTransaksi ini sudah tidak valid. Silakan buat transaksi Top Up baru.`, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        logger.error('❌ Error checking Pakasir status:', error.message);
        await ctx.reply('❌ *GAGAL!* Terjadi kesalahan saat mengecek status pembayaran. Coba lagi nanti.', { parse_mode: 'Markdown' });
    }
});

// --- ADMIN COMMANDS ---

async function sendAdminMenu(ctx) {
  const adminKeyboard = [
    [{ text: '➕ Tambah Server', callback_data: 'addserver' }, { text: '❌ Hapus Server', callback_data: 'deleteserver' }],
    [{ text: '💲 Edit Harga', callback_data: 'editserver_harga' }, { text: '📝 Edit Nama', callback_data: 'nama_server_edit' }],
    [{ text: '🌐 Edit Domain', callback_data: 'editserver_domain' }, { text: '🔑 Edit Auth', callback_data: 'editserver_auth' }],
    [{ text: '📊 Edit Quota', callback_data: 'editserver_quota' }, { text: '📶 Edit Limit IP', callback_data: 'editserver_limit_ip' }],
    [{ text: '🔢 Edit Batas Create', callback_data: 'editserver_batas_create_akun' }, { text: '🔢 Edit Total Create', callback_data: 'editserver_total_create_akun' }],
    [{ text: '💵 Tambah Saldo', callback_data: 'addsaldo_user' }, { text: '📋 List Server', callback_data: 'listserver' }],
    [{ text: '♻️ Reset Server', callback_data: 'resetdb' }, { text: 'ℹ️ Detail Server', callback_data: 'detailserver' }],
    [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
  ];
  try {
    const options = { reply_markup: { inline_keyboard: adminKeyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText('Menu Admin:', options); } 
    else { await ctx.reply('Menu Admin:', options); }
  } catch (error) { logger.error('Error saat mengirim menu admin:', error); }
}

bot.command('addsaldo', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const args = ctx.message.text.split(' ');
  if (args.length !== 3) { return ctx.reply('⚠️ Format salah. Gunakan: `/addsaldo <user_id> <jumlah>`', { parse_mode: 'Markdown' }); }
  const targetUserId = parseInt(args[1]);
  const amount = parseInt(args[2]);
  if (isNaN(targetUserId) || isNaN(amount) || amount <= 0) { return ctx.reply('⚠️ `user_id` dan `jumlah` harus berupa angka positif.', { parse_mode: 'Markdown' }); }
  db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
      if (err) { return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id`.', { parse_mode: 'Markdown' }); }
      if (!row) { return ctx.reply('⚠️ `user_id` tidak terdaftar.', { parse_mode: 'Markdown' }); }
      db.run("UPDATE users SET saldo = saldo + ? WHERE user_id = ?", [amount, targetUserId], function(err) {
          if (err) { return ctx.reply('⚠️ Kesalahan saat menambahkan saldo.', { parse_mode: 'Markdown' }); }
          if (this.changes === 0) { return ctx.reply('⚠️ Pengguna tidak ditemukan.', { parse_mode: 'Markdown' }); }
          ctx.reply(`✅ Saldo sebesar \`${amount.toLocaleString('id-ID')}\` berhasil ditambahkan untuk \`user_id\` \`${targetUserId}\`.`, { parse_mode: 'Markdown' });
      });
  });
});
// [Sisa kode admin commands: hapuslog, helpadmin, broadcast]
bot.command('hapuslog', async (ctx) => {
  if (!adminIds.includes(ctx.from.id)) return ctx.reply('Tidak ada izin!');
  try {
    if (fs.existsSync('bot-combined.log')) fs.unlinkSync('bot-combined.log');
    if (fs.existsSync('bot-error.log')) fs.unlinkSync('bot-error.log');
    ctx.reply('Log berhasil dihapus.');
  } catch (e) { ctx.reply('Gagal menghapus log: ' + e.message); }
});

bot.command('helpadmin', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const helpMessage = `*📋 Daftar Perintah Admin:*\n1. /addserver - Menambahkan server baru.\n2. /addsaldo - Menambahkan saldo ke akun pengguna.\n...\n`; // Omitted list for brevity
  ctx.reply(helpMessage, { parse_mode: 'Markdown' });
});

bot.command('broadcast', async (ctx) => {
  const userId = ctx.message.from.id;
  if (!adminIds.includes(userId)) { return ctx.reply('⚠️ Anda tidak memiliki izin untuk menggunakan perintah ini.', { parse_mode: 'Markdown' }); }
  const message = ctx.message.reply_to_message ? ctx.message.reply_to_message.text : ctx.message.text.split(' ').slice(1).join(' ');
  if (!message) { return ctx.reply('⚠️ Mohon berikan pesan untuk disiarkan.', { parse_mode: 'Markdown' }); }
  db.all("SELECT user_id FROM users", [], (err, rows) => {
      if (err) { return ctx.reply('⚠️ Kesalahan saat mengambil daftar pengguna.', { parse_mode: 'Markdown' }); }
      rows.forEach((row) => {
          const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
          axios.post(telegramUrl, { chat_id: row.user_id, text: message }).catch((error) => { logger.error(`⚠️ Kesalahan saat mengirim pesan siaran ke ${row.user_id}`, error.message); });
      });
      ctx.reply('✅ Pesan siaran berhasil dikirim.', { parse_mode: 'Markdown' });
  });
});
// --- ACTION HANDLERS ADMIN CRUD ---

bot.action('admin_menu', async (ctx) => {
    if (!adminIds.includes(ctx.from.id)) { await ctx.answerCbQuery('🚫 Anda tidak memiliki izin untuk mengakses menu admin.', { show_alert: true }); return; }
    await sendAdminMenu(ctx);
});

bot.action('deleteserver', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) { return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' }); }
      if (servers.length === 0) { return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' }); }
      const keyboard = servers.map(server => { return [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }]; });
      keyboard.push([{ text: '🔙 Kembali ke Menu Utama', callback_data: 'send_main_menu' }]);
      ctx.reply('🗑️ *Pilih server yang ingin dihapus:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    });
  } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' }); }
});

bot.action(/confirm_delete_server_(\d+)/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    db.run('DELETE FROM Server WHERE id = ?', [ctx.match[1]], function(err) {
      if (err) { return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat menghapus server.*', { parse_mode: 'Markdown' }); }
      if (this.changes === 0) { return ctx.reply('⚠️ *PERHATIAN! Server tidak ditemukan.*', { parse_mode: 'Markdown' }); }
      ctx.reply('✅ *Server berhasil dihapus.*', { parse_mode: 'Markdown' });
    });
  } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' }); }
});

bot.action('resetdb', async (ctx) => {
  try { await ctx.answerCbQuery(); await ctx.reply('🚨 *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', { reply_markup: { inline_keyboard: [[{ text: '✅ Ya', callback_data: 'confirm_resetdb' }], [{ text: '❌ Tidak', callback_data: 'cancel_resetdb' }]] }, parse_mode: 'Markdown' }); } 
  catch (error) { await ctx.reply(`❌ *Terjadi kesalahan.*`, { parse_mode: 'Markdown' }); }
});
bot.action('confirm_resetdb', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM Server', (err) => {
        if (err) { return reject('❗️ *PERHATIAN! Terjadi KESALAHAN SERIUS saat mereset database. Harap segera hubungi administrator!*'); }
        resolve();
      });
    });
    await ctx.reply('🚨 *PERHATIAN! Database telah DIRESET SEPENUHNYA. Semua server telah DIHAPUS TOTAL.*', { parse_mode: 'Markdown' });
  } catch (error) { await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' }); }
});
bot.action('cancel_resetdb', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' }); });

// --- CRUD EDIT ACTIONS (Mulai Input) ---
bot.action(/edit_harga_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId, amount: '' }; await ctx.reply('💰 *Silakan masukkan harga server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_nama_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_nama', serverId: serverId, name: '' }; await ctx.reply('🏷️ *Silakan masukkan nama server baru:*', { reply_markup: { inline_keyboard: keyboard_abc() }, parse_mode: 'Markdown' }); });
bot.action(/edit_domain_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_domain', serverId: serverId, domain: '' }; await ctx.reply('🌐 *Silakan masukkan domain server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_auth_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_auth', serverId: serverId, auth: '' }; await ctx.reply('🔑 *Silakan masukkan auth server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_quota_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId, quota: '' }; await ctx.reply('📊 *Silakan masukkan quota server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_limit_ip_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId, iplimit: '' }; await ctx.reply('📶 *Silakan masukkan limit IP server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId, batasCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan batas create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId, totalCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan total create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action('addsaldo_user', async (ctx) => {
    try {
        await ctx.answerCbQuery(); 
        userState[ctx.chat.id] = { step: 'request_user_id_for_add_saldo' };
        await ctx.editMessageText('👤 *Silakan masukkan User ID Telegram yang ingin ditambahkan saldonya:*', { parse_mode: 'Markdown' });
    } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda.*', { parse_mode: 'Markdown' }); }
});


// --- INPUT CALLBACK HANDLERS (Numeric and Text) ---

async function handleNumericInput(ctx, userStateData, data, field, fieldName, query, isAddSaldo = false) {
  let currentValue = userStateData[field] || ''; await ctx.answerCbQuery();
  if (data === 'delete') { currentValue = currentValue.slice(0, -1); } 
  else if (data === 'confirm') {
    if (currentValue.length === 0 || isNaN(parseFloat(currentValue)) || parseFloat(currentValue) <= 0) { return ctx.reply(`❌ *${fieldName} tidak valid.* Masukkan angka yang valid.`, { parse_mode: 'Markdown' }); }
    const numericValue = parseFloat(currentValue);
    try {
      if (isAddSaldo) { await updateUserBalance(userStateData.userId, numericValue); ctx.reply(`✅ *Saldo user berhasil ditambahkan.*\n\n📄 *Detail Saldo:*\n- Jumlah Saldo: *Rp ${numericValue.toLocaleString('id-ID')}*`, { parse_mode: 'Markdown' }); } 
      else { await updateServerField(userStateData.serverId, numericValue, query); ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Baru: *${isAddSaldo || fieldName === 'harga' ? 'Rp ' + numericValue.toLocaleString('id-ID') : numericValue}*`, { parse_mode: 'Markdown' }); }
    } catch (err) { ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' }); }
    delete userState[ctx.chat.id]; return;
  } else if (!/^\d+$/.test(data)) { return; } 
  else { if (currentValue.length < 12) { currentValue += data; } else { return ctx.reply('⚠️ *Jumlah maksimal adalah 12 digit!*', { parse_mode: 'Markdown' }); } }

  userStateData[field] = currentValue;
  const displayValue = isAddSaldo || fieldName === 'harga' ? `Rp ${currentValue.toLocaleString('id-ID')}` : currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${displayValue}*`;
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during numeric input:', error); }
}

async function handleTextInput(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || ''; await ctx.answerCbQuery();

  if (data === 'delete') { currentValue = currentValue.slice(0, -1); } 
  else if (data === 'confirm') {
    if (currentValue.length === 0) { return ctx.reply(`❌ *${fieldName} tidak boleh kosong.*`, { parse_mode: 'Markdown' }); }
    try {
      await updateServerField(userStateData.serverId, currentValue, query);
      ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Baru: *${currentValue}*`, { parse_mode: 'Markdown' });
    } catch (err) { ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' }); }
    delete userState[ctx.chat.id]; return;
  } else if (!/^[a-zA-Z0-9.\-_@]+$/.test(data)) { return; } 
  else { if (currentValue.length < 253) { currentValue += data; } else { return ctx.reply(`⚠️ *${fieldName} maksimal adalah 253 karakter!*`, { parse_mode: 'Markdown' }); } }

  userStateData[field] = currentValue;
  const newMessage = `📊 *Silakan masukkan ${fieldName} server baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${currentValue}*`;
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: field === 'name' ? keyboard_abc() : keyboard_full() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during text input:', error); }
}


bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (userStateData) {
    switch (userStateData.step) {
      case 'add_saldo': await handleNumericInput(ctx, userStateData, data, 'saldo', 'saldo', 'UPDATE users SET saldo = saldo + ? WHERE user_id = ?', true); break;
      case 'edit_batas_create_akun': await handleNumericInput(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?'); break;
      case 'edit_total_create_akun': await handleNumericInput(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?'); break;
      case 'edit_limit_ip': await handleNumericInput(ctx, userStateData, data, 'iplimit', 'limit IP', 'UPDATE Server SET iplimit = ? WHERE id = ?'); break;
      case 'edit_quota': await handleNumericInput(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?'); break;
      case 'edit_harga': await handleNumericInput(ctx, userStateData, data, 'amount', 'harga', 'UPDATE Server SET harga = ? WHERE id = ?'); break;
      case 'edit_auth': await handleTextInput(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?'); break;
      case 'edit_domain': await handleTextInput(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?'); break;
      case 'edit_nama': await handleTextInput(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?'); break;
      default: break;
    }
  }
});
// --- LOGIKA BACKUP DATABASE RAHMARIE---

// Menggunakan sqlite3-specific dump logic
function backupDatabase() {
    logger.info('Mulai proses backup database harian...');
    const today = new Date().toISOString().split('T')[0];
    const backupFileName = `sellvpn_backup_${today}.sql`;
    const backupPath = path.join(__dirname, backupFileName);
    
    // Command untuk membuat dump SQL dari SQLite3
    const dumpCommand = `.dump`;

    // Kita menggunakan child_process untuk menjalankan command sqlite3
    const { spawn } = require('child_process');

    try {
        const sqliteProcess = spawn('sqlite3', ['./sellvpn.db']);
        
        let dumpData = '';
        sqliteProcess.stdout.on('data', (data) => {
            dumpData += data.toString();
        });

        sqliteProcess.stderr.on('data', (data) => {
            logger.error(`SQLite Dump Error: ${data.toString()}`);
        });

        sqliteProcess.on('close', async (code) => {
            if (code === 0) {
                // Tulis hasil dump ke file .sql
                fs.writeFileSync(backupPath, dumpData);
                logger.info(`✅ Database dump berhasil dibuat di ${backupFileName}`);

                // Kirim file backup ke Admin ID utama
                try {
                    // Cek jika ADMIN adalah array, ambil ID pertama. Jika bukan array, gunakan ADMIN.
                    const adminRecipientId = Array.isArray(ADMIN) ? ADMIN[0] : ADMIN;
                    
                    await bot.telegram.sendDocument(adminRecipientId, { source: backupPath, filename: backupFileName }, {
                        caption: `🤖 *BACKUP OTOMATIS HARIAN*\n\nDatabase \`${backupFileName}\` berhasil dibuat dan dikirim.\n\nSimpan file ini untuk pemulihan (restore) data.`,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`✅ File backup berhasil dikirim ke Admin ID: ${adminRecipientId}`);
                } catch (e) {
                    logger.error(`❌ Gagal mengirim file backup ke admin: ${e.message}`);
                } finally {
                    // Hapus file backup setelah dikirim untuk menghemat ruang
                    fs.unlinkSync(backupPath);
                    logger.info(`File backup ${backupFileName} telah dihapus dari server.`);
                }
            } else {
                logger.error(`❌ Proses SQLite dump gagal dengan kode ${code}`);
            }
        });

        // Kirim perintah .dump ke proses sqlite3
        sqliteProcess.stdin.write(dumpCommand + '\n');
        sqliteProcess.stdin.end();

    } catch (e) {
        logger.error(`❌ Gagal menjalankan proses backup (Pastikan paket 'sqlite3' terinstal di sistem Anda): ${e.message}`);
    }
}

// Jadwal Backup Harian (Misal, setiap jam 03:00 pagi)
// Format: menit jam hari_dari_bulan bulan hari_dari_minggu
cron.schedule('0 3 * * *', () => {
    backupDatabase();
    // Gunakan 3 pagi waktu server, ini adalah jam paling sepi transaksi.
}, {
    timezone: "Asia/Jakarta" // Gunakan zona waktu Indonesia (WIB)
});

logger.info('✅ Penjadwalan backup harian (03:00 WIB) telah aktif.');


// --- INISIALISASI SERVER ---
app.listen(port, () => {
  bot.launch().then(() => {
      logger.info('Bot telah dimulai');
  }).catch((error) => {
      logger.error('Error saat memulai bot:', error);
  });
  logger.info(`Server berjalan di port ${port}`);
});