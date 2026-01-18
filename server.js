import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Force redeploy - Collection Improvements v4 - show_banner Migration + Admin Address + UX Improvements
// Services
import * as delegateRegistry from './services/delegateRegistry.js';
import * as pointsService from './services/pointsService.js';
import * as tradeOfferService from './services/tradeOfferService.js';
import * as blockchainDelegateService from './services/blockchainDelegateService.js';
import * as pointShopService from './services/pointShopService.js';
import * as pointsMigration from './services/pointsMigration.js'; // 💎 Punkte Migration
import * as ordinalTransferService from './services/ordinalTransferService.js';
import * as mintedCardsService from './services/mintedCardsService.js'; // 💣 BOMBENSICHER
import * as pendingCardsUpdateJob from './services/pendingCardsUpdateJob.js'; // 💣 Auto-Update Job
import * as bitcoin from 'bitcoinjs-lib';
import * as collectionService from './services/collectionService.js';
import { initDatabase, createTables, isDatabaseAvailable } from './services/db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
// Erhöhe Body-Limit für große Inskriptions-Listen (z.B. Collection Manager)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Multer für File Uploads
const upload = multer({ storage: multer.memoryStorage() });

// Verzeichnisse
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Konfiguration
const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
const USE_MOCK = process.env.USE_MOCK_INSCRIPTIONS === 'true';
const USE_FIXED_INSCRIPTION_FEE = process.env.USE_FIXED_INSCRIPTION_FEE === 'true';
const FIXED_INSCRIPTION_FEE_BTC = parseFloat(process.env.FIXED_INSCRIPTION_FEE_BTC || '0.0001'); // 10000 sats

// Admin Adressen
// Standard-Adressen (können über ADMIN_ADDRESSES Environment Variable überschrieben werden)
const DEFAULT_ADMIN_ADDRESSES = [
  'bc1pk04c62dkcev08jvmhlecufxtp4xw4af0s9n3vtm8w3dsn9985dhsvpralc',
  '34VvkvWnRw2GVgEQaQZ6fykKbebBHiT4ft',
  'bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj',
  'bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9',
  'bc1pv6vt56dyt5he62gnhyp3c5wqtglethjaegsmc4dxcs702sy6ccxsrhzyuj',
];

// Wenn ADMIN_ADDRESSES als Environment Variable gesetzt ist, verwende diese, sonst die Defaults
console.log('[Server] DEBUG - process.env.ADMIN_ADDRESSES:', process.env.ADMIN_ADDRESSES);
console.log('[Server] DEBUG - DEFAULT_ADMIN_ADDRESSES:', DEFAULT_ADMIN_ADDRESSES);
console.log('[Server] DEBUG - DEFAULT_ADMIN_ADDRESSES length:', DEFAULT_ADMIN_ADDRESSES.length);

const ADMIN_ADDRESSES = process.env.ADMIN_ADDRESSES
  ? process.env.ADMIN_ADDRESSES.split(',').map(addr => addr.trim()).filter(Boolean)
  : DEFAULT_ADMIN_ADDRESSES;

console.log('[Server] ✅ Admin addresses loaded:', ADMIN_ADDRESSES);
console.log('[Server] ✅ Admin addresses count:', ADMIN_ADDRESSES.length);

// Helper: Prüfe ob Admin
function isAdmin(walletAddress) {
  if (!walletAddress) {
    console.log(`[isAdmin] ❌ No wallet address provided`);
    return false;
  }
  // Case-insensitive Vergleich
  const normalizedAddress = walletAddress.toLowerCase().trim();
  const isAdminResult = ADMIN_ADDRESSES.some(addr => addr.toLowerCase().trim() === normalizedAddress);
  if (!isAdminResult) {
    console.log(`[isAdmin] ❌ Access denied: ${walletAddress} (normalized: ${normalizedAddress})`);
    console.log(`[isAdmin] Available admin addresses (${ADMIN_ADDRESSES.length}):`, ADMIN_ADDRESSES);
    console.log(`[isAdmin] Normalized admin addresses:`, ADMIN_ADDRESSES.map(a => a.toLowerCase().trim()));
  } else {
    console.log(`[isAdmin] ✅ Access granted: ${walletAddress} (normalized: ${normalizedAddress})`);
  }
  return isAdminResult;
}

// Helper: parseInscriptionResult
const parseInscriptionResult = (data, fileIndex = 0, orderIdPrefix = '') => {
  // WICHTIG: Speichere die ORIGINALE Order-ID von UniSat (für Status-Checks!)
  // Wir ändern sie nur für Display-Zwecke, aber speichern die originale separat
  let originalOrderId = orderIdPrefix || data.orderId;
  let displayOrderId = originalOrderId;
  
  // Ersetze "ORDIN" durch "BLACK" nur für Display-Zwecke
  if (displayOrderId && displayOrderId.includes('ORDIN')) {
    displayOrderId = displayOrderId.replace(/ORDIN/g, 'BLACK');
  }
  
  // Verwende displayOrderId für Rückgabe, aber speichere originalOrderId
  const orderId = displayOrderId;
  
  // Extrahiere inscriptionId - könnte in verschiedenen Stellen sein
  // WICHTIG: Bei Batch-Requests muss jede Datei eine eindeutige ID bekommen
  let inscriptionId = data.inscriptionId || 
                      data.id ||
                      data.files?.[fileIndex]?.inscriptionId ||
                      data.files?.[fileIndex]?.id ||
                      data.result?.inscriptionId ||
                      data.result?.id ||
                      null;
  
  // Wenn keine ID gefunden, erstelle eine eindeutige pending-ID
  // Bei Batch-Requests: pending-{orderId}-{index} für eindeutige Zuordnung
  if (!inscriptionId || inscriptionId === 'unknown') {
    if (orderId) {
      // WICHTIG: Bei Batch-Requests IMMER Index hinzufügen
      // fileIndex wird vom Aufrufer übergeben (0, 1, 2, ...)
      inscriptionId = `pending-${orderId}-${fileIndex}`;
    } else {
      inscriptionId = 'unknown';
    }
  } else if (inscriptionId && inscriptionId.startsWith('pending-')) {
    // WICHTIG: Wenn bereits eine pending-ID vorhanden ist,
    // dann muss es eine eindeutige ID mit Index sein
    // Prüfe ob Index bereits am Ende vorhanden ist (Format: pending-{orderId}-{index})
    const hasIndexAtEnd = /^pending-[^-]+-\d+$/.test(inscriptionId);
    if (!hasIndexAtEnd && orderId) {
      // Kein Index am Ende vorhanden, füge ihn hinzu
      // WICHTIG: Verwende fileIndex, der vom Aufrufer übergeben wird
      inscriptionId = `pending-${orderId}-${fileIndex}`;
    } else if (!hasIndexAtEnd && !orderId) {
      // Kein orderId, aber pending-ID vorhanden - füge Index hinzu
      inscriptionId = `${inscriptionId}-${fileIndex}`;
    }
  } else if (inscriptionId && !inscriptionId.startsWith('pending-')) {
    // Wenn UniSat bereits eine finale ID zurückgibt, verwende diese
    // Aber nur wenn es keine pending-ID ist
    // (Finale IDs haben Format: {txid}i{index})
    console.log(`[parseInscriptionResult] ✅ Finale ID von UniSat erhalten: ${inscriptionId}`);
  }
  
  // Extrahiere payAddress
  let payAddress = data.payAddress || 
                   data.paymentAddress || 
                   data.payaddress ||
                   data.address ||
                   data.payment?.address ||
                   data.paymentInfo?.address ||
                   data.feeAddress ||
                   null;
  
  // Extrahiere amount
  let amount = data.amount || 
               data.payment?.amount ||
               data.paymentInfo?.amount ||
               data.fee ||
               null;
  
  let amountInBTC = null;
  
  if (amount !== undefined && amount !== null) {
    // Wenn amount > 1, dann ist es wahrscheinlich in Satoshi
    if (amount > 1 && amount < 100000000) {
      amountInBTC = amount / 100000000;
    } else if (amount >= 100000000) {
      amountInBTC = amount / 100000000;
    } else {
      amountInBTC = amount;
    }
    
    // WICHTIG: Bei Batch-Requests kann der Betrag deutlich höher sein (inkl. Miner-Fees)
    // Begrenze nur bei einzelnen Inskriptionen, nicht bei Batch-Requests
    // Ein realistischer Maximalwert wäre ~0.001 BTC (100000 sats) für mehrere Inskriptionen
    const MAX_INSCRIPTION_FEE_BTC = 0.001; // Erhöht von 0.0002 auf 0.001 für Batch-Requests
    if (amountInBTC > MAX_INSCRIPTION_FEE_BTC) {
      console.warn(`[UniSat API] ⚠️ Amount sehr hoch: ${amountInBTC} BTC. Begrenze auf ${MAX_INSCRIPTION_FEE_BTC} BTC`);
      console.warn(`[UniSat API] ⚠️ HINWEIS: Dies könnte bei Batch-Requests problematisch sein!`);
      amountInBTC = MAX_INSCRIPTION_FEE_BTC;
    }
  }
  
  // Fallback: Wenn immer noch kein amount, verwende Standard-Betrag
  if (!amountInBTC && payAddress) {
    amountInBTC = USE_FIXED_INSCRIPTION_FEE ? FIXED_INSCRIPTION_FEE_BTC : 0.0001;
  }
  
  // Wenn USE_FIXED_INSCRIPTION_FEE aktiviert, überschreibe den Betrag
  if (USE_FIXED_INSCRIPTION_FEE && payAddress) {
    amountInBTC = FIXED_INSCRIPTION_FEE_BTC;
  }
  
  return {
    orderId: orderId, // Display-ID (BLACK)
    originalOrderId: originalOrderId, // Original-ID von UniSat (ORDIN) - WICHTIG für Status-Checks!
    payAddress: payAddress,
    amount: amountInBTC,
    txid: data.txid || data.payAddress || data.orderId,
    inscriptionId: inscriptionId,
    status: data.status || 'pending',
  };
};

// Helper: createUniSatInscription
async function createUniSatInscription(file, address, feeRate = 1, postage = 330, delegateMetadata = null) {
  if (USE_MOCK) {
    const mockOrderId = `MOCK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return {
      orderId: mockOrderId,
      inscriptionId: `pending-${mockOrderId}`,
      payAddress: 'bc1pmockaddressforinscriptionfees123456789',
      amount: 0.0001,
      txid: mockOrderId,
      status: 'pending',
    };
  }

  if (!UNISAT_API_KEY) {
    throw new Error('UniSat API key not configured');
  }

  const fileBuffer = Buffer.from(file.buffer);
  const base64Content = fileBuffer.toString('base64');
  
  // Bestimme MIME-Type: HTML für .html Dateien, JSON für .json Dateien, SVG für .svg Dateien, sonst aus Datei
  let mimeType = file.mimetype;
  if (!mimeType) {
    if (file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
      mimeType = 'text/html;charset=utf-8';
    } else if (file.originalname.endsWith('.json')) {
      mimeType = 'application/json';
    } else if (file.originalname.endsWith('.svg')) {
      mimeType = 'image/svg+xml';
    } else {
      // Versuche MIME-Type aus Dateiinhalt zu bestimmen
      const content = fileBuffer.toString('utf-8', 0, Math.min(100, fileBuffer.length));
      if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
        mimeType = 'text/html;charset=utf-8';
      } else if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
        mimeType = 'application/json';
      } else if (content.trim().startsWith('<svg') || content.trim().startsWith('<?xml')) {
        mimeType = 'image/svg+xml';
      } else {
        mimeType = 'text/html;charset=utf-8'; // Default für Delegate-Inskriptionen (HTML)
      }
    }
  }

  // Stelle sicher, dass charset=utf-8 nur einmal vorhanden ist (nicht doppelt!)
  let dataURLMimeType = mimeType;
  if (!mimeType.includes('charset=')) {
    // Füge charset nur hinzu, wenn noch nicht vorhanden
    if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) {
      dataURLMimeType = `${mimeType};charset=utf-8`;
    }
  }

  const filesArray = [{
    filename: file.originalname,
    dataURL: `data:${dataURLMimeType};base64,${base64Content}`
  }];

  const payload = {
    receiveAddress: address,
    feeRate: feeRate,
    outputValue: postage,
    files: filesArray
  };

  console.log(`[UniSat API] 📤 Creating inscription for ${file.originalname} (${file.size} bytes)`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText, raw: errorText };
      }
      const errorMessage = errorData.message || errorData.msg || errorData.error || errorData.raw || response.statusText;
      console.error('[UniSat API] ❌ Error Response:', { status: response.status, errorData });
      throw new Error(`UniSat API error (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    console.log('[UniSat API] 📥 Response received:', JSON.stringify(data, null, 2));

    if (data.code !== 0) {
      const errorMsg = data.msg || data.message || 'UniSat API returned error code';
      console.error('[UniSat API] ❌ API returned error:', errorMsg);
      throw new Error(errorMsg);
    }

    const result = parseInscriptionResult(data.data || data, 0);

    // Registriere Delegate-Inskription (falls Metadaten vorhanden)
    if (delegateMetadata && result.inscriptionId) {
      try {
        const delegateData = typeof delegateMetadata === 'string'
          ? JSON.parse(delegateMetadata)
          : delegateMetadata;

        if (delegateData && delegateData.op === 'delegate' && delegateData.cardId && delegateData.originalInscriptionId) {
          console.log(`[UniSat API] Registering delegate with metadata: ${result.inscriptionId} -> ${delegateData.originalInscriptionId}`);
          
          // ✅ EBENE 1: Registry (Legacy)
          delegateRegistry.registerDelegate(
            result.inscriptionId,
            delegateData.originalInscriptionId,
            delegateData.cardId,
            delegateData.name || 'Unknown',
            delegateData.rarity || 'common',
            address,
            delegateData.cardType || 'animal',
            delegateData.effect,
            delegateData.svgIcon
          );
          
          // 💣 EBENE 2: Database (BOMBENSICHER)
          try {
            await mintedCardsService.saveMintedCard({
              inscriptionId: result.inscriptionId,
              cardId: delegateData.cardId,
              cardName: delegateData.name || 'Unknown',
              rarity: delegateData.rarity || 'common',
              walletAddress: address,
              originalInscriptionId: delegateData.originalInscriptionId,
              cardType: delegateData.cardType || 'animal',
              effect: delegateData.effect,
              svgIcon: delegateData.svgIcon,
              txid: result.txid,
              packType: delegateData.packType,
              collectionId: delegateData.collectionId
            });
            console.log(`[UniSat API] 💣 Saved to DB: ${delegateData.name}`);
          } catch (dbErr) {
            console.warn(`[UniSat API] ⚠️ DB save failed (non-critical):`, dbErr.message);
          }
        }
      } catch (parseErr) {
        console.warn(`[UniSat API] Could not parse delegate metadata:`, parseErr.message);
      }
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('UniSat API request timeout');
    }
    throw error;
  }
}

// ========== API ENDPOINTS ==========

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========== UNISAT INSCRIPTION ENDPOINTS ==========

// Single Inscription
app.post('/api/unisat/inscribe', upload.single('file'), async (req, res) => {
  try {
    const address = req.body.address;
    const feeRate = parseInt(req.body.feeRate, 10) || 1;
    const postage = parseInt(req.body.postage, 10) || 330;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    if (!address) {
      return res.status(400).json({ error: 'No address provided' });
    }

    let delegateMetadata = null;
    if (req.body.delegateMetadata) {
      try {
        delegateMetadata = typeof req.body.delegateMetadata === 'string'
          ? JSON.parse(req.body.delegateMetadata)
          : req.body.delegateMetadata;
      } catch (e) {
        console.warn('[UniSat API] Could not parse delegateMetadata:', e.message);
      }
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📝 INSKRIPTION ANFRAGE`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📄 File: ${file.originalname} (${file.size} bytes)`);
    console.log(`👤 Address: ${address}`);
    console.log(`💰 Fee Rate: ${feeRate} sat/vB`);
    console.log(`📦 Postage: ${postage} sats`);
    console.log(`🔧 Mode: ${USE_MOCK ? '🧪 MOCK' : '✅ PRODUCTION'}`);
    console.log(`${'═'.repeat(80)}\n`);

    const result = await createUniSatInscription(file, address, feeRate, postage, delegateMetadata);

    // Log die Inskription
    const logEntry = {
      timestamp: new Date().toISOString(),
      address,
      orderId: result.orderId,
      txid: result.txid,
      inscriptionId: result.inscriptionId,
      payAddress: result.payAddress,
      amount: result.amount,
      amountSats: result.amount ? Math.round(result.amount * 100000000) : null,
      feeRate,
      postage,
      fileSize: file.size,
      fileName: file.originalname,
      fileCount: 1,
      fileIndex: 1,
      mode: USE_MOCK ? 'mock' : 'production',
      status: result.status || 'pending'
    };

    const logFile = path.join(logsDir, 'inscriptions.log');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`✅ INSKRIPTION ERFOLGREICH ERSTELLT`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📋 Order ID: ${result.orderId}`);
    console.log(`💳 Pay Address: ${result.payAddress || 'FEHLT'}`);
    console.log(`💰 Amount: ${result.amount ? (result.amount * 100000000).toFixed(0) + ' sats' : 'FEHLT'}`);
    console.log(`🆔 Inscription ID: ${result.inscriptionId}`);
    console.log(`${'═'.repeat(80)}\n`);

    res.json({
      status: 'ok',
      result: result
    });
  } catch (error) {
    console.error('[UniSat API] Inskription Fehler:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      status: 'error'
    });
  }
});

// Batch Inscription
app.post('/api/unisat/inscribe/batch', upload.array('files'), async (req, res) => {
  try {
    const address = req.body.address;
    const feeRate = parseInt(req.body.feeRate, 10) || 1;
    const postage = parseInt(req.body.postage, 10) || 330;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }
    if (!address) {
      return res.status(400).json({ error: 'No address provided' });
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`📝 BATCH INSKRIPTION ANFRAGE`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📄 Files: ${files.length} Dateien`);
    files.forEach((file, i) => {
      console.log(`  ${i + 1}. ${file.originalname} (${file.size} bytes)`);
    });
    console.log(`👤 Address: ${address}`);
    console.log(`💰 Fee Rate: ${feeRate} sat/vB`);
    console.log(`📦 Postage: ${postage} sats`);
    console.log(`🔧 Mode: ${USE_MOCK ? '🧪 MOCK' : '✅ PRODUCTION'}`);
    console.log(`${'═'.repeat(80)}\n`);

    let delegateMetadataArray = [];
    if (req.body.delegateMetadata) {
      if (Array.isArray(req.body.delegateMetadata)) {
        delegateMetadataArray = req.body.delegateMetadata;
      } else {
        delegateMetadataArray = [req.body.delegateMetadata];
      }
    }

    // Erstelle filesArray für UniSat API
    // WICHTIG: Für Delegate-Inskriptionen sollte der MIME-Type 'text/html;charset=utf-8' sein!
    // HTML mit <img>-Tag zeigt das Originalbild in Ordinals-Explorern an
    const filesArray = files.map(file => {
      const fileBuffer = Buffer.from(file.buffer);
      const base64Content = fileBuffer.toString('base64');
      
      // Bestimme MIME-Type: HTML für .html Dateien, JSON für .json Dateien, SVG für .svg Dateien, sonst aus Datei
      let mimeType = file.mimetype;
      if (!mimeType) {
        if (file.originalname.endsWith('.html') || file.originalname.endsWith('.htm')) {
          mimeType = 'text/html;charset=utf-8';
        } else if (file.originalname.endsWith('.json')) {
          mimeType = 'application/json';
        } else if (file.originalname.endsWith('.svg')) {
          mimeType = 'image/svg+xml';
        } else {
          // Versuche MIME-Type aus Dateiinhalt zu bestimmen
          const content = fileBuffer.toString('utf-8', 0, Math.min(100, fileBuffer.length));
          if (content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html')) {
            mimeType = 'text/html;charset=utf-8';
          } else if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
            mimeType = 'application/json';
          } else if (content.trim().startsWith('<svg') || content.trim().startsWith('<?xml')) {
            mimeType = 'image/svg+xml';
          } else {
            mimeType = 'text/html;charset=utf-8'; // Default für Delegate-Inskriptionen (HTML)
          }
        }
      }
      
      // Stelle sicher, dass charset=utf-8 nur einmal vorhanden ist (nicht doppelt!)
      let dataURLMimeType = mimeType;
      if (!mimeType.includes('charset=')) {
        // Füge charset nur hinzu, wenn noch nicht vorhanden
        if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) {
          dataURLMimeType = `${mimeType};charset=utf-8`;
        }
      }

      return {
            filename: file.originalname,
        dataURL: `data:${dataURLMimeType};base64,${base64Content}`
      };
    });

    const payload = {
        receiveAddress: address,
      feeRate: feeRate,
      outputValue: postage,
      files: filesArray
    };

    console.log(`[UniSat API] 📦 Batch Inskription: ${files.length} Dateien`);

      const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);
      
    let data;
      try {
        const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/create`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${UNISAT_API_KEY}`,
          'Content-Type': 'application/json',
            'accept': 'application/json',
          },
        body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText, raw: errorText };
          }
          const errorMessage = errorData.message || errorData.msg || errorData.error || errorData.raw || response.statusText;
        console.error('[UniSat API] ❌ Error Response (Batch):', { status: response.status, errorData });
            throw new Error(`UniSat API error (${response.status}): ${errorMessage}`);
          }
          
      data = await response.json();
      console.log('[UniSat API] 📥 Response received (Batch):', JSON.stringify(data, null, 2));
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('UniSat API request timeout');
      }
      throw error;
    }

    let results = [];
    if (data.code === 0 && data.data) {
      const orderId = data.data.orderId || data.orderId;
      
      if (Array.isArray(data.data)) {
        // Fallback: data.data ist ein Array
        results = data.data.map((item, index) => parseInscriptionResult(item, index, orderId));
      } else if (data.data.files && Array.isArray(data.data.files)) {
        // WICHTIG: Bei Batch-Requests hat jede Datei eine eigene Inskription-ID
        // ABER: data.data.amount ist der GESAMTE Betrag für die Batch-Inskription, nicht pro Datei!
        // Extrahiere für jede Datei die entsprechende ID, aber behalte den Gesamtbetrag
        results = data.data.files.map((file, index) => {
          // WICHTIG: Bei Batch-Requests ist amount der Gesamtbetrag in data.data
          // Verwende diesen für alle Dateien, nicht aufgeteilt
          const combinedData = { ...data.data, ...file };
          // Stelle sicher, dass fileIndex korrekt übergeben wird für eindeutige IDs
          const result = parseInscriptionResult(combinedData, index, orderId);
          
          // KRITISCH: Bei Batch-Requests muss amount der GESAMTE Betrag sein (nicht pro Datei!)
          // parseInscriptionResult extrahiert amount aus data.data, was korrekt ist
          
          // KRITISCH: Bei Batch-Requests MUSS jede Datei eine eindeutige ID haben
          // Überschreibe die ID IMMER mit einer eindeutigen ID, die den Index enthält
          if (data.data.files.length > 1) {
            const oldId = result.inscriptionId;
            
            // Prüfe ob die ID bereits den korrekten Index hat (Format: pending-{orderId}-{index})
            const expectedId = orderId ? `pending-${orderId}-${index}` : `pending-${Date.now()}-${index}`;
            const hasCorrectIndex = result.inscriptionId === expectedId || 
                                   (result.inscriptionId && result.inscriptionId.startsWith('pending-') && 
                                    new RegExp(`-${index}$`).test(result.inscriptionId));
            
            if (!hasCorrectIndex) {
              // Überschreibe die ID mit einer eindeutigen ID, die den Index enthält
              result.inscriptionId = expectedId;
              console.log(`[Batch] ⚠️ Datei ${index + 1}/${data.data.files.length}: ID korrigiert: "${oldId}" -> "${result.inscriptionId}"`);
        } else {
              console.log(`[Batch] ✅ Datei ${index + 1}/${data.data.files.length}: ID bereits korrekt: "${result.inscriptionId}"`);
            }
          } else {
            // Einzelne Datei: ID sollte ohne Index sein
            console.log(`[Batch] 📄 Einzelne Datei: ID: "${result.inscriptionId}"`);
          }
          
          return result;
        });
      } else {
        // Einzelne Inskription
        results = [parseInscriptionResult(data.data, 0, orderId)];
      }
    } else {
      const errorMsg = data.msg || data.message || 'UniSat API returned error code for batch inscription';
      console.error('[UniSat API] ❌ API returned error for batch:', errorMsg);
      throw new Error(errorMsg);
    }

    // Stelle sicher, dass wir genauso viele Ergebnisse wie Dateien haben
    if (results.length !== files.length) {
      console.warn(`[Batch] ⚠️ Anzahl Ergebnisse (${results.length}) stimmt nicht mit Anzahl Dateien (${files.length}) überein!`);
      const baseOrderId = results[0]?.orderId || `ORDER-${Date.now()}`;
      while (results.length < files.length) {
        const index = results.length;
        results.push({
          orderId: baseOrderId,
          inscriptionId: `${baseOrderId}-${index}`,
          payAddress: null,
          amount: null,
          txid: baseOrderId,
          status: 'error',
        });
      }
    }

    // Registriere Delegates und logge für jedes Ergebnis
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const file = files[i];
      const delegateMetadata = delegateMetadataArray[i] || null;

      // Registriere Delegate-Inskription (falls Metadaten vorhanden)
      if (delegateMetadata) {
        try {
          const delegateData = typeof delegateMetadata === 'string'
            ? JSON.parse(delegateMetadata)
            : delegateMetadata;

          if (delegateData && delegateData.op === 'delegate' && delegateData.cardId && delegateData.originalInscriptionId) {
            console.log(`[UniSat API] Registering delegate with metadata: ${result.inscriptionId} -> ${delegateData.originalInscriptionId}`);
            
            // ✅ EBENE 1: Registry (Legacy)
            delegateRegistry.registerDelegate(
              result.inscriptionId,
              delegateData.originalInscriptionId,
              delegateData.cardId,
              delegateData.name || 'Unknown',
              delegateData.rarity || 'common',
              address,
              delegateData.cardType || 'animal',
              delegateData.effect,
              delegateData.svgIcon
            );
            
            // 💣 EBENE 2: Database (BOMBENSICHER)
            try {
              await mintedCardsService.saveMintedCard({
                inscriptionId: result.inscriptionId,
                cardId: delegateData.cardId,
                cardName: delegateData.name || 'Unknown',
                rarity: delegateData.rarity || 'common',
                walletAddress: address,
                originalInscriptionId: delegateData.originalInscriptionId,
                cardType: delegateData.cardType || 'animal',
                effect: delegateData.effect,
                svgIcon: delegateData.svgIcon,
                txid: result.txid,
                packType: delegateData.packType,
                collectionId: delegateData.collectionId
              });
              console.log(`[UniSat API] 💣 Saved to DB (batch ${i+1}/${files.length}): ${delegateData.name}`);
            } catch (dbErr) {
              console.warn(`[UniSat API] ⚠️ DB save failed (non-critical):`, dbErr.message);
            }
          }
        } catch (parseErr) {
          console.warn(`[UniSat API] Could not parse delegate metadata for file ${i + 1}:`, parseErr.message);
        }
      }
    
    // Log die Inskription
    const logEntry = {
      timestamp: new Date().toISOString(),
      address,
      orderId: result.orderId,
      txid: result.txid,
      inscriptionId: result.inscriptionId,
        payAddress: result.payAddress,
        amount: result.amount,
        amountSats: result.amount ? Math.round(result.amount * 100000000) : null,
      feeRate,
        postage,
      fileSize: file.size,
      fileName: file.originalname,
      fileCount: files.length,
        fileIndex: i + 1,
        mode: USE_MOCK ? 'mock' : 'production',
        status: result.status || 'pending'
    };
    
    const logFile = path.join(logsDir, 'inscriptions.log');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`✅ BATCH INSKRIPTIONEN ERFOLGREICH ERSTELLT`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📋 Anzahl: ${results.length} Inskriptionen`);
    results.forEach((result, i) => {
      console.log(`  ${i + 1}. Order ID: ${result.orderId} | Pay Address: ${result.payAddress || 'FEHLT'} | Inscription ID: ${result.inscriptionId}`);
    });
    console.log(`${'═'.repeat(80)}\n`);

    res.json({
      status: 'ok',
      results: results,
      count: results.length
    });
  } catch (error) {
    console.error('[UniSat API] Batch-Inskription Fehler:', error);
    res.status(500).json({
      error: error.message || 'Internal server error',
      status: 'error'
    });
  }
});

// Check Pending Inscriptions
app.post('/api/unisat/check-pending-inscriptions', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    console.log(`[Check Pending] 🔍 Checking pending inscriptions for: ${walletAddress}`);

    // Hole alle pending Delegates aus der Registry
    const allDelegates = delegateRegistry.getAllDelegates();
    const pendingDelegates = Object.entries(allDelegates)
      .filter(([id, data]) => id.startsWith('pending-') && data.walletAddress === walletAddress)
      .map(([id, data]) => ({ inscriptionId: id, ...data }));

    console.log(`[Check Pending] Found ${pendingDelegates.length} pending delegates`);

    const updated = [];
    const notFound = [];

    for (const delegate of pendingDelegates) {
      // Extrahiere Order-ID und Index aus pending-ID
      // Format: pending-{orderId} oder pending-{orderId}-{index}
      let orderId = delegate.inscriptionId.replace('pending-', '');
      let fileIndex = 0;
      
      // Prüfe ob Index vorhanden ist (Format: pending-{orderId}-{index})
      const indexMatch = orderId.match(/^(.+)-(\d+)$/);
      if (indexMatch) {
        orderId = indexMatch[1];
        fileIndex = parseInt(indexMatch[2], 10);
      }
      
      // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat-Status-Check!
      // UniSat kennt nur die originale Order-ID mit "ORDIN", nicht unsere Display-ID mit "BLACK"
      let unisatOrderId = orderId;
      if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
        unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
        console.log(`[Check Pending] ⚠️ Order-ID geändert für UniSat: "${orderId}" -> "${unisatOrderId}"`);
      }
      
      // Methode 1: Prüfe Order-Status bei UniSat (mit originaler ID)
      let found = false;
      try {
        const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/query`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${UNISAT_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ orderId: unisatOrderId }), // WICHTIG: Verwende originalOrderId!
        });

        if (response.ok) {
          const orderData = await response.json();
          if (orderData.code === 0 && orderData.data) {
            const files = orderData.data.files || [];
            
            // WICHTIG: Prüfe die entsprechende Datei basierend auf fileIndex
            if (files.length > fileIndex) {
              const file = files[fileIndex];
              const finalId = file.inscriptionId || 
                            file.id ||
                            (fileIndex === 0 ? (orderData.data.inscriptionId || orderData.data.id) : null);
              
              if (finalId && !finalId.startsWith('pending-')) {
                console.log(`[Check Pending] ✅ Finale ID gefunden für Index ${fileIndex}: ${delegate.inscriptionId} -> ${finalId}`);
                delegateRegistry.updateDelegateInscriptionId(delegate.inscriptionId, finalId);
                updated.push({ oldId: delegate.inscriptionId, newId: finalId });
                found = true;
              }
            } else if (files.length === 1 && fileIndex === 0) {
              // Fallback: Wenn nur eine Datei vorhanden, verwende sie
              const file = files[0];
              const finalId = file.inscriptionId || file.id || orderData.data.inscriptionId || orderData.data.id;
              
              if (finalId && !finalId.startsWith('pending-')) {
                console.log(`[Check Pending] ✅ Finale ID gefunden (Fallback): ${delegate.inscriptionId} -> ${finalId}`);
                delegateRegistry.updateDelegateInscriptionId(delegate.inscriptionId, finalId);
                updated.push({ oldId: delegate.inscriptionId, newId: finalId });
                found = true;
              }
            }
          }
        } else if (response.status !== 404) {
          console.warn(`[Check Pending] Order query returned ${response.status} for ${orderId}`);
        }
      } catch (err) {
        console.warn(`[Check Pending] Error querying order ${orderId}:`, err.message);
      }

      // Methode 2: Suche auf der Blockchain
      if (!found) {
        try {
          const inscriptions = await blockchainDelegateService.getInscriptionsByAddress(walletAddress);
          const originalId = delegate.originalInscriptionId;
          
          // Suche nach Inskriptionen, die nach dem Order-Timestamp erstellt wurden
          for (const inscription of inscriptions) {
            try {
              const content = await blockchainDelegateService.getInscriptionContent(inscription.inscriptionId);
              if (content && (content.includes(originalId) || content.includes(delegate.cardId))) {
                // Prüfe ob es SVG ist (für Image-Delegates)
                if (content.trim().startsWith('<svg') || content.trim().startsWith('<?xml')) {
                  delegateRegistry.updateDelegateInscriptionId(delegate.inscriptionId, inscription.inscriptionId);
                  updated.push({ oldId: delegate.inscriptionId, newId: inscription.inscriptionId });
                  found = true;
                  break;
                }
              }
            } catch (contentErr) {
              // Ignoriere Content-Fehler
            }
          }
        } catch (chainErr) {
          console.warn(`[Check Pending] Error searching chain:`, chainErr.message);
        }
      }

      if (!found) {
        notFound.push(delegate.inscriptionId);
      }
    }

    res.json({
      status: 'ok',
      checked: pendingDelegates.length,
      updated: updated.length,
      notFound: notFound.length,
      updates: updated,
      pending: notFound
    });
  } catch (error) {
    console.error('[Check Pending] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Check Order Status
app.post('/api/unisat/check-order-status', async (req, res) => {
  try {
    let { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat-Status-Check!
    // UniSat kennt nur die originale Order-ID mit "ORDIN", nicht unsere Display-ID mit "BLACK"
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Order Status] ⚠️ Order-ID geändert für UniSat: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Order Status] 🔍 Checking order: ${orderId} (UniSat: ${unisatOrderId})`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId: unisatOrderId }), // WICHTIG: Verwende originalOrderId!
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        orderFound: false
      });
    }

    const data = await response.json();
    
    if (data.code === 0 && data.data) {
      const orderData = data.data;
      const finalId = orderData.files?.[0]?.inscriptionId || 
                    orderData.inscriptionId ||
                    orderData.files?.[0]?.id ||
                    orderData.id;

      // Prüfe ob Inskription auf Chain existiert
      let onChain = false;
      if (finalId && !finalId.startsWith('pending-')) {
        try {
          const details = await blockchainDelegateService.getInscriptionDetails(finalId);
          onChain = details !== null;
        } catch (err) {
          // Ignoriere Fehler
        }
      }

      res.json({
        orderId,
        orderFound: true,
        status: orderData.status || 'unknown',
        payAddress: orderData.payAddress || orderData.paymentAddress,
        amount: orderData.amount,
        finalInscriptionId: finalId || null,
        onChain,
        orderData: {
          status: orderData.status,
          files: orderData.files?.length || 0,
        }
      });
    } else {
      res.json({
        orderId,
        orderFound: false,
        error: data.msg || data.message || 'Order not found'
      });
    }
  } catch (error) {
    console.error('[Order Status] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Check Order Payment
app.post('/api/unisat/check-order-payment', async (req, res) => {
  try {
    const { orderId, paymentTxid, walletAddress } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }
    
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }
    
    console.log(`[Order Payment Check] 🔍 Checking order: ${orderId}`);
    if (paymentTxid) {
      console.log(`[Order Payment Check] 💰 Payment TXID: ${paymentTxid}`);
    }
    
    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat-Status-Check!
    // UniSat kennt nur die originale Order-ID mit "ORDIN", nicht unsere Display-ID mit "BLACK"
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Order Payment Check] ⚠️ Order-ID geändert für UniSat: "${orderId}" -> "${unisatOrderId}"`);
    }
    
    // Prüfe Order-Status bei UniSat (mit originaler ID)
    const statusUrls = [
      `${UNISAT_API_URL}/v2/inscribe/order/${unisatOrderId}`,
      `${UNISAT_API_URL}/v1/inscribe/order/${unisatOrderId}`,
    ];
    
    let orderData = null;
    let finalInscriptionId = null;
    
    for (const statusUrl of statusUrls) {
      try {
        console.log(`[Order Payment Check] Trying: ${statusUrl}`);
        
        const statusResponse = await fetch(statusUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${UNISAT_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          console.log(`[Order Payment Check] Response:`, JSON.stringify(statusData, null, 2));
          
          if (statusData.code === 0 && statusData.data) {
            orderData = statusData.data;
            
            // Extrahiere finale Inskription-ID
            finalInscriptionId = orderData.files?.[0]?.inscriptionId || 
                                orderData.inscriptionId ||
                                orderData.files?.[0]?.id ||
                                orderData.id ||
                                null;
            
            break;
          }
        }
      } catch (urlErr) {
        console.log(`[Order Payment Check] Endpoint ${statusUrl} failed: ${urlErr.message}`);
        continue;
      }
    }
    
    // Prüfe ob Zahlung angekommen ist
    let paymentReceived = false;
    let paymentStatus = 'unknown';
    
    if (orderData) {
      // Prüfe verschiedene Felder für Zahlungsstatus
      paymentStatus = orderData.status || orderData.paymentStatus || 'unknown';
      paymentReceived = paymentStatus === 'paid' || 
                       paymentStatus === 'inscribed' ||
                       orderData.paid === true ||
                       (orderData.payment && orderData.payment.status === 'paid');
      
      console.log(`[Order Payment Check] Payment status: ${paymentStatus}, Received: ${paymentReceived}`);
    }
    
    // Prüfe ob Inskription bereits erstellt wurde
    let inscriptionCreated = false;
    if (finalInscriptionId && !finalInscriptionId.startsWith('pending-')) {
      inscriptionCreated = true;
      console.log(`[Order Payment Check] ✅ Inscription created: ${finalInscriptionId}`);
    }
    
    res.json({
        orderId, // Display-ID (BLACK)
        unisatOrderId, // Original-ID von UniSat (ORDIN)
        paymentTxid: paymentTxid || null,
        orderFound: orderData !== null,
        paymentReceived,
        paymentStatus,
        inscriptionCreated,
        finalInscriptionId: finalInscriptionId || null,
        orderData: orderData ? {
          status: orderData.status,
          payAddress: orderData.payAddress || orderData.paymentAddress,
          amount: orderData.amount,
          files: orderData.files?.length || 0,
        } : null,
      });
  } catch (error) {
    console.error('[Order Payment Check] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Test: Diagnose Order Status
app.post('/api/test/check-order', async (req, res) => {
  try {
    const { orderId, paymentTxid } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat-Status-Check!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Test] ⚠️ Order-ID geändert für UniSat: "${orderId}" -> "${unisatOrderId}"`);
    }
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 DIAGNOSE: Order Status für ${orderId} (UniSat: ${unisatOrderId})`);
    console.log(`${'═'.repeat(80)}`);
    
    // Test 1: Prüfe mit POST /v2/inscribe/order/query
    console.log(`\n[Test 1] POST /v2/inscribe/order/query`);
    try {
      const queryResponse = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${UNISAT_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ orderId: unisatOrderId }), // WICHTIG: Verwende originalOrderId!
      });
      
      const queryData = await queryResponse.json();
      console.log(`Status: ${queryResponse.status}`);
      console.log(`Response:`, JSON.stringify(queryData, null, 2));
    } catch (err) {
      console.error(`❌ Error:`, err.message);
    }
    
    // Test 2: Prüfe mit GET /v2/inscribe/order/{orderId}
    console.log(`\n[Test 2] GET /v2/inscribe/order/${unisatOrderId}`);
    try {
      const getResponse = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/${unisatOrderId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${UNISAT_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      const getData = await getResponse.json();
      console.log(`Status: ${getResponse.status}`);
      console.log(`Response:`, JSON.stringify(getData, null, 2));
    } catch (err) {
      console.error(`❌ Error:`, err.message);
    }
    
    // Test 3: Prüfe mit GET /v1/inscribe/order/{orderId}
    console.log(`\n[Test 3] GET /v1/inscribe/order/${unisatOrderId}`);
    try {
      const v1Response = await fetch(`${UNISAT_API_URL}/v1/inscribe/order/${unisatOrderId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${UNISAT_API_KEY}`,
          'Content-Type': 'application/json',
        },
      });
      
      const v1Data = await v1Response.json();
      console.log(`Status: ${v1Response.status}`);
      console.log(`Response:`, JSON.stringify(v1Data, null, 2));
    } catch (err) {
      console.error(`❌ Error:`, err.message);
    }
    
    if (paymentTxid) {
      console.log(`\n[Payment Info] TXID: ${paymentTxid}`);
      // Prüfe Transaktion auf Blockchain
      try {
        const txResponse = await fetch(`https://mempool.space/api/tx/${paymentTxid}`);
        if (txResponse.ok) {
          const txData = await txResponse.json();
          console.log(`Transaction Status: confirmed=${txData.status?.confirmed || false}`);
          console.log(`Outputs:`, txData.vout?.map((v, i) => `${i}: ${v.value} sats to ${v.scriptpubkey_address}`).join(', '));
        }
      } catch (txErr) {
        console.error(`❌ Error checking TX:`, txErr.message);
      }
    }
    
    console.log(`${'═'.repeat(80)}\n`);
    
    res.json({ 
      message: 'Diagnose abgeschlossen - siehe Backend-Logs',
      orderId,
      paymentTxid: paymentTxid || null
    });
  } catch (error) {
    console.error('[Test] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Check if inscription is a delegate and return originalInscriptionId
// This endpoint is called by the frontend for HTML inscriptions that might be delegates
app.get('/api/inscription/check-delegate/:inscriptionId', async (req, res) => {
  try {
    const { inscriptionId } = req.params;
    console.log(`[DelegateCheck] 🔍 Checking if ${inscriptionId} is a delegate inscription...`);
    
    let isDelegate = false;
    let originalInscriptionId = null;
    
    // 1. Prüfe Registry (schnellste Methode)
    try {
      const delegateData = delegateRegistry.getDelegateCardData(inscriptionId);
      if (delegateData && delegateData.originalInscriptionId) {
        isDelegate = true;
        originalInscriptionId = delegateData.originalInscriptionId;
        console.log(`[DelegateCheck] ✅ Found in registry: ${inscriptionId} -> Original: ${originalInscriptionId}`);
        return res.json({ isDelegate: true, originalInscriptionId });
      }
    } catch (err) {
      console.log(`[DelegateCheck] ⚠️ Registry check failed:`, err.message);
    }
    
    // 2. Prüfe Content direkt von ordinals.com (nur wenn Registry-Check fehlgeschlagen ist)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const directResponse = await fetch(`https://ordinals.com/content/${inscriptionId}`, {
        method: 'GET',
        headers: { 'Accept': 'text/html,application/json,*/*' },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (directResponse.ok) {
        const directContentType = directResponse.headers.get('content-type') || '';
        
        if (directContentType.includes('text/html') || directContentType.includes('application/json') || directContentType.includes('text/')) {
          const directContent = await directResponse.text();
          
          // Prüfe delegate-metadata
          if (directContent && directContent.includes('delegate-metadata')) {
            const metadataMatch = directContent.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
            if (metadataMatch) {
              try {
                const metadata = JSON.parse(metadataMatch[1]);
                if (metadata.originalInscriptionId) {
                  isDelegate = true;
                  originalInscriptionId = metadata.originalInscriptionId;
                  console.log(`[DelegateCheck] ✅ Extracted from delegate-metadata: ${inscriptionId} -> Original: ${originalInscriptionId}`);
                  return res.json({ isDelegate: true, originalInscriptionId });
                }
              } catch (parseErr) {
                // Ignoriere Parse-Fehler
              }
            }
          }
          
          // Prüfe <img> Tag mit /content/ Referenz
          if (directContent && (directContent.includes('<img') || directContent.includes('/content/'))) {
            const imgMatch = directContent.match(/\/content\/([a-f0-9]{64}i\d+)/i);
            if (imgMatch && imgMatch[1] && imgMatch[1] !== inscriptionId) {
              isDelegate = true;
              originalInscriptionId = imgMatch[1];
              console.log(`[DelegateCheck] ✅ Extracted from <img> tag: ${inscriptionId} -> Original: ${originalInscriptionId}`);
              return res.json({ isDelegate: true, originalInscriptionId });
            }
          }
        }
      }
    } catch (fetchErr) {
      console.log(`[DelegateCheck] ⚠️ Content fetch failed:`, fetchErr.message);
    }
    
    // Keine Delegate-Inskription gefunden
    console.log(`[DelegateCheck] ❌ ${inscriptionId} is not a delegate inscription`);
    return res.json({ isDelegate: false, originalInscriptionId: null });
    
  } catch (error) {
    console.error(`[DelegateCheck] ❌ Error checking delegate:`, error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Inscription Image
app.get('/api/inscription/image/:inscriptionId', async (req, res) => {
  try {
    const { inscriptionId } = req.params;
    console.log(`[Image] 📥 Request for inscription image: ${inscriptionId}`);
    
    // Wenn es eine "pending-" ID ist, hole die originalInscriptionId aus der Registry
    let targetInscriptionId = inscriptionId;
    if (inscriptionId.startsWith('pending-')) {
      const delegateData = delegateRegistry.getDelegateCardData(inscriptionId);
      if (delegateData && delegateData.originalInscriptionId) {
        targetInscriptionId = delegateData.originalInscriptionId;
        console.log(`[Image] ✅ Resolved pending ID ${inscriptionId} to ${targetInscriptionId}`);
      }
    } else {
      // Für finale IDs: Prüfe ob es eine Delegate-Inskription (HTML mit originalInscriptionId) ist
      // ODER ob es eine Original-HTML-Inskription ist
      
      // ZUERST: Versuche Registry (schnellste Methode)
      const delegateData = delegateRegistry.getDelegateCardData(inscriptionId);
      if (delegateData && delegateData.originalInscriptionId) {
        targetInscriptionId = delegateData.originalInscriptionId;
        console.log(`[Image] ✅ Resolved delegate ID ${inscriptionId} to original ${targetInscriptionId} (from registry)`);
      } else {
        // Prüfe ob es eine Delegate-Inskription ist (hat originalInscriptionId in Metadaten)
        // ODER ob es eine Original-HTML-Inskription ist (hat KEINE originalInscriptionId)
        console.log(`[Image] 🔍 Checking if ${inscriptionId} is delegate or original HTML...`);
        try {
          // Versuche zuerst direkt von ordinals.com (schneller)
          let content = null;
          let contentType = null;
          try {
            const directResponse = await fetch(`https://ordinals.com/content/${inscriptionId}`);
            if (directResponse.ok) {
              contentType = directResponse.headers.get('content-type') || '';
              content = await directResponse.text();
              console.log(`[Image] 📄 Fetched content from ordinals.com (${content.length} bytes, ${contentType})`);
            }
          } catch (directErr) {
            console.warn(`[Image] ⚠️ Direct fetch failed, trying UniSat API:`, directErr.message);
          }
          
          // Fallback zu UniSat API
          if (!content) {
            content = await blockchainDelegateService.getInscriptionContent(inscriptionId);
            if (content) {
              console.log(`[Image] 📄 Fetched content from UniSat API (${content.length} bytes)`);
            }
          }
          
          if (content) {
            const isHTML = content.includes('<!DOCTYPE') || content.includes('<html') || contentType?.includes('text/html');
            
            // Methode 1: Prüfe ob es HTML mit Delegate-Metadaten im <script> Tag ist
            if (isHTML && content.includes('<script') && content.includes('delegate-metadata')) {
              const scriptMatch = content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
              if (scriptMatch && scriptMatch[1]) {
                try {
                  const metadata = JSON.parse(scriptMatch[1].trim());
                  if (metadata.originalInscriptionId) {
                    targetInscriptionId = metadata.originalInscriptionId;
                    console.log(`[Image] ✅ Extracted original ID ${targetInscriptionId} from delegate-metadata script tag`);
                    // Es ist eine Delegate-Inskription, verwende die Original-ID
                  } else {
                    // Es ist eine Original-HTML-Inskription (kein originalInscriptionId in Metadaten)
                    console.log(`[Image] 📄 Detected original HTML inscription (no originalInscriptionId in metadata)`);
                    // targetInscriptionId bleibt = inscriptionId (ist bereits Original)
                  }
                } catch (parseErr) {
                  console.warn(`[Image] ⚠️ Could not parse delegate-metadata:`, parseErr.message);
                }
              }
            }
            
            // Methode 2: Prüfe ob es ein <img> Tag mit /content/ Referenz gibt (Delegate-Indikator)
            // WICHTIG: Führe diese Extraktion NUR aus, wenn targetInscriptionId noch die ursprüngliche ID ist
            // UND wenn es HTML ist UND wenn es KEINE delegate-metadata gibt
            if (targetInscriptionId === inscriptionId && isHTML && !content.includes('delegate-metadata')) {
              console.log(`[Image] 🔍 Checking for <img> tag with /content/ reference...`);
              
              // Versuche verschiedene Regex-Patterns für <img> Tags
              const imgPatterns = [
                /<img[^>]*src=["']\/content\/([^"']+)["']/i,
                /<img[^>]*src=["']\/content\/([a-f0-9]+i\d+)["']/i,
                /src=["']\/content\/([a-f0-9]+i\d+)["']/i,
              ];
              
              let extracted = false;
              for (const pattern of imgPatterns) {
                const imgMatch = content.match(pattern);
                if (imgMatch && imgMatch[1]) {
                  targetInscriptionId = imgMatch[1];
                  console.log(`[Image] ✅ Extracted original ID ${targetInscriptionId} from <img> tag using pattern`);
                  extracted = true;
                  break;
                }
              }
              
              // Wenn immer noch nicht gefunden, versuche manuell zu suchen (einfacher Pattern)
              if (!extracted) {
                const contentMatch = content.match(/\/content\/([a-f0-9]{64}i\d+)/i);
                if (contentMatch && contentMatch[1]) {
                  targetInscriptionId = contentMatch[1];
                  console.log(`[Image] ✅ Extracted original ID ${targetInscriptionId} using manual search`);
                  extracted = true;
                }
              }
              
              if (!extracted) {
                // Keine originalInscriptionId gefunden = Es ist eine Original-HTML-Inskription
                console.log(`[Image] 📄 No originalInscriptionId found in HTML - this is an original HTML inscription`);
                // targetInscriptionId bleibt = inscriptionId (ist bereits Original)
              }
            } else if (targetInscriptionId === inscriptionId && !isHTML) {
              // Nicht HTML = wahrscheinlich ein Bild, verwende direkt
              console.log(`[Image] 📄 Content is not HTML (${contentType}), treating as image`);
            }
            
            // Wenn immer noch nicht gefunden, logge den Content zur Debugging
            if (targetInscriptionId === inscriptionId && isHTML) {
              console.log(`[Image] 📄 Determined: ${inscriptionId} is an original HTML inscription`);
            }
          } else {
            console.warn(`[Image] ⚠️ Could not fetch content for ${inscriptionId}`);
          }
        } catch (contentErr) {
          console.error(`[Image] ❌ Error fetching content for extraction:`, contentErr.message);
        }
      }
    }

    console.log(`[Image] 🎯 Target inscription ID: ${targetInscriptionId} (original: ${inscriptionId})`);
    
    // Prüfe zuerst, ob es eine Original-HTML-Inskription ist (kein Delegate)
    // Wenn targetInscriptionId === inscriptionId UND wir kein originalInscriptionId in der Registry haben,
    // könnte es eine Original-HTML-Inskription sein
    const isOriginalHTML = targetInscriptionId === inscriptionId;
    
    // Für Original-HTML-Inskriptionen: Hole Content und prüfe ob es HTML ist
    if (isOriginalHTML) {
      try {
        console.log(`[Image] 📄 Checking if ${inscriptionId} is an original HTML inscription...`);
        const contentResponse = await fetch(`https://ordinals.com/content/${inscriptionId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        
        if (contentResponse.ok) {
          const contentType = contentResponse.headers.get('content-type') || '';
          const content = await contentResponse.text();
          const isHTML = content.includes('<!DOCTYPE') || content.includes('<html') || contentType.includes('text/html');
          
          if (isHTML) {
            console.log(`[Image] ✅ Confirmed: ${inscriptionId} is an original HTML inscription`);
            // Für HTML-Inskriptionen: Versuche UniSat API für Preview-Feld
            try {
              // Versuche UniSat API für Inskriptions-Info (hat preview Feld)
              if (UNISAT_API_KEY && UNISAT_API_URL) {
                console.log(`[Image] 🔍 Trying UniSat API for preview field...`);
                const unisatResponse = await fetch(`${UNISAT_API_URL}/v1/indexer/inscription/info/${inscriptionId}`, {
                  headers: {
                    'Authorization': `Bearer ${UNISAT_API_KEY}`,
                    'Content-Type': 'application/json',
                  },
                });
                if (unisatResponse.ok) {
                  const unisatData = await unisatResponse.json();
                  console.log(`[Image] UniSat API response:`, JSON.stringify(unisatData).substring(0, 200));
                  if (unisatData.code === 0 && unisatData.data) {
                    // UniSat API hat möglicherweise ein preview Feld
                    if (unisatData.data.preview) {
                      console.log(`[Image] ✅ Found preview URL from UniSat API: ${unisatData.data.preview}`);
                      res.setHeader('Location', unisatData.data.preview);
                      res.setHeader('Cache-Control', 'public, max-age=3600');
                      res.setHeader('Access-Control-Allow-Origin', '*');
                      return res.redirect(302, unisatData.data.preview);
                    }
                    // Wenn kein preview Feld, aber contentType vorhanden, prüfe ob es ein Bild ist
                    if (unisatData.data.contentType && unisatData.data.contentType.includes('image')) {
                      // Es ist kein HTML, sondern ein Bild - verwende content
                      const imageResponse = await fetch(`https://ordinals.com/content/${inscriptionId}`);
                      if (imageResponse.ok) {
                        const imageContent = await imageResponse.text();
                        res.setHeader('Content-Type', unisatData.data.contentType || 'image/png');
                        res.setHeader('Cache-Control', 'public, max-age=3600');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        return res.send(imageContent);
                      }
                    }
                  }
                }
              }
            } catch (unisatErr) {
              console.warn(`[Image] ⚠️ Could not fetch UniSat API preview:`, unisatErr.message);
            }
            
            // Fallback: Für HTML-Inskriptionen ohne Preview, gib 404 zurück
            // Das Frontend wird dann den Platzhalter anzeigen
            console.log(`[Image] ❌ No preview available for HTML inscription ${inscriptionId}`);
            res.status(404).json({ 
              error: 'No preview available for HTML inscription',
              inscriptionId: inscriptionId,
              type: 'html'
            });
            return;
          }
        }
      } catch (contentErr) {
        console.warn(`[Image] ⚠️ Could not check content type:`, contentErr.message);
      }
    }
    
    // Versuche verschiedene Quellen für das Original-Bild
    const sources = [
      `https://ordinals.com/content/${targetInscriptionId}`,
      `https://ordinals.com/preview/${targetInscriptionId}`,
      `https://ordiscan.com/content/${targetInscriptionId}`,
    ];

    for (const source of sources) {
      try {
        console.log(`[Image] 🔍 Trying source: ${source}`);
        const response = await fetch(source, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          const content = await response.text();
          
          // Prüfe ob es HTML ist
          const isHTML = content.includes('<!DOCTYPE') || content.includes('<html') || contentType.includes('text/html');
          
          // Wenn es HTML ist und es eine Original-HTML-Inskription ist
          if (isHTML && isOriginalHTML) {
            console.log(`[Image] 📄 Original HTML inscription detected: ${targetInscriptionId}`);
            
            // Versuche Preview-URL, die ein Screenshot/Thumbnail liefern sollte
            if (source.includes('/preview/')) {
              // Wenn wir bereits die Preview-URL probieren und sie HTML zurückgibt,
              // verwende stattdessen die Preview als Proxy/Redirect
              console.log(`[Image] ⚠️ Preview URL returned HTML, will try alternative approach`);
              continue;
            }
            
            // Für Content-URL: Versuche Preview-URL separat
            try {
              const previewResponse = await fetch(`https://ordinals.com/preview/${targetInscriptionId}`, {
                headers: {
                  'User-Agent': 'Mozilla/5.0',
                },
              });
              if (previewResponse.ok) {
                const previewContentType = previewResponse.headers.get('content-type') || '';
                const previewContent = await previewResponse.text();
                
                // Prüfe ob die Preview ein Bild ist (nicht HTML)
                if (!previewContent.includes('<!DOCTYPE') && !previewContent.includes('<html') && 
                    (previewContentType.includes('image') || previewContent.trim().startsWith('<svg') || previewContent.length < 10000)) {
                  console.log(`[Image] ✅ Found preview image for HTML inscription (${previewContentType}, ${previewContent.length} bytes)`);
                  res.setHeader('Content-Type', previewContentType.includes('image') ? previewContentType : 'image/png');
                  res.setHeader('Cache-Control', 'public, max-age=3600');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  return res.send(previewContent);
                }
              }
            } catch (previewErr) {
              console.warn(`[Image] ⚠️ Could not fetch preview:`, previewErr.message);
            }
            
            // Wenn Preview nicht funktioniert oder auch HTML ist, verwende Preview-URL als Redirect
            console.log(`[Image] 📄 Redirecting to preview URL for HTML inscription`);
            res.setHeader('Location', `https://ordinals.com/preview/${targetInscriptionId}`);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.redirect(302, `https://ordinals.com/preview/${targetInscriptionId}`);
          }
          
          // Wenn es HTML ist und KEINE Original-Inskription, dann ist es eine Delegate-Inskription - skip
          if (isHTML && !isOriginalHTML) {
            console.log(`[Image] ⚠️ Source returned HTML delegate (${content.length} bytes), skipping: ${source}`);
            continue;
          }
          
          // Prüfe ob es ein Bild ist
          if (contentType.includes('svg') || contentType.includes('image') || content.trim().startsWith('<svg')) {
            console.log(`[Image] ✅ Found image at ${source} (${contentType}, ${content.length} bytes)`);
            res.setHeader('Content-Type', contentType || 'image/svg+xml');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.send(content);
          } else {
            console.log(`[Image] ⚠️ Source returned non-image content (${contentType}, ${content.length} bytes), skipping: ${source}`);
          }
        } else {
          console.log(`[Image] ⚠️ Source returned ${response.status}: ${source}`);
        }
      } catch (err) {
        console.warn(`[Image] ⚠️ Error fetching ${source}:`, err.message);
        continue;
      }
    }
    
    // Wenn keine der Quellen funktioniert hat und es eine Original-HTML-Inskription ist, 
    // versuche Preview-URL als letzten Fallback
    if (isOriginalHTML) {
      console.log(`[Image] 📄 All sources failed, redirecting to preview URL as last resort: ${targetInscriptionId}`);
      res.setHeader('Location', `https://ordinals.com/preview/${targetInscriptionId}`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.redirect(302, `https://ordinals.com/preview/${targetInscriptionId}`);
    }

    // Fallback: Versuche UniSat API
    try {
      const content = await blockchainDelegateService.getInscriptionContent(targetInscriptionId);
      if (content) {
        // Prüfe ob es ein Bild ist (nicht HTML)
        if (!content.includes('<!DOCTYPE') && !content.includes('<html')) {
          res.setHeader('Content-Type', 'image/svg+xml');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(content);
        }
      }
    } catch (err) {
      // Ignoriere Fehler
    }

    res.status(404).json({ error: 'Image not found' });
  } catch (error) {
    console.error('[Image] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== DELEGATE ENDPOINTS ==========

// Get Delegates by Wallet
// 💣 BOMBENSICHER: 3-Ebenen-System für Delegates
app.get('/api/delegates/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const useHybrid = req.query.hybrid === 'true';

    // ✅ EBENE 1: PostgreSQL (primär, bombensicher)
    console.log(`[Delegates API] 🔍 Fetching cards for ${walletAddress} (hybrid: ${useHybrid})`);
    
    try {
      const delegates = await mintedCardsService.getWalletCards(walletAddress, true);
      
      if (delegates.length > 0) {
        console.log(`[Delegates API] ✅ DB: Returning ${delegates.length} cards`);
        return res.json({ 
          delegates, 
          count: delegates.length, 
          source: 'database' 
        });
      }
      
      console.log(`[Delegates API] ℹ️ DB: No cards found, trying fallback...`);
    } catch (dbErr) {
      console.warn(`[Delegates API] ⚠️ DB error, trying fallback:`, dbErr.message);
    }

    // ⚠️ EBENE 2: Blockchain (wenn DB leer oder fehlgeschlagen)
    if (useHybrid) {
      console.log(`[Delegates API] 🔄 Blockchain: Fetching with hybrid mode...`);
      const delegates = await blockchainDelegateService.getDelegatesHybrid(walletAddress);
      
      // 🔄 AUTO-SYNC: Speichere gefundene Delegates in DB für nächste Abfrage
      if (delegates.length > 0 && isDatabaseAvailable()) {
        console.log(`[Delegates API] 🔄 Auto-syncing ${delegates.length} blockchain delegates to DB...`);
        try {
          const syncResult = await mintedCardsService.syncBlockchainDelegatesToDB(delegates, walletAddress);
          console.log(`[Delegates API] ✅ Auto-sync: ${syncResult.synced} synced, ${syncResult.skipped} skipped, ${syncResult.errors} errors`);
        } catch (syncErr) {
          console.error(`[Delegates API] ⚠️ Auto-sync failed (non-blocking):`, syncErr.message);
          // Non-blocking - Daten werden trotzdem zurückgegeben
        }
      }
      
      return res.json({ 
        delegates, 
        count: delegates.length, 
        source: 'blockchain-hybrid' 
      });
    }
    
    // ⚠️ EBENE 3: Registry (letzter Fallback)
    console.log(`[Delegates API] 📋 Registry: Using as last fallback...`);
    const delegates = delegateRegistry.getDelegatesByWallet(walletAddress);
    return res.json({ 
      delegates, 
      count: delegates.length, 
      source: 'registry-fallback' 
    });
    
  } catch (error) {
    console.error('[Delegates API] ❌ All fallbacks failed:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Pack Availability (all packs)
app.get('/api/packs/availability', async (req, res) => {
  try {
    res.json({
      'starter-pack': { available: true, sold: 0, total: 1000 },
      'premium-pack': { available: true, sold: 0, total: 500 }
    });
  } catch (error) {
    console.error('[Packs Availability] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Pack Availability (specific pack)
app.get('/api/packs/:packId/availability', async (req, res) => {
  try {
    const { packId } = req.params;
    console.log(`[Packs] ✅ Checking availability for: ${packId}`);
    
    // Default availability
    const availability = {
      available: true,
      sold: 0,
      total: packId === 'starter-pack' ? 1000 : 500
    };
    
    res.json(availability);
  } catch (error) {
    console.error('[Packs Availability] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Increment Pack Counter
app.post('/api/packs/:packId/increment', async (req, res) => {
  try {
    const { packId } = req.params;
    console.log(`[Packs] ✅ Incrementing counter for: ${packId}`);
    
    // For now: Just acknowledge (can be stored in DB later)
    res.json({ 
      success: true, 
      packId,
      message: 'Pack counter incremented'
    });
  } catch (error) {
    console.error('[Packs Increment] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Minting Logs for Wallet
app.get('/api/minting/logs/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    
    // Für jetzt: Gib leeres Array zurück (kann später aus Datenbank geladen werden)
    res.json({ logs: [] });
  } catch (error) {
    console.error('[Minting Logs] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Log Minting Event
app.post('/api/minting/log', async (req, res) => {
  try {
    const { walletAddress, packId, inscriptionIds, txid } = req.body;
    console.log(`[Minting] ✅ Logging mint event:`, {
      walletAddress,
      packId,
      inscriptionCount: inscriptionIds?.length,
      txid
    });
    
    // For now: Just acknowledge (can be stored in DB later)
    res.json({ 
      success: true,
      message: 'Minting event logged'
    });
  } catch (error) {
    console.error('[Minting Log] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 💣 BOMBENSICHER: Update pending → confirmed
app.post('/api/minting/update-status', async (req, res) => {
  try {
    const { tempId, finalInscriptionId, txid } = req.body;
    
    if (!tempId || !finalInscriptionId) {
      return res.status(400).json({ 
        error: 'tempId and finalInscriptionId required',
        received: { tempId, finalInscriptionId }
      });
    }
    
    console.log(`[Minting Update] 🔄 Updating: ${tempId} → ${finalInscriptionId}`);
    
    const result = await mintedCardsService.updatePendingToConfirmed(tempId, finalInscriptionId, txid);
    
    if (result.success) {
      console.log(`[Minting Update] ✅ Updated successfully (method: ${result.method})`);
      res.json({ 
        success: true,
        message: 'Card status updated to confirmed',
        method: result.method,
        card: result.card
      });
    } else {
      console.warn(`[Minting Update] ⚠️ Update failed: ${result.error}`);
      res.status(404).json({ 
        success: false,
        error: result.error 
      });
    }
  } catch (error) {
    console.error('[Minting Update] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 💣 BOMBENSICHER: Manual Trigger für Pending Update Job (Testing)
app.post('/api/admin/trigger-pending-update', async (req, res) => {
  try {
    console.log(`[Admin] 🔧 Manual pending update job triggered`);
    
    const result = await pendingCardsUpdateJob.updatePendingCards();
    
    res.json({
      success: true,
      message: 'Pending update job completed',
      stats: result
    });
  } catch (error) {
    console.error('[Admin] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Test: Prüfe spezifische Inskriptionen
app.post('/api/test/check-inscriptions', async (req, res) => {
  try {
    const { inscriptionIds, walletAddress } = req.body;
    
    if (!inscriptionIds || !Array.isArray(inscriptionIds)) {
      return res.status(400).json({ error: 'inscriptionIds array required' });
    }
    
    const { getInscriptionContent, getInscriptionDetails, getInscriptionsByAddress } = await import('./services/blockchainDelegateService.js');
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 TEST: Prüfe ${inscriptionIds.length} Inskriptionen`);
    console.log(`${'═'.repeat(80)}`);
    
    // Schritt 1: Prüfe, ob UniSat API Inskriptionen für die Adresse zurückgibt
    if (walletAddress) {
      console.log(`\n[Test 1] Hole alle Inskriptionen für Adresse: ${walletAddress}`);
      try {
        const allInscriptions = await getInscriptionsByAddress(walletAddress);
        console.log(`✅ UniSat API gibt ${allInscriptions.length} Inskriptionen zurück`);
        console.log(`Inskription IDs:`, allInscriptions.map(i => i.inscriptionId).slice(0, 10));
        
        // Prüfe, ob unsere Inskriptionen dabei sind
        const found = inscriptionIds.filter(id => 
          allInscriptions.some(ins => ins.inscriptionId === id)
        );
        console.log(`\n✅ ${found.length}/${inscriptionIds.length} Inskriptionen in UniSat API gefunden:`);
        found.forEach(id => console.log(`  - ${id}`));
        
        const missing = inscriptionIds.filter(id => !found.includes(id));
        if (missing.length > 0) {
          console.log(`\n❌ ${missing.length} Inskriptionen NICHT in UniSat API gefunden:`);
          missing.forEach(id => console.log(`  - ${id}`));
        }
      } catch (err) {
        console.error(`❌ Fehler beim Abrufen der Inskriptionen:`, err.message);
      }
    }
    
    // Schritt 2: Prüfe jede Inskription einzeln
    console.log(`\n[Test 2] Prüfe jede Inskription einzeln:`);
    const results = [];
    
    for (const inscriptionId of inscriptionIds) {
      console.log(`\n--- Prüfe ${inscriptionId} ---`);
      const result = {
            inscriptionId,
        found: false,
        hasContent: false,
        isDelegate: false,
        contentType: null,
        error: null,
      };
      
      try {
        // Prüfe Details
        const details = await getInscriptionDetails(inscriptionId);
        if (details) {
          result.found = true;
          result.owner = details.owner || details.address;
          result.mimeType = details.mimeType || details.contentType;
          console.log(`✅ Inskription gefunden: Owner=${result.owner}, MIME=${result.mimeType}`);
        } else {
          console.log(`❌ Inskription nicht gefunden in UniSat API`);
          results.push(result);
          continue;
        }
        
        // Prüfe Content
        try {
          const content = await getInscriptionContent(inscriptionId);
          if (content) {
            result.hasContent = true;
            result.contentType = content.trim().startsWith('<!DOCTYPE') || content.trim().startsWith('<html') ? 'HTML' : 
                                 content.trim().startsWith('{') ? 'JSON' : 'Other';
            console.log(`✅ Content abgerufen: ${result.contentType} (${content.length} bytes)`);
            
            // Prüfe ob es ein Delegate ist
            let delegateData = null;
            try {
              delegateData = JSON.parse(content);
            } catch (parseError) {
              // Versuche HTML-Parsing
              if (content.includes('<script')) {
                const scriptMatch = content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
                if (scriptMatch && scriptMatch[1]) {
                  delegateData = JSON.parse(scriptMatch[1].trim());
                  console.log(`✅ Metadaten aus HTML extrahiert`);
                }
              }
            }
            
            if (delegateData && delegateData.p === 'ord-20' && delegateData.op === 'delegate') {
              result.isDelegate = true;
              result.delegateData = {
                originalInscriptionId: delegateData.originalInscriptionId,
                cardId: delegateData.cardId,
                name: delegateData.name,
              };
              console.log(`✅ Ist Delegate: ${delegateData.name} -> ${delegateData.originalInscriptionId}`);
            } else {
              console.log(`❌ Ist KEIN Delegate (p=${delegateData?.p}, op=${delegateData?.op})`);
            }
          }
        } catch (contentErr) {
          result.error = contentErr.message;
          console.log(`❌ Fehler beim Abrufen des Contents:`, contentErr.message);
        }
      } catch (err) {
        result.error = err.message;
        console.log(`❌ Fehler:`, err.message);
      }
      
      results.push(result);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    res.json({
      walletAddress,
      total: inscriptionIds.length,
      results,
      summary: {
        found: results.filter(r => r.found).length,
        hasContent: results.filter(r => r.hasContent).length,
        isDelegate: results.filter(r => r.isDelegate).length,
      },
    });
  } catch (error) {
    console.error('[Test Inscriptions] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Test: Prüfe getDelegatesFromChain direkt
app.get('/api/test/delegates/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;
    const { getDelegatesFromChain } = await import('./services/blockchainDelegateService.js');
    
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🔍 TEST: getDelegatesFromChain für ${walletAddress}`);
    console.log(`${'═'.repeat(80)}`);
    
    const delegates = await getDelegatesFromChain(walletAddress);
    
    console.log(`\n✅ Gefunden ${delegates.length} Delegates`);
    delegates.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.delegateInscriptionId} -> ${d.originalInscriptionId} (${d.name})`);
    });
    
    res.json({ delegates, count: delegates.length, walletAddress });
  } catch (error) {
    console.error('[Test Delegates] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== UNISAT API ENDPOINTS (ERWEITERT) ==========

// Get Order Summary
// 💣 BOMBENSICHER: Order Status Check für pending → confirmed Updates
app.get('/api/unisat/order-status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Order Status] 🔍 Checking order: ${orderId}`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/${orderId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Order Status] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code !== 0) {
      console.error('[Order Status] ❌ API returned error code:', data.code, data.msg);
      return res.status(400).json({ 
        error: data.msg || 'Order check failed',
        code: data.code
      });
    }
    
    console.log(`[Order Status] ✅ Order ${orderId} status: ${data.data?.status || 'unknown'}`);
    
    // Wenn confirmed, extrahiere Inscription IDs
    if (data.data?.status === 'confirmed' && data.data?.inscriptions) {
      console.log(`[Order Status] 📋 Found ${data.data.inscriptions.length} inscriptions`);
    }
    
    res.json({
      orderId: orderId,
      status: data.data?.status || 'unknown',
      inscriptions: data.data?.inscriptions || [],
      txid: data.data?.txid || null,
      data: data.data
    });
  } catch (error) {
    console.error('[Order Status] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.get('/api/unisat/order/summary', async (req, res) => {
  try {
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log('[Order Summary] 📊 Fetching order summary...');

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/summary`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Order Summary] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Order Summary] ✅ Summary retrieved');
    res.json({
        status: 'ok',
        summary: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get order summary',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Order Summary] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Order List
app.get('/api/unisat/order/list', async (req, res) => {
  try {
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    const {
      cursor = 0,
      size = 20,
      sort = 'desc',
      status,
      receiveAddress,
      clientId,
      withFiles = false
    } = req.query;

    console.log('[Order List] 📋 Fetching order list...', { cursor, size, sort, status });

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
      sort: String(sort),
    });

    if (status) queryParams.append('status', String(status));
    if (receiveAddress) queryParams.append('receiveAddress', String(receiveAddress));
    if (clientId) queryParams.append('clientId', String(clientId));
    if (withFiles) queryParams.append('withFiles', String(withFiles));

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/list?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Order List] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Order List] ✅ List retrieved:', data.data?.list?.length || 0, 'orders');
    res.json({
        status: 'ok',
        orders: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || 0,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get order list',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Order List] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Estimate Refund
app.post('/api/unisat/order/:orderId/refund-estimate', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Refund Estimate] ⚠️ Order-ID geändert: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Refund Estimate] 💰 Estimating refund for order: ${orderId} (UniSat: ${unisatOrderId})`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/${unisatOrderId}/refund-estimate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Refund Estimate] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Refund Estimate] ✅ Refund estimate retrieved');
      res.json({
        status: 'ok',
        orderId,
        estimate: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to estimate refund',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Refund Estimate] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Process Refund
app.post('/api/unisat/order/:orderId/refund', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { refundAddress } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    if (!refundAddress) {
      return res.status(400).json({ error: 'Refund address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Refund] ⚠️ Order-ID geändert: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Refund] 💸 Processing refund for order: ${orderId} (UniSat: ${unisatOrderId})`);
    console.log(`[Refund] 📍 Refund address: ${refundAddress}`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/${unisatOrderId}/refund`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refundAddress }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Refund] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Refund] ✅ Refund processed successfully');
    res.json({
        status: 'ok',
        orderId,
        refund: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to process refund',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Refund] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Request Commit Transactions
app.post('/api/unisat/order/request-commit', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Request Commit] ⚠️ Order-ID geändert: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Request Commit] 📝 Requesting commit transactions for order: ${orderId} (UniSat: ${unisatOrderId})`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/request-commit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId: unisatOrderId }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Request Commit] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Request Commit] ✅ Commit transactions requested');
      res.json({
        status: 'ok',
        orderId,
        commitTxs: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to request commit transactions',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Request Commit] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Sign Commit Transactions
app.post('/api/unisat/order/sign-commit', async (req, res) => {
  try {
    const { orderId, commitTxs, signatures } = req.body;
    
    if (!orderId || !commitTxs || !signatures) {
      return res.status(400).json({ error: 'Order ID, commit transactions, and signatures required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Sign Commit] ⚠️ Order-ID geändert: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Sign Commit] ✍️ Signing commit transactions for order: ${orderId} (UniSat: ${unisatOrderId})`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/sign-commit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        orderId: unisatOrderId,
        commitTxs,
        signatures
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Sign Commit] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Sign Commit] ✅ Commit transactions signed');
      res.json({
        status: 'ok',
        orderId,
        result: data.data || {}
      });
} else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to sign commit transactions',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Sign Commit] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Sign Reveal Transactions
app.post('/api/unisat/order/sign-reveal', async (req, res) => {
  try {
    const { orderId, revealTxs, signatures } = req.body;
    
    if (!orderId || !revealTxs || !signatures) {
      return res.status(400).json({ error: 'Order ID, reveal transactions, and signatures required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    // WICHTIG: Ändere "BLACK" zurück zu "ORDIN" für UniSat!
    let unisatOrderId = orderId;
    if (unisatOrderId && unisatOrderId.includes('BLACK') && !unisatOrderId.includes('ORDIN')) {
      unisatOrderId = unisatOrderId.replace(/BLACK/g, 'ORDIN');
      console.log(`[Sign Reveal] ⚠️ Order-ID geändert: "${orderId}" -> "${unisatOrderId}"`);
    }

    console.log(`[Sign Reveal] ✍️ Signing reveal transactions for order: ${orderId} (UniSat: ${unisatOrderId})`);

    const response = await fetch(`${UNISAT_API_URL}/v2/inscribe/order/sign-reveal`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        orderId: unisatOrderId,
        revealTxs,
        signatures
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Sign Reveal] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Sign Reveal] ✅ Reveal transactions signed');
      res.json({
        status: 'ok',
        orderId,
        result: data.data || {}
      });
} else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to sign reveal transactions',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Sign Reveal] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== BLOCKCHAIN INDEXER ENDPOINTS ==========

// Get Blockchain Info
app.get('/api/blockchain/info', async (req, res) => {
  try {
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log('[Blockchain] 📊 Fetching blockchain info...');

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/blockchain/info`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Info retrieved');
      res.json({
        status: 'ok',
        info: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get blockchain info',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Recommended Fees
app.get('/api/blockchain/fees/recommended', async (req, res) => {
  try {
    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log('[Blockchain] 💰 Fetching recommended fees...');

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/fees/recommended`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Recommended fees retrieved');
    res.json({
        status: 'ok',
        fees: data.data || {}
      });
} else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get recommended fees',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Address Balance
app.get('/api/blockchain/address/:address/balance', async (req, res) => {
  try {
    const { address } = req.params;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 💵 Fetching balance for address: ${address}`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Balance retrieved');
    res.json({
        status: 'ok',
        address,
        balance: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get balance',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Available Balance (spendable BTC)
app.get('/api/blockchain/address/:address/available-balance', async (req, res) => {
  try {
    const { address } = req.params;
    const { withLowFee } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    const queryParams = new URLSearchParams();
    if (withLowFee !== undefined) queryParams.append('withLowFee', String(withLowFee));

    console.log(`[Blockchain] 💵 Fetching available balance for address: ${address}`);

    const url = `${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/available-balance${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Available balance retrieved');
    res.json({
        status: 'ok',
        address,
        availableBalance: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get available balance',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Address Transaction History
app.get('/api/blockchain/address/:address/history', async (req, res) => {
  try {
    const { address } = req.params;
    const { cursor = 0, size = 20 } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📜 Fetching transaction history for address: ${address}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/history?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transaction history retrieved');
    res.json({
        status: 'ok',
        address,
        history: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get transaction history',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Available UTXO List
app.get('/api/blockchain/address/:address/available-utxo', async (req, res) => {
  try {
    const { address } = req.params;
    const { cursor = 0, size = 20, withLowFee } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 💰 Fetching available UTXOs for address: ${address}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });
    if (withLowFee !== undefined) queryParams.append('withLowFee', String(withLowFee));

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/available-utxo-data?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Available UTXOs retrieved');
      res.json({
        status: 'ok',
        address,
        utxos: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get available UTXOs',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get All UTXO List
app.get('/api/blockchain/address/:address/all-utxo', async (req, res) => {
  try {
    const { address } = req.params;
    const { cursor = 0, size = 20 } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 💰 Fetching all UTXOs for address: ${address}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/all-utxo-data?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ All UTXOs retrieved');
    res.json({
        status: 'ok',
        address,
        utxos: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get all UTXOs',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Transaction Info by TXID
app.get('/api/blockchain/tx/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    
    if (!txid) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📄 Fetching transaction info: ${txid}`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/tx/${txid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transaction info retrieved');
      res.json({
        status: 'ok',
        txid,
        tx: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get transaction info',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Transaction Inputs
app.get('/api/blockchain/tx/:txid/inputs', async (req, res) => {
  try {
    const { txid } = req.params;
    const { cursor = 0, size = 20 } = req.query;
    
    if (!txid) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📥 Fetching transaction inputs: ${txid}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/tx/${txid}/ins?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transaction inputs retrieved');
      res.json({
        status: 'ok',
        txid,
        inputs: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get transaction inputs',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Transaction Outputs
app.get('/api/blockchain/tx/:txid/outputs', async (req, res) => {
  try {
    const { txid } = req.params;
    const { cursor = 0, size = 20 } = req.query;
    
    if (!txid) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📤 Fetching transaction outputs: ${txid}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/tx/${txid}/outs?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transaction outputs retrieved');
      res.json({
        status: 'ok',
        txid,
        outputs: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get transaction outputs',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Raw Transaction
app.get('/api/blockchain/tx/:txid/raw', async (req, res) => {
  try {
    const { txid } = req.params;
    
    if (!txid) {
      return res.status(400).json({ error: 'Transaction ID required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📄 Fetching raw transaction: ${txid}`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/rawtx/${txid}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Raw transaction retrieved');
      res.json({
        status: 'ok',
        txid,
        rawTx: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get raw transaction',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get UTXO by TXID and Index
app.get('/api/blockchain/utxo/:txid/:index', async (req, res) => {
  try {
    const { txid, index } = req.params;
    
    if (!txid || index === undefined) {
      return res.status(400).json({ error: 'Transaction ID and index required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 💰 Fetching UTXO: ${txid}:${index}`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/utxo/${txid}/${index}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ UTXO retrieved');
      res.json({
        status: 'ok',
        txid,
        index,
        utxo: data.data || null // null wenn UTXO bereits gespendet wurde
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get UTXO',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Push Raw Transaction
app.post('/api/blockchain/push-tx', async (req, res) => {
  try {
    const { rawTx } = req.body;
    
    if (!rawTx) {
      return res.status(400).json({ error: 'Raw transaction required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log('[Blockchain] 📤 Pushing raw transaction to Bitcoin node...');

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/local_pushtx`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawTx }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transaction pushed successfully');
      res.json({
        status: 'ok',
        txid: data.data?.txid || null,
        result: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to push transaction',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Push Multiple Raw Transactions
app.post('/api/blockchain/push-txs', async (req, res) => {
  try {
    const { rawTxs } = req.body;
    
    if (!rawTxs || !Array.isArray(rawTxs)) {
      return res.status(400).json({ error: 'Array of raw transactions required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📤 Pushing ${rawTxs.length} raw transactions to Bitcoin node...`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/local_pushtxs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawTxs }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Transactions pushed successfully');
      res.json({
        status: 'ok',
        results: data.data || []
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to push transactions',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Block Info by Height
app.get('/api/blockchain/block/height/:height', async (req, res) => {
  try {
    const { height } = req.params;
    
    if (!height) {
      return res.status(400).json({ error: 'Block height required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📦 Fetching block info for height: ${height}`);

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/height/${height}/block`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Block info retrieved');
      res.json({
        status: 'ok',
        height,
        block: data.data || {}
      });
    } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get block info',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Transactions by Block Height
app.get('/api/blockchain/block/:height/txs', async (req, res) => {
  try {
    const { height } = req.params;
    const { cursor = 0, size = 20 } = req.query;
    
    if (!height) {
      return res.status(400).json({ error: 'Block height required' });
    }

    const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
    const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
    
    if (!UNISAT_API_KEY) {
      return res.status(500).json({ error: 'UniSat API key not configured' });
    }

    console.log(`[Blockchain] 📋 Fetching transactions for block height: ${height}`);

    const queryParams = new URLSearchParams({
      cursor: String(cursor),
      size: String(size),
    });

    const response = await fetch(`${UNISAT_API_URL}/v1/indexer/block/${height}/txs?${queryParams}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[Blockchain] ❌ Error:', response.status, errorText);
      return res.status(response.status).json({ 
        error: `UniSat API error: ${response.status}`,
        details: errorText
      });
    }

    const data = await response.json();
    
    if (data.code === 0) {
      console.log('[Blockchain] ✅ Block transactions retrieved');
      res.json({
        status: 'ok',
        height,
        transactions: data.data?.list || [],
        total: data.data?.total || 0,
        cursor: data.data?.cursor || cursor,
      });
  } else {
      res.status(400).json({
        error: data.msg || data.message || 'Failed to get block transactions',
        code: data.code
      });
    }
  } catch (error) {
    console.error('[Blockchain] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== POINTS ENDPOINTS ==========

// Get Points
app.get('/api/points/:walletAddress', (req, res) => {
  try {
    const { walletAddress } = req.params;
    const points = pointsService.getPoints(walletAddress);
    res.json(points);
  } catch (error) {
    console.error('[Points] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Add Points
app.post('/api/points/add', (req, res) => {
  try {
    const { walletAddress, packId, packName, cardCount, points, reason, details } = req.body;
    
    // Unterstütze beide Formate: direktes points/reason ODER packId-basiert
    let pointsToAdd = points;
    let reasonToUse = reason;
    
    if (packId) {
      // Berechne Punkte basierend auf Pack-ID
      const POINTS_CONFIG = pointsService.POINTS_CONFIG || {};
      pointsToAdd = POINTS_CONFIG[packId] || 5; // Default: 5 Punkte für normales Pack
      reasonToUse = `minted ${packName || packId} (${cardCount || 0} cards)`;
    }
    
    if (!walletAddress || !pointsToAdd || !reasonToUse) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = pointsService.addPoints(walletAddress, pointsToAdd, reasonToUse, details || { packId, packName, cardCount });
    console.log(`[Points] Added ${pointsToAdd} points (+ ${result.bonus} bonus) to ${walletAddress}. Total: ${result.total}`);
      res.json({
        success: true,
      walletAddress,
      pointsAdded: pointsToAdd,
      bonusPoints: result.bonus,
      totalPoints: result.total
    });
  } catch (error) {
    console.error('[Points] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== POINT SHOP ENDPOINTS ==========

// Get all active items
app.get('/api/point-shop/items', async (req, res) => {
  try {
    const items = await pointShopService.getPointShopItems();
    res.json({ items });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Mint item with points
app.post('/api/point-shop/mint', async (req, res) => {
  try {
    const { walletAddress, itemId, walletType, feeRate } = req.body;
    
    if (!walletAddress || !itemId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const item = await pointShopService.getPointShopItem(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Prüfe Punkte
    const userPoints = pointsService.getPoints(walletAddress);
    if (userPoints.total < item.pointsCost) {
      return res.status(400).json({ error: `Not enough points. Required: ${item.pointsCost}, You have: ${userPoints.total}` });
    }

    // Subtrahiere Punkte
    pointsService.addPoints(
      walletAddress,
      -item.pointsCost,
      `purchased point shop item: ${item.title}`,
      { 
        itemId, 
        itemTitle: item.title, 
        itemType: item.itemType,
        inscriptionId: item.itemType === 'delegate' ? item.delegateInscriptionId : item.originalInscriptionId
      }
    );

    console.log(`[PointShop] ✅ ${item.pointsCost} points deducted from ${walletAddress} for item: ${item.title} (Type: ${item.itemType})`);
    
    // Gebe Item-Informationen zurück
    const response = {
      success: true,
      message: 'Points deducted successfully',
      itemType: item.itemType,
      item: item
    };
    
    if (item.itemType === 'delegate') {
      // Für Delegates: Frontend erstellt neue Delegate-Inskription
      response.delegateInscriptionId = item.delegateInscriptionId;
    } else {
      // Für Original-Ordinals: Backend muss Transfer durchführen
      // Frontend ruft dann /api/point-shop/transfer auf
      response.originalInscriptionId = item.originalInscriptionId;
    }
    
    res.json(response);
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Transfer original ordinal to user (called after points are deducted)
app.post('/api/point-shop/transfer', async (req, res) => {
  try {
    const { walletAddress, itemId, recipientAddress, feeRate, inscriptionId: specificInscriptionId } = req.body;
    
    if (!walletAddress || !itemId || !recipientAddress || !feeRate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const item = await pointShopService.getPointShopItem(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Wenn specificInscriptionId gegeben ist (z.B. von Series), verwende diese
    // Ansonsten verwende item.originalInscriptionId (für normale original Items)
    let inscriptionIdToTransfer = specificInscriptionId;
    
    if (!inscriptionIdToTransfer) {
      // Für normale original Items
      if (item.itemType === 'original') {
        inscriptionIdToTransfer = item.originalInscriptionId;
      } else {
        // Für Series oder andere Typen ohne spezifische inscriptionId muss sie übergeben werden
        return res.status(400).json({ error: 'No inscription ID provided for transfer' });
      }
    }

    if (!inscriptionIdToTransfer) {
      return res.status(400).json({ error: 'No inscription ID found to transfer' });
    }

    console.log(`[PointShop] 🔄 Starting transfer of ${inscriptionIdToTransfer} to ${recipientAddress}${item.itemType === 'series' ? ` (Series item #${item.currentIndex}/${item.totalCount})` : ''}`);
    
    // Prüfe ob bereits signierte Transaktion vorhanden (Pre-Signing)
    let presignedTxHex = null;
    
    if (item.itemType === 'series' && item.presignedTxs) {
      // Für Series: Suche nach signierter Transaktion für diese Inskription
      const presignedTx = item.presignedTxs.find(pt => pt.inscriptionId === inscriptionIdToTransfer);
      if (presignedTx && presignedTx.signedTxHex) {
        presignedTxHex = presignedTx.signedTxHex;
        console.log(`[PointShop] ✅ Found presigned transaction for ${inscriptionIdToTransfer}`);
      }
    } else if (item.itemType === 'original' && item.signedTxHex) {
      // Für einzelne Original-Items
      presignedTxHex = item.signedTxHex;
      console.log(`[PointShop] ✅ Found presigned transaction for ${inscriptionIdToTransfer}`);
    }
    
    // Wenn Pre-Signed TX vorhanden: Direkt broadcasten (Xverse Pre-Signing Flow - UNVERÄNDERT)
    if (presignedTxHex) {
      const transferResult = await ordinalTransferService.transferOrdinal(
        inscriptionIdToTransfer,
        recipientAddress,
        parseInt(feeRate, 10),
        presignedTxHex
      );
      
      console.log(`[PointShop] ✅ Original ordinal ${inscriptionIdToTransfer} transferred to ${recipientAddress} (Pre-Signed)`);
      console.log(`[PointShop] 📝 Transaction ID: ${transferResult.txid}`);
      
      return res.json({
        success: true,
        message: 'Transfer completed successfully',
        txid: transferResult.txid,
        inscriptionId: inscriptionIdToTransfer,
        presigned: true,
      });
    }
    
    // Wenn keine Pre-Signed TX: PSBT erstellen und zurückgeben (für Frontend-Signatur - UniSat & Xverse)
    console.log(`[PointShop] 🔄 No pre-signed transaction found, creating PSBT for frontend signing...`);
    const psbtData = await ordinalTransferService.preparePresignedTransfer(
      inscriptionIdToTransfer,
      recipientAddress,
      parseInt(feeRate, 10)
    );
    
    console.log(`[PointShop] ✅ PSBT created for ${inscriptionIdToTransfer}, returning to frontend for signing`);
    
    res.json({
      success: true,
      requiresSigning: true,
      psbtBase64: psbtData.psbtBase64,
      inscriptionId: inscriptionIdToTransfer,
      recipientAddress: recipientAddress,
      feeRate: parseInt(feeRate, 10),
      message: 'PSBT created. Please sign in your wallet and call /api/point-shop/transfer/broadcast',
    });
  } catch (error) {
    console.error('[PointShop] ❌ Transfer error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Broadcast signierte PSBT (für normale Transfers ohne Pre-Signing)
app.post('/api/point-shop/transfer/broadcast', async (req, res) => {
  try {
    const { inscriptionId, signedPsbtHex, signedPsbtBase64 } = req.body;
    
    if (!inscriptionId || (!signedPsbtHex && !signedPsbtBase64)) {
      return res.status(400).json({ error: 'Missing required fields: inscriptionId and signedPsbtHex or signedPsbtBase64' });
    }

    // Konvertiere Base64 zu Hex falls nötig
    let signedTxHex = signedPsbtHex;
    if (!signedTxHex && signedPsbtBase64) {
      // Konvertiere Base64 zu Hex
      const binaryString = Buffer.from(signedPsbtBase64, 'base64');
      signedTxHex = binaryString.toString('hex');
    }

    console.log(`[PointShop] Broadcasting signed transaction for ${inscriptionId}`);
    const transferResult = await ordinalTransferService.transferOrdinal(
      inscriptionId,
      '', // recipientAddress nicht benötigt für Broadcast
      null, // feeRate nicht benötigt für Broadcast
      signedTxHex
    );
    
    console.log(`[PointShop] ✅ Transaction broadcasted: ${transferResult.txid}`);
    
    res.json({
      success: true,
      message: 'Transaction broadcasted successfully',
      txid: transferResult.txid,
      inscriptionId: inscriptionId,
    });
  } catch (error) {
    console.error('[PointShop] ❌ Broadcast error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Prepare PSBT for Pre-Signing (erstellt unsignierte PSBT)
app.post('/api/point-shop/admin/prepare-psbt', async (req, res) => {
  try {
    const { inscriptionId, recipientAddress, feeRate } = req.body;
    
    if (!inscriptionId || !recipientAddress || !feeRate) {
      return res.status(400).json({ error: 'Missing required fields: inscriptionId, recipientAddress, feeRate' });
    }

    const psbtData = await ordinalTransferService.preparePresignedTransfer(
      inscriptionId,
      recipientAddress,
      parseInt(feeRate, 10)
    );
    
    console.log(`[PointShop] ✅ PSBT prepared for pre-signing: ${inscriptionId}`);
    res.json({ success: true, ...psbtData });
  } catch (error) {
    console.error('[PointShop] ❌ Error preparing PSBT:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Finalize Signed PSBT (konvertiert signierte PSBT zu finaler Transaktion)
app.post('/api/point-shop/admin/finalize-psbt', async (req, res) => {
  try {
    const { signedPsbtHex } = req.body;
    
    if (!signedPsbtHex) {
      return res.status(400).json({ error: 'Missing required field: signedPsbtHex' });
    }

    const finalTxHex = ordinalTransferService.finalizeSignedPSBT(signedPsbtHex);
    
    // Validiere finale Transaktion
    try {
      const tx = bitcoin.Transaction.fromHex(finalTxHex);
      const txid = tx.getId();
      console.log(`[PointShop] ✅ Finalized transaction: ${txid}`);
    } catch (validationError) {
      return res.status(400).json({ error: 'Failed to validate finalized transaction' });
    }
    
    res.json({ success: true, signedTxHex: finalTxHex });
  } catch (error) {
    console.error('[PointShop] ❌ Error finalizing PSBT:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Save Presigned Transaction (speichert signierte Transaktion im Item)
app.post('/api/point-shop/admin/save-presigned', async (req, res) => {
  try {
    const { itemId, inscriptionId, signedTxHex } = req.body;
    
    if (!itemId || !inscriptionId || !signedTxHex) {
      return res.status(400).json({ error: 'Missing required fields: itemId, inscriptionId, signedTxHex' });
    }

      const item = await pointShopService.getPointShopItem(itemId);
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // Validiere signierte Transaktion
    try {
      const tx = bitcoin.Transaction.fromHex(signedTxHex);
      const txid = tx.getId();
      console.log(`[PointShop] Validated presigned transaction: ${txid}`);
    } catch (validationError) {
      return res.status(400).json({ error: 'Invalid signed transaction hex' });
    }

    // Speichere signierte Transaktion
    if (item.itemType === 'series') {
      // Für Series: Speichere in presignedTxs Array
      if (!item.presignedTxs) {
        item.presignedTxs = [];
      }
      
      // Entferne alte Einträge für diese Inskription
      item.presignedTxs = item.presignedTxs.filter(pt => pt.inscriptionId !== inscriptionId);
      
      // Füge neue signierte Transaktion hinzu
      item.presignedTxs.push({
        inscriptionId,
        signedTxHex,
        createdAt: new Date().toISOString(),
      });
    } else if (item.itemType === 'original') {
      // Für einzelne Original-Items
      item.signedTxHex = signedTxHex;
      item.presignedAt = new Date().toISOString();
    } else {
      return res.status(400).json({ error: 'Item type does not support pre-signing' });
    }

    // Speichere aktualisiertes Item
    await pointShopService.updatePointShopItem(itemId, item);
    
    console.log(`[PointShop] ✅ Presigned transaction saved for item ${itemId}, inscription ${inscriptionId}`);
    res.json({ success: true, item });
  } catch (error) {
    console.error('[PointShop] ❌ Error saving presigned transaction:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Point Shop Pre-Signing Endpoints (UniSat Marketplace Flow)
// Transfer Sessions Storage (in-memory, sollte in Production persistiert werden)
const transferSessions = new Map();

// Create Transfer Order (ähnlich wie UniSat's create_put_on)
app.post('/api/point-shop/admin/create-transfer', requireAdmin, async (req, res) => {
  try {
    console.log('[PointShop] Create Transfer request received:', { 
      inscriptionId: req.body.inscriptionId, 
      recipientAddress: req.body.recipientAddress, 
      feeRate: req.body.feeRate,
      itemId: req.body.itemId 
    });
    
    if (!ordinalTransferService || !ordinalTransferService.preparePresignedTransfer) {
      console.error('[PointShop] ❌ Ordinal Transfer Service not available');
      return res.status(503).json({ 
        code: -1,
        msg: 'Ordinal Transfer Service not available. Please check server logs.',
        data: null
      });
    }

    const { inscriptionId, recipientAddress, feeRate, itemId } = req.body;

    if (!inscriptionId || !recipientAddress) {
      return res.status(400).json({ 
        code: -1,
        msg: 'inscriptionId and recipientAddress are required',
        data: null
      });
    }

    const feeRateValue = feeRate || 5; // Default 5 sat/vB
    console.log('[PointShop] Calling preparePresignedTransfer...');
    const result = await ordinalTransferService.preparePresignedTransfer(
      inscriptionId,
      recipientAddress,
      feeRateValue
    );

    // Generate transferId (ähnlich wie auctionId in UniSat)
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Store transfer session (in Production, use Redis or database)
    transferSessions.set(transferId, {
      transferId,
      inscriptionId,
      recipientAddress,
      feeRate: feeRateValue,
      itemId: itemId || null,
      psbtBase64: result.psbtBase64,
      createdAt: new Date().toISOString(),
      status: 'pending',
      signIndexes: [0] // Always sign the first (and only) input
    });

    // Clean up old sessions (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, session] of transferSessions.entries()) {
      if (new Date(session.createdAt).getTime() < oneHourAgo) {
        transferSessions.delete(id);
      }
    }

    console.log('[PointShop] ✅ Transfer created successfully:', transferId);
    
    // Return response in UniSat format
    res.json({
      code: 0,
      msg: 'success',
      data: {
        transferId: transferId,
        psbt: result.psbtBase64, // Base64 PSBT
        signIndexes: [0], // Index of input to sign (always 0 for single input)
        inscriptionId: result.inscriptionId,
        recipientAddress: result.recipientAddress,
        feeRate: result.feeRate
      }
    });
  } catch (error) {
    console.error('[PointShop] ❌ Error creating transfer:', error);
    console.error('[PointShop] Error message:', error.message);
    console.error('[PointShop] Error stack:', error.stack);
    res.status(500).json({ 
      code: -1,
      msg: error.message || 'Failed to create transfer',
      data: null,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Confirm Transfer Order (ähnlich wie UniSat's confirm_put_on)
app.post('/api/point-shop/admin/confirm-transfer', requireAdmin, async (req, res) => {
  try {
    const { transferId, psbt, fromBase64 = true, itemId } = req.body;

    if (!transferId || !psbt) {
      return res.status(400).json({ 
        code: -1,
        msg: 'transferId and psbt are required',
        data: null
      });
    }

    // Retrieve transfer session
    const session = transferSessions.get(transferId);
    if (!session) {
      return res.status(404).json({ 
        code: -1,
        msg: 'Transfer session not found or expired',
        data: null
      });
    }

    if (session.status !== 'pending') {
      return res.status(400).json({ 
        code: -1,
        msg: `Transfer session already ${session.status}`,
        data: null
      });
    }

    if (!ordinalTransferService || !ordinalTransferService.finalizeSignedPSBT) {
      return res.status(503).json({ 
        code: -1,
        msg: 'Ordinal Transfer Service not available',
        data: null
      });
    }

    console.log('[PointShop] Confirming transfer:', transferId);

    // Parse PSBT (handle both Base64 and Hex)
    let signedPsbtData = psbt;
    if (fromBase64 && typeof psbt === 'string' && !psbt.startsWith('0x')) {
      // Already in correct format if fromBase64 is true
      signedPsbtData = psbt;
    } else if (!fromBase64 && typeof psbt === 'string' && /^[0-9a-fA-F]*$/.test(psbt.replace('0x', ''))) {
      // Hex format
      signedPsbtData = psbt;
    }

    // Finalize signed PSBT to get transaction hex
    const signedTxHex = ordinalTransferService.finalizeSignedPSBT(signedPsbtData);

    // Update session status
    session.status = 'confirmed';
    session.signedTxHex = signedTxHex;
    session.confirmedAt = new Date().toISOString();
    transferSessions.set(transferId, session);

    // Save to pointShopService if itemId is provided
    if (itemId && session.inscriptionId) {
      console.log(`[PointShop] Saving pre-signed transaction for item ${itemId}, inscription ${session.inscriptionId}`);
      const item = await pointShopService.getPointShopItem(itemId);
      if (item) {
        if (item.itemType === 'series') {
          if (!item.presignedTxs) {
            item.presignedTxs = [];
          }
          item.presignedTxs = item.presignedTxs.filter(pt => pt.inscriptionId !== session.inscriptionId);
          item.presignedTxs.push({ 
            inscriptionId: session.inscriptionId, 
            signedTxHex, 
            createdAt: new Date().toISOString() 
          });
          item.presignedAt = new Date().toISOString();
        } else if (item.itemType === 'original') {
          item.signedTxHex = signedTxHex;
          item.presignedAt = new Date().toISOString();
        }
        await pointShopService.updatePointShopItem(itemId, item);
      }
    }

    console.log('[PointShop] ✅ Transfer confirmed successfully:', transferId);
    
    // Return response in UniSat format
    res.json({
      code: 0,
      msg: 'success',
      data: {
        transferId: transferId,
        signedTxHex: signedTxHex,
        inscriptionId: session.inscriptionId,
        recipientAddress: session.recipientAddress
      }
    });
  } catch (error) {
    console.error('[PointShop] ❌ Error confirming transfer:', error);
    console.error('[PointShop] Error message:', error.message);
    console.error('[PointShop] Error stack:', error.stack);
    res.status(500).json({ 
      code: -1,
      msg: error.message || 'Failed to confirm transfer',
      data: null,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Admin: Add item
app.post('/api/point-shop/admin/add', async (req, res) => {
  try {
    const { itemType, inscriptionId, title, description, pointsCost } = req.body;
    
    if (!itemType || !inscriptionId || !title || !pointsCost) {
      return res.status(400).json({ error: 'Missing required fields: itemType, inscriptionId, title, pointsCost' });
    }

    if (itemType !== 'delegate' && itemType !== 'original') {
      return res.status(400).json({ error: 'Invalid itemType. Must be "delegate" or "original"' });
    }

    const item = await pointShopService.addPointShopItem(
      inscriptionId,
      itemType,
      title,
      description || '',
      pointsCost
    );
    
    console.log(`[PointShop] ✅ Admin added item: ${item.id} - ${title} (Type: ${itemType})`);
    res.json({ success: true, item });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Update item
app.put('/api/point-shop/admin/item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body;
    
    const item = await pointShopService.updatePointShopItem(itemId, updates);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    console.log(`[PointShop] ✅ Admin hat Item aktualisiert: ${itemId}`);
    res.json({ success: true, item });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Delete item (deaktiviert)
app.delete('/api/point-shop/admin/item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const success = await pointShopService.deletePointShopItem(itemId);
    if (!success) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    console.log(`[PointShop] ✅ Admin hat Item deaktiviert: ${itemId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Zeige ALLE Items (auch inaktive) - für Debugging/Wiederherstellung
app.get('/api/point-shop/admin/all-items', requireAdmin, async (req, res) => {
  try {
    const { getPool, isDatabaseAvailable } = await import('./services/db.js');
    
    if (isDatabaseAvailable()) {
      const pool = getPool();
      const result = await pool.query(
        'SELECT * FROM point_shop_items ORDER BY created_at DESC'
      );
      
      const items = result.rows.map(row => {
        const item = {
          id: row.id,
          itemType: row.item_type,
          title: row.title,
          description: row.description || '',
          pointsCost: row.points_cost,
          active: row.active,
          createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        };
        
        if (row.delegate_inscription_id) item.delegateInscriptionId = row.delegate_inscription_id;
        if (row.original_inscription_id) item.originalInscriptionId = row.original_inscription_id;
        
        if (row.item_type === 'series') {
          item.inscriptionIds = row.inscription_ids || [];
          item.currentIndex = row.current_index || 0;
          item.totalCount = row.total_count;
          item.seriesTitle = row.series_title;
        }
        
        return item;
      });
      
      console.log(`[PointShop] 📊 Admin: ${items.length} Items gefunden (${items.filter(i => i.active).length} aktiv)`);
      res.json({ items, total: items.length, active: items.filter(i => i.active).length });
    } else {
      res.status(500).json({ error: 'Database not available' });
    }
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Reaktiviere alle Items
app.post('/api/point-shop/admin/reactivate-all', requireAdmin, async (req, res) => {
  try {
    const { getPool, isDatabaseAvailable } = await import('./services/db.js');
    
    if (isDatabaseAvailable()) {
      const pool = getPool();
      const result = await pool.query(
        'UPDATE point_shop_items SET active = true, updated_at = $1 WHERE active = false',
        [new Date()]
      );
      
      console.log(`[PointShop] ✅ Admin: ${result.rowCount} Items reaktiviert`);
      res.json({ success: true, reactivated: result.rowCount });
    } else {
      res.status(500).json({ error: 'Database not available' });
    }
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Suche und reaktiviere Items mit spezifischem Titel
app.post('/api/point-shop/admin/reactivate-by-title', requireAdmin, async (req, res) => {
  try {
    const { title } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }

    const { getPool, isDatabaseAvailable } = await import('./services/db.js');
    
    if (isDatabaseAvailable()) {
      const pool = getPool();
      
      // Suche nach Items mit diesem Titel
      const searchResult = await pool.query(
        'SELECT * FROM point_shop_items WHERE title = $1 ORDER BY created_at DESC',
        [title]
      );
      
      if (searchResult.rows.length === 0) {
        return res.json({ 
          success: false, 
          message: `Keine Items mit Titel "${title}" gefunden`,
          found: 0,
          reactivated: 0
        });
      }
      
      // Reaktiviere alle gefundenen Items
      const reactivateResult = await pool.query(
        'UPDATE point_shop_items SET active = true, updated_at = $1 WHERE title = $2 AND active = false',
        [new Date(), title]
      );
      
      console.log(`[PointShop] ✅ Admin: ${reactivateResult.rowCount} Items mit Titel "${title}" reaktiviert`);
      res.json({ 
        success: true, 
        found: searchResult.rows.length,
        reactivated: reactivateResult.rowCount,
        items: searchResult.rows.map(row => ({
          id: row.id,
          title: row.title,
          active: row.active,
          pointsCost: row.points_cost,
          itemType: row.item_type
        }))
      });
    } else {
      res.status(500).json({ error: 'Database not available' });
    }
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Add Series Item (mehrere Inskriptionen → ein Item mit "1/N - N/N")
app.post('/api/point-shop/admin/add-series', async (req, res) => {
  try {
    const { inscriptionIds, title, description, pointsCost, totalCount, inscriptionItemType } = req.body;
    
    if (!inscriptionIds || !Array.isArray(inscriptionIds) || inscriptionIds.length === 0) {
      return res.status(400).json({ error: 'inscriptionIds must be a non-empty array' });
    }
    
    if (!title || !pointsCost) {
      return res.status(400).json({ error: 'Missing required fields: title, pointsCost' });
    }

    const item = await pointShopService.addPointShopSeries(
      inscriptionIds,
      title,
      description || '',
      pointsCost,
      totalCount || inscriptionIds.length,
      inscriptionItemType || 'original'
    );
    
    console.log(`[PointShop] ✅ Admin added series item: ${item.id} - ${title} (${inscriptionIds.length} items, Type: ${inscriptionItemType || 'original'})`);
    res.json({ success: true, item });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Add Bulk Items (mehrere Inskriptionen → mehrere separate Items)
app.post('/api/point-shop/admin/add-bulk', async (req, res) => {
  try {
    const { itemType, inscriptionIds, title, description, pointsCost } = req.body;
    
    if (!itemType || !inscriptionIds || !Array.isArray(inscriptionIds) || inscriptionIds.length === 0) {
      return res.status(400).json({ error: 'Missing or invalid fields: itemType, inscriptionIds (array)' });
    }
    
    if (itemType !== 'delegate' && itemType !== 'original') {
      return res.status(400).json({ error: 'Invalid itemType. Must be "delegate" or "original"' });
    }
    
    if (!title || !pointsCost) {
      return res.status(400).json({ error: 'Missing required fields: title, pointsCost' });
    }

    const items = await pointShopService.addPointShopBulk(
      itemType,
      inscriptionIds,
      title,
      description || '',
      pointsCost
    );
    
    console.log(`[PointShop] ✅ Admin added ${items.length} bulk items: "${title}" (Type: ${itemType})`);
    res.json({ success: true, itemsCreated: items.length, items });
  } catch (error) {
    console.error('[PointShop] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Mint Series Item (sequenziell: 1/N, 2/N, ...)
app.post('/api/point-shop/mint-series', async (req, res) => {
  try {
    const { walletAddress, itemId, walletType, feeRate } = req.body;
    
    if (!walletAddress || !itemId) {
      return res.status(400).json({ error: 'Missing required fields: walletAddress, itemId' });
    }

    const item = await pointShopService.getPointShopItem(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.itemType !== 'series') {
      return res.status(400).json({ error: 'Item is not a series' });
    }
    
    // Prüfe ob noch Items verfügbar
    if (item.currentIndex >= item.inscriptionIds.length) {
      return res.status(400).json({ error: 'Series is sold out' });
    }

    // Prüfe Punkte
    const userPoints = pointsService.getPoints(walletAddress);
    if (userPoints.total < item.pointsCost) {
      return res.status(400).json({ error: `Not enough points. Required: ${item.pointsCost}, You have: ${userPoints.total}` });
    }

    // Hole nächste Inskription (sequenziell)
    const seriesResult = await pointShopService.getNextSeriesInscription(itemId);
    if (!seriesResult) {
      return res.status(400).json({ error: 'Series is sold out or no more items available' });
    }

    // Subtrahiere Punkte
    pointsService.addPoints(
      walletAddress,
      -item.pointsCost,
      `purchased point shop series item: ${item.title} (#${seriesResult.currentNumber}/${seriesResult.totalCount})`,
      { 
        itemId, 
        itemTitle: item.title, 
        itemType: 'series',
        inscriptionId: seriesResult.inscriptionId,
        currentNumber: seriesResult.currentNumber,
        totalCount: seriesResult.totalCount,
        remaining: seriesResult.remaining
      }
    );

    console.log(`[PointShop] ✅ ${item.pointsCost} points deducted from ${walletAddress} for series item: ${item.title} (#${seriesResult.currentNumber}/${seriesResult.totalCount})`);
    
    // Gebe Serie-Informationen zurück
    const response = {
      success: true,
      message: 'Points deducted successfully',
      itemType: 'series',
      inscriptionId: seriesResult.inscriptionId,
      currentNumber: seriesResult.currentNumber,
      totalCount: seriesResult.totalCount,
      remaining: seriesResult.remaining,
      inscriptionItemType: seriesResult.inscriptionItemType,
      item: item
    };
    
    res.json(response);
  } catch (error) {
    console.error('[PointShop] ❌ Series mint error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== COLLECTION ENDPOINTS ==========

// Get all active collections
app.get('/api/collections', async (req, res) => {
  try {
    const category = req.query.category;
    const page = req.query.page;
    const collections = await collectionService.getAllCollections(category, page);
    res.json({ collections });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get single collection
app.get('/api/collections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const collection = await collectionService.getCollection(id);
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    res.json(collection);
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Get wallet inscriptions
app.get('/api/collections/admin/wallet-inscriptions', async (req, res) => {
  try {
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const address = getValidAddress(req.query.address) ||
                   getValidAddress(req.headers['x-admin-address']) ||
                   getValidAddress(req.headers['X-Admin-Address']) ||
                   getValidAddress(req.body.address) ||
                   getValidAddress(req.body.adminAddress);
    
    console.log(`[Collections] Wallet inscriptions request`);
    console.log(`[Collections] Query address:`, req.query.address);
    console.log(`[Collections] Header x-admin-address:`, req.headers['x-admin-address']);
    console.log(`[Collections] Header X-Admin-Address:`, req.headers['X-Admin-Address']);
    console.log(`[Collections] Extracted address:`, address);
    
    if (!address) {
      return res.status(400).json({ error: 'Missing address parameter' });
    }

    // Prüfe Admin-Rechte
    console.log(`[Collections] Checking admin for wallet inscriptions: ${address}`);
    if (!isAdmin(address)) {
      console.log(`[Collections] ❌ Access denied for: ${address}`);
      return res.status(403).json({ error: 'Admin access required' });
    }

    console.log(`[Collections] ✅ Admin access granted, fetching inscriptions for: ${address}`);

    // Verwende die Funktion, die ALLE Inskriptionen mit automatischer Pagination lädt
    try {
      const inscriptions = await blockchainDelegateService.getAllInscriptionsByAddress(address);
      console.log(`[Collections] ✅ Retrieved ${inscriptions.length} total inscriptions from blockchainDelegateService (all pages loaded)`);
      
      if (inscriptions.length > 0) {
        const firstIds = inscriptions.slice(0, 5).map(i => i.inscriptionId || i.id || 'unknown');
        console.log(`[Collections] First ${Math.min(5, inscriptions.length)} inscription IDs:`, firstIds);
        console.log(`[Collections] Sample inscription structure:`, JSON.stringify(inscriptions[0], null, 2).substring(0, 800));
      }
      
      // Formatiere für Frontend - BEHALTE ALLE Content-Types (HTML, SVG, Bilder, JSON, etc.)
      // WICHTIG: Für jede Inskription prüfen, ob sie eine Delegate-Inskription ist
      const formatted = await Promise.all(inscriptions.map(async (ins) => {
        const inscriptionId = ins.inscriptionId || ins.id || ins.inscription_id || ins.inscriptionid;
        const inscriptionNumber = ins.inscriptionNumber || ins.number || ins.num || ins.inscription_number || ins.inscriptionnumber;
        
        // Content-Type: Prüfe mehrere mögliche Felder (für alle Typen: HTML, SVG, Bilder, JSON, etc.)
        let contentType = ins.contentType || ins.content_type || ins.contenttype || 
                           ins.mimeType || ins.mime_type || ins.mime || 
                           ins.contentTypeName || 'unknown';
        
        // Definiere Variablen vor Verwendung
        const contentLength = ins.contentLength || ins.content_length || ins.contentlength || ins.size || 0;
        const name = ins.name || ins.meta?.name || ins.title || 
                    (inscriptionNumber ? `Inscription #${inscriptionNumber}` : `Inscription ${inscriptionId?.slice(0, 10)}...`) || 
                    'Unknown Inscription';
        
        // WICHTIG: Prüfe ob es eine Delegate-Inskription ist (sind HTML-Inskriptionen)
        // Delegate-Inskriptionen sollten als HTML gerendert werden, nicht als "unknown"
        // ABER: Für die Vorschauanzeige sollte das Original-Bild angezeigt werden, nicht der HTML-Content
        let isDelegate = false;
        let originalInscriptionId = null; // WICHTIG: Für Delegate-Inskriptionen - Original-Inskription-ID für Vorschau
        if (inscriptionId) {
          try {
            // Prüfe in der Delegate-Registry
            const delegateData = delegateRegistry.getDelegateCardData(inscriptionId);
            if (delegateData && delegateData.originalInscriptionId) {
              isDelegate = true;
              originalInscriptionId = delegateData.originalInscriptionId;
              contentType = 'text/html'; // Delegate-Inskriptionen sind HTML (aber zeigen Original-Bild an)
              console.log(`[Collections] ✅ Identified delegate inscription: ${inscriptionId} -> Original: ${originalInscriptionId} (setting contentType to text/html)`);
            }
          } catch (err) {
            // Registry-Fehler ignorieren (kann passieren, wenn Registry noch nicht geladen ist)
            console.log(`[Collections] ⚠️ Could not check delegate registry for ${inscriptionId}:`, err.message);
          }
          
          // Zusätzliche Prüfung: Versuche originalInscriptionId aus dem Content zu extrahieren
          // (falls Registry nicht verfügbar ist oder Inskription nicht in Registry)
          // WICHTIG: Prüfe IMMER, auch wenn contentType bereits bekannt ist (könnte HTML sein, das noch nicht als Delegate erkannt wurde)
          // ODER wenn contentType falsch ist (z.B. image/avif statt text/html für Delegate-Inskriptionen)
          if (!originalInscriptionId && ins.content && typeof ins.content === 'string') {
            try {
              // Versuche delegate-metadata aus HTML zu extrahieren
              const metadataMatch = ins.content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
              if (metadataMatch) {
                const metadata = JSON.parse(metadataMatch[1]);
                if (metadata.originalInscriptionId) {
                  isDelegate = true;
                  originalInscriptionId = metadata.originalInscriptionId;
                  contentType = 'text/html'; // Delegate-Inskriptionen sind HTML (korrigiere falschen Content-Type)
                  console.log(`[Collections] ✅ Extracted delegate metadata from content: ${inscriptionId} -> Original: ${originalInscriptionId} (was incorrectly typed as ${ins.contentType || 'unknown'})`);
                }
              }
              // Zusätzlich: Prüfe ob es ein <img> Tag mit /content/ Referenz gibt (Delegate-Indikator)
              // Dies funktioniert auch, wenn delegate-metadata fehlt
              if (!originalInscriptionId && (ins.content.includes('<img') || ins.content.includes('/content/'))) {
                const imgMatch = ins.content.match(/\/content\/([a-f0-9]{64}i\d+)/i);
                if (imgMatch && imgMatch[1] && imgMatch[1] !== inscriptionId) {
                  // Gefundene ID ist unterschiedlich = wahrscheinlich originalInscriptionId
                  isDelegate = true;
                  originalInscriptionId = imgMatch[1];
                  contentType = 'text/html'; // Korrigiere falschen Content-Type
                  console.log(`[Collections] ✅ Extracted originalInscriptionId from <img> tag: ${inscriptionId} -> Original: ${originalInscriptionId} (was incorrectly typed as ${ins.contentType || 'unknown'})`);
                }
              }
            } catch (parseErr) {
              // Ignoriere Parse-Fehler
              console.log(`[Collections] ⚠️ Error extracting delegate metadata from content for ${inscriptionId}:`, parseErr.message);
            }
          }
          
          // WICHTIG: Wenn Content-Type HTML ist UND keine originalInscriptionId gefunden wurde,
          // versuche Content direkt von ordinals.com zu holen (NUR für HTML-Inskriptionen)
          // ABER: Nur wenn Registry-Check fehlgeschlagen ist UND Content nicht vorhanden ist
          // PERFORMANCE: Nur die ersten 30 HTML-Inskriptionen prüfen (um Timeouts zu vermeiden)
          // Die anderen werden später geprüft, wenn der Benutzer sie benötigt
          const htmlCheckCount = inscriptions.slice(0, inscriptions.indexOf(ins) + 1).filter(i => {
            const ct = i.contentType || i.content_type || i.contenttype || i.mimeType || i.mime_type || i.mime || i.contentTypeName || 'unknown';
            return ct === 'text/html' || ct.includes('html') || ct === 'unknown';
          }).length;
          
          if (!originalInscriptionId && !ins.content && inscriptionId && htmlCheckCount <= 30 &&
              (contentType === 'text/html' || contentType.includes('html'))) {
            try {
              // Versuche Content direkt von ordinals.com zu holen (nur für HTML-Inskriptionen, nicht für Bilder)
              // Erstelle AbortController für Timeout (kompatibel mit älteren Node.js-Versionen)
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 Sekunden Timeout (noch schneller)
              
              const directResponse = await fetch(`https://ordinals.com/content/${inscriptionId}`, {
                method: 'GET',
                headers: {
                  'Accept': 'text/html,application/json,*/*',
                },
                signal: controller.signal,
              });
              
              clearTimeout(timeoutId); // Timeout löschen, wenn Request erfolgreich ist
              
              if (directResponse.ok) {
                const directContentType = directResponse.headers.get('content-type') || '';
                
                // Nur Text-Content holen (für HTML/JSON), nicht Bilder (zu groß und zu langsam)
                if (directContentType.includes('text/html') || directContentType.includes('application/json') || directContentType.includes('text/')) {
                  const directContent = await directResponse.text();
                  
                  // Prüfe ob es HTML mit Delegate-Metadaten ist
                  if (directContent && directContent.includes('delegate-metadata')) {
                    const metadataMatch = directContent.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
                    if (metadataMatch) {
                      try {
                        const metadata = JSON.parse(metadataMatch[1]);
                        if (metadata.originalInscriptionId) {
                          isDelegate = true;
                          originalInscriptionId = metadata.originalInscriptionId;
                          contentType = 'text/html'; // Korrigiere falschen Content-Type
                          console.log(`[Collections] ✅ CORRECTED: ${inscriptionId} is actually a delegate -> Original: ${originalInscriptionId} (was incorrectly typed as ${ins.contentType || 'unknown'})`);
                        }
                      } catch (parseErr) {
                        // Ignoriere Parse-Fehler
                      }
                    }
                  }
                  // Prüfe auch ob es ein <img> Tag mit /content/ Referenz gibt (Delegate-Indikator)
                  if (!originalInscriptionId && directContent && (directContent.includes('<img') || directContent.includes('/content/'))) {
                    const imgMatch = directContent.match(/\/content\/([a-f0-9]{64}i\d+)/i);
                    if (imgMatch && imgMatch[1] && imgMatch[1] !== inscriptionId) {
                      isDelegate = true;
                      originalInscriptionId = imgMatch[1];
                      contentType = 'text/html';
                      console.log(`[Collections] ✅ CORRECTED: ${inscriptionId} is actually a delegate (extracted from <img> tag) -> Original: ${originalInscriptionId} (was incorrectly typed as ${ins.contentType || 'unknown'})`);
                    }
                  }
                } else if (directContentType.includes('image/')) {
                  // Es ist tatsächlich ein Bild, nicht HTML - aktualisiere Content-Type
                  contentType = directContentType;
                }
              }
            } catch (fetchErr) {
              // Ignoriere Fetch-Fehler (kann passieren, wenn ordinals.com nicht erreichbar ist oder Timeout)
              // Diese Prüfung ist optional, daher Fehler ignorieren (sonst wird es zu langsam)
            }
          }
          
          // Zusätzliche Prüfung: Wenn Content-Type "unknown" ist, aber Content HTML enthält, setze auf text/html
          // Dies erkennt auch Delegate-Inskriptionen, die nicht in der Registry sind und keine delegate-metadata haben
          if (contentType === 'unknown' && !isDelegate && ins.content && typeof ins.content === 'string') {
            const contentLower = ins.content.toLowerCase();
            if (contentLower.includes('<!doctype html') || contentLower.includes('<html') || 
                contentLower.includes('delegate-metadata') || contentLower.includes('ord-20') ||
                contentLower.includes('<script') || contentLower.includes('<body') ||
                contentLower.includes('<head') || contentLower.includes('<div')) {
              contentType = 'text/html';
              // Versuche nochmal originalInscriptionId zu extrahieren (falls delegate-metadata vorhanden)
              if (!originalInscriptionId) {
                try {
                  const metadataMatch = ins.content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
                  if (metadataMatch) {
                    const metadata = JSON.parse(metadataMatch[1]);
                    if (metadata.originalInscriptionId) {
                      isDelegate = true;
                      originalInscriptionId = metadata.originalInscriptionId;
                      console.log(`[Collections] ✅ Detected HTML content AND extracted delegate metadata: ${inscriptionId} -> Original: ${originalInscriptionId}`);
                    } else {
                      // HTML gefunden, aber keine delegate-metadata - möglicherweise normales HTML
                      console.log(`[Collections] ✅ Detected HTML content for ${inscriptionId}, but no delegate metadata found (setting contentType to text/html)`);
                    }
                  } else {
                    // HTML gefunden, aber keine delegate-metadata - möglicherweise normales HTML
                    console.log(`[Collections] ✅ Detected HTML content for ${inscriptionId}, but no delegate metadata found (setting contentType to text/html)`);
                  }
                } catch (parseErr) {
                  // Ignoriere Parse-Fehler
                  console.log(`[Collections] ✅ Detected HTML content for ${inscriptionId} (setting contentType to text/html)`);
                }
              }
            }
          }
          
          // Fallback: Wenn Content-Type immer noch "unknown" ist und keine anderen Indikatoren vorhanden sind,
          // aber Content-Length > 0, könnte es auch HTML sein (versuche es als HTML)
          if (contentType === 'unknown' && contentLength > 0 && contentLength < 100000) {
            // Prüfe ob es ein bekannter Delegate-Standard ist (könnte auch ohne Content in der API-Antwort sein)
            // In diesem Fall lassen wir es als "unknown", aber Frontend kann es trotzdem als HTML versuchen
            console.log(`[Collections] ⚠️ Content-Type still unknown for ${inscriptionId} (length: ${contentLength}), Frontend will try HTML fallback`);
          }
        }
        
        // Timestamp: Verwende mehrere mögliche Quellen
        let timestamp = Date.now();
        if (ins.timestamp) {
          timestamp = typeof ins.timestamp === 'number' ? ins.timestamp : new Date(ins.timestamp).getTime();
        } else if (ins.createdAt) {
          timestamp = typeof ins.createdAt === 'number' ? ins.createdAt : new Date(ins.createdAt).getTime();
        } else if (ins.time) {
          timestamp = typeof ins.time === 'number' ? ins.time : new Date(ins.time).getTime();
        } else if (ins.genesisTimestamp) {
          timestamp = typeof ins.genesisTimestamp === 'number' ? ins.genesisTimestamp : new Date(ins.genesisTimestamp).getTime();
        }
        
        const result = {
          inscriptionId,
          inscriptionNumber,
          name,
          contentType,
          contentLength,
          timestamp,
          isDelegate, // Flag für Frontend
          originalInscriptionId, // WICHTIG: Für Delegate-Inskriptionen - Original-Inskription-ID für Vorschau
          // Behalte zusätzliche wichtige Felder
          address: ins.address || address,
          txid: ins.txid || ins.utxo?.txid || null,
          vout: ins.vout || ins.utxo?.vout || null,
        };
        
        // Debug-Logging für Delegate-Inskriptionen
        if (isDelegate || originalInscriptionId) {
          console.log(`[Collections] 📋 Delegate-Inskription erkannt: ${inscriptionId} -> isDelegate: ${isDelegate}, originalInscriptionId: ${originalInscriptionId}, contentType: ${contentType}`);
        }
        
        return result;
      })); // Promise.all für async map
      
      // Filtere Einträge ohne ID
      const filtered = formatted.filter(ins => ins.inscriptionId);

      // Logge Statistiken nach Content-Type
      const contentTypeStats = {};
      filtered.forEach(ins => {
        const ct = ins.contentType || 'unknown';
        contentTypeStats[ct] = (contentTypeStats[ct] || 0) + 1;
      });
      
      // Logge auch Delegate-Statistiken
      const delegateStats = {
        total: filtered.length,
        delegates: filtered.filter(ins => ins.isDelegate === true).length,
        delegatesWithOriginal: filtered.filter(ins => ins.isDelegate === true && ins.originalInscriptionId).length,
        htmlInscriptions: filtered.filter(ins => (ins.contentType || '').includes('html')).length,
      };
      
      // Zeige erste Delegate-Inskriptionen für Debugging
      const foundDelegates = filtered.filter(ins => ins.isDelegate === true);
      if (foundDelegates.length > 0) {
        console.log(`[Collections] ✅ Found ${foundDelegates.length} delegate inscriptions! First 3:`, foundDelegates.slice(0, 3).map(d => ({
          inscriptionId: d.inscriptionId,
          originalInscriptionId: d.originalInscriptionId,
          contentType: d.contentType
        })));
      } else {
        // Nur warnen wenn tatsächlich HTML-Inskriptionen vorhanden sind, aber keine Delegates gefunden wurden
        if (delegateStats.htmlInscriptions > 0) {
          console.warn(`[Collections] ⚠️ NO delegate inscriptions found! Total inscriptions: ${filtered.length}, HTML inscriptions: ${delegateStats.htmlInscriptions}`);
          console.warn(`[Collections] ⚠️ This might mean:`);
          console.warn(`[Collections]   1. Registry check failed or Registry is empty`);
          console.warn(`[Collections]   2. Content fetch from ordinals.com failed or timed out`);
          console.warn(`[Collections]   3. Delegate inscriptions are not in the wallet`);
        } else {
          // Wenn keine HTML-Inskriptionen vorhanden sind, ist das normal (z.B. nur SVG/Bilder)
          console.log(`[Collections] ℹ️ No delegate inscriptions found (${filtered.length} total inscriptions, ${delegateStats.htmlInscriptions} HTML inscriptions). This is normal if the wallet only contains image/SVG inscriptions.`);
        }
      }
      
      console.log(`[Collections] 📊 Content-Type Verteilung:`, contentTypeStats);
      console.log(`[Collections] 📊 Delegate-Statistiken:`, delegateStats);
      console.log(`[Collections] ✅ Successfully formatted ${filtered.length} inscriptions for frontend (total loaded: ${inscriptions.length})`);
      
      res.json({ inscriptions: filtered });
    } catch (error) {
      console.error(`[Collections] ❌ Error fetching inscriptions using blockchainDelegateService:`, error.message);
      console.error(`[Collections] Error stack:`, error.stack);
      
      // Fallback 1: Versuche UTXO-Data Endpoint und extrahiere Inskriptionen
      console.log(`[Collections] Attempting fallback 1: UTXO-Data endpoint...`);
      try {
        const utxoUrl = `${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/utxo-data`;
        const utxoResponse = await fetch(utxoUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${UNISAT_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (utxoResponse.ok) {
          const utxoData = await utxoResponse.json();
          console.log(`[Collections] ✅ UTXO-Data endpoint succeeded!`);
          console.log(`[Collections] UTXO-Data structure:`, JSON.stringify(utxoData, null, 2).substring(0, 1000));
          
          // UTXO-Data Format: { code: 0, data: [{ txid, vout, inscriptions: [...] }, ...] }
          // Extrahiere alle Inskriptionen aus UTXOs
          const utxos = (utxoData.code === 0 && utxoData.data) ? (Array.isArray(utxoData.data) ? utxoData.data : []) : [];
          const allInscriptions = [];
          
          for (const utxo of utxos) {
            if (utxo.inscriptions && Array.isArray(utxo.inscriptions)) {
              allInscriptions.push(...utxo.inscriptions);
            } else if (utxo.inscriptionId || utxo.inscription) {
              // Einzelne Inskription im UTXO
              allInscriptions.push(utxo.inscriptionId || utxo.inscription || utxo);
            }
          }
          
          console.log(`[Collections] Extracted ${allInscriptions.length} inscriptions from ${utxos.length} UTXOs`);
          
          if (allInscriptions.length > 0) {
            const formatted = allInscriptions.map(ins => {
              const inscriptionId = typeof ins === 'string' ? ins : (ins.inscriptionId || ins.id || ins.inscriptionId);
              return {
                inscriptionId,
                name: `Inscription ${inscriptionId?.slice(0, 10)}...` || 'Unknown',
                contentType: 'unknown',
                contentLength: 0,
                inscriptionNumber: null,
                timestamp: Date.now(),
              };
            }).filter(ins => ins.inscriptionId);
            
            res.json({ inscriptions: formatted });
            return;
          }
        }
      } catch (utxoError) {
        console.warn(`[Collections] ⚠️ UTXO-Data fallback failed:`, utxoError.message);
      }
      
      // Fallback 2: Versuche alternative Endpoints
      console.log(`[Collections] Attempting fallback 2: Alternative endpoints...`);
      const alternativeEndpoints = [
        `${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}/inscription-utxo-data`,
        `${UNISAT_API_URL}/v1/indexer/address/${encodeURIComponent(address)}`,
      ];
      
      for (const url of alternativeEndpoints) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${UNISAT_API_KEY}`,
              'Content-Type': 'application/json',
            },
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`[Collections] ✅ Alternative endpoint succeeded: ${url}`);
            console.log(`[Collections] Response structure:`, JSON.stringify(data, null, 2).substring(0, 1000));
            
            // Versuche die Daten zu extrahieren
            let inscriptions = [];
            if (data.code === 0 && data.data) {
              inscriptions = data.data.list || data.data.inscriptions || data.data || [];
            } else if (Array.isArray(data.data)) {
              inscriptions = data.data;
            } else if (Array.isArray(data)) {
              inscriptions = data;
            }
            
            const formatted = inscriptions.map(ins => ({
              inscriptionId: ins.inscriptionId || ins.id || ins.inscription_id || ins.inscriptionid,
              name: ins.name || `Inscription #${ins.inscriptionNumber || 'Unknown'}`,
              contentType: ins.contentType || ins.mimeType || 'unknown',
              contentLength: ins.contentLength || ins.size || 0,
              inscriptionNumber: ins.inscriptionNumber || ins.number,
              timestamp: ins.timestamp || ins.createdAt || Date.now(),
            })).filter(ins => ins.inscriptionId);
            
            res.json({ inscriptions: formatted });
            return;
          }
        } catch (altError) {
          console.warn(`[Collections] ⚠️ Alternative endpoint ${url} failed:`, altError.message);
        }
      }
      
      // Alle Fallbacks fehlgeschlagen
      console.error(`[Collections] ❌ All methods failed to fetch inscriptions`);
      res.status(500).json({ error: `Failed to fetch inscriptions: ${error.message}. Check server logs for details. All UniSat API endpoints returned 404. This might mean: 1) API structure changed, 2) API key invalid, 3) Wallet address has no inscriptions.` });
    }
  } catch (error) {
    console.error('[Collections] ❌ Error fetching wallet inscriptions:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Create collection
app.post('/api/collections/admin/create', async (req, res) => {
  try {
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    console.log(`[Collections] Create request`);
    console.log(`[Collections] Query adminAddress:`, req.query.adminAddress);
    console.log(`[Collections] Header x-admin-address:`, req.headers['x-admin-address']);
    console.log(`[Collections] Header X-Admin-Address:`, req.headers['X-Admin-Address']);
    console.log(`[Collections] Body adminAddress:`, req.body?.adminAddress);
    console.log(`[Collections] Extracted adminAddress:`, adminAddress);
    
    if (!adminAddress) {
      console.log(`[Collections] ❌ No admin address provided`);
      return res.status(401).json({ error: 'Unauthorized: Admin address required' });
    }
    
    if (!isAdmin(adminAddress)) {
      console.log(`[Collections] ❌ Access denied for: ${adminAddress}`);
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    console.log(`[Collections] ✅ Admin access granted: ${adminAddress}`);
    
    const { name, description, thumbnail, price, items, mintType } = req.body;
    
    if (!name || !price || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: name, price, items' });
    }

    const collection = await collectionService.createCollection({
      name,
      description: description || '',
      thumbnail: thumbnail || '',
      price: parseFloat(price),
      category: req.body.category || 'default', // Unterstützung für Kategorien
      page: req.body.page || null, // Seiten-Zuordnung (z.B. 'smile-a-bit', 'tech-games', etc.)
      mintType: req.body.mintType || 'individual',
      showBanner: req.body.showBanner !== undefined ? req.body.showBanner : false,
      items: items.map(item => ({
        inscriptionId: item.inscriptionId,
        name: item.name || `Item ${item.inscriptionId.slice(0, 10)}...`,
        type: item.type || 'delegate',
        imageUrl: item.imageUrl,
      })),
    });
    
    console.log(`[Collections] ✅ Admin created collection: ${collection.id} - ${name}`);
    res.json({ success: true, collection });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Update collection
app.put('/api/collections/admin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    console.log(`[Collections] Update request for collection ${id}`);
    console.log(`[Collections] Admin address:`, adminAddress);
    
    if (!adminAddress) {
      return res.status(401).json({ error: 'Unauthorized: Admin address required' });
    }
    
    if (!isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    const { name, description, thumbnail, price, items, mintType, showBanner } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (thumbnail !== undefined) updates.thumbnail = thumbnail;
    if (price !== undefined) updates.price = parseFloat(price);
    if (req.body.category !== undefined) updates.category = req.body.category;
    if (req.body.page !== undefined) updates.page = req.body.page;
    if (mintType !== undefined) updates.mintType = mintType;
    if (showBanner !== undefined) updates.showBanner = showBanner;
    if (items !== undefined && Array.isArray(items)) {
      updates.items = items.map(item => ({
        inscriptionId: item.inscriptionId,
        name: item.name || `Item ${item.inscriptionId.slice(0, 10)}...`,
        type: item.type || 'delegate',
        imageUrl: item.imageUrl,
      }));
    }

    const collection = await collectionService.updateCollection(id, updates);
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    console.log(`[Collections] ✅ Admin updated collection: ${id}`);
    res.json({ success: true, collection });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Delete/Deactivate collection
app.delete('/api/collections/admin/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const adminAddress = req.headers['x-admin-address'] || 
                         req.headers['X-Admin-Address'] ||
                         req.query.adminAddress ||
                         req.body.adminAddress;
    
    console.log(`[Collections] Delete request for collection ${id}`);
    console.log(`[Collections] Admin address from headers:`, req.headers['x-admin-address'] || req.headers['X-Admin-Address']);
    console.log(`[Collections] Admin address from query:`, req.query.adminAddress);
    console.log(`[Collections] Admin address from body:`, req.body.adminAddress);
    console.log(`[Collections] Final adminAddress:`, adminAddress);
    
    if (!adminAddress) {
      console.log(`[Collections] ❌ No admin address provided`);
      return res.status(401).json({ error: 'Unauthorized: Admin address required' });
    }
    
    if (!isAdmin(adminAddress)) {
      console.log(`[Collections] ❌ Access denied for: ${adminAddress}`);
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    console.log(`[Collections] ✅ Admin access granted, deactivating collection: ${id}`);
    await collectionService.deactivateCollection(id);
    
    console.log(`[Collections] ✅ Admin deactivated collection: ${id}`);
    res.json({ success: true });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Erase collection (permanently delete)
app.delete('/api/collections/admin/:id/erase', async (req, res) => {
  try {
    const { id } = req.params;
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const adminAddress = req.headers['x-admin-address'] || 
                         req.headers['X-Admin-Address'] ||
                         req.query.adminAddress ||
                         req.body.adminAddress;
    
    console.log(`[Collections] ERASE request for collection ${id}`);
    console.log(`[Collections] Admin address:`, adminAddress);
    
    if (!adminAddress) {
      console.log(`[Collections] ❌ No admin address provided`);
      return res.status(401).json({ error: 'Unauthorized: Admin address required' });
    }
    
    if (!isAdmin(adminAddress)) {
      console.log(`[Collections] ❌ Access denied for: ${adminAddress}`);
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    console.log(`[Collections] ⚠️ Admin access granted, PERMANENTLY DELETING collection: ${id}`);
    await collectionService.deleteCollection(id);
    
    console.log(`[Collections] ✅ Admin PERMANENTLY DELETED collection: ${id}`);
    res.json({ success: true, message: 'Collection permanently deleted' });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Test endpoint to debug admin check
app.get('/api/test-admin', (req, res) => {
  const { address } = req.query;
  const result = {
    address: address,
    adminAddresses: ADMIN_ADDRESSES,
    isAdmin: isAdmin(address),
    normalizedAddress: address ? address.toLowerCase() : null,
  };
  console.log('[Test Admin] Result:', JSON.stringify(result, null, 2));
  res.json(result);
});

// Admin: Get all collections (including inactive)
app.get('/api/collections/admin/all', async (req, res) => {
  try {
    // Prüfe Header, Body und Query-Parameter (wie requireAdmin)
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    console.log(`[Collections Admin All] Checking admin: ${adminAddress}`);
    console.log(`[Collections Admin All] Admin addresses:`, ADMIN_ADDRESSES);
    
    if (!adminAddress) {
      console.log(`[Collections Admin All] ❌ No admin address provided`);
      return res.status(401).json({ error: 'Unauthorized: Admin address required' });
    }
    
    if (!isAdmin(adminAddress)) {
      console.log(`[Collections Admin All] ❌ Access denied for: ${adminAddress}`);
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    console.log(`[Collections Admin All] ✅ Access granted for: ${adminAddress}`);
    const category = req.query.category;
    const collections = await collectionService.getAllCollectionsAdmin(category);
    res.json({ collections });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Set Collection mintType to random (für SMILE A BIT)
app.post('/api/collections/admin/:id/set-random', async (req, res) => {
  try {
    const { id } = req.params;
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    const collection = await collectionService.updateCollection(id, { mintType: 'random' });
    
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    console.log(`[Collections] ✅ Admin set collection ${id} to random mint`);
    res.json({ success: true, collection });
  } catch (error) {
    console.error('[Collections] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Mint original ordinal from collection
// Unterstützt zwei Modi:
// 1. Ohne signedPsbt: Erstellt PSBT und gibt es zurück (requiresSigning: true)
// 2. Mit signedPsbt: Broadcastet die signierte Transaktion
app.post('/api/collections/mint-original', async (req, res) => {
  try {
    const { walletAddress, collectionId, itemId, feeRate, walletType, signedPsbt } = req.body;
    
    if (!walletAddress || !collectionId || !itemId || !feeRate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const collection = await collectionService.getCollection(collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    const item = collection.items.find(i => i.inscriptionId === itemId);
    if (!item || item.type !== 'original') {
      return res.status(400).json({ error: 'Item not found or not an original ordinal' });
    }

    // WICHTIG: Für Original Items, die von Admin-Adressen gehalten werden:
    // Der Benutzer kann die PSBT nicht signieren, weil er die Admin-Adresse nicht kontrolliert
    // 
    // Lösung: Wir geben dem Benutzer die PSBT, aber mit einem Hinweis, dass er sie nicht signieren kann
    // Der Admin muss die PSBT manuell signieren (z.B. über ein Admin-Panel oder manuell)
    // ODER: Die Ordinals müssen bereits an die Benutzer-Adresse transferiert werden, bevor sie zum Verkauf angeboten werden
    
    const psbtData = await ordinalTransferService.preparePresignedTransfer(
      item.inscriptionId,
      walletAddress,
      parseInt(feeRate, 10)
    );
    
    const ownerAddress = psbtData.ownerAddress;
    const isAdminAddress = ownerAddress && ADMIN_ADDRESSES.some(addr => addr.toLowerCase() === ownerAddress.toLowerCase());
    
    // WICHTIG: Für sofortige Transfers MUSS ADMIN_PRIVATE_KEY gesetzt sein!
    // Ohne Private Key kann der Admin die PSBT nicht automatisch signieren.
    // Für "sofort" nach Kauf gibt es keine Alternative - der Admin MUSS signieren.
    if (isAdminAddress) {
      // Debug: Prüfe ob ADMIN_PRIVATE_KEY gesetzt ist
      const hasAdminKey = !!(process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_WIF);
      console.log(`[Collections] 🔍 ADMIN_PRIVATE_KEY check:`, {
        ADMIN_PRIVATE_KEY: process.env.ADMIN_PRIVATE_KEY ? 'SET' : 'NOT SET',
        ADMIN_WIF: process.env.ADMIN_WIF ? 'SET' : 'NOT SET',
        hasAdminKey: hasAdminKey,
        keyLength: process.env.ADMIN_PRIVATE_KEY?.length || 0,
      });
      
      // Automatische Signatur (wenn ADMIN_PRIVATE_KEY gesetzt) - SOFORT!
      if (hasAdminKey) {
        console.log(`[Collections] 🔐 Admin address detected - signing PSBT automatically in backend (INSTANT TRANSFER)`);
        console.log(`[Collections] Owner address: ${ownerAddress} (admin address)`);
        
        try {
          // ✅ WICHTIG: Verwende signPSBTForImmediateTransfer für Collection Minting
          // Dies verwendet SIGHASH_ALL für sofortige Transfers (keine weiteren Inputs möglich)
          console.log(`[Collections] 🔐 Using signPSBTForImmediateTransfer (SIGHASH_ALL mode)`);
          const signedPsbt = await ordinalTransferService.signPSBTForImmediateTransfer(psbtData.psbtBase64);
          const transferResult = await ordinalTransferService.transferOrdinal(
            item.inscriptionId,
            walletAddress,
            parseInt(feeRate, 10),
            signedPsbt
          );
          
          console.log(`[Collections] ✅ Original ordinal ${item.inscriptionId} transferred to ${walletAddress} (INSTANT - auto-signed with SIGHASH_ALL)`);
          
          // 💎 PUNKTESYSTEM: Vergebe Punkte für Collection Mint
          try {
            const pointsToAdd = collection.isPremium 
              ? pointsService.POINTS_CONFIG['premium-mint'] 
              : pointsService.POINTS_CONFIG['normal-mint'];
            
            const pointsResult = await pointsService.addPoints(
              walletAddress,
              pointsToAdd,
              `minted collection: ${collection.name} (${collection.isPremium ? 'premium' : 'normal'})`,
              { 
                collectionId: collection.id,
                collectionName: collection.name,
                isPremium: collection.isPremium,
                inscriptionId: item.inscriptionId,
                txid: transferResult.txid
              }
            );
            console.log(`[Collections] 💎 Added ${pointsToAdd} points (+ ${pointsResult.bonus} bonus) to ${walletAddress}. Total: ${pointsResult.total}`);
          } catch (pointsErr) {
            console.error(`[Collections] ❌ Failed to add points (non-blocking):`, pointsErr);
            // Non-blocking - Mint war erfolgreich
          }
          
          res.json({
            success: true,
            message: 'Transfer completed successfully - inscription is on its way!',
            txid: transferResult.txid,
            inscriptionId: item.inscriptionId,
            instant: true,
            signingMode: 'SIGHASH_ALL (immediate transfer)',
          });
          return; // Wichtig: Return hier
        } catch (signError) {
          console.error(`[Collections] ❌ Failed to sign PSBT with admin key:`, signError);
          console.error(`[Collections] Error details:`, signError.message);
          throw new Error(`Failed to sign and transfer: ${signError.message}. Please ensure ADMIN_PRIVATE_KEY is correctly set in Railway.`);
        }
      } else {
        // KEIN ADMIN_PRIVATE_KEY gesetzt - kann nicht sofort transferieren!
        console.error(`[Collections] ❌ ADMIN_PRIVATE_KEY not set - cannot perform instant transfer`);
        console.error(`[Collections] ⚠️ For instant transfers, ADMIN_PRIVATE_KEY must be set in Railway environment variables`);
        console.error(`[Collections] Current process.env.ADMIN_PRIVATE_KEY:`, process.env.ADMIN_PRIVATE_KEY ? 'SET (but may be empty)' : 'NOT SET');
        
        res.status(500).json({
          error: 'ADMIN_PRIVATE_KEY not configured',
          message: 'Instant transfer requires ADMIN_PRIVATE_KEY to be set in Railway. Please configure it to enable instant transfers.',
          requiresAdminSigning: false,
          instructions: '1. Go to Railway → Backend Service → Variables\n2. Add ADMIN_PRIVATE_KEY with value: Kxtc8p82sqppSrrcRnFkjE8Po2uJsAmo7nrdHyXde4n6S4YQMuqV\n3. Redeploy the backend',
        });
        return;
      }
    } 
    // Wenn signedPsbt vorhanden ist (vom Frontend ODER vom Admin-Panel), broadcasten
    if (signedPsbt) {
      console.log(`[Collections] 🔄 Broadcasting signed PSBT for ${item.inscriptionId} to ${walletAddress}`);
      console.log(`[Collections] Signed PSBT format: ${signedPsbt.length} chars, isHex: ${/^[0-9a-fA-F]+$/.test(signedPsbt)}`);
      
      const transferResult = await ordinalTransferService.transferOrdinal(
        item.inscriptionId,
        walletAddress,
        parseInt(feeRate, 10),
        signedPsbt
      );
      
      console.log(`[Collections] ✅ Original ordinal ${item.inscriptionId} transferred to ${walletAddress}`);
      console.log(`[Collections] 📝 Transaction ID: ${transferResult.txid}`);
      
      // 💎 PUNKTESYSTEM: Vergebe Punkte für Collection Mint
      try {
        const pointsToAdd = collection.isPremium 
          ? pointsService.POINTS_CONFIG['premium-mint'] 
          : pointsService.POINTS_CONFIG['normal-mint'];
        
        const pointsResult = await pointsService.addPoints(
          walletAddress,
          pointsToAdd,
          `minted collection: ${collection.name} (${collection.isPremium ? 'premium' : 'normal'})`,
          { 
            collectionId: collection.id,
            collectionName: collection.name,
            isPremium: collection.isPremium,
            inscriptionId: item.inscriptionId,
            txid: transferResult.txid
          }
        );
        console.log(`[Collections] 💎 Added ${pointsToAdd} points (+ ${pointsResult.bonus} bonus) to ${walletAddress}. Total: ${pointsResult.total}`);
      } catch (pointsErr) {
        console.error(`[Collections] ❌ Failed to add points (non-blocking):`, pointsErr);
        // Non-blocking - Mint war erfolgreich
      }
      
      res.json({
        success: true,
        message: 'Transfer completed successfully',
        txid: transferResult.txid,
        inscriptionId: item.inscriptionId,
      });
    } 
    // Sonst: Erstelle PSBT für Frontend-Signing
    else {
      console.log(`[Collections] 🔄 Creating PSBT for ${item.inscriptionId} to ${walletAddress}`);
      console.log(`[Collections] Owner address: ${ownerAddress} (user will sign)`);
      
      res.json({
        success: true,
        requiresSigning: true,
        psbtBase64: psbtData.psbtBase64,
        inscriptionId: item.inscriptionId,
        feeRate: parseInt(feeRate, 10),
        recipientAddress: walletAddress,
        ownerAddress: ownerAddress,
      });
    }
  } catch (error) {
    console.error('[Collections] ❌ Transfer error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== ADMIN TRANSFER QUEUE ENDPOINTS ==========

// Get transfer queue (für Admin-Panel)
app.get('/api/collections/admin/transfer-queue', requireAdmin, async (req, res) => {
  try {
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    // Hole Transfer-Queue (aus Memory oder Datenbank)
    const queue = global.transferQueue || [];
    
    // Filtere nach Status
    const status = req.query.status || 'pending';
    const filteredQueue = status === 'all' 
      ? queue 
      : queue.filter(item => item.status === status);
    
    res.json({
      success: true,
      queue: filteredQueue,
      total: queue.length,
      pending: queue.filter(item => item.status === 'pending').length,
      completed: queue.filter(item => item.status === 'completed').length,
      failed: queue.filter(item => item.status === 'failed').length,
    });
  } catch (error) {
    console.error('[Collections] ❌ Error getting transfer queue:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin signiert PSBT aus Queue (vom Admin-Panel)
app.post('/api/collections/admin/sign-transfer', requireAdmin, async (req, res) => {
  try {
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    const { transferQueueId, signedPsbt } = req.body;
    
    if (!transferQueueId || !signedPsbt) {
      return res.status(400).json({ error: 'Missing transferQueueId or signedPsbt' });
    }
    
    // Finde Transfer-Queue-Entry
    const queue = global.transferQueue || [];
    const queueEntry = queue.find(item => item.id === transferQueueId);
    
    if (!queueEntry) {
      return res.status(404).json({ error: 'Transfer queue entry not found' });
    }
    
    if (queueEntry.status !== 'pending') {
      return res.status(400).json({ error: `Transfer already ${queueEntry.status}` });
    }
    
    console.log(`[Collections] 🔐 Admin signing transfer: ${transferQueueId}`);
    console.log(`[Collections] Inscription: ${queueEntry.inscriptionId}`);
    console.log(`[Collections] Recipient: ${queueEntry.recipientAddress}`);
    
    // Broadcast die signierte PSBT
    try {
      const transferResult = await ordinalTransferService.transferOrdinal(
        queueEntry.inscriptionId,
        queueEntry.recipientAddress,
        queueEntry.feeRate,
        signedPsbt
      );
      
      // Update Queue-Entry
      queueEntry.status = 'completed';
      queueEntry.txid = transferResult.txid;
      queueEntry.completedAt = new Date().toISOString();
      
      console.log(`[Collections] ✅ Transfer completed: ${transferResult.txid}`);
      
      res.json({
        success: true,
        message: 'Transfer completed successfully',
        txid: transferResult.txid,
        inscriptionId: queueEntry.inscriptionId,
        transferQueueId: transferQueueId,
      });
    } catch (broadcastError) {
      // Update Queue-Entry mit Fehler
      queueEntry.status = 'failed';
      queueEntry.error = broadcastError.message;
      queueEntry.failedAt = new Date().toISOString();
      
      console.error(`[Collections] ❌ Transfer failed:`, broadcastError);
      throw broadcastError;
    }
  } catch (error) {
    console.error('[Collections] ❌ Error signing transfer:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get recent minted items for a collection (or fallback to collection wallet items)
app.get('/api/collections/:collectionId/recent-mints', async (req, res) => {
  try {
    const { collectionId } = req.params;
    const limit = parseInt(req.query.limit || '10', 10);
    
    const collection = await collectionService.getCollection(collectionId);
    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    
    // Versuche, gemintete Items zu finden (durch Suche nach Delegates mit Collection-Name)
    // Für jetzt: Hole einfach die ersten Items vom ersten Admin-Wallet als Fallback
    const adminAddress = DEFAULT_ADMIN_ADDRESSES[0];
    
    if (!adminAddress) {
      return res.status(500).json({ error: 'No admin address available' });
    }
    
    try {
      // Hole Inskriptionen vom Admin-Wallet
      const inscriptions = await blockchainDelegateService.getAllInscriptionsByAddress(adminAddress);
      
      // Filtere nach Collection-Items (prüfe ob inscriptionId in collection.items ist)
      const collectionInscriptionIds = new Set(collection.items.map(item => item.inscriptionId));
      const collectionItems = inscriptions
        .filter(ins => collectionInscriptionIds.has(ins.inscriptionId))
        .slice(0, limit);
      
      // Formatiere für Frontend
      const formattedItems = collectionItems.map(ins => {
        const item = collection.items.find(i => i.inscriptionId === ins.inscriptionId);
        return {
          inscriptionId: ins.inscriptionId,
          name: item?.name || `Item ${ins.inscriptionId.slice(0, 10)}...`,
          imageUrl: item?.imageUrl || `${UNISAT_API_URL}/v1/indexer/inscription/info/${ins.inscriptionId}`,
          type: item?.type || 'delegate',
          mintedAt: ins.timestamp || Date.now(),
        };
      });
      
      // Falls nicht genug Items gefunden, fülle mit Collection-Items auf
      if (formattedItems.length < limit) {
        const remaining = limit - formattedItems.length;
        const usedIds = new Set(formattedItems.map(item => item.inscriptionId));
        const additionalItems = collection.items
          .filter(item => !usedIds.has(item.inscriptionId))
          .slice(0, remaining)
          .map(item => ({
            inscriptionId: item.inscriptionId,
            name: item.name,
            imageUrl: item.imageUrl || `${UNISAT_API_URL}/v1/indexer/inscription/info/${item.inscriptionId}`,
            type: item.type,
            mintedAt: Date.now(), // Placeholder timestamp
          }));
        formattedItems.push(...additionalItems);
      }
      
      res.json({ items: formattedItems.slice(0, limit) });
    } catch (error) {
      console.error('[Collections Recent Mints] ❌ Error fetching inscriptions:', error);
      // Fallback: Hole einfach die ersten Collection-Items
      const fallbackItems = collection.items.slice(0, limit).map(item => ({
        inscriptionId: item.inscriptionId,
        name: item.name,
        imageUrl: item.imageUrl || `${UNISAT_API_URL}/v1/indexer/inscription/info/${item.inscriptionId}`,
        type: item.type,
        mintedAt: Date.now(),
      }));
      res.json({ items: fallbackItems });
    }
  } catch (error) {
    console.error('[Collections Recent Mints] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Force re-migrate collections from JSON (wenn vorhanden)
app.post('/api/collections/admin/force-migrate', async (req, res) => {
  try {
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    console.log('[Collections] 🔄 Force migration requested by admin');
    
    if (!isDatabaseAvailable()) {
      return res.status(400).json({ error: 'Database not available. Collections are stored in JSON file only.' });
    }
    
    const pool = getPool();
    
    // Lösche Migration-Status, um erneute Migration zu ermöglichen
    await pool.query('DELETE FROM migration_status WHERE migration_name = $1', ['collections_json_to_db']);
    
    // Führe Migration erneut aus
    await collectionService.migrateCollectionsToDB();
    
    // Hole alle Collections
    const collections = await collectionService.getAllCollectionsAdmin();
    
    res.json({ 
      success: true, 
      message: 'Collections migration completed',
      collectionsCount: collections.length,
      collections: collections.map(c => ({ id: c.id, name: c.name, category: c.category }))
    });
  } catch (error) {
    console.error('[Collections] ❌ Error during force migration:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Get all collections from JSON (for backup/restore)
app.get('/api/collections/admin/json-backup', async (req, res) => {
  try {
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    // Lade Collections aus JSON (Fallback)
    // Verwende fs direkt, da loadCollections nicht exportiert ist
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const DATA_DIR = path.join(__dirname, 'data');
    const COLLECTIONS_FILE = path.join(DATA_DIR, 'collections.json');
    
    let collections = [];
    if (fs.existsSync(COLLECTIONS_FILE)) {
      try {
        const data = fs.readFileSync(COLLECTIONS_FILE, 'utf-8');
        const collectionsData = JSON.parse(data);
        collections = collectionsData.collections || [];
      } catch (error) {
        console.error('[Collections] Error loading JSON file:', error);
      }
    }
    
    res.json({ collections });
  } catch (error) {
    console.error('[Collections] ❌ Error loading JSON backup:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin: Restore collections from JSON backup
app.post('/api/collections/admin/restore-from-json', async (req, res) => {
  try {
    const getValidAddress = (value) => {
      if (!value) return null;
      if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
        return null;
      }
      return value;
    };
    
    const adminAddress = getValidAddress(req.query.adminAddress) ||
                        getValidAddress(req.headers['x-admin-address']) ||
                        getValidAddress(req.headers['X-Admin-Address']) ||
                        getValidAddress(req.body?.adminAddress);
    
    if (!adminAddress || !isAdmin(adminAddress)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }
    
    const { collections } = req.body;
    
    if (!collections || !Array.isArray(collections)) {
      return res.status(400).json({ error: 'Invalid collections data' });
    }
    
    console.log(`[Collections] 🔄 Restoring ${collections.length} collections from backup`);
    
    let restoredCount = 0;
    for (const collectionData of collections) {
      try {
        // Erstelle Collection neu (wird in DB und JSON gespeichert)
        // WICHTIG: Verwende die originale ID falls vorhanden (für Restore)
        await collectionService.createCollection({
          id: collectionData.id, // Behalte originale ID für Restore
          name: collectionData.name,
          description: collectionData.description || '',
          thumbnail: collectionData.thumbnail || '',
          price: collectionData.price || 0,
          items: collectionData.items || [],
          category: collectionData.category || 'default',
          page: collectionData.page || null,
          mintType: collectionData.mintType || collectionData.mint_type || 'individual',
          createdAt: collectionData.createdAt, // Behalte originale Timestamps
          active: collectionData.active !== false,
        });
        restoredCount++;
      } catch (error) {
        console.error(`[Collections] ❌ Error restoring collection ${collectionData.name}:`, error);
      }
    }
    
    res.json({ 
      success: true, 
      message: `Restored ${restoredCount} of ${collections.length} collections`,
      restoredCount,
      totalCount: collections.length
    });
  } catch (error) {
    console.error('[Collections] ❌ Error during restore:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== TRADE ENDPOINTS ==========

// Get Active Trade Offers
app.get('/api/trades/offers', (req, res) => {
  try {
    const offers = tradeOfferService.getActiveTradeOffers();
    res.json({ offers, count: offers.length });
  } catch (error) {
    console.error('[Trades] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Create Trade Offer - Schritt 1: Erstelle PSBTs mit Platzhalter-Empfänger
app.post('/api/trades/offers', async (req, res) => {
  try {
    const { maker, offerCards, requestCards, expiresAt, signature, signedPsbts } = req.body;
    
    if (!maker || !offerCards || !requestCards || !expiresAt) {
      return res.status(400).json({ error: 'Missing required fields: maker, offerCards, requestCards, expiresAt' });
    }

    if (!Array.isArray(offerCards) || offerCards.length === 0) {
      return res.status(400).json({ error: 'offerCards must be a non-empty array' });
    }

    if (!Array.isArray(requestCards) || requestCards.length === 0) {
      return res.status(400).json({ error: 'requestCards must be a non-empty array' });
    }

    console.log(`[Trades] Creating offer by ${maker}: ${offerCards.length} cards offered, ${requestCards.length} cards requested`);

    // Wenn signierte PSBTs vorhanden sind, speichere das Offer mit den signierten PSBTs
    if (signedPsbts && Array.isArray(signedPsbts) && signedPsbts.length > 0) {
      // Schritt 2: Offer mit signierten PSBTs speichern
      const offer = tradeOfferService.createTradeOffer(maker, offerCards, requestCards, expiresAt, signature || '');
      
      // Speichere signierte PSBTs im Offer (mit Platzhalter-Empfänger)
      tradeOfferService.saveMakerSignedPsbts(offer.offerId, signedPsbts);
      
      console.log(`[Trades] ✅ Trade offer created with ${signedPsbts.length} signed PSBTs (with placeholder recipient): ${offer.offerId}`);
      res.json({ ...offer, makerSignedPsbts: signedPsbts.length });
      return;
    }

    // Schritt 1: Erstelle PSBTs für jede angebotene Karte mit Platzhalter-Empfänger (Maker's Adresse)
    // Der Maker muss diese im Frontend signieren
    const feeRate = 5; // Standard Fee Rate für Trades
    const psbts = [];

    for (const cardId of offerCards) {
      try {
        // Erstelle PSBT mit Maker's Adresse als Platzhalter-Empfänger
        // Später beim Accept wird eine neue Transaktion mit richtigem Taker-Empfänger erstellt
        const psbtData = await ordinalTransferService.preparePresignedTransfer(
          cardId,
          maker, // Platzhalter: Sende an Maker selbst (wird beim Accept durch Taker ersetzt)
          feeRate
        );
        
        psbts.push({
          inscriptionId: cardId,
          psbtBase64: psbtData.psbtBase64,
          placeholderRecipient: maker, // Markiere als Platzhalter
        });
      } catch (error) {
        console.error(`[Trades] Error creating PSBT for card ${cardId}:`, error);
        return res.status(500).json({ 
          error: `Failed to create PSBT for card ${cardId}: ${error.message}` 
        });
      }
    }

    console.log(`[Trades] ✅ Created ${psbts.length} PSBTs with placeholder recipient (${maker}) for offer creation`);
    
    res.json({ 
      requiresSigning: true,
      psbts: psbts,
      message: 'Please sign all PSBTs in your wallet. These PSBTs use a placeholder recipient and will be replaced with the actual recipient when the offer is accepted.',
      offerCards,
      requestCards,
      expiresAt,
    });
  } catch (error) {
    console.error('[Trades] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get Trade Offer
app.get('/api/trades/offers/:offerId', (req, res) => {
  try {
    const { offerId } = req.params;
    const offer = tradeOfferService.getTradeOffer(offerId);
    
    if (!offer) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }
    
    res.json(offer);
  } catch (error) {
    console.error('[Trades] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Accept Trade Offer
app.post('/api/trades/offers/:offerId/accept', async (req, res) => {
  try {
    const { offerId } = req.params;
    const { taker, walletType } = req.body;
    
    if (!taker) {
      return res.status(400).json({ error: 'Missing required field: taker (wallet address)' });
    }

    const offer = tradeOfferService.getTradeOffer(offerId);
    
    if (!offer) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }

    if (offer.status !== 'active') {
      return res.status(400).json({ error: `Trade offer is not active (status: ${offer.status})` });
    }

    if (offer.maker.toLowerCase() === taker.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot accept your own trade offer' });
    }

    // Prüfe ob Offer abgelaufen ist
    const now = Math.floor(Date.now() / 1000);
    if (offer.expiresAt < now) {
      tradeOfferService.updateTradeOfferStatus(offerId, 'expired');
      return res.status(400).json({ error: 'Trade offer has expired' });
    }

    console.log(`[Trades] Accepting offer ${offerId} by ${taker}`);
    console.log(`[Trades] Offer: ${offer.offerCards.length} cards, Request: ${offer.requestCards.length} cards`);

    // Prüfe ob walletType angegeben ist
    if (!walletType || (walletType !== 'unisat' && walletType !== 'xverse')) {
      return res.status(400).json({ error: 'Invalid or missing walletType. Must be "unisat" or "xverse"' });
    }

    // Hole Taker's Delegates um die tatsächlichen Delegate-IDs zu finden
    const takerDelegates = await blockchainDelegateService.getDelegatesHybrid(taker);
    console.log(`[Trades] Found ${takerDelegates.length} delegates for taker ${taker}`);

    // Finde Taker's Delegates die zu den requestCards passen
    const takerCardsToTransfer = [];
    for (const requestedOriginalId of offer.requestCards) {
      // Finde einen Delegate des Takers, der auf diese Original-ID verweist
      const matchingDelegate = takerDelegates.find(
        (d) => d.originalInscriptionId === requestedOriginalId
      );
      if (matchingDelegate) {
        takerCardsToTransfer.push(matchingDelegate.inscriptionId);
      } else {
        return res.status(400).json({ 
          error: `Taker does not own a delegate for requested card: ${requestedOriginalId}` 
        });
      }
    }

    console.log(`[Trades] Taker will transfer ${takerCardsToTransfer.length} cards to maker`);
    console.log(`[Trades] Maker will transfer ${offer.offerCards.length} cards to taker`);

    // Prüfe ob Maker bereits signierte PSBTs hat (mit Platzhalter)
    const makerSignedPsbts = tradeOfferService.getMakerSignedPsbts(offerId);
    const hasMakerSignedPsbts = makerSignedPsbts && makerSignedPsbts.length > 0;
    
    if (hasMakerSignedPsbts) {
      console.log(`[Trades] ✅ Maker has already signed ${makerSignedPsbts.length} PSBTs (with placeholder). Creating new PSBTs with correct recipient.`);
    } else {
      console.log(`[Trades] ⚠️ Maker has not signed PSBTs yet. Creating new PSBTs for maker to sign.`);
    }

    // Erstelle PSBTs für beide Seiten des Trades
    const feeRate = 5; // Standard Fee Rate für Trades
    const makerPsbts = [];
    const takerPsbts = [];

    // 1. PSBTs für Maker's Karten → Taker (mit richtigem Empfänger)
    // Die bereits signierten PSBTs mit Platzhalter dienen als Verpflichtung,
    // aber wir erstellen neue PSBTs mit richtigem Empfänger für den tatsächlichen Transfer
    for (const makerCardId of offer.offerCards) {
      try {
        const psbtData = await ordinalTransferService.preparePresignedTransfer(
          makerCardId,
          taker, // Maker's Karten gehen an Taker (richtiger Empfänger)
          feeRate
        );
        makerPsbts.push({
          inscriptionId: makerCardId,
          recipient: taker,
          psbtBase64: psbtData.psbtBase64,
          from: 'maker',
        });
      } catch (error) {
        console.error(`[Trades] Error creating PSBT for maker card ${makerCardId}:`, error);
        return res.status(500).json({ 
          error: `Failed to create PSBT for maker card ${makerCardId}: ${error.message}` 
        });
      }
    }

    // 2. PSBTs für Taker's Karten → Maker (Taker muss diese signieren)
    for (const takerCardId of takerCardsToTransfer) {
      try {
        const psbtData = await ordinalTransferService.preparePresignedTransfer(
          takerCardId,
          offer.maker, // Taker's Karten gehen an Maker
          feeRate
        );
        takerPsbts.push({
          inscriptionId: takerCardId,
          recipient: offer.maker,
          psbtBase64: psbtData.psbtBase64,
          from: 'taker',
        });
      } catch (error) {
        console.error(`[Trades] Error creating PSBT for taker card ${takerCardId}:`, error);
        return res.status(500).json({ 
          error: `Failed to create PSBT for taker card ${takerCardId}: ${error.message}` 
        });
      }
    }

    console.log(`[Trades] ✅ Created ${makerPsbts.length} maker PSBTs and ${takerPsbts.length} taker PSBTs for trade ${offerId}`);
    
    // Markiere Offer als "pending" (wird erst auf "accepted" gesetzt nach erfolgreichem Broadcast)
    tradeOfferService.updateTradeOfferStatus(offerId, 'pending');
    
    // 💎 Speichere Taker im Offer (für Punktevergabe später)
    tradeOfferService.updateTradeOfferTaker(offerId, taker);
    
    // Speichere Maker-PSBTs im Offer (für später, wenn Maker signiert)
    tradeOfferService.saveMakerPsbts(offerId, makerPsbts);
    
    res.json({ 
      success: true, 
      requiresSigning: true,
      makerPsbts: makerPsbts, // PSBTs die der Maker signieren muss
      takerPsbts: takerPsbts, // PSBTs die der Taker signieren muss
      offerId: offerId,
      message: 'PSBTs created. Maker and Taker must sign their respective PSBTs. Taker can sign now, Maker must sign separately.',
      offer: tradeOfferService.getTradeOffer(offerId)
    });
  } catch (error) {
    console.error('[Trades] ❌ Error accepting offer:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Maker signiert seine PSBTs für ein Trade Offer
app.post('/api/trades/offers/:offerId/sign-maker', async (req, res) => {
  try {
    const { offerId } = req.params;
    const { signedPsbts } = req.body; // Array von { inscriptionId, signedPsbtHex }
    
    if (!signedPsbts || !Array.isArray(signedPsbts) || signedPsbts.length === 0) {
      return res.status(400).json({ error: 'Missing required field: signedPsbts (array)' });
    }

    const offer = tradeOfferService.getTradeOffer(offerId);
    if (!offer) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }

    // Speichere signierte Maker-PSBTs
    tradeOfferService.saveMakerSignedPsbts(offerId, signedPsbts);
    
    console.log(`[Trades] ✅ Maker signed ${signedPsbts.length} PSBTs for offer ${offerId}`);
    
    res.json({ 
      success: true,
      message: 'Maker PSBTs signed and saved. Trade can be completed when taker signs.',
      offer: tradeOfferService.getTradeOffer(offerId)
    });
  } catch (error) {
    console.error('[Trades] ❌ Error signing maker PSBTs:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Broadcast signierte PSBTs für Trade
app.post('/api/trades/offers/:offerId/broadcast', async (req, res) => {
  try {
    const { offerId } = req.params;
    const { signedPsbts } = req.body; // Array von { inscriptionId, signedPsbtHex } - Taker's PSBTs
    
    if (!signedPsbts || !Array.isArray(signedPsbts) || signedPsbts.length === 0) {
      return res.status(400).json({ error: 'Missing required field: signedPsbts (array)' });
    }

    const offer = tradeOfferService.getTradeOffer(offerId);
    if (!offer) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({ error: `Trade offer is not in pending state (status: ${offer.status})` });
    }

    // Hole signierte Maker-PSBTs (falls vorhanden)
    const makerSignedPsbts = tradeOfferService.getMakerSignedPsbts(offerId);
    
    // Kombiniere alle PSBTs (Maker + Taker)
    const allSignedPsbts = [];
    
    if (makerSignedPsbts && makerSignedPsbts.length > 0) {
      // Konvertiere Maker-PSBTs zu Broadcast-Format
      for (const makerPsbt of makerSignedPsbts) {
        allSignedPsbts.push({
          inscriptionId: makerPsbt.inscriptionId,
          signedPsbtHex: makerPsbt.signedPsbtHex,
        });
      }
      console.log(`[Trades] Using ${makerSignedPsbts.length} signed maker PSBTs`);
    } else {
      console.warn(`[Trades] ⚠️ No signed maker PSBTs found for offer ${offerId}. Only taker PSBTs will be broadcasted.`);
    }
    
    // Füge Taker's signierte PSBTs hinzu
    for (const takerPsbt of signedPsbts) {
      allSignedPsbts.push({
        inscriptionId: takerPsbt.inscriptionId,
        signedPsbtHex: takerPsbt.signedPsbtHex,
      });
    }
    
    console.log(`[Trades] Broadcasting ${allSignedPsbts.length} signed transactions for trade ${offerId} (${makerSignedPsbts?.length || 0} maker + ${signedPsbts.length} taker)`);

    // Broadcast alle signierten PSBTs
    const txids = [];
    for (const signedPsbt of allSignedPsbts) {
      if (!signedPsbt.inscriptionId || !signedPsbt.signedPsbtHex) {
        return res.status(400).json({ error: 'Each signedPsbt must have inscriptionId and signedPsbtHex' });
      }

      try {
        const transferResult = await ordinalTransferService.transferOrdinal(
          signedPsbt.inscriptionId,
          '', // recipientAddress nicht benötigt für Broadcast
          null, // feeRate nicht benötigt für Broadcast
          signedPsbt.signedPsbtHex
        );
        txids.push({
          inscriptionId: signedPsbt.inscriptionId,
          txid: transferResult.txid,
        });
        console.log(`[Trades] ✅ Broadcasted transaction for ${signedPsbt.inscriptionId}: ${transferResult.txid}`);
      } catch (error) {
        console.error(`[Trades] ❌ Error broadcasting transaction for ${signedPsbt.inscriptionId}:`, error);
        return res.status(500).json({ 
          error: `Failed to broadcast transaction for ${signedPsbt.inscriptionId}: ${error.message}` 
        });
      }
    }

    // Prüfe ob alle PSBTs gebroadcastet wurden
    const expectedCount = (makerSignedPsbts?.length || 0) + signedPsbts.length;
    const actualCount = txids.length;
    
    if (actualCount < expectedCount) {
      // Nicht alle PSBTs wurden erfolgreich gebroadcastet
      tradeOfferService.updateTradeOfferStatus(offerId, 'pending');
      console.warn(`[Trades] ⚠️ Trade ${offerId} partially completed. Only ${actualCount}/${expectedCount} transactions broadcasted.`);
      return res.json({ 
        success: true, 
        message: `Trade partially completed. ${actualCount}/${expectedCount} transactions broadcasted.`,
        txids: txids,
        partial: true,
        offer: tradeOfferService.getTradeOffer(offerId)
      });
    }

    // Vollständiger Trade abgeschlossen
    tradeOfferService.updateTradeOfferStatus(offerId, 'accepted');
    
    // 💎 PUNKTESYSTEM: Vergebe Punkte an beide Teilnehmer
    try {
      const maker = offer.maker;
      const taker = offer.taker; // Wurde im accept endpoint gespeichert
      
      if (maker && taker) {
        // Maker bekommt 5 Punkte
        await pointsService.addPoints(
          maker,
          pointsService.POINTS_CONFIG['trade'],
          `completed trade (maker): ${offer.offerCards.length} for ${offer.requestCards.length} cards`,
          { offerId, role: 'maker', offerCards: offer.offerCards, requestCards: offer.requestCards }
        );
        
        // Taker bekommt 5 Punkte
        await pointsService.addPoints(
          taker,
          pointsService.POINTS_CONFIG['trade'],
          `completed trade (taker): ${offer.requestCards.length} for ${offer.offerCards.length} cards`,
          { offerId, role: 'taker', offerCards: offer.offerCards, requestCards: offer.requestCards }
        );
        
        console.log(`[Trades] 💎 Added ${pointsService.POINTS_CONFIG['trade']} points each to maker (${maker}) and taker (${taker})`);
      } else {
        console.warn(`[Trades] ⚠️ Cannot add points: maker or taker missing (maker: ${maker}, taker: ${taker})`);
      }
    } catch (pointsErr) {
      console.error(`[Trades] ❌ Failed to add points (non-blocking):`, pointsErr);
      // Non-blocking - Trade war erfolgreich
    }
    
    console.log(`[Trades] ✅ Trade ${offerId} completed successfully. All ${actualCount} transactions broadcasted.`);
    res.json({ 
      success: true, 
      message: 'Trade completed successfully',
      txids: txids,
      offer: tradeOfferService.getTradeOffer(offerId)
    });
  } catch (error) {
    console.error('[Trades] ❌ Error broadcasting trade:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Cancel/Delete Trade Offer
app.delete('/api/trades/offers/:offerId', (req, res) => {
  try {
    const { offerId } = req.params;
    const { maker } = req.body; // Optional: Prüfe ob der Maker das Offer löscht
    
    const offer = tradeOfferService.getTradeOffer(offerId);
    
    if (!offer) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }

    // Optional: Prüfe ob nur der Maker sein eigenes Offer löschen kann
    if (maker && offer.maker.toLowerCase() !== maker.toLowerCase()) {
      return res.status(403).json({ error: 'Only the maker can cancel this trade offer' });
    }

    const success = tradeOfferService.deleteTradeOffer(offerId);
    
    if (!success) {
      return res.status(404).json({ error: 'Trade offer not found' });
    }
    
    console.log(`[Trades] ✅ Trade offer ${offerId} cancelled/deleted`);
    res.json({ success: true, message: 'Trade offer cancelled' });
  } catch (error) {
    console.error('[Trades] ❌ Error cancelling offer:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== ADMIN ENDPOINTS ==========

// Admin Middleware
function requireAdmin(req, res, next) {
  // Prüfe Header, Body und Query-Parameter (unterstützt verschiedene Formate)
  // Filtere 'undefined' Strings und leere Werte heraus
  const getValidAddress = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && (value === 'undefined' || value === 'null' || value.trim() === '')) {
      return null;
    }
    return value;
  };
  
  const walletAddress = getValidAddress(req.headers['x-admin-address']) || 
                       getValidAddress(req.headers['X-Admin-Address']) ||
                       getValidAddress(req.headers['x-wallet-address']) || 
                       getValidAddress(req.headers['X-Wallet-Address']) ||
                       getValidAddress(req.body.walletAddress) || 
                       getValidAddress(req.body.adminAddress) ||
                       getValidAddress(req.query.walletAddress) ||
                       getValidAddress(req.query.adminAddress) ||
                       getValidAddress(req.query.address);
  
  console.log(`[requireAdmin] 🔍 Checking admin access...`);
  console.log(`[requireAdmin] Headers:`, {
    'x-admin-address': req.headers['x-admin-address'],
    'X-Admin-Address': req.headers['X-Admin-Address'],
    'x-wallet-address': req.headers['x-wallet-address'],
    'X-Wallet-Address': req.headers['X-Wallet-Address'],
  });
  console.log(`[requireAdmin] Body:`, { 
    walletAddress: req.body.walletAddress, 
    adminAddress: req.body.adminAddress 
  });
  console.log(`[requireAdmin] Query:`, { 
    walletAddress: req.query.walletAddress, 
    adminAddress: req.query.adminAddress,
    address: req.query.address
  });
  console.log(`[requireAdmin] Extracted walletAddress:`, walletAddress);
  
  if (!walletAddress) {
    console.log(`[requireAdmin] ❌ No wallet address provided. Headers:`, Object.keys(req.headers).filter(k => k.toLowerCase().includes('admin') || k.toLowerCase().includes('wallet')));
    console.log(`[requireAdmin] Query params:`, Object.keys(req.query));
    return res.status(401).json({ error: 'Unauthorized: Wallet address required' });
  }
  
  const normalizedWalletAddress = walletAddress.toLowerCase().trim();
  console.log(`[requireAdmin] Normalized walletAddress:`, normalizedWalletAddress);
  console.log(`[requireAdmin] Calling isAdmin(${normalizedWalletAddress})...`);
  
  if (!isAdmin(normalizedWalletAddress)) {
    console.log(`[requireAdmin] ❌ Access denied for: ${walletAddress} (normalized: ${normalizedWalletAddress})`);
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  
  console.log(`[requireAdmin] ✅ ADMIN_ACCESS_GRANTED from ${walletAddress} (normalized: ${normalizedWalletAddress}) at ${new Date().toISOString()}`);
  next();
}

// Get All Delegates (Admin)
app.get('/api/admin/delegates', requireAdmin, (req, res) => {
  try {
    const allDelegates = delegateRegistry.getAllDelegates();
    res.json({ delegates: allDelegates, count: Object.keys(allDelegates).length });
  } catch (error) {
    console.error('[Admin] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Open Card Images Folder (Admin)
app.post('/api/admin/open-card-images', requireAdmin, async (req, res) => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    // Pfad zu den Kartenbildern (anpassen nach Bedarf)
    const cardImagesPath = path.join(__dirname, '../card-images');
    
    if (!fs.existsSync(cardImagesPath)) {
      return res.status(404).json({ error: 'Card images folder not found' });
    }

    // Öffne Ordner (Windows)
    if (process.platform === 'win32') {
      await execAsync(`explorer "${cardImagesPath}"`);
    } else if (process.platform === 'darwin') {
      await execAsync(`open "${cardImagesPath}"`);
  } else {
      await execAsync(`xdg-open "${cardImagesPath}"`);
    }

    res.json({ status: 'ok', message: 'Folder opened' });
  } catch (error) {
    console.error('[Admin] ❌ Error opening folder:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========== MISSING ENDPOINTS ==========

// Collection Stats
app.get('/api/collection/stats', (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Missing address parameter' });
    }

    // Placeholder: Gibt grundlegende Stats zurück
    const stats = {
      totalCollections: 0,
      totalInscriptions: 0,
      address: address,
      timestamp: Date.now(),
    };

    try {
      const collections = collectionService.getAllCollections();
      stats.totalCollections = collections.length;
      stats.totalInscriptions = collections.reduce((sum, col) => sum + (col.items?.length || 0), 0);
    } catch (err) {
      console.warn('[Collection Stats] Could not fetch collection stats:', err.message);
    }

    res.json(stats);
  } catch (error) {
    console.error('[Collection Stats] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Collection Hashlist
app.get('/api/collection/hashlist', (req, res) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Missing address parameter' });
    }

    // Placeholder: Gibt leere Hashliste zurück
    const hashlist = {
      address: address,
      inscriptions: [],
      timestamp: Date.now(),
    };

    try {
      const collections = collectionService.getAllCollections();
      const allInscriptionIds = collections.flatMap(col => 
        (col.items || []).map(item => item.inscriptionId)
      );
      hashlist.inscriptions = [...new Set(allInscriptionIds)]; // Entferne Duplikate
    } catch (err) {
      console.warn('[Collection Hashlist] Could not fetch hashlist:', err.message);
    }

    res.json(hashlist);
  } catch (error) {
    console.error('[Collection Hashlist] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin Stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    // Hole Admin-Adresse für Delegate-Stats
    const adminAddress = req.headers['x-admin-address'] || 
                         req.headers['X-Admin-Address'] ||
                         req.query.adminAddress ||
                         req.query.address;
    
      const stats = {
        totalCollections: 0,
        activeCollections: 0,
        totalInscriptions: 0,
        totalTrades: 0,
        totalDelegates: 0,
        byRarity: {},
        timestamp: Date.now(),
      };

    try {
      const collections = await collectionService.getAllCollectionsAdmin();
      stats.totalCollections = collections.length;
      stats.activeCollections = collections.filter(c => c.active).length;
      stats.totalInscriptions = collections.reduce((sum, col) => sum + (col.items?.length || 0), 0);
    } catch (err) {
      console.warn('[Admin Stats] Could not fetch collection stats:', err.message);
    }

    try {
      const trades = tradeOfferService.getActiveTradeOffers();
      stats.totalTrades = trades.length;
    } catch (err) {
      console.warn('[Admin Stats] Could not fetch trade stats:', err.message);
    }

    // Delegate-Stats
    try {
      const allDelegates = delegateRegistry.getAllDelegates();
      // getAllDelegates() gibt möglicherweise ein Objekt zurück, nicht ein Array
      const delegatesArray = Array.isArray(allDelegates) ? allDelegates : Object.values(allDelegates || {});
      stats.totalDelegates = delegatesArray.length;
      
      // Rarity-Verteilung
      const rarityCounts = {};
      delegatesArray.forEach(delegate => {
        const rarity = delegate?.rarity || 'common';
        rarityCounts[rarity] = (rarityCounts[rarity] || 0) + 1;
      });
      stats.byRarity = rarityCounts;
    } catch (err) {
      console.warn('[Admin Stats] Could not fetch delegate stats:', err.message);
    }

    res.json(stats);
  } catch (error) {
    console.error('[Admin Stats] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Admin Trades
app.get('/api/admin/trades', requireAdmin, (req, res) => {
  try {
    const trades = tradeOfferService.getActiveTradeOffers();
    // Formatiere Trades für Frontend
    const formattedTrades = trades.map(trade => ({
      id: trade.id,
      maker: trade.maker,
      offerCards: trade.offerCards || [],
      requestCards: trade.requestCards || [],
      status: trade.status || 'active',
      createdAt: trade.createdAt || Date.now(),
      expiresAt: trade.expiresAt,
    }));
    res.json({ trades: formattedTrades, count: formattedTrades.length });
  } catch (error) {
    console.error('[Admin Trades] ❌ Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ========================================
// MARKETPLACE ENDPOINTS (Ord-Dropz Style)
// ========================================

/**
 * Erstellt eine vorsignierte Marketplace-Listing
 * Verwendet SIGHASH_SINGLE | SIGHASH_ANYONECANPAY
 * 
 * Use-Case: Verkäufer listet Inscription zum Verkauf
 * - Admin signiert VORHER
 * - Käufer kauft SPÄTER und fügt Zahlung hinzu
 */
app.post('/api/marketplace/create-listing', async (req, res) => {
  try {
    const { inscriptionId, buyerAddress, sellerAddress, priceInSats, feeRate } = req.body;
    
    if (!inscriptionId || !buyerAddress || !sellerAddress || !priceInSats) {
      return res.status(400).json({ 
        error: 'Missing required fields: inscriptionId, buyerAddress, sellerAddress, priceInSats' 
      });
    }

    console.log('[API] 🏪 Creating marketplace listing:', {
      inscriptionId,
      buyerAddress,
      sellerAddress,
      priceInSats,
      feeRate: feeRate || 5,
    });

    // Import Marketplace Service dynamisch
    const marketplaceModule = await import('./services/ordinalMarketplaceService.js');
    
    const result = await marketplaceModule.createMarketplaceListing(
      inscriptionId,
      buyerAddress,
      sellerAddress,
      parseInt(priceInSats, 10),
      feeRate ? parseInt(feeRate, 10) : 5
    );

    console.log('[API] ✅ Marketplace listing created successfully');
    return res.json(result);

  } catch (error) {
    console.error('[API] ❌ Error creating marketplace listing:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Bulk-Erstellung von Marketplace-Listings
 * Wie bei Ord-Dropz: Signiert viele Inscriptions auf einmal
 */
app.post('/api/marketplace/create-bulk-listings', async (req, res) => {
  try {
    const { inscriptions, feeRate } = req.body;
    
    if (!Array.isArray(inscriptions) || inscriptions.length === 0) {
      return res.status(400).json({ 
        error: 'inscriptions must be a non-empty array of { inscriptionId, buyerAddress, sellerAddress, priceInSats }' 
      });
    }

    console.log(`[API] 🏪 Creating ${inscriptions.length} marketplace listings (BULK)...`);

    // Import Marketplace Service dynamisch
    const marketplaceModule = await import('./services/ordinalMarketplaceService.js');

    const result = await marketplaceModule.createBulkMarketplaceListings(
      inscriptions,
      feeRate ? parseInt(feeRate, 10) : 5
    );

    console.log(`[API] ✅ Bulk listing creation complete: ${result.summary.successful}/${result.summary.total} successful`);
    return res.json(result);

  } catch (error) {
    console.error('[API] ❌ Error creating bulk marketplace listings:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// ========================================
// SERVER START
// ========================================

// Initialisiere Datenbank und starte Server
async function startServer() {
  // Initialisiere Datenbank
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`🔧 Initialisiere Datenbank...`);
  const dbPool = initDatabase();
  
  if (dbPool) {
    // Erstelle Tabellen
    await createTables();
    
    // Führe Migration aus (JSON -> DB)
    await pointShopService.migrateJSONToDB();
    await collectionService.migrateCollectionsToDB();
    await pointsMigration.migratePointsJSONToDB(); // 💎 Punkte Migration
    console.log(`✅ Datenbank bereit\n`);
  } else {
    console.log(`⚠️ Keine Datenbankverbindung - verwende JSON-Fallback\n`);
  }

  // 🧹 Cleanup: Entferne alte pending IDs aus Registry
  console.log(`🧹 Cleaning up delegate registry...`);
  const { cleanupPendingDelegates } = await import('./services/delegateRegistry.js');
  const cleanupResult = cleanupPendingDelegates();
  console.log(`🧹 Cleanup result: Removed ${cleanupResult.cleaned} pending IDs, ${cleanupResult.remaining} confirmed delegates remaining\n`);

  // 💣 BOMBENSICHER: Starte Cron Job für Auto-Update (pending → confirmed)
  console.log(`⏰ Starting Cron Job for pending cards auto-update...`);
  
  // Erste Ausführung nach 30 Sekunden (um DB Zeit zu geben)
  setTimeout(async () => {
    console.log(`[Cron] 🚀 Running initial pending cards update...`);
    await pendingCardsUpdateJob.updatePendingCards();
  }, 30000);
  
  // Dann alle 5 Minuten
  setInterval(async () => {
    console.log(`[Cron] ⏰ Running scheduled pending cards update...`);
    await pendingCardsUpdateJob.updatePendingCards();
  }, 5 * 60 * 1000); // 5 Minuten
  
  console.log(`⏰ Cron Job scheduled: Every 5 minutes (first run in 30s)\n`);

  // Starte Server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🚀 SERVER START - VERSION: Collection-Improvements-v4`);
    console.log(`📅 DEPLOYED: 2025-01-15 12:00`);
    console.log(`💾 Datenbank: ${isDatabaseAvailable() ? '✅ PostgreSQL' : '⚠️ JSON-Fallback'}`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🔧 Mode: ${USE_MOCK ? '🧪 MOCK' : '✅ PRODUCTION'}`);
    console.log(`🔑 UniSat API: ${UNISAT_API_KEY ? '✅ Konfiguriert' : '❌ Nicht konfiguriert'}`);
    console.log(`👑 Admin Adressen: ${ADMIN_ADDRESSES.length}`);
    console.log(`👑 Admin Adressen Liste:`);
    ADMIN_ADDRESSES.forEach((addr, idx) => {
      console.log(`   ${idx + 1}. ${addr}`);
    });
    console.log(`${'═'.repeat(80)}\n`);
  });
}

startServer().catch(error => {
  console.error('❌ Fehler beim Starten des Servers:', error);
  process.exit(1);
});
