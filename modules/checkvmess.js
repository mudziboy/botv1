const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

async function checkvmess(serverId) {
  console.log(`Checking VMess account on server ${serverId}`);

  // Ambil domain dari database
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM Server WHERE id = ?', [serverId], (err, server) => {
      if (err) {
        console.error('Error fetching server:', err.message);
        return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');
      }

      if (!server) return resolve('❌ Server tidak ditemukan. Silakan coba lagi.');

      const domain = server.domain;
      const auth = server.auth;
      const param = `:5888/checkvmess?auth=${auth}`;
      const url = `http://${domain}${param}`;
      axios.get(url)
        .then(response => {
          if (response.data.status === "success") {
            const vmessData = response.data.data;
            let msg = `
🌟 *CHECK AKUN VMESS* 🌟
`;
            vmessData.forEach(user => {
              msg += `
┌─────────────────────────────
│ Username: \`${user.user}\`
│ Penggunaan: \`${user.usage}\`
│ Kuota: \`${user.quota}\`
│ Batas IP: \`${user.ip_limit}\`
│ Jumlah IP: \`${user.ip_count}\`
│ Jumlah Log: \`${user.log_count}\`
└─────────────────────────────
`;
            });
            msg += `✨ Terima kasih telah menggunakan layanan kami! ✨`;
              console.log('VMess account checked successfully');
              return resolve(msg);
            } else {
              console.log('Error checking VMess account');
              return resolve(`❌ Terjadi kesalahan: ${response.data.message}`);
            }
          })
        .catch(error => {
          console.error('Error saat memeriksa VMess:', error);
          return resolve('❌ Terjadi kesalahan saat memeriksa VMess. Silakan coba lagi nanti.');
        });
    });
  });
}

module.exports = { checkvmess };
