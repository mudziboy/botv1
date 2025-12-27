// =======================================================
// 1. MODUL BAWAAN (NATIVE MODULES)
// =======================================================
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process'); // spawn ditambahkan untuk backup

// =======================================================
// 2. MODUL PIHAK KETIGA (THIRD-PARTY MODULES)
// =======================================================
const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const { PakasirClient } = require('pakasir-client');

// =======================================================
// 3. KONSTANTA DAN KONFIGURASI
// =======================================================

// --- PEMUATAN KONSTANTA DARI .vars.json ---
const vars = JSON.parse(fs.readFileSync('./.vars.json', 'utf8'));

// Variabel Bot dan Aplikasi
const BOT_TOKEN = vars.BOT_TOKEN;
const port = vars.PORT || 50123;
const ADMIN_RAW = vars.USER_ID;
const GROUP_ID = vars.GROUP_ID;
const CHANNEL_USERNAME = vars.CHANNEL_USERNAME;
const ADMIN_USERNAME_TEMBAK_PAKET = vars.ADMIN_USERNAME_TEMBAK_PAKET || '@dorinajabot';


// Variabel Pakasir
const PAKASIR_API_KEY = vars.PAKASIR_API_KEY;
const PAKASIR_PROJECT_SLUG = vars.PAKASIR_PROJECT_SLUG;
const PAKASIR_WEBHOOK_URL = vars.PAKASIR_WEBHOOK_URL;
const PAKASIR_BASE_URL = vars.PAKASIR_BASE_URL;

// Variabel Bisnis/Angka
const NAMA_STORE = vars.NAMA_STORE;
const MIN_DEPOSIT_AMOUNT = vars.MIN_DEPOSIT_AMOUNT || 10000;
const RESELLER_PRICE = vars.RESELLER_PRICE || 25000;
const RESELLER_DISCOUNT_PERCENT = vars.RESELLER_DISCOUNT_PERCENT || 40;

// Variabel Batasan (Limit)
const TRIAL_EXPIRY_HOURS = vars.TRIAL_EXPIRY_HOURS || 1;
const MEMBER_TRIAL_LIMIT = vars.MEMBER_TRIAL_LIMIT || 1;
const RESELLER_TRIAL_LIMIT = vars.RESELLER_TRIAL_LIMIT || 10;

// --- KONFIGURASI BARU: CASHBACK (HARDCODED) ---
const CASHBACK_TYPE = vars.CASHBACK_TYPE || 'PERCENT';
const CASHBACK_VALUE = vars.CASHBACK_VALUE || 10; // Default: 0

// =======================================================
// 4. INISIALISASI INSTANS & LOGGER
// =======================================================
const app = express();
app.use(express.json());

const pakasir = new PakasirClient({
  project: PAKASIR_PROJECT_SLUG,
  apiKey: PAKASIR_API_KEY
});
const bot = new Telegraf(BOT_TOKEN);

// --- LOGGER CONFIGURATION ---
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

// --- MODUL AKUN ---
const { createssh } = require('./modules/createssh');
const { createvmess } = require('./modules/createvmess');
const { createvless } = require('./modules/createvless');
const { createtrojan } = require('./modules/createtrojan');
const { createshadowsocks } = require('./modules/createshadowsocks');
// Modul RENEW
const { renewssh } = require('./modules/renewssh');
const { renewvmess } = require('./modules/renewvmess');
const { renewvless } = require('./modules/renewvless');
const { renewtrojan } = require('./modules/renewtrojan');
const { renewshadowsocks } = require('./modules/renewshadowsocks'); 
const { createzivpn } = require('./modules/createzivpn');
const { renewzivpn } = require('./modules/renewzivpn');
// --- FIX AKHIR: Mengkonversi ID Admin ke Integer Array dengan aman ---
let adminIds = [];
if (Array.isArray(ADMIN_RAW)) {
    adminIds = ADMIN_RAW.map(id => parseInt(id)).filter(id => !isNaN(id));
} else if (ADMIN_RAW) {
    adminIds = [parseInt(ADMIN_RAW)].filter(id => !isNaN(id));
}
if (adminIds.length === 0) {
    logger.error("⚠️ PERINGATAN! Admin ID tidak terdeteksi atau tidak valid di .vars.json.");
}
logger.info(`✅ Bot initialized. Admin IDs: ${adminIds.join(', ')}`);


const db = new sqlite3.Database('./sellvpn.db', (err) => {
  if (err) { logger.error('Kesalahan koneksi SQLite3:', err.message); }
  else { logger.info('Terhubung ke SQLite3'); }
});


// --- FUNGSI UTILITY BARU (dbAllAsync) ---
async function dbAllAsync(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) { reject(err); }
      else { resolve(rows); }
    });
  });
}

const userState = {};
global.processedTransactions = new Set();
logger.info('User state initialized');


// =======================================================
// 5. INICIALISASI DATABASE
// =======================================================
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
  db.all("PRAGMA table_info(users)", (err, rows) => {
    if (err || !rows) return;
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
// =======================================================
// INISIALISASI TABEL KELOLA AKUN (USER ACCOUNTS)
// =======================================================
db.run(`CREATE TABLE IF NOT EXISTS user_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  protocol TEXT,
  username TEXT,
  password TEXT,
  config_detail TEXT,
  server_name TEXT,
  ip_address TEXT,
  expired_at TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
)`, (err) => { 
    if (err) { 
        logger.error('Kesalahan membuat tabel user_accounts:', err.message); 
    } else {
        logger.info('✅ Tabel user_accounts siap digunakan.');
    }
});
// =======================================================
// 6. FUNGSI UTILITY DASAR (UMUM)
// =======================================================

/**
 * Menghitung bonus cashback berdasarkan nominal top up.
 */
function calculateCashback(amount) {
    if (CASHBACK_VALUE <= 0) return 0;

    let bonus = 0;
    if (CASHBACK_TYPE === 'PERCENT') {
        bonus = Math.floor(amount * (CASHBACK_VALUE / 100));
    } else if (CASHBACK_TYPE === 'FIXED') {
        bonus = CASHBACK_VALUE;
    }
    
    return Math.max(0, bonus);
}

async function getUserDetails(userId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT saldo, role, daily_trial_count, last_trial_date FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (err) { reject(err); }
      else { resolve(row || { saldo: 0, role: 'member', daily_trial_count: 0, last_trial_date: '' }); }
    });
  });
}

async function getServerInfo(serverId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT nama_server, domain, total_create_akun, batas_create_akun FROM Server WHERE id = ?', [serverId], (err, row) => {
      if (err) { reject(err); }
      else { resolve(row); }
    });
  });
}

// FUNGSI UTILITY CHANNEL
async function isUserJoinedChannel(userId) {
  if (!CHANNEL_USERNAME) return true; 
  try {
    const chatMember = await bot.telegram.getChatMember(CHANNEL_USERNAME, userId);
    return ['member', 'administrator', 'creator', 'restricted'].includes(chatMember.status);
  } catch (error) {
    logger.error(`Error checking channel membership for ${userId} in ${CHANNEL_USERNAME}:`, error.message);
    if (error.response && error.response.error_code === 400) {
        return false; 
    }
    return false; 
  }
}


function calculatePrice(basePrice, role) {
  if (role === 'reseller') {
    const discount = basePrice * (RESELLER_DISCOUNT_PERCENT / 100);
    return Math.max(0, basePrice - discount);
  }
  return basePrice;
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


function executeScript(scriptType, username, serverId) {
    return new Promise((resolve) => {
        db.get('SELECT domain, auth FROM Server WHERE id = ?', [serverId], async (err, server) => {
            if (err || !server) {
                logger.error(`Failed to get server details for ID ${serverId}: ${err ? err.message : 'Not found'}`);
                return resolve(`❌ GAGAL! Server ID ${serverId} tidak ditemukan atau terjadi kesalahan database.`);
            }

            const trialExp = 1; 
            const password = username; 
            const iplimit = 1; 
            const quota = 500; 

            let endpoint = '';
            let params = { user: username, exp: trialExp, quota: quota, iplimit: iplimit, auth: server.auth }; 

            switch (scriptType) {
                case 'ssh':
                    endpoint = 'createssh';
                    params.password = password; 
                    delete params.quota;
                    break;
                case 'zivpn':
                    endpoint = 'api/user/create'; 
                    params = { password: username, days: 1, auth: server.auth };
                    break;
                case 'vmess': endpoint = 'createvmess'; break;
                case 'vless': endpoint = 'createvless'; break;
                case 'trojan': endpoint = 'createtrojan'; break;
                case 'shadowsocks': endpoint = 'createshadowsocks'; break;
                default:
                    return resolve('❌ GAGAL! Tipe protokol tidak dikenali.');
            }

            const url = `http://${server.domain}:5888/${endpoint}`;
            const queryParams = new URLSearchParams(params).toString();
            const fullUrl = `${url}?${queryParams}`;
            
            logger.info(`Executing TRIAL API call: ${fullUrl}`);

            try {
                let response;
                if (scriptType === 'zivpn') {
                    const trialUrl = `http://${server.domain}:8888/api/user/create`;
                    response = await axios.post(trialUrl, {
                        password: username,
                        days: 1
                    }, {
                        headers: { 'X-API-Key': server.auth, 'Content-Type': 'application/json' },
                        timeout: 15000
                    });
                    
                    const data = response.data;
                    if (data.success || data.status === 'success') {
                        const d = data.data;
                        return resolve(`
🚀 *TRIAL ZIVPN UDP BERHASIL*
───────────────────
🔑 *Password:* \`${username}\`
🌐 *Host IP:* \`${server.domain}\`
📅 *Expired:* \`${d.expired}\` (1 Hari)
───────────────────
*Cara Pakai:* Gunakan aplikasi ZiVPN dan masukkan IP serta password di atas.`.trim());
                    } else {
                        return resolve(`❌ GAGAL! API: ${data.message}`);
                    }
                } else {
                    response = await axios.get(fullUrl);
                    const d = response.data.data;
                    let formattedMsg = '';

                    if (scriptType === 'ssh') {
                        let portsData = { 
                            openssh: "22, 80, 443", dropbear: "443, 109", udp_ssh: "1-65535", dns: "443, 53, 22", 
                            ssh_ws: "80, 8080", ssh_ssl_ws: "443", ssl_tls: "443", ovpn_ssl: "443", 
                            ovpn_tcp: "1194", ovpn_udp: "2200", badvpn: "7100, 7300, 7300" 
                        }; 
                        
                        formattedMsg = `
🔰 *AKUN SSH TRIAL | AKTIF 1 HARI*

👤 \`Username:\` \`${d.username}\`
🔑 \`Password:\` \`${d.password}\`
🌍 \`IP:\` \`${d.ip}\`
🏙️ \`Lokasi:\` \`${d.city || 'N/A'}\`
📡 \`Domain:\` \`${d.domain}\`
🔐 \`PubKey (SlowDNS):\` \`${d.pubkey || '-'}\`

🔌 *PORT*
OpenSSH   : \`${portsData.openssh || '-'}\`
Dropbear  : \`${portsData.dropbear || '-'}\`
PORT UDP   : \`${portsData.udp_ssh || '-'}\`
DNS       : \`${portsData.dns || '-'}\`
WS        : \`${portsData.ssh_ws || '-'}\`
SSL WS    : \`${portsData.ssh_ssl_ws || '-'}\`
SSL/TLS   : \`${portsData.ssl_tls || '-'}\`
OVPN TCP  : \`${portsData.ovpn_tcp || '-'}\`
OVPN UDP  : \`${portsData.ovpn_udp || '-'}\`
OVPN SSL  : \`${portsData.ovpn_ssl || '-'}\`
BadVPN    : \`${portsData.badvpn || '-'}\`
Qouta     : *500Mb*

📍 *Gunakan dengan bijak*
📅 *Expired:* \`${d.expired}\`
✨ By : *TUNNEL FT DOR* ✨`.trim();
                    } else { 
                        const link_tls = d.vmess_tls_link || d.trojan_tls_link;
                        const link_ntls = d.vmess_nontls_link || d.ss_link_ws;
                        const link_grpc = d.vmess_grpc_link || d.trojan_grpc_link || d.ss_link_grpc;

                        const extraDetails = `
│🔌 Port HTTP : \`80\`
│🚪 Path/Service: \`${d.path || d.service_name || 'N/A'}\`
${d.uuid ? `│🔑 UUID/Pass : \`${d.uuid}\`` : d.password ? `│🔑 UUID/Pass : \`${d.password}\`` : ''}
${d.alter_id ? `│🔢 AlterID   : \`${d.alter_id}\`` : ''}
${d.method ? `│🔐 Method    : \`${d.method}\`` : ''}`;

                        formattedMsg = `
🌐 *TRIAL AKUN ${scriptType.toUpperCase()} | AKTIF 1 HARI*
┌─────────────────────
│👤 Username : \`${d.username}\`
│🌐 Domain    : \`${d.domain}\`
│📍 IP/City   : \`${d.ip} / ${d.city || 'N/A'}\`
│🔌 Port TLS  : \`443\`
${extraDetails.trim()}
└─────────────────────

🔗 *Link Konfigurasi*
${link_tls ? `➡️ WS TLS : \`${link_tls}\`` : ''}
${link_ntls ? `➡️ WS NTLS/SS WS: \`${link_ntls}\`` : ''}
${link_grpc ? `➡️ gRPC   : \`${link_grpc}\`` : ''}

📅 *Expired:* \`${d.expired}\`
✨ By : *TUNNEL FT DOR* ✨`.trim();
                    }
                    return resolve(formattedMsg);
                }
            } catch (e) {
                logger.error(`Trial API failed for ${scriptType} on ${server.domain}: ${e.message}`);
                return resolve(`❌ GAGAL! Gagal menghubungi API server VPN di ${server.domain}. (Error: ${e.message.substring(0, 100)})`);
            }
        }); // <-- Penutup db.get
    }); // <-- Penutup Promise
}

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


// =======================================================
// 8. FUNGSI PAKASIR & WEBHOOK (CASHBACK & QRIS)
// =======================================================

// ... di sekitar Baris 930 pada kode lengkap Anda (Fungsi generatePakasirPayment)

async function generatePakasirPayment(userId, amount) {
    const orderId = `PKS-${userId}-${Date.now()}`;
    
    try {
        // Panggil API Pakasir secara manual menggunakan AXIOS untuk mendapatkan data QRIS string.
        // PAKASIR_BASE_URL dijamin ada karena sudah diperbaiki di .vars.json
        const url = `${PAKASIR_BASE_URL}/api/transactioncreate/qris`;
        
        const payload = {
            'project': PAKASIR_PROJECT_SLUG,
            'order_id': orderId,
            'amount': amount,
            'api_key': PAKASIR_API_KEY
        };
        
        // Catatan: Jika API Pakasir membutuhkan header khusus (selain Content-Type: application/json) 
        // Anda mungkin perlu menambahkannya di sini.
        const response = await axios.post(url, payload, { 
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000 // Timeout 10 detik
        });
        
        const data = response.data;

        // --- VALIDASI RESPON PAKASIR ---
        if (!data || !data.payment) {
             // Ambil pesan error spesifik dari Pakasir, jika ada
             const errorMessage = data.message || "Tidak ada data pembayaran di respons Pakasir.";
             logger.error('API Pakasir Gagal (Respons Invalid):', errorMessage, data);
             throw new Error(errorMessage); 
        }
        
        const paymentData = data.payment;
        
        // Ambil data penting
        const paymentUrl = paymentData.payment_url || `https://app.pakasir.com/p/${orderId}`; 
        const qrisString = paymentData.payment_number; // Kunci: Data QRIS yang bisa di-scan

        if (!qrisString) {
             logger.error('API Pakasir Gagal: payment_number (QRIS String) tidak ditemukan.', data);
             throw new Error("Data QRIS (payment_number) tidak ditemukan."); 
        }


        // --- SIMPAN KE DATABASE ---
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
        
        // Mengembalikan STRING QRIS yang valid untuk di-encode
        return { orderId, paymentUrl, amount, qrisString };
        
    } catch (e) {
        // Tangkap semua error: HTTP, Network, atau Error yang dilempar dari dalam blok try
        let errorMsg = e.message || "Gagal menghubungi API Pakasir (Unknown error).";
        
        if (e.response) {
            // Error dari respons HTTP (misal 400, 500)
            if (e.response.data && e.response.data.message) {
                 errorMsg = e.response.data.message; // Pesan error dari Pakasir
            } else {
                 errorMsg = `HTTP Error ${e.response.status}`;
            }
        } 
        
        logger.error(`Error saat generate Pakasir Payment (Manual Axios): ${errorMsg}`);
        throw new Error(errorMsg);
    }
}
// --- WEBHOOK HANDLER PAKASIR (DIPERBARUI DENGAN CASHBACK) ---

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
        
        // --- LOGIKA CASHBACK BARU ---
        const bonusAmount = calculateCashback(amount);
        const totalAmount = amount + bonusAmount;
        // --- AKHIR LOGIKA CASHBACK BARU ---

        db.run('BEGIN TRANSACTION');
        db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [totalAmount, userId], (err) => {
            if (err) { db.run('ROLLBACK'); logger.error(`Error updating user balance for webhook ${order_id}: ${err.message}`); return; }

            db.run('UPDATE pending_deposits_pakasir SET status = ? WHERE order_id = ?', ['completed', order_id], async (err) => { 
                if (err) { db.run('ROLLBACK'); logger.error(`Error updating pending_deposits status for webhook ${order_id}: ${err.message}`); return; }
                db.run('COMMIT');
                logger.info(`✅ Saldo user ${userId} berhasil ditambahkan via Pakasir Webhook. Amount: ${amount}. Bonus: ${bonusAmount}`);
                
                const userAfterTopUp = await getUserDetails(userId);
                const userTag = (await botInstance.telegram.getChat(userId).catch(() => ({}))).username || userId;

                let messageText = 
                    `🎉 <b>TOP UP SALDO BERHASIL (OTOMATIS)</b> 🎉\n\n` +
                    `Invoice: <code>${order_id}</code>\n` +
                    `Jumlah Masuk: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n`;
                
                if (bonusAmount > 0) {
                    messageText += `💰 Cashback: <b>Rp ${bonusAmount.toLocaleString('id-ID')}</b>\n`;
                    messageText += `Total Diterima: <b>Rp ${totalAmount.toLocaleString('id-ID')}</b>\n`;
                }
                
                messageText += `Metode: ${payload.payment_method || 'QRIS'}\n\n` +
                               `Saldo Anda telah diupdate. Terima kasih!`;
                
                botInstance.telegram.sendMessage(userId, messageText, { parse_mode: 'HTML' }).catch(e => logger.error(`Failed to notify user ${userId}: ${e.message}`));
                
                // NOTIFIKASI KE GRUP
                botInstance.telegram.sendMessage(GROUP_ID, 
                    `<blockquote>📢 <b>NOTIFIKASI TOP UP OTOMATIS</b>\n\n` +
                    `✅ *Top Up Berhasil*\n` +
                    `👤 User: <b>@${userTag}</b> (ID: <code>${userId}</code>)\n` +
                    `✨ Role: <b>${userAfterTopUp.role.toUpperCase()}</b>\n` +
                    `\n🔗 Order ID: <code>${order_id}</code>\n` +
                    `💵 Jumlah Masuk: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                    (bonusAmount > 0 ? `💰 Bonus: <b>Rp ${bonusAmount.toLocaleString('id-ID')}</b>\n` : '') +
                    `💳 Metode: ${payload.payment_method || 'QRIS'}\n` +
                    `\n🔥 Saldo Baru: <b>Rp ${userAfterTopUp.saldo.toLocaleString('id-ID')}</b>\n` +
                    `</blockquote>`,
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

// --- ENPOINT BARU UNTUK UPDATE KUOTA SERVER OTOMATIS (DIPANGGIL DARI SERVER VPN) ---
// app.js (Menggantikan seluruh blok app.post('/server-quota-update', ...))
app.post('/server-quota-update', async (req, res) => {
    // TAMBAHKAN 'count' di destructuring body
    const { server_id, action, secret, count } = req.body; 
    
    // --- VALIDASI (PENTING! Ganti RAHASIA_KUNCI_ANDA) ---
    // HARUS DIGANTI DENGAN KUNCI RAHASIA YANG SAMA DENGAN SKRIP EXP
    if (secret !== 'TUNNELFTDOR') { 
        logger.warn(`Unauthorized quota update attempt from server ID: ${server_id}`);
        return res.status(403).json({ error: 'Unauthorized secret.' });
    }

    // VALIDASI BARU: Pastikan 'count' adalah angka positif
    if (!server_id || action !== 'expired_account' || isNaN(parseInt(count, 10)) || parseInt(count, 10) <= 0) {
        logger.warn(`Invalid quota update payload: ${JSON.stringify(req.body)}`);
        return res.status(400).json({ error: 'Invalid payload or count.' });
    }

    const serverId = parseInt(server_id, 10);
    const expiredCount = parseInt(count, 10); // <--- INI JUMLAH AKUN EXPIRED
    
    if (isNaN(serverId)) {
        return res.status(400).json({ error: 'Invalid server_id.' });
    }

    try {
        // Query BARU: Mengurangi total_create_akun sebanyak expiredCount
        const result = await new Promise((resolve, reject) => {
            db.run(
                // Menggunakan tanda tanya (?) untuk expiredCount dan serverId
                'UPDATE Server SET total_create_akun = MAX(0, total_create_akun - ?) WHERE id = ?',
                [expiredCount, serverId], // <--- PASSING expiredCount SEBAGAI PARAMETER
                function (err) {
                    if (err) return reject(err);
                    resolve(this.changes);
                }
            );
        });

        if (result > 0) {
            logger.info(`✅ Kuota Server ID ${serverId} berhasil dikurangi ${expiredCount} otomatis karena akun expired.`);
            const serverInfo = await getServerInfo(serverId);

            bot.telegram.sendMessage(GROUP_ID, 
                `<blockquote>📉 <b>KUOTA SERVER OTOMATIS DIKURANGI</b>\n\n` +
                `Action: <b>${action.toUpperCase()}</b>\n` +
                `🌐 Server: <b>${serverInfo?.nama_server || 'N/A'}</b> (ID: <code>${serverId}</code>)\n` +
                `➖ Jumlah Dikurangi: <b>${expiredCount} Akun</b>\n` + // TAMBAHKAN JUMLAH
                `👥 Kuota Baru: <b>${serverInfo?.total_create_akun || 'N/A'}</b> dari ${serverInfo?.batas_create_akun || 'N/A'}\n` +
                `\nStatus: <b>Berhasil. Akun Expired Telah Dihapus.</b>` +
                `</blockquote>`,
                { parse_mode: 'HTML' }
            ).catch(e => logger.error(`Failed to notify admin group about quota reduction: ${e.message}`));

            return res.json({ status: 'success', message: `Quota successfully reduced by ${expiredCount}.` });
        } else {
             logger.warn(`Kuota Server ID ${serverId} tidak diubah (mungkin total sudah 0 atau ID tidak valid).`);
            return res.json({ status: 'warning', message: 'No changes made or server not found.' });
        }
    } catch (error) {
        logger.error(`❌ DB Error during quota update for server ${serverId}: ${error.message}`);
        return res.status(500).json({ status: 'error', message: 'Internal Database Error.' });
    }
});// =======================================================
// 9. HANDLER MENU & COMMANDS
// =======================================================

bot.command(['start', 'menu'], async (ctx) => {
  if (ctx.chat.type !== 'private') {
      logger.info(`Command /start ignored in chat type: ${ctx.chat.type}`);
      return;
  }
  logger.info('Start or Menu command received');
  const userId = ctx.from.id;

  const isJoined = await isUserJoinedChannel(userId);
  if (!isJoined) {
    const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
    const message = 
      '⚠️ *WAJIB JOIN CHANNEL*\n\n' +
      `Karena bot sering terkena suspend, Anda wajib gabung untuk informasi.\n\n` +
      `Silakan klik tombol di bawah, bergabung, lalu klik \`✅ Saya Sudah Bergabung\`.`;
      
    const keyboard = [[{ text: '➡️ Join Channel Sekarang', url: channelLink }],
                      [{ text: '✅ Saya Sudah Bergabung', callback_data: 'check_force_subscribe' }]];
                      
    await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    
    db.get('SELECT * FROM users WHERE user_id = ?', [userId], (err, row) => {
      if (err) { logger.error('Kesalahan saat memeriksa user_id:', err.message); return; }
      if (!row) { db.run('INSERT INTO users (user_id, role) VALUES (?, ?)', [userId, 'member'], (err) => { if (!err) logger.info(`User ID ${userId} berhasil disimpan sebagai member`); }); }
    });
    return;
  }
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

  // --- STATISTIK ---
  const latency = (Math.random() * 0.1 + 0.01).toFixed(2);
  let jumlahPengguna = 0;
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT COUNT(*) AS count FROM users', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    jumlahPengguna = row.count;
  } catch (e) {
    logger.error('Error fetching total user count:', e.message);
    jumlahPengguna = 0;
  }


  // Statistik user
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()).getTime();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let userToday = 0, userWeek = 0, userMonth = 0;
  let globalToday = 0, globalWeek = 0, globalMonth = 0;
  try {
    userToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [userId, todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    userWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [userId, weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    userMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [userId, monthStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalToday = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [todayStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalWeek = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [weekStart], (err, row) => resolve(row ? row.count : 0));
    });
    globalMonth = await new Promise((resolve) => {
      db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks", "trial_ssh","trial_vmess","trial_vless","trial_trojan","trial_shadowsocks")', [monthStart], (err, row) => resolve(row ? row.count : 0));
    });
  } catch (e) {}
  // Informasi Cashback
  let cashbackInfo = '';
  if (CASHBACK_VALUE > 0) {
      if (CASHBACK_TYPE === 'PERCENT') {
          // TAG B/ YANG SALAH DIGANTI DENGAN TAG B PENUTUP YANG BENAR </b>
          cashbackInfo = `<b>NEW EVENT:</b>\n Setiap Top Up dapat Cashback ${CASHBACK_VALUE}%!`; 
      } else if (CASHBACK_TYPE === 'FIXED') {
          cashbackInfo = `<b>NEW EVENT:</b>\n Setiap Top Up dapat Cashback Rp${CASHBACK_VALUE.toLocaleString('id-ID')}!`;
      }
  }
// ...

  const messageText = `
╭─ <b>⚡ WELCOME DI ${NAMA_STORE} ⚡</b>
├ Bot SSH & XRAY PREMIUM!
├ Otomatis Create Account 24/7
├ Dapatkan harga diskon 40% dengan menjadi Reseller!
└───────────────────────────

<b>Hai, <code>${userName}</code>!</b>
ID: <code>${userId}</code>
Status: <b>${roleText}</b>
Saldo: <code>Rp ${saldo.toLocaleString('id-ID')}</code>
<blockquote>${cashbackInfo}</blockquote>

<blockquote> <b>Statistik Anda</b>
✨ Hari Ini    : ${userToday} akun
✨ Minggu Ini  : ${userWeek} akun
✨ Bulan Ini   : ${userMonth} akun

<b>Statistik Global</b>
📈 Hari Ini    : ${globalToday} akun
📈 Minggu Ini  : ${globalWeek} akun
📈 Bulan Ini   : ${globalMonth} akun
</blockquote>

👥 Pengguna BOT: ${jumlahPengguna}
⏱️ Latency: ${latency} ms
───────────────────────────`;

  let resellerButton = (role === 'reseller')
    ? { text: '👑 Anda Sudah Reseller (Diskon 40% Aktif)', callback_data: 'role_active_placeholder' }
    : { text: `👑 Upgrade Reseller (Rp${RESELLER_PRICE.toLocaleString('id-ID')})`, callback_data: 'upgrade_reseller_confirm' };

  const keyboard = [
    [{ text: '➕ Create Akun', callback_data: 'service_create' }, { text: '🆓 Trial Akun', callback_data: 'trial_account' }], 
    [{ text: '💰 Top Up Saldo', callback_data: 'topup_saldo' }, { text: '♻️ Renew Akun', callback_data: 'service_renew' }],
    [{ text: '📁 Kelola Akun', callback_data: 'manage_accounts' }, { text: '🚀 Tembak Dor', url: `https://t.me/${ADMIN_USERNAME_TEMBAK_PAKET.replace('@', '')}` }],
    [resellerButton]
  ];

  if (adminIds.includes(userId)) { keyboard.unshift([{ text: '🛠️ Menu Admin', callback_data: 'admin_menu' }]); }

  try {
    const options = { parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText(messageText, options); }
    else { await ctx.reply(messageText, options); }
  } catch (error) { logger.error('Error saat mengirim/mengedit menu utama:', error); }
}

// --- ACTION HANDLER KHUSUS --- 
bot.action('send_main_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await sendMainMenu(ctx);
        delete userState[ctx.chat.id]; 
    } catch (e) {
        logger.error('Error saat kembali ke menu utama:', e.message);
        await ctx.reply('Kembali ke Menu Utama.');
        delete userState[ctx.chat.id];
    }
});

bot.action('check_force_subscribe', async (ctx) => {
    await ctx.answerCbQuery();
    const userId = ctx.from.id;
    const isJoined = await isUserJoinedChannel(userId); 

    if (isJoined) {
        try {
           await ctx.editMessageText('✅ Terima kasih sudah bergabung! Anda sekarang dapat menggunakan bot.\nJika bot ini tersuspend, cek informasinya di channel', {
               reply_markup: { inline_keyboard: [[{ text: '➡️ Ke Menu Utama', callback_data: 'send_main_menu' }]] }
           });
        } catch (e) {
           await ctx.reply('✅ Terima kasih sudah bergabung! Anda sekarang dapat menggunakan bot.\nJika bot ini tersuspend, cek informasinya di channel');
        }
        await sendMainMenu(ctx);
    } else {
        const channelLink = `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`;
        const message = 
          '❌ *Anda belum bergabung!*\n\n' +
          `Karena bot sering terkena suspend, harap gabung dulu ke channel ini untuk informasi ya!: [${CHANNEL_USERNAME}](${channelLink}).\n\n` +
          `Jika sudah bergabung, coba klik \`✅ Saya Sudah Bergabung\` lagi.`;

        const keyboard = [[{ text: '➡️ Join Channel Sekarang', url: channelLink }],
                          [{ text: '✅ Saya Sudah Bergabung', callback_data: 'check_force_subscribe' }]];
                          
        try {
            await ctx.editMessageText(message, { 
                parse_mode: 'Markdown', 
                reply_markup: { inline_keyboard: keyboard } 
            });
        } catch (e) {
             if (e.message && !e.message.includes('message is not modified')) {
                 logger.error('Error saat mengedit pesan force subscribe:', e);
             }
        }
    }
});

// --- LOGIKA UPGRADE RESELLER ---
bot.action('upgrade_reseller_confirm', async (ctx) => {
    const userId = ctx.from.id; await ctx.answerCbQuery();
    
    const validationText = 
      `Apakah kamu yakin ingin menjadi reseller? Saldo akan terpotong sekitar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n\n` +
      '<b>Manfaat menjadi reseller:</b>\n' +
      `• Harga pembelian layanan diskon <b>${RESELLER_DISCOUNT_PERCENT}%</b>.\n` +
      `• Batas akun Trial harian menjadi <b>${RESELLER_TRIAL_LIMIT}</b> kali (Normal: ${MEMBER_TRIAL_LIMIT}).\n\n` +
      'Lanjutkan?';
      
    await ctx.editMessageText(
        '⚠️ <b>VALIDASI UPGRADE RESELLER</b>\n\n' + validationText,
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
        
        await ctx.reply('🎉 <b>SELAMAT! Anda telah berhasil menjadi Reseller!</b>\n\n' + `Saldo Anda terpotong sebesar <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>.\n` + `Nikmati harga layanan yang lebih murah (Diskon ${RESELLER_DISCOUNT_PERCENT}%) dan batas Trial lebih besar.`, { parse_mode: 'HTML' });

        const userInfo = await bot.telegram.getChat(userId).catch(() => ({ first_name: 'Unknown User' }));
        const username = userInfo.username ? `@${userInfo.username}` : (userInfo.first_name || userId);
        
        // NOTIFIKASI UPGRADE RESELLER KE GRUP
        await bot.telegram.sendMessage(GROUP_ID, 
            `<blockquote>👑 <b>UPGRADE RESELLER BERHASIL</b>\n👤 User: <b>${username}</b>\nID: <code>${userId}</code>\nNominal Terpotong: <b>Rp${RESELLER_PRICE.toLocaleString('id-ID')}</b>\nSelamat datang Reseller baru!</blockquote>`, 
            { parse_mode: 'HTML' }
        );

        await sendMainMenu(ctx);
    });
});

// --- LOGIKA TRIAL AKUN ---
bot.action('trial_account', async (ctx) => { await handleTrialMenu(ctx); });

async function handleTrialMenu(ctx) {
    await ctx.answerCbQuery();
    const keyboard = [
      [{ text: 'Trial SSH | UDP', callback_data: 'trial_select_server_ssh' }],
      [{ text: 'Trial Vmess', callback_data: 'trial_select_server_vmess' }, { text: 'Trial Vless', callback_data: 'trial_select_server_vless' }],
      [{ text: 'Trial Trojan', callback_data: 'trial_select_server_trojan' }, { text: 'Trial Shadowsocks', callback_data: 'trial_select_server_shadowsocks' }],
      [{ text: 'Trial ZiVPN UDP', callback_data: 'trial_select_server_zivpn' }], // Tambahkan ini
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
    ];
    await ctx.editMessageText('🆓 *Pilih jenis Trial Akun (Masa Aktif 1 Hari):*', {
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown'
    });
}
async function showTrialServerMenu(ctx, jenis) {
  try {
    const servers = await dbAllAsync('SELECT id, nama_server FROM Server');
    if (!servers || servers.length === 0) {
      return ctx.editMessageText('⚠️ *PERHATIAN!*\nTidak ada server yang tersedia saat ini. Coba lagi nanti!', {
        parse_mode: 'Markdown'
      });
    }

    const keyboard = servers.map(s => [{
      text: `🌐 ${s.nama_server}`,
      callback_data: `trial_exec_${jenis}_${s.id}` 
    }]);

    keyboard.push([{ text: '⬅️ Kembali', callback_data: 'trial_account' }]);


    const pesan = `
🧪 *Pilih server untuk Trial ${jenis.toUpperCase()} (1 HARI):*

⚠️ *Perhatian:*
- Trial hanya aktif selama 1 hari dengan speed yang sudah disesuaikan.
- Hanya bisa membuat trial 1x dalam seminggu.
- Gabung ke reseller untuk menambah kouta trial 10/7.
- Beli server premium untuk kecepatan yang lebih baik dan stabil.
- Pilih server di bawah:
    `.trim();

    await ctx.editMessageText(pesan, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (err) {
    logger.error(`❌ Gagal tampilkan server trial untuk ${jenis}:`, err.message);
    await ctx.reply('❌ Terjadi kesalahan saat memuat daftar server.');
  }
}

/// app.js (Menggantikan blok bot.action(/trial_exec.../) yang lama)

// --- ACTION UNTUK EKSEKUSI TRIAL AKUN ---
bot.action(/trial_exec_(vmess|vless|trojan|shadowsocks|ssh|zivpn)_(\d+)/, async (ctx) => {
    const type = ctx.match[1];
    const serverId = ctx.match[2]; 
    const userId = ctx.from.id;
    await ctx.answerCbQuery('Membuat akun Trial...');
    
    let user;
    try {
        user = await getUserDetails(userId);
    } catch(e) {
        return ctx.reply('❌ GAGAL: Terjadi kesalahan saat memproses detail akun Anda.', { parse_mode: 'Markdown' });
    }

    const today = new Date().toISOString().split('T')[0];
    
    // --- LOGIKA COOLDOWN 7 HARI ---
    const lastTrialDate = user.last_trial_date;
    const oneWeekInMilliseconds = 7 * 24 * 60 * 60 * 1000;
    
    let isTrialPeriodExpired = true; 
    let daysRemaining = 0;
    
    if (lastTrialDate) {
        // Konversi tanggal terakhir trial menjadi timestamp
        // Catatan: Membuat objek Date dari format YYYY-MM-DD
        const lastTrialTimestamp = new Date(lastTrialDate).getTime();
        const nextTrialTimestamp = lastTrialTimestamp + oneWeekInMilliseconds;
        const nowTimestamp = Date.now();
        
        if (nowTimestamp < nextTrialTimestamp) {
            isTrialPeriodExpired = false; // Belum 7 hari, trial masih diblokir
            const remainingMs = nextTrialTimestamp - nowTimestamp;
            // Hitung sisa hari (dibulatkan ke atas agar mencakup hari ini)
            daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000)); 
        }
    }
    
   
    if (isTrialPeriodExpired && user.daily_trial_count > 0) {
        await new Promise((resolve, reject) => {
            db.run('UPDATE users SET daily_trial_count = 0, last_trial_date = ? WHERE user_id = ?', [today, userId], (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
        user.daily_trial_count = 0;
    }

    const maxLimit = user.role === 'reseller' ? RESELLER_TRIAL_LIMIT : MEMBER_TRIAL_LIMIT;
    
    // Pengecekan utama: Apakah periode cooldown sudah habis?
    if (!isTrialPeriodExpired) {
        return ctx.reply(`❌ *Batas Trial Tercapai!* Anda dapat mengambil Trial Akun lagi dalam waktu **${daysRemaining} hari**.`, { parse_mode: 'Markdown' });
    }
    
    // Pengecekan limit harian/per-cooldown
    if (user.daily_trial_count >= maxLimit) {
        return ctx.reply(`❌ *Batas Trial ${maxLimit} akun sudah tercapai!* Batas Trial Anda akan direset dalam waktu 7 hari.`, { parse_mode: 'Markdown' });
    }
    // --- AKHIR LOGIKA COOLDOWN 7 HARI ---


    const tempUsername = `trial${userId}`; 

    // Eksekusi skrip dengan Server ID (INI HARUSNYA MEMANGGIL API SERVER DI PORT 5888)
    const msg = await executeScript(type, tempUsername, serverId); 
    
    if (msg.startsWith('❌')) {
      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } else {
      await recordAccountTransaction(userId, `trial_${type}`);
      
      // Update daily_trial_count dan last_trial_date (yang sekarang menjadi acuan 7 hari)
      db.run(
        'UPDATE users SET daily_trial_count = daily_trial_count + 1, last_trial_date = ? WHERE user_id = ?',
        [today, userId],
        (err) => {
          if (err) logger.error('Error updating trial count:', err.message);
        }
      );
      
      await ctx.reply(msg, { parse_mode: 'Markdown' }); 
      
      // --- AMBIL DETAIL TAMBAHAN ---
      const serverInfo = await getServerInfo(serverId);
      
      const userTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.id;
      bot.telegram.sendMessage(GROUP_ID, 
          `<blockquote>🧪 <b>TRIAL AKUN DIBUAT</b>\n\n` +
          `👤 User: <b>${userTag}</b>\n` +
          `📍 ID: <code>${userId}</code>)\n` +
          `\n✨ Role: <b>${user.role.toUpperCase()}</b>\n` +
          `🛠 Protokol: <b>${type.toUpperCase()}</b>\n` +
          `\n🌐 Server: <b>${serverInfo?.nama_server || 'N/A'}</b>\n` +
          `🔗 Domain: <code>${serverInfo?.domain || 'N/A'}</code>\n` +
          `\n🗓 Sisa Trial: <b>${maxLimit - (user.daily_trial_count + 1)}</b> dari ${maxLimit} (Reset 7 Hari)\n` +
          `</blockquote>`,
          { parse_mode: 'HTML' }
      ).catch(e => logger.error(`Failed to notify admin group about trial: ${e.message}`));
    }

});
// --- FUNGSI TAMPILAN SERVER (CREATE/RENEW) ---
async function startSelectServer(ctx, action, type, page = 0) {
  try {
    const userId = ctx.from.id;
    const user = await getUserDetails(userId);
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
    const keyboard = [[{ text: 'Buat SSH', callback_data: 'create_ssh' }],
      [{ text: 'Buat Vmess', callback_data: 'create_vmess' }, { text: 'Buat Vless', callback_data: 'create_vless' }],
      [{ text: 'Buat Trojan', callback_data: 'create_trojan' }, { text: 'Buat Shadowsocks', callback_data: 'create_shadowsocks' }], [{ text: 'Buat ZiVPN UDP', callback_data: 'create_zivpn' }],
      [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]];
    await ctx.editMessageText('➕ *Pilih jenis akun yang ingin Anda buat:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});
bot.action('service_renew', async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = [[{ text: 'Perpanjang SSH', callback_data: 'renew_ssh' }],
      [{ text: 'Perpanjang Vmess', callback_data: 'renew_vmess' }, { text: 'Perpanjang Vless', callback_data: 'renew_vless' }],
      [{ text: 'Perpanjang Trojan', callback_data: 'renew_trojan' }, { text: 'Perpanjang Shadowsocks', callback_data: 'renew_shadowsocks' }],
      [{ text: 'Perpanjang UDP ZiVPN', callback_data: 'renew_zivpn' }],
    [{ text: '🔙 Kembali', callback_data: 'send_main_menu' }]
];
    await ctx.editMessageText('♻️ *Pilih jenis akun yang ingin Anda perpanjang:*', { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
});

bot.action(/Maps_(\w+)_(\w+)_(\d+)/, async (ctx) => {
  const [, action, type, page] = ctx.match;
  await ctx.answerCbQuery();
  await startSelectServer(ctx, action, type, parseInt(page, 10));
});
bot.action(/(create|renew)_(vmess|vless|trojan|shadowsocks|ssh|zivpn)/, async (ctx) => {
    const action = ctx.match[1]; const type = ctx.match[2]; await startSelectServer(ctx, action, type, 0);
});
bot.action(/(create|renew)_username_(vmess|vless|trojan|shadowsocks|ssh|zivpn)_(.+)/, async (ctx) => {
  const action = ctx.match[1]; const type = ctx.match[2]; const serverId = ctx.match[3];
  userState[ctx.chat.id] = { step: `username_${action}_${type}`, serverId, type, action };

  db.get('SELECT batas_create_akun, total_create_akun FROM Server WHERE id = ?', [serverId], async (err, server) => {
    if (err) { return ctx.reply('❌ *Terjadi kesalahan saat mengambil detail server.*', { parse_mode: 'Markdown' }); }
    if (!server) { return ctx.reply('❌ *Server tidak ditemukan.*', { parse_mode: 'Markdown' }); }
    if (server.total_create_akun >= server.batas_create_akun) { return ctx.reply('❌ *Server penuh. Tidak dapat membuat akun baru di server ini.*', { parse_mode: 'Markdown' }); }
    await ctx.reply('👤 *Masukkan username:*', { parse_mode: 'Markdown' });
  });
});

bot.action(/trial_select_server_(vmess|vless|trojan|shadowsocks|ssh|zivpn)/, async (ctx) => {
    const type = ctx.match[1];
    await ctx.answerCbQuery();
    await showTrialServerMenu(ctx, type);
}); 

// --- ACTION UNTUK TOP UP SALDO BARU (Tampilan QRIS di Bot) ---
bot.action('topup_saldo', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        userState[ctx.chat.id] = { step: 'request_pakasir_amount', amount: '' };
        await ctx.editMessageText(
            `💰 *TOP UP SALDO (OTOMATIS)*\n\n` +
            `Silakan masukkan jumlah nominal saldo yang Anda ingin tambahkan ke akun Anda. (hanya angka dan tidak pakai titik).\n` +
            `Minimal Top Up adalah *Rp ${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}*.\n\n` +
            `_Contoh: 50000_`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        logger.error('❌ Kesalahan saat memulai proses top-up saldo otomatis:', error);
        await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
    }
});

// --- ACTION HANDLERS PAKASIR ---
// ... di sekitar Baris 1110 pada kode lengkap Anda

bot.action(/create_pakasir_payment_(\d+)/, async (ctx) => {
    const amount = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    await ctx.answerCbQuery('Membuat QRIS Pembayaran...');

    try {
        // Menerima qrisString baru, bukan qrisImageUrl
        const { orderId, paymentUrl, qrisString } = await generatePakasirPayment(userId, amount);

        // --- MENGGUNAKAN QRIS STRING UNTUK MENGGENERATE GAMBAR ---
        // Karena qrisString adalah data pembayaran yang sebenarnya, QR Code ini akan berfungsi.
        const qrisImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrisString)}`;
        // --------------------------------------------------------

        const expiryDate = new Date(Date.now() + 60 * 60 * 1000);
// ... (Kode selanjutnya sama, hanya menggunakan qrisImageUrl yang baru)
        
        const expiryText = expiryDate.toLocaleTimeString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

        const message =
            `✅ *PEMBAYARAN QRIS TERSEDIA*\n\n` +
            `Invoice ID: \`${orderId}\`\n` +
            `Nominal: *Rp ${amount.toLocaleString('id-ID')}* (+Biaya Admin)\n` +
            `Metode: *QRIS*\n` +
            `Kadaluarsa: ${expiryText} WIB\n\n` +
            `Silakan scan QRIS di atas dengan aplikasi pembayaran Anda (Dana/Gopay/OVO/LinkAja).\n*Jika Qris tidak bisa di scan, silahkan buka tautan dibawah*\n`;
            
        // Kirim gambar QRIS terlebih dahulu
        await ctx.replyWithPhoto(
            { url: qrisImageUrl },
            { 
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💳 Buka Tautan Pembayaran', url: paymentUrl }],
                        [{ text: '🔄 Cek Status Transaksi', callback_data: `check_pakasir_status_${orderId}` }],
                        [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
                    ]
                }
            }
        );
        
        // Hapus pesan lama (yang meminta konfirmasi)
        try { await ctx.deleteMessage(ctx.callbackQuery.message.message_id); } catch(e) { /* Abaikan error delete */ }

    } catch (error) {
        logger.error('❌ Error creating Pakasir payment:', error.message);
        await ctx.reply(`❌ *GAGAL!* Terjadi kesalahan saat membuat tautan pembayaran. Coba lagi nanti. (Error: ${error.message})`, { parse_mode: 'Markdown' });
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


// =======================================================
// 10. TEXT HANDLER UTAMA (FIXED)
// =======================================================
bot.on('text', async (ctx) => {
  const state = userState[ctx.chat.id];
  if (!state) return;

  const text = ctx.message.text.trim();
  
  // --- A. KHUSUS FLOW CREATE ZIVPN (Karena hanya butuh Pass & Day) ---
  if (state.step === 'username_create_zivpn') {
      state.password = text;
      state.step = 'days_create_zivpn';
      return ctx.reply('📅 Masukkan *Masa Aktif* (Hari):', { parse_mode: 'Markdown' });
  }

  if (state.step === 'days_create_zivpn') {
      const days = text;
      const { password, serverId } = state;
      delete userState[ctx.chat.id];

      // KODE BARU (FIXED)
db.get("SELECT domain, auth, iplimit FROM Server WHERE id = ?", [serverId], async (err, server) => {
    if (err || !server) return ctx.reply('❌ Server tidak ditemukan.');
    
    const loading = await ctx.reply('⌛ *Sedang memproses akun ZiVPN...*');
    
    // Perbaikan: Tambahkan userId di awal, gunakan server.domain, dan server.iplimit
    const result = await createzivpn(ctx.from.id, password, days, serverId, server.iplimit);
    
    await ctx.telegram.editMessageText(ctx.chat.id, loading.message_id, null, result, { parse_mode: 'Markdown' });
});
      return; // WAJIB ada return agar tidak lanjut ke logika di bawah
  }

  // --- 1. FLOW CREATE/RENEW ---
  if (state.step.startsWith('username_') && state.action !== 'trial') {
    state.username = text;

    if (
      !state.username ||
      state.username.length < 3 ||
      state.username.length > 20 ||
      /[A-Z]/.test(state.username) ||
      /[^a-z0-9]/.test(state.username)
    ) {
      return ctx.reply(
        '❌ *Username tidak valid. Gunakan 3-20 karakter, huruf kecil, dan angka saja.*',
        { parse_mode: 'Markdown' }
      );
    }

    const { type, action } = state;

    if (action === 'create' && type === 'ssh') {
      state.step = `password_${state.action}_${state.type}`;
      await ctx.reply('🔑 *Masukkan password:*', { parse_mode: 'Markdown' });
    } else {
      state.step = `exp_${state.action}_${state.type}`;
      await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
    }
  }

  // --- 2. FLOW PASSWORD ---
  else if (state.step.startsWith('password_')) {
    state.password = text;

    if (
      !state.password ||
      state.password.length < 6 ||
      /[^a-zA-Z0-9]/.test(state.password)
    ) {
      return ctx.reply(
        '❌ *Password tidak valid. Gunakan minimal 6 karakter (huruf/angka).*',
        { parse_mode: 'Markdown' }
      );
    }

    state.step = `exp_${state.action}_${state.type}`;
    await ctx.reply('⏳ *Masukkan masa aktif (hari):*', { parse_mode: 'Markdown' });
  }

  // --- 3. FLOW INPUT MASA AKTIF ---
  else if (state.step.startsWith('exp_')) {
    const exp = parseInt(text, 10);
    if (isNaN(exp) || exp <= 0 || exp > 365) {
      return ctx.reply(
        '❌ *Masa aktif tidak valid. Masukkan angka yang valid (1–365 hari).*',
        { parse_mode: 'Markdown' }
      );
    }

    state.exp = exp;

    db.get(
      'SELECT quota, iplimit, harga, nama_server FROM Server WHERE id = ?',
      [state.serverId],
      async (err, server) => {
        if (err || !server) {
          return ctx.reply(
            '❌ *Terjadi kesalahan saat mengambil detail server.*',
            { parse_mode: 'Markdown' }
          );
        }

        state.quota = server.quota;
        state.iplimit = server.iplimit;

        const user = await getUserDetails(ctx.from.id);
        const pricePerDay = calculatePrice(server.harga, user.role);
        const totalHarga = pricePerDay * state.exp;

        if (user.saldo < totalHarga) {
          return ctx.reply(
            `❌ *Saldo Anda tidak mencukupi. Harga total: Rp${totalHarga.toLocaleString('id-ID')}.*`,
            { parse_mode: 'Markdown' }
          );
        }

        let msg;
        const { username, password, exp, quota, iplimit, serverId, type, action } = state;

        // --- PEMBUATAN AKUN ---
        const userId = ctx.from.id; // Ambil ID Telegram User
        
        if (action === 'create') {
          if (type === 'vmess') msg = await createvmess(userId, username, exp, quota, iplimit, serverId);
          else if (type === 'vless') msg = await createvless(userId, username, exp, quota, iplimit, serverId);
          else if (type === 'trojan') msg = await createtrojan(userId, username, exp, quota, iplimit, serverId);
          else if (type === 'shadowsocks') msg = await createshadowsocks(userId, username, exp, quota, iplimit, serverId);
          else if (type === 'ssh') msg = await createssh(userId, username, password, exp, iplimit, serverId);
          else if (type === 'zivpn') msg = await createzivpn(userId, username, exp, serverId, iplimit);
          
          db.run('UPDATE Server SET total_create_akun = total_create_akun + 1 WHERE id = ?', [serverId]);
        }
        // --- PERPANJANG AKUN (REVISI UPDATE DB) ---
// --- PERPANJANG AKUN (REVISI UPDATE DB) ---
else if (action === 'renew') {
  let renewResult;
  if (type === 'vmess') renewResult = await renewvmess(username, exp, quota, iplimit, serverId);
  else if (type === 'vless') renewResult = await renewvless(username, exp, quota, iplimit, serverId);
  else if (type === 'trojan') renewResult = await renewtrojan(username, exp, quota, iplimit, serverId);
  else if (type === 'shadowsocks') renewResult = await renewshadowsocks(username, exp, quota, iplimit, serverId);
  else if (type === 'ssh') renewResult = await renewssh(username, exp, iplimit, serverId);
  else if (type === 'zivpn') renewResult = await renewzivpn(state.password || state.username, exp, serverId);

  msg = renewResult.message; // Ambil teks pesan untuk dikirim ke user

  // Jika perpanjang berhasil, update database lokal
  if (renewResult.success) {
      db.run(`UPDATE user_accounts SET expired_at = ? WHERE username = ? AND protocol = ?`, 
      [renewResult.new_expired, username, type.toUpperCase()]);

      // NOTIFIKASI KE GRUP ADMIN (Hanya dikirim jika sukses)
      const userTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.id;
      bot.telegram.sendMessage(GROUP_ID, 
          `<blockquote>♻️ <b>NOTIFIKASI PERPANJANGAN AKUN</b>\n\n` +
          `👤 User: <b>${userTag}</b> (ID: <code>${ctx.from.id}</code>)\n` +
          `🛠 Protokol: <b>${type.toUpperCase()}</b>\n` +
          `👤 Akun: <code>${username}</code>\n` +
          `📅 Expired Baru: <b>${renewResult.new_expired}</b>\n` +
          `➕ Tambahan: <b>${exp} Hari</b>\n\n` +
          `Status: <b>Berhasil Diperpanjang</b></blockquote>`,
          { parse_mode: 'HTML' }
      ).catch(e => logger.error(`Gagal kirim notif renew ke grup: ${e.message}`));
  }
}
        await recordAccountTransaction(ctx.from.id, type);
        logger.info(`Account ${action} transaction recorded for user ${ctx.from.id}, type: ${type}`);

        db.run('BEGIN TRANSACTION');
        db.run(
          'UPDATE users SET saldo = saldo - ? WHERE user_id = ?',
          [totalHarga, ctx.from.id],
         async (err) => {
            if (err) {
              db.run('ROLLBACK');
              return ctx.reply(
                '❌ *Terjadi kesalahan saat mengurangi saldo pengguna. Transaksi dibatalkan.*',
                { parse_mode: 'Markdown' }
              );
            }

            db.run('COMMIT');
            ctx.reply(
              `✅ *Transaksi Berhasil!* Saldo terpotong: Rp${totalHarga.toLocaleString('id-ID')}.\n\n${msg}`,
              { parse_mode: 'Markdown' }
            );

            const user = await getUserDetails(ctx.from.id);
            const serverInfo = await getServerInfo(serverId);

            const userTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.id;
            
            const todayStart = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
            const globalToday = await new Promise(resolve => db.get('SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [todayStart], (err, row) => resolve(row ? row.count : 0)));
            const userToday = await new Promise(resolve => db.get('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND timestamp >= ? AND type IN ("ssh","vmess","vless","trojan","shadowsocks")', [ctx.from.id, todayStart], (err, row) => resolve(row ? row.count : 0)));

            bot.telegram.sendMessage(GROUP_ID, 
                `<blockquote>🛒 <b>TRANSAKSI AKUN BERHASIL</b>\n\n` +
                `👤 User: <b>${userTag}</b> (ID: <code>${ctx.from.id}</code>)\n` +
                `✨ Role: <b>${user.role.toUpperCase()}</b>\n` +
                `🛠 Action: <b>${action.toUpperCase()} ${type.toUpperCase()}</b>\n` +
                `\n🌐 Server: <b>${serverInfo?.nama_server || 'N/A'}</b>\n` +
                `🔗 Domain: <code>${serverInfo?.domain || 'N/A'}</code>\n` +
                `👥 Akun Server: ${serverInfo?.total_create_akun + (action === 'create' ? 1 : 0) || 'N/A'}/${serverInfo?.batas_create_akun || 'N/A'}\n` +
                `\n📅 Masa Aktif: ${exp} hari\n` +
                `💵 Harga: <b>Rp ${totalHarga.toLocaleString('id-ID')}</b>\n` +
                `\n📈 Transaksi User Hari Ini: <b>${userToday}</b>\n` +
                `📊 Transaksi Global Hari Ini: <b>${globalToday}</b>\n` +
                `</blockquote>`,
                { parse_mode: 'HTML' }
            ).catch(e => logger.error(`Failed to notify admin group about ${action}: ${e.message}`));
            delete userState[ctx.chat.id];
          }
        );
      }
    );
  }

  
  // --- 4. FLOW TOP UP PAKASIR ---
  else if (state.step === 'request_pakasir_amount') {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < MIN_DEPOSIT_AMOUNT) {
      return ctx.reply(
        `❌ *Nominal tidak valid.* Masukkan angka yang valid (minimal Rp${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}).`,
        { parse_mode: 'Markdown' }
      );
    }

    await ctx.reply(
      `📝 *Konfirmasi Top Up Saldo Otomatis:*\n\n💰 Jumlah Nominal: *Rp ${amount.toLocaleString('id-ID')}*\n\nTekan tombol di bawah untuk membuat tautan pembayaran QRIS.`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: `💳 Buat Pembayaran Rp ${amount.toLocaleString('id-ID')}`, callback_data: `create_pakasir_payment_${amount}` }],
            [{ text: '❌ Batalkan', callback_data: 'send_main_menu' }]
          ]
        },
        parse_mode: 'Markdown'
      }
    );

    delete userState[ctx.chat.id];
  }
  
  // --- 5. FLOW ADMIN ADD SALDO (PERBAIKAN BUG) ---
  else if (state.step === 'request_user_id_for_add_saldo' || state.step === 'request_amount_for_add_saldo') {
      const isUserIdStep = state.step === 'request_user_id_for_add_saldo';
      const numericValue = parseInt(text, 10);
      
      if (isNaN(numericValue) || numericValue <= 0) {
          return ctx.reply(`❌ *Input tidak valid.* Masukkan angka positif untuk ${isUserIdStep ? 'User ID' : 'jumlah saldo'}.`, { parse_mode: 'Markdown' });
      }
      
      if (isUserIdStep) {
          state.targetUserId = numericValue;
          state.step = 'request_amount_for_add_saldo';
          return ctx.reply('💵 *Silakan masukkan jumlah saldo yang ingin ditambahkan (angka saja):*', { parse_mode: 'Markdown' });
      } else {
          const targetUserId = state.targetUserId;
          const amount = numericValue;
          
          db.get("SELECT * FROM users WHERE user_id = ?", [targetUserId], (err, row) => {
              if (err) { return ctx.reply('⚠️ Kesalahan saat memeriksa `user_id` target.', { parse_mode: 'Markdown' }); }
              if (!row) { return ctx.reply('⚠️ `user_id` target tidak terdaftar. Pastikan pengguna sudah /start bot terlebih dahulu.', { parse_mode: 'Markdown' }); }
              
              db.run('UPDATE users SET saldo = saldo + ? WHERE user_id = ?', [amount, targetUserId], async function(err) { 
                  if (err) { return ctx.reply('❌ *Terjadi kesalahan saat menambahkan saldo.*', { parse_mode: 'Markdown' }); }
                  
                  const userAfterUpdate = await getUserDetails(targetUserId);
                  const adminTag = ctx.from.username ? `@${ctx.from.username}` : ctx.from.id;
                  const targetUserTag = (await bot.telegram.getChat(targetUserId).catch(() => ({}))).username || targetUserId;
                  
                  bot.telegram.sendMessage(GROUP_ID, 
                      `<blockquote>💸 <b>SALDO DITAMBAHKAN OLEH ADMIN BAIK HATI</b>\n\n` +
                      `👤 User Target: <b>@${targetUserTag}</b> (ID: <code>${targetUserId}</code>)\n` +
                      `✨ Role: <b>${userAfterUpdate.role.toUpperCase()}</b>\n` +
                      `\n➕ Jumlah: <b>Rp ${amount.toLocaleString('id-ID')}</b>\n` +
                      `🔥 Saldo Baru: <b>Rp ${userAfterUpdate.saldo.toLocaleString('id-ID')}</b>\n` +
                      `\n🛠️ Oleh Admin: <b>${adminTag}</b> (ID: <code>${ctx.from.id}</code>)` +
                      `</blockquote>`, 
                      { parse_mode: 'HTML' }
                  ).catch(e => logger.error(`Failed to notify admin group about admin menu addsaldo (text input): ${e.message}`));
                  
                  ctx.reply(`✅ *Saldo berhasil ditambahkan.*\n\n📄 *Detail Saldo:*\n- User ID: ${targetUserId}\n- Jumlah Saldo: *Rp ${amount.toLocaleString('id-ID')}*`, { parse_mode: 'Markdown' });
                  delete userState[ctx.chat.id];
              });
          });
          return;
      }
  }


  // --- 6. FLOW ADMIN ADD SERVER ---
  else if (state.step === 'addserver' || state.step.startsWith('addserver_')) {
    if (state.step === 'addserver') {
      const domain = text;
      if (!domain) return ctx.reply('⚠️ *Domain tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_auth';
      state.domain = domain;
      await ctx.reply('🔑 *Masukkan auth server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_auth') {
      const auth = text;
      if (!auth) return ctx.reply('⚠️ *Auth tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_nama_server';
      state.auth = auth;
      await ctx.reply('🏷️ *Masukkan nama server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_nama_server') {
      const nama_server = text;
      if (!nama_server) return ctx.reply('⚠️ *Nama server tidak boleh kosong.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_quota';
      state.nama_server = nama_server;
      await ctx.reply('📊 *Masukkan quota server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_quota') {
      const quota = parseInt(text, 10);
      if (isNaN(quota)) return ctx.reply('⚠️ *Quota tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_iplimit';
      state.quota = quota;
      await ctx.reply('🔢 *Masukkan limit IP server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_iplimit') {
      const iplimit = parseInt(text, 10);
      if (isNaN(iplimit)) return ctx.reply('⚠️ *Limit IP tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_batas_create_akun';
      state.iplimit = iplimit;
      await ctx.reply('🔢 *Masukkan batas create akun server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_batas_create_akun') {
      const batas_create_akun = parseInt(text, 10);
      if (isNaN(batas_create_akun)) return ctx.reply('⚠️ *Batas create akun tidak valid.*', { parse_mode: 'Markdown' });
      state.step = 'addserver_harga';
      state.batas_create_akun = batas_create_akun;
      await ctx.reply('💰 *Masukkan harga server:*', { parse_mode: 'Markdown' });
    } else if (state.step === 'addserver_harga') {
      const harga = parseFloat(text);
      if (isNaN(harga) || harga <= 0)
        return ctx.reply('⚠️ *Harga tidak valid.*', { parse_mode: 'Markdown' });

      const { domain, auth, nama_server, quota, iplimit, batas_create_akun } = state;
      try {
        db.run(
          'INSERT INTO Server (domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, total_create_akun) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [domain, auth, nama_server, quota, iplimit, batas_create_akun, harga, 0],
          function (err) {
            if (err) {
              logger.error('Error saat menambahkan server:', err.message);
              ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
            } else {
              ctx.reply(
                `✅ *Server baru dengan domain ${domain} berhasil ditambahkan.*\n\n📄 *Detail:*\n- Domain: ${domain}\n- Auth: ${auth}\n- Nama: ${nama_server}\n- Quota: ${quota}\n- Limit IP: ${iplimit}\n- Batas Create: ${batas_create_akun}\n- Harga: Rp ${harga.toLocaleString('id-ID')}`,
                { parse_mode: 'Markdown' }
              );
            }
          }
        );
      } catch (error) {
        logger.error('Error saat menambahkan server:', error);
        await ctx.reply('❌ *Terjadi kesalahan saat menambahkan server baru.*', { parse_mode: 'Markdown' });
      }

      delete userState[ctx.chat.id];
    }
  }

  // --- 7. FLOW ADMIN BROADCAST INPUT ---
  else if (state.step === 'admin_broadcast_input') {
    await executeBroadcast(ctx, text);
    return;
  }
  
  // --- 8. FLOW ADMIN CASHBACK INPUT ---
  else if (state.step === 'cashback_input') {
      const value = parseInt(text, 10);
      const type = state.type;
      
      if (isNaN(value) || value < 0) {
          return ctx.reply('❌ *Input tidak valid.* Masukkan angka positif.', { parse_mode: 'Markdown' });
      }
      
      const message = `
*✅ PENGATURAN TERSIMPAN!*

Untuk menerapkan perubahan ini, silakan edit variabel *CASHBACK_TYPE* dan *CASHBACK_VALUE* di file \`.vars.json\` (atau di \`app.js\` di bagian konstan) menjadi:

- \`CASHBACK_TYPE\`: **${type.toUpperCase()}**
- \`CASHBACK_VALUE\`: **${value}**

*Wajib Restart Bot* agar perubahan ini efektif.
      `;
      
      await ctx.reply(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]] } });
      delete userState[ctx.chat.id];
      return;
  }
});


// =======================================================
// 11. ADMIN HANDLERS & INLINE KEYBOARD HANDLERS
// =======================================================

async function sendAdminMenu(ctx) {
  const currentCashbackValue = CASHBACK_VALUE > 0 
      ? (CASHBACK_TYPE === 'PERCENT' ? `${CASHBACK_VALUE}%` : `Rp${CASHBACK_VALUE.toLocaleString('id-ID')}`) 
      : 'Nonaktif';
      
  const adminKeyboard = [
    [{ text: `💸 Cashback (${currentCashbackValue})`, callback_data: 'admin_cashback' }],
    [{ text: '➕ Tambah Server', callback_data: 'addserver' }, { text: '❌ Hapus Server', callback_data: 'deleteserver' }],
    [{ text: '💲 Edit Harga', callback_data: 'editserver_harga' }, { text: '📝 Edit Nama', callback_data: 'editserver_nama' }],
    [{ text: '🌐 Edit Domain', callback_data: 'editserver_domain' }, { text: '🔑 Edit Auth', callback_data: 'editserver_auth' }],
    [{ text: '📊 Edit Quota', callback_data: 'editserver_quota' }, { text: '📶 Edit Limit IP', callback_data: 'editserver_limit_ip' }],
    [{ text: '🔢 Edit Batas Create', callback_data: 'editserver_batas_create_akun' }, { text: '🔢 Edit Total Create', callback_data: 'editserver_total_create_akun' }],
    [{ text: '💵 Tambah Saldo Manual', callback_data: 'addsaldo_user' }, { text: '📋 List Server', callback_data: 'listserver' }],
    [{ text: '📢 Broadcast Pesan', callback_data: 'admin_broadcast_message' }, { text: 'ℹ️ Detail Server', callback_data: 'detailserver' }],
    [{ text: '♻️ Reset Server', callback_data: 'resetdb' }, { text: '🔙 Kembali', callback_data: 'send_main_menu' }]
  ];
  
  const messageText = `
*🛠️ MENU ADMINISTRATOR ${NAMA_STORE} 🛠️*

*⚙️ KONFIGURASI BOT SAAT INI:*
- Cashback: *${currentCashbackValue}*
- Tipe Cashback: *${CASHBACK_TYPE}*
- Min Deposit: *Rp${MIN_DEPOSIT_AMOUNT.toLocaleString('id-ID')}*

*Pilih Opsi:*
  `;
  
  try {
    const options = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: adminKeyboard } };
    if (ctx.updateType === 'callback_query') { await ctx.editMessageText(messageText, options); }
    else { await ctx.reply(messageText, options); }
  } catch (error) { logger.error('Error saat mengirim menu admin:', error); }
}

// --- LOGIKA BROADCAST BARU ---
bot.action('admin_broadcast_message', async (ctx) => {
    await ctx.answerCbQuery();
    if (!adminIds.includes(ctx.from.id)) { return ctx.reply('🚫 Anda tidak memiliki izin.'); }
    
    userState[ctx.chat.id] = { step: 'admin_broadcast_input' };
    
    const message = `
📢 *PENAWARAN BROADCAST*

Silakan kirimkan pesan yang ingin Anda siarkan (broadcast) ke *SEMUA* pengguna bot. Pesan ini akan dikirim dengan format *HTML*.

*PERHATIAN:* Pesan ini akan dikirim ke *${await dbAllAsync('SELECT COUNT(*) as count FROM users').then(r => r[0].count)}* pengguna. Gunakan dengan bijak.
    `;
    
    await ctx.reply(message, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: [[{ text: '❌ Batalkan', callback_data: 'admin_menu' }]] }
    });
});
// Fungsi Eksekusi Broadcast (dipanggil dari bot.on('text'))
async function executeBroadcast(ctx, message) {
    if (!adminIds.includes(ctx.from.id)) { return ctx.reply('🚫 Anda tidak memiliki izin.'); }
    
    const users = await dbAllAsync("SELECT user_id FROM users");
    let successCount = 0;
    
    for (const row of users) {
        try {
            await bot.telegram.sendMessage(row.user_id, message, { parse_mode: 'HTML' });
            successCount++;
        } catch (error) { 
            logger.error(`⚠️ Kesalahan saat mengirim broadcast ke ${row.user_id}: ${error.message}`);
        }
    }
    
    ctx.reply(`✅ Pesan siaran berhasil dikirim ke ${successCount} pengguna dari total ${users.length}.`);
    delete userState[ctx.chat.id];
}

// --- CRUD SERVER ACTIONS ---
bot.action('admin_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await sendAdminMenu(ctx);
});

bot.action('addserver', async (ctx) => {
  try {
    await ctx.answerCbQuery('Memulai penambahan server...');
    await ctx.reply('🌐 *Silakan masukkan domain/ip server:*', { parse_mode: 'Markdown' });
    userState[ctx.chat.id] = { step: 'addserver' };
  }
  catch (error) { 
    await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda. Silakan coba lagi nanti.*', { parse_mode: 'Markdown' });
  }
}); 

bot.action('deleteserver', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
      if (err) { return ctx.reply('⚠️ *PERHATIAN! Terjadi kesalahan saat mengambil daftar server.*', { parse_mode: 'Markdown' }); }
      if (servers.length === 0) { return ctx.reply('⚠️ *PERHATIAN! Tidak ada server yang tersedia saat ini.*', { parse_mode: 'Markdown' }); }
      const keyboard = servers.map(server => { return [{ text: server.nama_server, callback_data: `confirm_delete_server_${server.id}` }]; });
      keyboard.push([{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]);
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
  try { await ctx.answerCbQuery(); await ctx.reply('🚨 *PERHATIAN! Anda akan menghapus semua server yang tersedia. Apakah Anda yakin?*', { reply_markup: { inline_keyboard: [[{ text: '✅ Ya', callback_data: 'confirm_resetdb' }], [{ text: '❌ Tidak', callback_data: 'admin_menu' }]] }, parse_mode: 'Markdown' }); }
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
    await sendAdminMenu(ctx);
  } catch (error) { await ctx.reply(`❌ *${error}*`, { parse_mode: 'Markdown' }); }
});
bot.action('cancel_resetdb', async (ctx) => { await ctx.answerCbQuery(); await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' }); });

// --- CRUD EDIT ACTIONS (Mulai Input) ---
bot.action('editserver_harga', async (ctx) => { await showServerListForEdit(ctx, 'edit_harga'); });
bot.action('editserver_nama', async (ctx) => { await showServerListForEdit(ctx, 'edit_nama'); });
bot.action('editserver_domain', async (ctx) => { await showServerListForEdit(ctx, 'edit_domain'); });
bot.action('editserver_auth', async (ctx) => { await showServerListForEdit(ctx, 'edit_auth'); });
bot.action('editserver_quota', async (ctx) => { await showServerListForEdit(ctx, 'edit_quota'); });
bot.action('editserver_limit_ip', async (ctx) => { await showServerListForEdit(ctx, 'edit_limit_ip'); });
bot.action('editserver_batas_create_akun', async (ctx) => { await showServerListForEdit(ctx, 'edit_batas_create_akun'); });
bot.action('editserver_total_create_akun', async (ctx) => { await showServerListForEdit(ctx, 'edit_total_create_akun'); });

async function showServerListForEdit(ctx, editAction) {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk diedit.*', { parse_mode: 'Markdown' });
        }
        const keyboard = servers.map(server => {
            return [{ text: `${server.nama_server} (${server.domain})`, callback_data: `${editAction}_${server.id}` }];
        });
        keyboard.push([{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]);
        ctx.editMessageText(`📝 *Pilih server yang ingin Anda edit ${editAction.replace('edit_', '').replace(/_/g, ' ')}:*`, 
            { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
    });
}

// --- LOGIKA CLEANUP DATA AKUN EXPIRED ---
function cleanupExpiredAccounts() {
    logger.info('Mulai proses pembersihan data akun expired di database...');


    const query = "DELETE FROM user_accounts WHERE julianday(expired_at) < julianday('now', '-1 days')";

    db.run(query, function(err) {
        if (err) {
            logger.error(`❌ Gagal membersihkan data akun expired: ${err.message}`);
        } else {
            if (this.changes > 0) {
                logger.info(`✅ Cleanup Berhasil: ${this.changes} data akun lama telah dihapus.`);
            } else {
                logger.info('ℹ️ Cleanup Selesai: Tidak ada data akun yang perlu dihapus saat ini.');
            }
        }
    });
}

// Jadwal Cleanup Harian (Setiap jam 04:00 pagi WIB)
cron.schedule('0 4 * * *', () => {
    cleanupExpiredAccounts();
}, {
    timezone: "Asia/Jakarta"
});

logger.info('✅ Penjadwalan cleanup data (04:00 WIB) telah aktif.');

// --- FUNGSI REMINDER EXPIRED (2 HARI SEBELUM) ---
async function sendExpirationReminder() {
    logger.info('Menjalankan pengecekan reminder expired...');
    
    // Cari akun yang expired dalam tepat 2 hari lagi
    const query = `
        SELECT user_id, protocol, username, expired_at 
        FROM user_accounts 
        WHERE date(expired_at) = date('now', '+2 days')
    `;

    db.all(query, [], async (err, rows) => {
        if (err) {
            return logger.error(`Gagal query reminder: ${err.message}`);
        }

        if (rows.length === 0) return logger.info('Tidak ada reminder untuk hari ini.');

        for (const acc of rows) {
            const message = `
⚠️ *REMINDER PERPANJANGAN AKUN* ⚠️
━━━━━━━━━━━━━━━━━━━━━━
Halo, akun Anda akan segera expired dalam *2 hari* lagi. Silakan lakukan perpanjangan agar akun tetap aktif.

👤 *Username:* \`${acc.username}\`
🛠 *Protokol:* \`${acc.protocol}\`
📅 *Expired:* \`${acc.expired_at}\`
━━━━━━━━━━━━━━━━━━━━━━
Gunakan menu *♻️ Renew Akun* di bot untuk memperpanjang.
`.trim();

            try {
                await bot.telegram.sendMessage(acc.user_id, message, { parse_mode: 'Markdown' });
                logger.info(`✅ Reminder terkirim ke ${acc.user_id} untuk akun ${acc.username}`);
            } catch (e) {
                logger.error(`❌ Gagal kirim reminder ke ${acc.user_id}: ${e.message}`);
            }
        }
    });
}

// Tambahkan ke Cron Job (Misal setiap jam 09:00 pagi WIB)
cron.schedule('0 9 * * *', () => {
    sendExpirationReminder();
}, {
    timezone: "Asia/Jakarta"
});



// Handler untuk detail server
bot.action('detailserver', async (ctx) => {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk ditampilkan.*', { parse_mode: 'Markdown' });
        }
        
        const details = servers.map(server => 
            `🌐 *${server.nama_server}* (ID: ${server.id})\n` +
            `Domain: ${server.domain}\n` +
            `Auth: ${server.auth.substring(0, 4)}...\n` +
            `Harga: Rp${server.harga.toLocaleString('id-ID')}\n` +
            `Quota: ${server.quota} GB\n` +
            `Limit IP: ${server.iplimit} IP\n` +
            `Batas/Total Akun: ${server.total_create_akun}/${server.batas_create_akun}`
        ).join('\n\n---\n\n');
        
        ctx.reply(`📋 *Detail Semua Server:*\n\n${details}`, { parse_mode: 'Markdown' });
    });
});
bot.action('listserver', async (ctx) => {
    await ctx.answerCbQuery();
    db.all('SELECT * FROM Server', [], (err, servers) => {
        if (err || servers.length === 0) {
            return ctx.reply('⚠️ *Tidak ada server untuk ditampilkan.*', { parse_mode: 'Markdown' });
        }
        
        const list = servers.map(server => 
            `ID: ${server.id} | Nama: ${server.nama_server} | Domain: ${server.domain} | Akun: ${server.total_create_akun}/${server.batas_create_akun}`
        ).join('\n');
        
        ctx.reply(`📋 *List Server Singkat:*\n\n${list}`, { parse_mode: 'Markdown' });
    });
});

bot.action('manage_accounts', async (ctx) => {
  const userId = ctx.from.id;
  await ctx.answerCbQuery();

  db.all('SELECT id, protocol, username, expired_at FROM user_accounts WHERE user_id = ? ORDER BY created_at DESC', [userId], async (err, rows) => {
    if (err || !rows || rows.length === 0) {
      // Menggunakan inline_keyboard manual jika Markup bermasalah
      return ctx.editMessageText('📭 *Anda belum memiliki akun aktif.*', { 
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '⬅️ KEMBALI', callback_data: 'send_main_menu' }]]
        }
      });
    }

    const keyboard = rows.map(acc => [
      { text: `[${acc.protocol}] ${acc.username} - Exp: ${acc.expired_at}`, callback_data: `view_acc_${acc.id}` }
    ]);
    keyboard.push([{ text: '⬅️ KEMBALI', callback_data: 'send_main_menu' }]);

    await ctx.editMessageText('📁 *DAFTAR AKUN ANDA*\nKlik pada akun untuk melihat detail konfigurasi:', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  });
});

bot.action(/^view_acc_(\d+)$/, async (ctx) => {
  const accId = ctx.match[1];
  const userId = ctx.from.id;
  await ctx.answerCbQuery();

  db.get('SELECT * FROM user_accounts WHERE id = ? AND user_id = ?', [accId, userId], async (err, acc) => {
    if (err || !acc) return ctx.reply('❌ Akun tidak ditemukan.');

    const detailMsg = `📋 *DETAIL AKUN [${acc.protocol}]*\n` + acc.config_detail;
    
    await ctx.reply(detailMsg, { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('⬅️ KEMBALI KE LIST', 'manage_accounts')]])
    });
  });
});


bot.action(/edit_harga_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_harga', serverId: serverId, amount: '' }; await ctx.reply('💰 *Silakan masukkan harga server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_nama_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_nama', serverId: serverId, name: '' }; await ctx.reply('🏷️ *Silakan masukkan nama server baru:*', { reply_markup: { inline_keyboard: keyboard_abc() }, parse_mode: 'Markdown' }); });
bot.action(/edit_domain_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_domain', serverId: serverId, domain: '' }; await ctx.reply('🌐 *Silakan masukkan domain server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_auth_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_auth', serverId: serverId, auth: '' }; await ctx.reply('🔑 *Silakan masukkan auth server baru:*', { reply_markup: { inline_keyboard: keyboard_full() }, parse_mode: 'Markdown' }); });
bot.action(/edit_quota_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_quota', serverId: serverId, quota: '' }; await ctx.reply('📊 *Silakan masukkan quota server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_limit_ip_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_limit_ip', serverId: serverId, iplimit: '' }; await ctx.reply('📶 *Silakan masukkan limit IP server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_batas_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_batas_create_akun', serverId: serverId, batasCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan batas create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });
bot.action(/edit_total_create_akun_(\d+)/, async (ctx) => { const serverId = ctx.match[1]; userState[ctx.chat.id] = { step: 'edit_total_create_akun', serverId: serverId, totalCreateAkun: '' }; await ctx.reply('🔢 *Silakan masukkan total create akun server baru (angka saja):*', { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); });

// --- ACTION UNTUK MEMULAI ADD SALDO MANUAL ---
bot.action('addsaldo_user', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        userState[ctx.chat.id] = { step: 'request_user_id_for_add_saldo' };
        await ctx.editMessageText('👤 *Silakan masukkan User ID Telegram yang ingin ditambahkan saldonya (angka):*', { parse_mode: 'Markdown' });
    } catch (error) { await ctx.reply('❌ *GAGAL! Terjadi kesalahan saat memproses permintaan Anda.*', { parse_mode: 'Markdown' }); }
});


// --- LOGIKA EDIT CASHBACK (BARU) ---
bot.action('admin_cashback', async (ctx) => {
    await ctx.answerCbQuery();
    
    const message = `
*💰 PENGATURAN CASHBACK*

Cashback saat ini: ${CASHBACK_VALUE > 0 
      ? (CASHBACK_TYPE === 'PERCENT' ? `${CASHBACK_VALUE}%` : `Rp${CASHBACK_VALUE.toLocaleString('id-ID')}`) 
      : 'Nonaktif'}
Tipe: ${CASHBACK_TYPE}
      
Silakan pilih tipe cashback yang ingin Anda terapkan:
    `;
    
    const keyboard = [
        [{ text: '💲 Atur Cashback Nominal (FIXED)', callback_data: 'cashback_set_fixed' }],
        [{ text: '📈 Atur Cashback Persen (%)', callback_data: 'cashback_set_percent' }],
        [{ text: '🚫 Nonaktifkan Cashback (0)', callback_data: 'cashback_set_off' }],
        [{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]
    ];
    
    await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action('cashback_set_off', async (ctx) => {
    await ctx.answerCbQuery('Cashback dinonaktifkan.');
    const message = `
✅ *CASHBACK DINONAKTIFKAN!*

Untuk mengaktifkan/mengubah cashback, silakan edit variabel *CASHBACK_TYPE* dan *CASHBACK_VALUE* di file \`.vars.json\` atau \`app.js\` (setelah ini, restart bot):

- \`CASHBACK_VALUE\` diatur ke **0**.

_Kembali ke Menu Admin._
    `;
    await ctx.editMessageText(message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Kembali ke Menu Admin', callback_data: 'admin_menu' }]] } });
});

bot.action(/cashback_set_(fixed|percent)/, async (ctx) => {
    const type = ctx.match[1];
    await ctx.answerCbQuery(`Memulai pengaturan ${type}...`);
    
    const fieldName = type === 'fixed' ? 'Nominal Rupiah (Rp)' : 'Persentase (%)';
    
    const message = `
*⚙️ ATUR CASHBACK ${type.toUpperCase()}*

Masukkan ${fieldName} yang baru (angka saja, tanpa simbol/persen). Input ini akan digunakan sebagai *instruksi* untuk perubahan di server:
    `;
    
    userState[ctx.chat.id] = { step: 'cashback_input', type: type };
    
    await ctx.reply(message, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: [[{ text: '❌ Batalkan', callback_data: 'admin_menu' }]] }
    });
});


// --- INPUT CALLBACK HANDLERS ---
async function handleNumericInput(ctx, userStateData, data, field, fieldName, query) {
  let currentValue = userStateData[field] || ''; await ctx.answerCbQuery();
  if (data === 'delete') { currentValue = currentValue.slice(0, -1); }
  else if (data === 'confirm') {
    if (currentValue.length === 0 || isNaN(parseFloat(currentValue)) || parseFloat(currentValue) <= 0) { return ctx.reply(`❌ *${fieldName} tidak valid.* Masukkan angka yang valid.`, { parse_mode: 'Markdown' }); }
    const numericValue = parseFloat(currentValue);
 
    try {
        await updateServerField(userStateData.serverId, numericValue, query); 
        ctx.reply(`✅ *${fieldName} server berhasil diupdate.*\n\n📄 *Detail Server:*\n- ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} Baru: *${fieldName === 'harga' ? 'Rp ' + numericValue.toLocaleString('id-ID') : numericValue}*`, { parse_mode: 'Markdown' }); 
    } catch (err) { ctx.reply(`❌ *Terjadi kesalahan saat mengupdate ${fieldName} server.*`, { parse_mode: 'Markdown' }); }
    delete userState[ctx.chat.id]; return;
  } else if (!/^\d+$/.test(data)) { return; }
  else { if (currentValue.length < 12) { currentValue += data; } else { return ctx.reply('⚠️ *Jumlah maksimal adalah 12 digit!*', { parse_mode: 'Markdown' }); } }

  userStateData[field] = currentValue;
  const displayValue = fieldName === 'harga' ? `Rp ${parseInt(currentValue, 10).toLocaleString('id-ID')}` : currentValue;
  const newMessage = `💵 *Silakan masukkan ${fieldName} baru:*\n\n${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)} saat ini: *${displayValue}*`;
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: keyboard_nomor() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during numeric input:', error); }
}

async function handleTextInput(ctx, userStateData, data, field, fieldName, query, keyboardFunc) {
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
  try { await ctx.editMessageText(newMessage, { reply_markup: { inline_keyboard: keyboardFunc() }, parse_mode: 'Markdown' }); } catch (error) { if (!error.message.includes('message is not modified')) logger.error('Error editing message during text input:', error); }
}


bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userStateData = userState[ctx.chat.id];

  if (userStateData) {
    switch (userStateData.step) {
      case 'edit_batas_create_akun': await handleNumericInput(ctx, userStateData, data, 'batasCreateAkun', 'batas create akun', 'UPDATE Server SET batas_create_akun = ? WHERE id = ?'); break;
      case 'edit_total_create_akun': await handleNumericInput(ctx, userStateData, data, 'totalCreateAkun', 'total create akun', 'UPDATE Server SET total_create_akun = ? WHERE id = ?'); break;
      case 'edit_limit_ip': await handleNumericInput(ctx, userStateData, data, 'iplimit', 'limit IP', 'UPDATE Server SET iplimit = ? WHERE id = ?'); break;
      case 'edit_quota': await handleNumericInput(ctx, userStateData, data, 'quota', 'quota', 'UPDATE Server SET quota = ? WHERE id = ?'); break;
      case 'edit_harga': await handleNumericInput(ctx, userStateData, data, 'amount', 'harga', 'UPDATE Server SET harga = ? WHERE id = ?'); break;
      case 'edit_auth': await handleTextInput(ctx, userStateData, data, 'auth', 'auth', 'UPDATE Server SET auth = ? WHERE id = ?', keyboard_full); break;
      case 'edit_domain': await handleTextInput(ctx, userStateData, data, 'domain', 'domain', 'UPDATE Server SET domain = ? WHERE id = ?', keyboard_full); break;
      case 'edit_nama': await handleTextInput(ctx, userStateData, data, 'name', 'nama server', 'UPDATE Server SET nama_server = ? WHERE id = ?', keyboard_abc); break;
      
      case 'cashback_input':
          if (data === 'confirm' || data === 'delete' || data.match(/^\d+$/)) {
             const currentValue = userStateData.amount || '';
             if (data === 'confirm') {
                await ctx.answerCbQuery('Input diterima. Memproses instruksi...');
                // Biarkan bot.on('text') memproses konfirmasi setelah input terakhir
                return;
             }
             await handleNumericInput(ctx, userStateData, data, 'amount', userStateData.type === 'fixed' ? 'nominal Rupiah' : 'persentase', 'N/A');
             return;
          }
          break;
      default: 
        if (data === 'cancel_resetdb') {
            await ctx.answerCbQuery(); 
            await ctx.reply('❌ *Proses reset database dibatalkan.*', { parse_mode: 'Markdown' });
            delete userState[ctx.chat.id];
        }
        break;
    }
  }
});


// =======================================================
// 12. LOGIKA BACKUP DAN INISIALISASI SERVER
// =======================================================

// --- LOGIKA BACKUP DATABASE ---
function backupDatabase() {
    logger.info('Mulai proses backup database harian...');
    const today = new Date().toISOString().split('T')[0];
    const backupFileName = `sellvpn_backup_${today}.sql`;
    const backupPath = path.join(__dirname, backupFileName);
    
    const dumpCommand = `.dump`;

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
                fs.writeFileSync(backupPath, dumpData);
                logger.info(`✅ Database dump berhasil dibuat di ${backupFileName}`);

                const adminRecipientId = Array.isArray(ADMIN_RAW) ? ADMIN_RAW[0] : ADMIN_RAW;
                
                try {
                    await bot.telegram.sendDocument(adminRecipientId, { source: backupPath, filename: backupFileName }, {
                        caption: `🤖 *BACKUP OTOMATIS HARIAN*\n\nDatabase \`${backupFileName}\` berhasil dibuat dan dikirim.\n\nSimpan file ini untuk pemulihan (restore) data.`,
                        parse_mode: 'Markdown'
                    });
                    logger.info(`✅ File backup berhasil dikirim ke Admin ID: ${adminRecipientId}`);
                } catch (e) {
                    logger.error(`❌ Gagal mengirim file backup ke admin: ${e.message}`);
                } finally {
                    fs.unlinkSync(backupPath);
                    logger.info(`File backup ${backupFileName} telah dihapus dari server.`);
                }
            } else {
                logger.error(`❌ Proses SQLite dump gagal dengan kode ${code}`);
            }
        });

        sqliteProcess.stdin.write(dumpCommand + '\n');
        sqliteProcess.stdin.end();

    } catch (e) {
        logger.error(`❌ Gagal menjalankan proses backup (Pastikan paket 'sqlite3' terinstal di sistem Anda): ${e.message}`);
    }
}

// Jadwal Backup Harian (Misal, setiap jam 03:00 pagi)
cron.schedule('0 3 * * *', () => {
    backupDatabase();
}, {
    timezone: "Asia/Jakarta"
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