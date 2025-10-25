const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

async function checkssh(serverId) {
  console.log(`Checking SSH account on server ${serverId}`);

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
      const param = `:5888/checkssh?auth=${auth}`;
      const url = `http://${domain}${param}`;
      axios.get(url)
        .then(response => {
          if (response.data.status === "success") {
            const sshData = response.data.data;
            let msg = `
🌟 *CHECK AKUN SSH* 🌟
`;
            sshData.forEach(user => {
              msg += `
┌─────────────────────────────
│ Username: \`${user.user}\`
│ Batas IP: \`${user.ip_limit}\`
│ IP Count: \`${user.total_ip_connect}\`
└─────────────────────────────
`;
            });
            msg += `✨ Terima kasih telah menggunakan layanan kami! ✨`;
              console.log('SSH account checked successfully');
              return resolve(msg);
            } else {
              console.log('Error checking SSH account');
              return resolve(`❌ Terjadi kesalahan: ${response.data.message}`);
            }
          })
        .catch(error => {
          console.error('Error saat memeriksa SSH:', error);
          return resolve('❌ Terjadi kesalahan saat memeriksa SSH. Silakan coba lagi nanti.');
        });
    });
  });
}

module.exports = { checkssh };
