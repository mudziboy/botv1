const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

/**
 * Fungsi Create TROJAN dengan Fitur Auto-Save ke Kelola Akun
 * @param {number} userId - ID Telegram user 
 */
async function createtrojan(userId, username, exp, quota, limitip, serverId) {
  console.log(`⚙️ Creating TROJAN for ${username} | UserID: ${userId} | Exp: ${exp} | Quota: ${quota} GB | IP Limit: ${limitip}`);

  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) return resolve('❌ Server tidak ditemukan.');

      const url = `http://${server.domain}:5888/createtrojan?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${server.auth}`;

      try {
        const { data } = await axios.get(url);

        if (data.status !== 'success') return resolve(`❌ Gagal: ${data.message}`);

        const d = data.data;

        const msg = `
         🔥 *TROJAN PREMIUM ACCOUNT*

🔹 *Informasi Akun*
┌─────────────────────
│👤 *Username:* \`${d.username}\`
│🌐 *Domain:* \`${d.domain}\`
└─────────────────────
┌─────────────────────
│🔐 *Port TLS:* \`443\`
│📡 *Port HTTP:* \`80\`
│🔁 *Network:* WebSocket / gRPC
│📦 *Quota:* ${d.quota}
│🌍 *IP Limit:* ${d.ip_limit}
└─────────────────────

🔗 *TROJAN TLS:*
\`\`\`
${d.trojan_tls_link}
\`\`\`
🔗 *TROJAN GRPC:*
\`\`\`
${d.trojan_grpc_link}
\`\`\`

🔏 *PUBKEY:* \`${d.pubkey}\`
┌─────────────────────
│🕒 *Expired:* \`${d.expired}\`
│
│📥 [Save Account](https://${d.domain}:81/trojan-${d.username}.txt)
└─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        // --- LOGIKA SIMPAN KE TABEL KELOLA AKUN --- 
        const saveQuery = `INSERT INTO user_accounts 
          (user_id, protocol, username, config_detail, server_name, ip_address, expired_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`;

        db.run(saveQuery, [
          userId,
          'TROJAN',
          d.username,
          msg,
          server.nama_server,
          server.domain,
          d.expired
        ], (saveErr) => {
          if (saveErr) console.error('❌ Gagal simpan database:', saveErr.message);
        });

        resolve(msg);
      } catch (e) {
        console.error('❌ Error Trojan API:', e.message);
        resolve('❌ Tidak bisa request trojan.');
      }
    });
  });
}

module.exports = { createtrojan };