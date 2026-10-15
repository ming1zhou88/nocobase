const { Client } = require('ssh2');

const conn = new Client();
conn
  .on('ready', () => {
    console.log('SSH Connected');

    // Run pm2 list to see all processes
    conn.exec('pm2 list', (err, stream) => {
      if (err) {
        console.error('Error:', err);
        conn.end();
        return;
      }
      let output = '';
      stream
        .on('close', (code, signal) => {
          console.log('Exit code:', code);
          console.log('Output:\n', output);
          conn.end();
        })
        .on('data', (data) => {
          output += data.toString();
        })
        .stderr.on('data', (data) => {
          console.log('STDERR:', data.toString());
        });
    });
  })
  .connect({
    host: '120.79.239.166',
    port: 22,
    username: 'root',
    password: 'Ta08292023',
  });
