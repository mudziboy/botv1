const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

/**
 * Fungsi Renew ZiVPN dengan Output Object untuk Sinkronisasi Database
 */
async function renewzivpn(password, exp, serverId) {
    const db = new sqlite3.Database('./sellvpn.db');

    return new Promise((resolve) => {
        db.get('SELECT ip, auth FROM Server WHERE id = ?', [serverId], async (err, server) => {
            if (err || !server) {
                db.close();
                return resolve({ success: false, message: "❌ GAGAL! Server tidak ditemukan." });
            }

            const url = `http://${server.ip}:5888/api/user/renew`;
            
            try {
                const response = await axios.post(url, {
                    password: password,
                    days: parseInt(exp)
                }, {
                    headers: { 'X-API-Key': server.auth, 'Content-Type': 'application/json' },
                    timeout: 10000
                });

                if (response.data.success || response.data.status === "success") {
                    const d = response.data.data;
                    resolve({
                        success: true,
                        new_expired: d.expired, // Mengirim tanggal baru ke app.js
                        message: `
✅ *PERPANJANG ZIVPN BERHASIL*
━━━━━━━━━━━━━━━━━━━━
🔑 *Password:* \`${password}\`
🌐 *Host IP:* \`${server.ip}\`
📅 *Expired Baru:* \`${d.expired}\`
➕ *Tambahan:* ${exp} Hari
━━━━━━━━━━━━━━━━━━━━
🙏 *Terimakasih telah memperpanjang!*
`.trim()
                    });
                } else {
                    resolve({ success: false, message: `❌ GAGAL: ${response.data.message}` });
                }
            } catch (e) {
                resolve({ success: false, message: `❌ GAGAL: API VPS tidak merespon.` });
            } finally {
                db.close();
            }
        });
    });
}

module.exports = { renewzivpn };