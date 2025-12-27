// createzivpn.js - VERSI TERFIX
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

async function createzivpn(userId, password, exp, serverId, ipLimit) {
    const db = new sqlite3.Database('./sellvpn.db');

    return new Promise((resolve) => {
        db.get('SELECT domain, auth, nama_server FROM Server WHERE id = ?', [serverId], async (err, server) => {
            if (err || !server) {
                db.close();
                return resolve("❌ GAGAL! Server tidak ditemukan atau database error.");
            }

            // Memastikan menggunakan Port 8888 sesuai permintaan
            const url = `http://${server.domain}:5888/api/user/create`; 
            
            try {
                const response = await axios.post(url, {
                    password: password,
                    days: parseInt(exp),
                    ip_limit: parseInt(ipLimit) // Perbaikan: Mengirim IP Limit agar sinkron dengan VPS 
                }, {
                    headers: {
                        'X-API-Key': server.auth, 
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 
                });

                if (response.data.success || response.data.status === "success") {
                    const d = response.data.data;
                    const msg = `
✅ *AKUN UDP ZIVPN BERHASIL*
━━━━━━━━━━━━━━━━━━━━
🔑 *Password:* \`${password}\`
🌐 *Host IP:* \`${server.domain}\`
📅 *Expired:* \`${d.expired}\`
📱 *IP Limit:* ${ipLimit} Device
━━━━━━━━━━━━━━━━━━━━
📝 *Cara Pakai:*
•Install ZiVPN
•Masukkan Host Ip & Password di atas.
━━━━━━━━━━━━━━━━━━━━`.trim();

                    // Simpan ke user_accounts untuk fitur "Kelola Akun"
                    const saveQuery = `INSERT INTO user_accounts 
                      (user_id, protocol, username, password, config_detail, server_name, ip_address, expired_at) 
                      VALUES (?, 'ZIVPN', ?, ?, ?, ?, ?, ?)`;

                    db.run(saveQuery, [userId, password, password, msg, server.nama_server, server.domain, d.expired]);

                    resolve(msg);
                } else {
                    resolve(`❌ GAGAL: ${response.data.message}`);
                }
            } catch (e) {
                resolve(`❌ GAGAL: API VPS di ${server.domain}:5888 tidak merespon. Pastikan Firewall port 5888 terbuka.`);
            } finally {
                db.close(); 
            }
        });
    });
}

module.exports = { createzivpn };