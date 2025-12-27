const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

// ✅ CREATE VMESS
async function createvmess(username, exp, quota, limitip, serverId) {
  console.log(`⚙️ Creating VMESS for ${username} | Exp: ${exp} | Quota: ${quota} GB | IP Limit: ${limitip}`);

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
        const response = await axios.get(url);
        // VPS mengirim: { status: "success", data: { vmess_tls_link: "..." } }
        // Jadi kita harus mengambil response.data.data
        const data = response.data; 

        if (data.status !== 'success') {
          return resolve(`❌ Gagal membuat akun: ${data.message}`);
        }

        // KUNCINYA DI SINI: Gunakan fallback agar tidak undefined
        const d = data.data || {}; 

        const msg = `
 *VMESS PREMIUM ACCOUNT*
┌─────────────────────
│👤 *Username:* \`${d.username}\`
│🌐 *Domain:* \`${d.domain}\`
└─────────────────────
┌─────────────────────
│🔐 *Port TLS:* \`443\`
│📡 *Port HTTP:* \`80\`
│🔁 *Network:* WebSocket
│📦 *Quota:* ${d.quota || quota}
│🌍 *IP Limit:* ${d.iplimit || limitip} 
└─────────────────────

🔗 *VMESS TLS:*
\`\`\`
${d.vmess_tls_link || "Gagal mendapatkan link"}
\`\`\`
🔗 *VMESS NON-TLS:*
\`\`\`
${d.vmess_nontls_link || "Gagal mendapatkan link"}
\`\`\`
🔗 *VMESS GRPC:*
\`\`\`
${d.vmess_grpc_link || "Gagal mendapatkan link"}
\`\`\`

🧾 *UUID:* \`${d.uuid}\`
┌─────────────────────
│🕒 *Expired:* \`${d.expired}\`
└─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        resolve(msg);

      } catch (e) {
        console.error('❌ Error saat request ke API:', e.message);
        resolve('❌ Tidak bisa menghubungi server. Coba lagi nanti.');
      }
    });
  });
}

module.exports = { createvmess };