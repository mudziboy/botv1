const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

/**
 * Fungsi Create SSH dengan Fitur Auto-Save ke Kelola Akun
 * @param {number} userId - ID Telegram user untuk keperluan simpan database
 */
async function createssh(userId, username, password, exp, iplimit, serverId) {
  console.log(`⚙️ Creating SSH for ${username} | UserID: ${userId} | Exp: ${exp} | IP Limit: ${iplimit}`);

  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ DB Error:', err?.message || 'Server tidak ditemukan');
        return resolve('❌ Server tidak ditemukan.');
      }

      // Endpoint API SSH Port 5888
      const url = `http://${server.domain}:5888/createssh?user=${username}&password=${password}&exp=${exp}&iplimit=${iplimit}&auth=${server.auth}`;

      try {
        const { data } = await axios.get(url);

        if (data.status !== 'success') {
          return resolve(`❌ Gagal membuat akun: ${data.message}`);
        }

        const d = data.data;

        // Template pesan yang akan dikirim ke user dan disimpan di database
        const msg = `
🔥 *AKUN SSH PREMIUM* 🔹 *Informasi Akun*
┌─────────────────────
│👤 Username   : \`${d.username}\`
│🔑 Password   : \`${d.password}\`
│🌐 Domain     : \`${d.domain}\`
└─────────────────────
┌─────────────────────
│🔒 TLS        : 443
│🌍 HTTP       : 80
│🛡️ SSH        : 22
│🌐 SSH WS     : 80
│🔐 SSL WS     : 443
│🧱 Dropbear   : 109, 443
│🧭 DNS        : 53, 443, 22
│📥 OVPN       : 1194, 2200, 443
└─────────────────────

🔏 *PUBKEY:*
\`\`\`
${d.pubkey || '-'}
\`\`\`
📁 *UDP HTTP CUSTOM:*
\`${d.domain}:1-65535@${d.username}:${d.password}\`
📁 *HTTP CUSTOM 443:*
\`${d.domain}:443@${d.username}:${d.password}\`
📁 *HTTP CUSTOM 80:*
\`${d.domain}:80@${d.username}:${d.password}\`



📦 *Download OVPN:*
\`https://${d.domain}:81/allovpn.zip\`
┌─────────────────────
│📅 *Expired:* \`${d.expired}\`
│🌐 *IP Limit:* \`${d.ip_limit} IP\`
└─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        // --- LOGIKA SIMPAN KE TABEL KELOLA AKUN ---
        const saveQuery = `INSERT INTO user_accounts 
          (user_id, protocol, username, password, config_detail, server_name, ip_address, expired_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(saveQuery, [
          userId,               // ID Telegram User
          'SSH',                // Protokol
          d.username,           // Username akun
          d.password,           // Password akun
          msg,                  // Simpan seluruh format teks agar bisa dipanggil lagi
          server.nama_server,   // Nama server dari database
          server.domain,        // IP/Domain server
          d.expired             // Tanggal expired dari API VPS
        ], (saveErr) => {
          if (saveErr) {
            console.error('❌ Gagal menyimpan ke user_accounts:', saveErr.message);
          } else {
            console.log(`✅ Data akun SSH ${username} berhasil disimpan untuk fitur Kelola Akun.`);
          }
        });

        resolve(msg);
      } catch (e) {
        console.error('❌ Error API SSH:', e.message);
        resolve('❌ Tidak bisa menghubungi API Server SSH.');
      }
    });
  });
}

module.exports = { createssh };