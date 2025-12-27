const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

/**
 * Fungsi Create VMESS dengan Fitur Auto-Save ke Kelola Akun
 * @param {number} userId - ID Telegram user
 */
async function createvmess(userId, username, exp, quota, limitip, serverId) {
  console.log(`⚙️ Creating VMESS for ${username} | UserID: ${userId} | Exp: ${exp} | Quota: ${quota} GB | IP Limit: ${limitip}`);

  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid. Gunakan hanya huruf dan angka tanpa spasi.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) {
        console.error('❌ DB Error:', err?.message || 'Server tidak ditemukan');
        return resolve('❌ Server tidak ditemukan.');
      }

      const url = `http://${server.domain}:5888/createvmess?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${server.auth}`;

      try {
        const { data } = await axios.get(url);

        if (data.status !== 'success') {
          console.error('❌ Gagal dari API:', data.message);
          return resolve(`❌ Gagal membuat akun: ${data.message}`);
        }

        const d = data.data;

        // Template pesan untuk dikirim ke user dan disimpan di database
        const msg = `
🔥 *VMESS PREMIUM ACCOUNT*
         
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

🔗 *VMESS TLS:*
\`\`\`
${d.vmess_tls_link}
\`\`\`

🔗 *VMESS NON-TLS:*
\`\`\`
${d.vmess_nontls_link}
\`\`\`

🔗 *VMESS GRPC:*
\`\`\`
${d.vmess_grpc_link}
\`\`\`

🧾 *UUID:* \`${d.uuid}\`
📅 *Expired:* \`${d.expired}\`
─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        // --- LOGIKA SIMPAN KE TABEL KELOLA AKUN ---
        const saveQuery = `INSERT INTO user_accounts 
          (user_id, protocol, username, config_detail, server_name, ip_address, expired_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?)`;

        db.run(saveQuery, [
          userId,               // ID Telegram User
          'VMESS',              // Protokol
          d.username,           // Username akun
          msg,                  // Simpan seluruh format teks
          server.nama_server,   // Nama server
          server.domain,        // Domain server
          d.expired             // Tanggal expired dari VPS
        ], (saveErr) => {
          if (saveErr) {
            console.error('❌ Gagal menyimpan VMESS ke database:', saveErr.message);
          } else {
            console.log(`✅ Akun VMESS ${username} berhasil disimpan untuk Kelola Akun.`);
          }
        });

        resolve(msg);
      } catch (e) {
        console.error('❌ Error API VMESS:', e.message);
        resolve('❌ Tidak bisa menghubungi API Server VMESS.');
      }
    });
  });
}

module.exports = { createvmess };