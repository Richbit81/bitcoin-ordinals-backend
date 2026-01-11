// Einfacher Test ob der Server startet
import express from 'express';

const app = express();
const PORT = 3002;

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server läuft!' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Test-Server läuft auf http://localhost:${PORT}`);
  console.log('Test mit: curl http://localhost:3002/api/health');
});








