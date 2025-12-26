const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

/**
 * Fungsi Renew VMESS dengan Output Object untuk Sinkronisasi Database
 */
async function renewvmess(username, exp, quota, limitip, serverId) {
  // Validasi karakter username
  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return { 
      success: false, 
      message: '❌ Username tidak valid. Gunakan hanya huruf dan angka tanpa spasi.' 
    };
  }

  return new Promise((resolve) => {
    // Ambil detail server dari database
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err || !server) {
        return resolve({ success: false, message: '❌ Server tidak ditemukan.' });
      }

      // Endpoint API Renew VMESS Port 5888
      const url = `http://${server.domain}:5888/renewvmess?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${server.auth}`;
      
      axios.get(url)
        .then(res => {
          if (res.data.status === "success") {
            const data = res.data.data;
            
            // Mengembalikan Object agar app.js bisa update tabel user_accounts
            resolve({
              success: true,
              new_expired: data.exp, // Tanggal expired baru dari API VPS
              message: `
♻️ *RENEW VMESS PREMIUM* ♻️

🔹 *Informasi Akun*
┌─────────────────────────────
│ Username   : \`${username}\`
│ Kadaluarsa : \`${data.exp}\`
│ Kuota      : \`${data.quota} GB\`
│ Batas IP   : \`${data.limitip} IP\`
└─────────────────────────────
✅ Akun berhasil diperpanjang.
✨ Terima kasih telah berlangganan!
`.trim()
            });
          } else {
            resolve({ 
              success: false, 
              message: `❌ Gagal: ${res.data.message}` 
            });
          }
        })
        .catch((error) => {
          console.error('Renew VMESS Error:', error.message);
          resolve({ 
            success: false, 
            message: '❌ Gagal menghubungi server VPS.' 
          });
        });
    });
  });
}

module.exports = { renewvmess };