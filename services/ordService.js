import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ord-Pfad (Windows: C:\tools\ord.exe, Linux/Mac: ord)
const ORD_PATH = process.platform === 'win32' 
  ? (process.env.ORD_PATH || 'C:\\tools\\ord.exe')
  : (process.env.ORD_PATH || 'ord');

// Bitcoin RPC Konfiguration (aus .env oder Defaults)
const BITCOIN_DATA_DIR = process.env.BITCOIN_DATA_DIR || 'D:\\Bitcoin';
const BITCOIN_COOKIE_FILE = path.join(BITCOIN_DATA_DIR, '.cookie');

// Prüfe ob Cookie-Datei existiert, sonst verwende RPC-Credentials
let ORD_RPC_ARGS = '';
if (fs.existsSync(BITCOIN_COOKIE_FILE)) {
  // Verwende Cookie-Datei (empfohlen)
  // Keine speziellen Index-Flags: Ord verwendet Standard-Index
  ORD_RPC_ARGS = `--cookie-file "${BITCOIN_COOKIE_FILE}" --bitcoin-data-dir "${BITCOIN_DATA_DIR}"`;
} else {
  // Fallback: RPC-Credentials
  const BITCOIN_RPC_URL = process.env.BITCOIN_RPC_URL || 'http://127.0.0.1:8332';
  const BITCOIN_RPC_USER = process.env.BITCOIN_RPC_USER || 'bitcoinuser';
  const BITCOIN_RPC_PASS = process.env.BITCOIN_RPC_PASS || '1oDqGECAjkB3vb8QswiRIVy5uF4ZWgTY';
  ORD_RPC_ARGS = [
    `--bitcoin-rpc-url=${BITCOIN_RPC_URL}`,
    `--bitcoin-rpc-username=${BITCOIN_RPC_USER}`,
    `--bitcoin-rpc-password=${BITCOIN_RPC_PASS}`
  ].join(' ');
}

/**
 * Prüft, ob Ord installiert ist und gibt Status zurück
 */
export async function checkOrdStatus() {
  try {
    // Prüfe Ord-Version
    const { stdout: versionOutput } = await execAsync(`"${ORD_PATH}" --version`);
    const version = versionOutput.trim();
    
    // Prüfe Wallet-Status (versuche Receive Address zu bekommen)
    let walletInfo = null;
    try {
      // Versuche wallet receive, aber ignoriere Server-Sync-Fehler
      const { stdout: addressOutput, stderr: errorOutput } = await execAsync(`"${ORD_PATH}" ${ORD_RPC_ARGS} wallet receive`);
      // Parse Receive Address
      const addressMatch = addressOutput.match(/address:\s*(.+)/i) || addressOutput.match(/(bc1[a-z0-9]+)/i);
      if (addressMatch) {
        walletInfo = {
          address: addressMatch[1].trim(),
          status: 'loaded'
        };
      } else {
        // Prüfe ob Wallet-Datei existiert (Wallet ist erstellt, aber nicht geladen)
        const walletPath = path.join(BITCOIN_DATA_DIR, 'ord', 'wallet.dat');
        if (fs.existsSync(walletPath)) {
          walletInfo = {
            status: 'exists_but_not_loaded',
            error: 'Wallet exists but could not get address. Try: ord wallet receive'
          };
        } else {
          walletInfo = {
            status: 'not_loaded',
            error: 'Could not get receive address'
          };
        }
      }
    } catch (walletError) {
      // Prüfe ob Fehler wegen Server-Sync ist (kann ignoriert werden)
      const errorMsg = walletError.message || walletError.stderr || '';
      if (errorMsg.includes('blocks behind') || errorMsg.includes('no-sync')) {
        // Wallet existiert, aber Server ist nicht synchronisiert
        // Das ist OK für Inskriptionen
        const walletPath = path.join(BITCOIN_DATA_DIR, 'ord', 'wallet.dat');
        if (fs.existsSync(walletPath)) {
          walletInfo = {
            status: 'exists_but_sync_issue',
            error: 'Wallet exists but server sync check failed. Inscriptions should still work.'
          };
        } else {
          walletInfo = {
            status: 'not_loaded',
            error: walletError.message
          };
        }
      } else {
        // Anderer Fehler
        walletInfo = {
          status: 'not_loaded',
          error: walletError.message
        };
      }
    }
    
    return {
      installed: true,
      version,
      wallet: walletInfo,
      ready: walletInfo?.status === 'loaded'
    };
  } catch (error) {
    return {
      installed: false,
      error: error.message,
      ready: false
    };
  }
}

/**
 * Erstellt eine einzelne Inskription mit Ord
 * @param {string} filePath - Pfad zur Datei
 * @param {string} feeRate - Fee Rate in sat/vB
 * @param {string} destination - Empfänger-Adresse
 */
export async function inscribeFile(filePath, feeRate = '1', destination = null) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Korrekte Ord-Syntax: ord [RPC_ARGS] wallet --no-sync inscribe --fee-rate <FEE_RATE> --file <FILE> [--destination <ADDRESS>]
    // --no-sync: Umgeht Synchronisationsprüfungen
    // WICHTIG: Ord-Server muss gestoppt sein, damit Ord direkt mit Bitcoin Core arbeitet
    let command = `"${ORD_PATH}" ${ORD_RPC_ARGS} wallet --no-sync inscribe --fee-rate ${feeRate} --file "${filePath}"`;
    
    if (destination) {
      command += ` --destination ${destination}`;
    }
    
    console.log(`[Ord] Executing command: ${command}`);
    console.log(`[Ord] Starting ord command execution...`);
    
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB Buffer für große Outputs
      timeout: 300000 // 5 Minuten Timeout
    });
    
    console.log(`[Ord] Command output: ${stdout.substring(0, 500)}...`);
    if (stderr) {
      console.log(`[Ord] Command stderr: ${stderr.substring(0, 500)}...`);
    }
    
    // Parse Output für Inscription ID
    // Ord gibt normalerweise etwas wie "inscription abc123...i0" zurück
    const inscriptionMatch = stdout.match(/inscription\s+([a-f0-9]+i\d+)/i) || 
                            stdout.match(/([a-f0-9]{64}i\d+)/);
    
    if (!inscriptionMatch) {
      console.error(`[Ord] Could not parse inscription ID from output: ${stdout}`);
      return {
        success: false,
        error: 'Could not parse inscription ID from ord output',
        output: stdout,
        stderr: stderr || ''
      };
    }
    
    return {
      success: true,
      output: stdout,
      inscriptionId: inscriptionMatch[1],
      rawOutput: stdout,
      stderr: stderr || ''
    };
  } catch (error) {
    console.error(`[Ord] Inscription error: ${error.message}`);
    console.error(`[Ord] Error stdout: ${error.stdout || 'none'}`);
    console.error(`[Ord] Error stderr: ${error.stderr || 'none'}`);
    return {
      success: false,
      error: error.message,
      stderr: error.stderr || '',
      stdout: error.stdout || ''
    };
  }
}

/**
 * Erstellt Batch-Inskriptionen mit Ord
 * @param {Array<string>} filePaths - Array von Dateipfaden
 * @param {string} feeRate - Fee Rate in sat/vB
 * @param {string} destination - Empfänger-Adresse
 */
export async function inscribeBatch(filePaths, feeRate = '1', destination = null) {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      throw new Error('No files provided for batch inscription');
    }
    
    // Prüfe, ob alle Dateien existieren
    for (const filePath of filePaths) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
    }
    
    const results = [];
    
    // Führe Inskriptionen sequenziell aus (Ord unterstützt Batch möglicherweise nicht direkt)
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      console.log(`[Ord Batch] Processing file ${i + 1}/${filePaths.length}: ${filePath}`);
      
      const result = await inscribeFile(filePath, feeRate, destination);
      results.push({
        index: i,
        filePath,
        ...result
      });
      
      // Kleine Pause zwischen Inskriptionen
      if (i < filePaths.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return {
      success: true,
      total: filePaths.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
}

/**
 * Prüft den Status einer Inskription
 * @param {string} inscriptionId - Inskription ID
 */
export async function checkInscriptionStatus(inscriptionId) {
  try {
    const { stdout } = await execAsync(`"${ORD_PATH}" ${ORD_RPC_ARGS} wallet inscriptions`);
    
    // Parse Output für spezifische Inskription
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes(inscriptionId)) {
        return {
          found: true,
          inscriptionId,
          status: 'confirmed', // Vereinfacht, könnte auch 'pending' sein
          details: line.trim()
        };
      }
    }
    
    return {
      found: false,
      inscriptionId,
      status: 'not_found'
    };
  } catch (error) {
    return {
      found: false,
      error: error.message,
      status: 'error'
    };
  }
}


