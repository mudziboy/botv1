const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

/**
 * Fungsi untuk membuat akun UDP ZiVPN via API VPS Port 8888 dengan Auto-Save
 */
async function createzivpn(userId, password, exp, serverId, ipLimit) {
    const db = new sqlite3.Database('./sellvpn.db');

    return new Promise((resolve) => {
        // PERBAIKAN: Pastikan mengambil kolom 'domain' dari tabel Server
        db.get('SELECT domain, auth, nama_server FROM Server WHERE id = ?', [serverId], async (err, server) => {
            if (err) {
                db.close();
                return resolve("❌ GAGAL! Terjadi kesalahan database.");
            }
            if (!server) {
                db.close();
                return resolve("❌ GAGAL! Server ID tidak ditemukan.");
            }

            // PERBAIKAN: Menggunakan server.domain (bukan server.ip)
            const url = `http://${server.domain}:8888/api/user/create`; 
            
            try {
                const response = await axios.post(url, {
                    password: password,
                    days: parseInt(exp)
                }, {
                    headers: {
                        'X-API-Key': server.auth, 
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 
                });

                if (response.data.success || response.data.status === "success") {
                    const d = response.data.data;
                    
                    // PERBAIKAN: Mengganti semua server.ip menjadi server.domain
                    const msg = `
✅ *AKUN UDP ZIVPN BERHASIL*
━━━━━━━━━━━━━━━━━━━━
🔑 *Password:* \`${password}\`
🌐 *Host IP:* \`${server.domain}\`
📅 *Expired:* \`${d.expired}\`
📱 *IP Limit:* ${ipLimit} Device
━━━━━━━━━━━━━━━━━━━━
📝 *Cara Pakai:*
1. Install aplikasi ZiVPN di Playstore.
2. Masukkan Host/IP: \`${server.domain}\`
3. Masukkan Password di atas.
━━━━━━━━━━━━━━━━━━━━
🙏 *Terimakasih telah berlangganan!*
`.trim();

                    // --- LOGIKA SIMPAN KE TABEL KELOLA AKUN ---
                    const saveQuery = `INSERT INTO user_accounts 
                      (user_id, protocol, username, password, config_detail, server_name, ip_address, expired_at) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

                    db.run(saveQuery, [
                        userId,             
                        'ZIVPN',            
                        password,           
                        password,           
                        msg,                
                        server.nama_server, 
                        server.domain,      // PERBAIKAN: Gunakan domain
                        d.expired           
                    ], (saveErr) => {
                        if (saveErr) console.error('❌ Gagal simpan ZiVPN ke database:', saveErr.message);
                    });

                    resolve(msg);
                } else {
                    resolve(`❌ GAGAL: ${response.data.message || 'Respon API tidak sukses'}`);
                }
            } catch (e) {
                // PERBAIKAN: Pesan error menggunakan server.domain agar tidak muncul 'undefined'
                resolve(`❌ GAGAL: API VPS di ${server.domain}:8888 tidak merespon.`);
            } finally {
                db.close(); 
            }
        });
    });
}

module.exports = { createzivpn };