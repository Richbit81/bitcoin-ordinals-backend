/**
 * UniSat API Monitor
 * Zeigt UniSat API-Aktivitäten in Echtzeit an
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.join(__dirname, 'logs');
const inscriptionsLogFile = path.join(logsDir, 'inscriptions.log');

console.log('🔍 UniSat API Monitor gestartet...');
console.log('📁 Log-Datei:', inscriptionsLogFile);
console.log('');
console.log('Warte auf UniSat API-Aktivitäten...');
console.log('Drücken Sie Ctrl+C zum Beenden');
console.log('═'.repeat(80));

// Lese vorhandene Logs
if (fs.existsSync(inscriptionsLogFile)) {
  const lines = fs.readFileSync(inscriptionsLogFile, 'utf-8').split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    console.log(`\n📜 Letzte ${Math.min(10, lines.length)} Einträge:\n`);
    lines.slice(-10).forEach((line, index) => {
      try {
        const entry = JSON.parse(line);
        const time = new Date(entry.timestamp).toLocaleTimeString('de-DE');
        console.log(`[${time}] ${entry.mode === 'mock' ? '🧪 MOCK' : '✅ PROD'} Order: ${entry.orderId}`);
        console.log(`         Address: ${entry.address}`);
        console.log(`         File: ${entry.fileName} (${entry.fileSize} bytes)`);
        console.log(`         Fee Rate: ${entry.feeRate} sat/vB`);
        if (entry.inscriptionId) {
          console.log(`         Inscription ID: ${entry.inscriptionId}`);
        }
        console.log('');
      } catch (e) {
        // Ignore parse errors
      }
    });
  }
}

// Watch für neue Einträge
let lastSize = fs.existsSync(inscriptionsLogFile) ? fs.statSync(inscriptionsLogFile).size : 0;

const watchLogFile = () => {
  if (!fs.existsSync(inscriptionsLogFile)) {
    setTimeout(watchLogFile, 1000);
    return;
  }

  const stats = fs.statSync(inscriptionsLogFile);
  if (stats.size > lastSize) {
    // Neue Daten vorhanden
    const stream = fs.createReadStream(inscriptionsLogFile, { start: lastSize });
    let buffer = '';
    
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Letzte unvollständige Zeile behalten
      
      lines.forEach((line) => {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            const time = new Date(entry.timestamp).toLocaleTimeString('de-DE');
            console.log(`\n${'═'.repeat(80)}`);
            console.log(`🆕 NEUE INSKRIPTION [${time}]`);
            console.log(`${'═'.repeat(80)}`);
            console.log(`📋 Order ID: ${entry.orderId}`);
            console.log(`👤 Address: ${entry.address}`);
            console.log(`📄 File: ${entry.fileName} (${entry.fileSize} bytes)`);
            console.log(`💰 Fee Rate: ${entry.feeRate} sat/vB`);
            if (entry.postage) {
              console.log(`📦 Postage: ${entry.postage} sats`);
            }
            console.log(`🔧 Mode: ${entry.mode === 'mock' ? '🧪 MOCK' : '✅ PRODUCTION'}`);
            if (entry.payAddress) {
              console.log(`💳 Pay Address: ${entry.payAddress}`);
            }
            if (entry.amount) {
              console.log(`💰 Amount: ${entry.amount} BTC`);
            }
            if (entry.inscriptionId) {
              console.log(`🆔 Inscription ID: ${entry.inscriptionId}`);
            }
            if (entry.txid) {
              console.log(`📝 TX ID: ${entry.txid}`);
            }
            if (entry.status) {
              console.log(`📊 Status: ${entry.status}`);
            }
            console.log(`${'═'.repeat(80)}\n`);
          } catch (e) {
            console.log('⚠️  Fehler beim Parsen der Log-Zeile:', line);
          }
        }
      });
    });
    
    lastSize = stats.size;
  }
  
  setTimeout(watchLogFile, 500); // Prüfe alle 500ms
};

watchLogFile();

