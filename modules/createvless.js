const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

// ✅ CREATE VLESS DENGAN AUTO-SAVE
async function createvless(userId, username, exp, quota, limitip, serverId) {
  console.log(`⚙️ Creating VLESS for ${username} | UserID: ${userId} | Exp: ${exp} | Quota: ${quota} GB | IP Limit: ${limitip}`);

  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ DB Error:', err?.message || 'Server tidak ditemukan');
        return resolve('❌ Server tidak ditemukan.');
      }

      const url = `http://${server.domain}:5888/createvless?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${server.auth}`;

      try {
        const { data } = await axios.get(url);

        if (data.status !== 'success') {
          return resolve(`❌ Gagal membuat akun: ${data.message}`);
        }

        const d = data.data;

        const msg = `
         🔥 *VLESS PREMIUM ACCOUNT*

🔹 *Informasi Akun*
┌─────────────────────
│👤 *Username:* \`${d.username}\`
│🌐 *Domain:* \`${d.domain}\`
└─────────────────────
┌─────────────────────
│🔐 *Port TLS:* \`443\`
│📡 *Port HTTP:* \`80\`
│🔁 *Network:* WebSocket
│📦 *Quota:* ${d.quota === '0 GB' ? 'Unlimited' : d.quota}
│🌍 *IP Limit:* ${d.ip_limit === '0' ? 'Unlimited' : d.ip_limit}
└─────────────────────

🔗 *VLESS TLS:*
\`\`\`
${d.vless_tls_link}
\`\`\`
🔗 *VLESS NON-TLS:*
\`\`\`
${d.vless_nontls_link}
\`\`\`
🔗 *VLESS GRPC:*
\`\`\`
${d.vless_grpc_link}
\`\`\`

🧾 *UUID:* \`${d.uuid}\`
🔏 *PUBKEY:* \`${d.pubkey}\`
┌─────────────────────
│🕒 *Expired:* \`${d.expired}\`
│
│📥 [Save Account](https://${d.domain}:81/vless-${d.username}.txt)
└─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        // --- LOGIKA SIMPAN KE TABEL KELOLA AKUN --- 
        const saveQuery = `INSERT INTO user_accounts 
          (user_id, protocol, username, config_detail, server_name, ip_address, expired_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`;

        db.run(saveQuery, [
          userId,
          'VLESS',
          d.username,
          msg,
          server.nama_server,
          server.domain,
          d.expired
        ], (saveErr) => {
          if (saveErr) console.error('❌ Gagal simpan database:', saveErr.message);
        });

        console.log('✅ VLESS created and saved for', username);
        resolve(msg);

      } catch (e) {
        console.error('❌ Error API VLESS:', e.message);
        resolve('❌ Tidak bisa menghubungi server.');
      }
    });
  });
}

module.exports = { createvless };