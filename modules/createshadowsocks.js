const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./sellvpn.db');

async function createshadowsocks(username, exp, quota, limitip, serverId) {
  console.log(`⚙️ Creating Shadowsocks for ${username} | Exp: ${exp} | Quota: ${quota} GB | IP Limit: ${limitip}`);

  if (/\s/.test(username) || /[^a-zA-Z0-9]/.test(username)) {
    return '❌ Username tidak valid.';
  }

  return new Promise((resolve) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], async (err, server) => {
      if (err || !server) return resolve('❌ Server tidak ditemukan.');

      const url = `http://${server.domain}:5888/createshadowsocks?user=${username}&exp=${exp}&quota=${quota}&iplimit=${limitip}&auth=${server.auth}`;

      try {
        const response = await axios.get(url);
        const data = response.data;

        if (data.status !== 'success') return resolve(`❌ Gagal: ${data.message}`);

        const d = data.data;

        const msg = `
         🔥 *SHADOWSOCKS PREMIUM*

🔹 *Informasi Akun*
┌─────────────────────
│👤 *Username:* \`${d.username}\`
│🌐 *Domain:* \`${d.domain}\`
└─────────────────────
┌─────────────────────
│📦 *Quota:* ${d.quota}
│🌍 *IP Limit:* ${d.iplimit}
└─────────────────────

🔗 *SS WS LINK:*
\`\`\`
${d.ss_link_ws}
\`\`\`
🔗 *SS GRPC LINK:*
\`\`\`
${d.ss_link_grpc}
\`\`\`

🔐 *Method:* \`${d.method}\`
🧾 *Password:* \`${d.password}\`
┌─────────────────────
│🕒 *Expired:* \`${d.expired}\`
└─────────────────────
✨ By : *TUNNEL OFFICIAL*! ✨
`.trim();

        resolve(msg);
      } catch (e) {
        resolve('❌ Error Shadowsocks API');
      }
    });
  });
}
module.exports = { createshadowsocks };