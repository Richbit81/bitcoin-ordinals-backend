// Einfacher Test-Script
import http from 'http';

const options = {
  hostname: 'localhost',
  port: 3002,
  path: '/api/health',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(`✅ Server antwortet! Status: ${res.statusCode}`);
  res.on('data', (d) => {
    console.log(`Response: ${d.toString()}`);
  });
});

req.on('error', (error) => {
  console.error(`❌ Fehler: ${error.message}`);
  console.error('Der Server läuft wahrscheinlich nicht auf Port 3002.');
});

req.end();








