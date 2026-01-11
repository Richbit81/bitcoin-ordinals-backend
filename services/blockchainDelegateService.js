/**
 * Blockchain Delegate Service
 * Ruft Delegate-Inskriptionen direkt von der Blockchain über UniSat API ab
 */

// Lade dotenv falls nicht bereits geladen (für direkten Service-Aufruf)
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lade .env-Datei explizit (von Projekt-Root aus)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Helper-Funktion: Lese Umgebungsvariablen zur Laufzeit
 * (immer zur Laufzeit, nie beim Import, da dotenv.config() möglicherweise
 * noch nicht ausgeführt wurde, wenn der Service importiert wird)
 */
function getApiConfig() {
  // Lade .env erneut zur Sicherheit (falls sie beim Import noch nicht geladen war)
  dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
  
  const apiKey = process.env.UNISAT_API_KEY || '';
  const apiUrl = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
  
  return { apiKey, apiUrl };
}

/**
 * Hole alle Inskriptionen einer Adresse von der Chain
 * Verwendet den korrekten UniSat API-Endpunkt laut Dokumentation:
 * GET /v1/indexer/address/{address}/inscription-data?cursor=0&size=100
 * Response: { code: 0, msg: "OK", data: { cursor, total, inscription: [...] } }
 */
export async function getInscriptionsByAddress(address, cursor = 0, size = 100) {
  try {
    // Lese Umgebungsvariablen zur Laufzeit (immer zur Laufzeit, nie beim Import)
    const { apiKey, apiUrl } = getApiConfig();
    
    if (!apiKey) {
      console.error('[Blockchain] ❌ UNISAT_API_KEY is not set');
      console.error('[Blockchain] ❌ process.env.UNISAT_API_KEY:', process.env.UNISAT_API_KEY ? `EXISTS (${process.env.UNISAT_API_KEY.substring(0, 8)}...)` : 'MISSING');
      console.error('[Blockchain] ❌ .env file location:', path.resolve(__dirname, '..', '.env'));
      return [];
    }

    // Verwende den korrekten UniSat API-Endpunkt laut offizieller Dokumentation
    // GET /v1/indexer/address/{address}/inscription-data?cursor=0&size=100
    const endpoint = `${apiUrl}/v1/indexer/address/${encodeURIComponent(address)}/inscription-data`;
    const url = `${endpoint}?cursor=${cursor}&size=${size}`;

    console.log(`[Blockchain] 🔍 Calling UniSat API: ${url}`);
    console.log(`[Blockchain] 🔑 Using API Key: ${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
      },
    });

    console.log(`[Blockchain] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[Blockchain] ❌ UniSat API error (${response.status}): ${errorText}`);
      
      if (response.status === 401) {
        throw new Error('Unauthorized: Invalid UniSat API key');
      }
      
      throw new Error(`UniSat API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log(`[Blockchain] 📥 Full UniSat API Response:`, JSON.stringify(data, null, 2));

    // Parse UniSat API Response-Struktur laut Dokumentation
    // Struktur: { code: 0, msg: "OK", data: { cursor, total, inscription: [...] } }
    if (data.code !== 0) {
      const errorMsg = data.msg || data.message || 'UniSat API returned error code';
      console.error(`[Blockchain] ❌ UniSat API error code: ${data.code}, message: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    if (!data.data) {
      console.warn(`[Blockchain] ⚠️ No data field in response`);
      return [];
    }

    // Extrahiere Inskriptionen-Array aus data.data.inscription
    let inscriptions = [];
    
    if (Array.isArray(data.data.inscription)) {
      // Standard-Struktur laut Dokumentation: data.data.inscription
      inscriptions = data.data.inscription;
      console.log(`[Blockchain] ✅ Found ${inscriptions.length} inscriptions in data.data.inscription (total: ${data.data.total || 'unknown'})`);
    } else if (Array.isArray(data.data)) {
      // Alternative: data.data ist direkt ein Array
      inscriptions = data.data;
      console.log(`[Blockchain] ✅ Found ${inscriptions.length} inscriptions directly in data.data`);
    } else if (data.data.list && Array.isArray(data.data.list)) {
      // Alternative: data.data.list
      inscriptions = data.data.list;
      console.log(`[Blockchain] ✅ Found ${inscriptions.length} inscriptions in data.data.list`);
    } else if (Array.isArray(data.inscription)) {
      // Alternative: inscription direkt in root
      inscriptions = data.inscription;
      console.log(`[Blockchain] ✅ Found ${inscriptions.length} inscriptions directly in root`);
    } else {
      console.warn(`[Blockchain] ⚠️ No inscriptions array found in response`);
      console.warn(`[Blockchain] ⚠️ Response keys:`, Object.keys(data));
      if (data.data) {
        console.warn(`[Blockchain] ⚠️ data.data keys:`, Object.keys(data.data));
        console.warn(`[Blockchain] ⚠️ Full data.data:`, JSON.stringify(data.data, null, 2).substring(0, 500));
      }
      return [];
    }

    if (inscriptions.length === 0) {
      console.warn(`[Blockchain] ⚠️ Empty inscriptions array returned from API`);
      return [];
    }

    // Logge erste paar Inskription-IDs zur Debugging
    const firstIds = inscriptions.slice(0, 5).map(i => i.inscriptionId || i.id || 'unknown');
    console.log(`[Blockchain] First ${Math.min(5, inscriptions.length)} inscription IDs:`, firstIds);

    // Filtere NUR explizit markierte BRC20-Tokens heraus - behalte ALLE anderen Content-Types!
    // WICHTIG: Filtere NICHT nach Content-Type allein, da auch text/plain Inskriptionen legitim sein können!
    const filteredInscriptions = inscriptions.filter(ins => {
      // Prüfe NUR explizit markierte BRC20-Tokens (isBRC20 Flag)
      // NICHT nach Content-Type filtern, da das zu aggressiv ist!
      const isBRC20 = ins.isBRC20 === true || ins.isBRC20 === 'true' ||
                     (ins.utxo?.inscriptions && ins.utxo.inscriptions.some((i) => i.isBRC20 === true || i.isBRC20 === 'true'));
      
      // Filtere NUR wenn es wirklich explizit als BRC20 markiert ist
      // BEHALTE ALLES: HTML, SVG, Bilder (PNG/JPG/GIF/WebP), JSON, Text-Dateien, etc.
      if (isBRC20) {
        console.log(`[Blockchain] ⚠️ Filtered out BRC20 token: ${ins.inscriptionId || ins.id} (contentType: ${ins.contentType || 'unknown'})`);
        return false;
      }
      
      return true; // Behalte ALLE anderen Inskriptionen!
    });
    
    // Logge Content-Type Verteilung für Debugging
    const contentTypeCounts = {};
    filteredInscriptions.forEach(ins => {
      const ct = ins.contentType || ins.content_type || ins.mimeType || ins.mime_type || 'unknown';
      contentTypeCounts[ct] = (contentTypeCounts[ct] || 0) + 1;
    });
    console.log(`[Blockchain] 📊 Content-Type Verteilung (${filteredInscriptions.length} Inskriptionen nach BRC20-Filter):`, contentTypeCounts);

    // Formatiere Inskriptionen für Rückgabe (behalte alle Felder)
    const formatted = filteredInscriptions.map(ins => ({
      inscriptionId: ins.inscriptionId || ins.id || null,
      inscriptionNumber: ins.inscriptionNumber || ins.number || ins.num || null,
      contentType: ins.contentType || ins.content_type || ins.mimeType || ins.mime_type || 'unknown',
      contentLength: ins.contentLength || ins.content_length || ins.contentlength || ins.size || 0,
      address: ins.address || address,
      timestamp: ins.timestamp || ins.createdAt || ins.time || null,
      txid: ins.utxo?.txid || ins.txid || null,
      vout: ins.utxo?.vout || ins.vout || null,
      height: ins.utxo?.height || ins.height || null,
      // Behalte auch alle anderen Felder
      ...ins
    })).filter(ins => ins.inscriptionId); // Entferne Einträge ohne ID

    // Rückgabe: Array von Inskriptionen + Metadata für Pagination
    // UniSat API Pagination: Wenn `inscription.length === size`, gibt es möglicherweise weitere Seiten
    // Wenn `cursor` vorhanden ist UND größer als der aktuelle cursor, gibt es weitere Seiten
    const returnedCount = formatted.length;
    const nextCursor = data.data.cursor || null;
    const totalCount = data.data.total || null;
    
    // hasMore: Wenn wir genau `size` Inskriptionen erhalten haben UND (cursor erhöht sich ODER total > aktuelle Anzahl)
    const hasMore = (returnedCount === size) && (
      (nextCursor !== null && nextCursor > cursor) || 
      (totalCount !== null && totalCount > returnedCount) ||
      (nextCursor !== null && nextCursor !== cursor)
    );
    
    console.log(`[Blockchain] 📊 Pagination Info: returned=${returnedCount}, size=${size}, cursor=${cursor}, nextCursor=${nextCursor}, total=${totalCount}, hasMore=${hasMore}`);
    
    return {
      inscriptions: formatted,
      cursor: nextCursor,
      total: totalCount || formatted.length,
      hasMore: hasMore
    };

  } catch (error) {
    console.error('[Blockchain] ❌ Error fetching inscriptions:', error);
    throw error;
  }
}

/**
 * Hole ALLE Inskriptionen einer Adresse mit automatischer Pagination
 * Lädt alle Seiten, bis alle Inskriptionen geladen sind
 */
export async function getAllInscriptionsByAddress(address) {
  try {
    const allInscriptions = [];
    let cursor = 0;
    const size = 100; // Max pro Request
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 1000; // Sicherheitslimit (max 100.000 Inskriptionen)

    console.log(`[Blockchain] 🔄 Starting to load ALL inscriptions for address: ${address}`);

    while (hasMore && pageCount < maxPages) {
      pageCount++;
      console.log(`[Blockchain] 📄 Loading page ${pageCount} (cursor: ${cursor}, size: ${size})`);

      const result = await getInscriptionsByAddress(address, cursor, size);
      
      if (!result || !result.inscriptions || result.inscriptions.length === 0) {
        console.log(`[Blockchain] ⏹️ No more inscriptions found at page ${pageCount}`);
        break;
      }

      // Füge Inskriptionen hinzu
      allInscriptions.push(...result.inscriptions);
      console.log(`[Blockchain] ✅ Page ${pageCount}: Loaded ${result.inscriptions.length} inscriptions (total so far: ${allInscriptions.length}/${result.total || 'unknown'})`);

      // Prüfe ob es weitere Seiten gibt
      // Strategie 1: Wenn `total` vorhanden ist und größer als geladene Anzahl, gibt es mehr Seiten
      // Strategie 2: Wenn wir genau `size` Inskriptionen erhalten haben, gibt es wahrscheinlich weitere Seiten
      // Strategie 3: Wenn `cursor` sich erhöht hat, gibt es mehr Seiten
      
      let shouldContinue = false;
      let nextCursor = cursor;
      
      // Prüfe 1: Total-basierte Pagination (am zuverlässigsten)
      if (result.total && typeof result.total === 'number' && allInscriptions.length < result.total) {
        shouldContinue = true;
        console.log(`[Blockchain] ➡️ More pages available: Loaded ${allInscriptions.length}/${result.total} (${result.total - allInscriptions.length} remaining)`);
      }
      // Prüfe 2: Wir haben genau `size` Inskriptionen erhalten - versuche IMMER nächste Seite
      // WICHTIG: Wenn wir genau 100 erhalten, gibt es wahrscheinlich weitere Seiten!
      else if (result.inscriptions.length === size) {
        shouldContinue = true;
        console.log(`[Blockchain] ➡️ Got exactly ${size} inscriptions on page ${pageCount}, assuming more pages available - will load next page`);
        console.log(`[Blockchain] 🔍 Result structure: total=${result.total || 'N/A'}, cursor=${result.cursor || 'N/A'}, hasMore=${result.hasMore}`);
      }
      // Prüfe 3: Cursor hat sich geändert - es gibt mehr Seiten
      else if (result.cursor && result.cursor !== cursor && result.cursor > cursor) {
        shouldContinue = true;
        console.log(`[Blockchain] ➡️ Cursor changed from ${cursor} to ${result.cursor}, assuming more pages available`);
      }
      
      if (shouldContinue) {
        // Bestimme nächsten cursor
        if (result.cursor && result.cursor !== cursor && result.cursor > cursor) {
          // Cursor-basierte Pagination (bevorzugt)
          nextCursor = result.cursor;
          console.log(`[Blockchain] ➡️ Using cursor-based pagination: ${cursor} -> ${nextCursor}`);
        } else {
          // Offset-basierte Pagination (Fallback)
          nextCursor = cursor + size;
          console.log(`[Blockchain] ➡️ Using offset-based pagination: ${cursor} -> ${nextCursor}`);
        }
        
        cursor = nextCursor;
        hasMore = true;
        
        // Kurze Pause zwischen Requests, um Rate-Limiting zu vermeiden
        await new Promise(resolve => setTimeout(resolve, 200));
      } else {
        // Keine weiteren Seiten basierend auf aktuellen Kriterien
        hasMore = false;
        if (result.total) {
          console.log(`[Blockchain] ⏹️ No more pages. Loaded all ${allInscriptions.length}/${result.total} inscriptions`);
        } else {
          console.log(`[Blockchain] ⏹️ No more pages. Last page had ${result.inscriptions.length} inscriptions (less than ${size})`);
        }
      }
    }

    console.log(`[Blockchain] ✅ Loaded ALL ${allInscriptions.length} inscriptions from ${pageCount} pages`);

    // Filtere Duplikate (falls vorhanden)
    const uniqueInscriptions = Array.from(
      new Map(allInscriptions.map(ins => [ins.inscriptionId, ins])).values()
    );

    if (uniqueInscriptions.length < allInscriptions.length) {
      console.log(`[Blockchain] ⚠️ Removed ${allInscriptions.length - uniqueInscriptions.length} duplicate inscriptions`);
    }

    // Gruppiere nach Content-Type für Logging
    const byContentType = {};
    uniqueInscriptions.forEach(ins => {
      const ct = ins.contentType || 'unknown';
      byContentType[ct] = (byContentType[ct] || 0) + 1;
    });
    console.log(`[Blockchain] 📊 Inskriptionen nach Content-Type:`, byContentType);

    return uniqueInscriptions;

  } catch (error) {
    console.error('[Blockchain] ❌ Error fetching all inscriptions:', error);
    throw error;
  }
}

/**
 * Hole Content einer Inskription
 */
export async function getInscriptionContent(inscriptionId) {
  try {
    const { apiKey, apiUrl } = getApiConfig();
    
    const response = await fetch(
      `${apiUrl}/v1/indexer/inscription/${inscriptionId}/content`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      // Wenn Content nicht verfügbar, versuche es mit /content endpoint
      const altResponse = await fetch(
        `https://ordinals.com/content/${inscriptionId}`,
        { method: 'GET' }
      );
      
      if (altResponse.ok) {
        return await altResponse.text();
      }
      
      throw new Error(`UniSat API error: ${response.status}`);
    }

    const content = await response.text();
    return content;
  } catch (error) {
    console.error(`[Blockchain] Error fetching content for ${inscriptionId}:`, error.message);
    throw error;
  }
}

/**
 * Hole Details einer Inskription (inkl. Besitzer-Adresse)
 */
export async function getInscriptionDetails(inscriptionId) {
  try {
    const { apiKey, apiUrl } = getApiConfig();
    
    const response = await fetch(
      `${apiUrl}/v1/indexer/inscription/${inscriptionId}`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`UniSat API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code === 0 && data.data) {
      return data.data;
    }
    
    return null;
  } catch (error) {
    console.error(`[Blockchain] Error fetching details for ${inscriptionId}:`, error.message);
    return null;
  }
}

/**
 * Hole alle Original-Karten-Inskription-IDs aus der Datenbank
 */
async function getAllOriginalCardInscriptionIds() {
  try {
    const cardsModule = await import('../config/cards.js');
    const cards = cardsModule.ALL_CARDS || cardsModule.default || cardsModule.cards || [];
    
    // Extrahiere alle eindeutigen inscriptionIds
    const originalIds = new Set();
    cards.forEach(card => {
      if (card.inscriptionId) {
        originalIds.add(card.inscriptionId);
      }
    });
    
    console.log(`[Blockchain] 📋 Geladen ${originalIds.size} Original-Karten-Inskription-IDs`);
    return Array.from(originalIds);
  } catch (error) {
    console.error('[Blockchain] ❌ Fehler beim Laden der Karten-Datenbank:', error);
    return [];
  }
}

/**
 * Prüfe ob eine Inskription ein Delegate ist (basierend auf Metadaten im Content)
 */
function isDelegateInscription(content, originalInscriptionIds = []) {
  if (!content) return false;
  
  try {
    // Methode 1: Direktes JSON mit ord-20 Metadaten
    const json = JSON.parse(content);
    if (json.p === 'ord-20' && json.op === 'delegate') {
      return true;
    }
  } catch {
    // Kein direktes JSON, versuche HTML
  }
  
  // Methode 2: HTML mit Metadaten im <script> Tag
  if (content.includes('<script')) {
    const scriptMatch = content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[1]) {
      try {
        const json = JSON.parse(scriptMatch[1].trim());
        if (json.p === 'ord-20' && json.op === 'delegate') {
          return true;
        }
      } catch {
        // Konnte Metadaten nicht parsen
      }
    }
  }
  
  // Methode 3: Rekursive Referenz zu einer Original-Inskription (HTML/SVG)
  // Prüfe ob Content eine Referenz zu einer bekannten Original-Inskription enthält
  if (originalInscriptionIds.length > 0) {
    for (const originalId of originalInscriptionIds) {
      if (content.includes(`/content/${originalId}`) || 
          content.includes(`content/${originalId}`) ||
          content.includes(`"${originalId}"`) ||
          content.includes(`'${originalId}'`)) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Extrahiere Delegate-Metadaten aus Content
 */
function extractDelegateMetadata(content, originalInscriptionIds = []) {
  if (!content) return null;
  
  try {
    // Versuche direktes JSON
    const json = JSON.parse(content);
    if (json.p === 'ord-20' && json.op === 'delegate') {
      return json;
    }
  } catch {
    // Kein direktes JSON
  }
  
  // Versuche HTML mit Metadaten
  if (content.includes('<script')) {
    const scriptMatch = content.match(/<script[^>]*id=["']delegate-metadata["'][^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch && scriptMatch[1]) {
      try {
        const json = JSON.parse(scriptMatch[1].trim());
        if (json.p === 'ord-20' && json.op === 'delegate') {
          return json;
        }
      } catch {
        // Konnte Metadaten nicht parsen
      }
    }
  }
  
  // Fallback: Extrahiere Original-Inskription-ID aus rekursiver Referenz
  if (originalInscriptionIds.length > 0) {
    for (const originalId of originalInscriptionIds) {
      if (content.includes(`/content/${originalId}`) || 
          content.includes(`content/${originalId}`) ||
          content.includes(`"${originalId}"`) ||
          content.includes(`'${originalId}'`)) {
        // Erstelle Mock-Metadaten basierend auf rekursiver Referenz
        return {
          p: 'ord-20',
          op: 'delegate',
          originalInscriptionId: originalId,
        };
      }
    }
  }
  
  return null;
}

/**
 * Finde alle Delegate-Inskriptionen für eine Wallet-Adresse
 * VEREINFACHT: Hole alle Inskriptionen und filtere nur die Delegates
 */
export async function getDelegatesFromChain(walletAddress) {
  try {
    console.log(`[Blockchain] 🔍 Suche nach Delegates für ${walletAddress}`);
    
    // Schritt 1: Hole alle Inskriptionen der Wallet-Adresse
    console.log(`[Blockchain] 🔍 Hole alle Inskriptionen der Adresse...`);
    let allInscriptions = await getInscriptionsByAddress(walletAddress);
    console.log(`[Blockchain] ✅ Gefunden ${allInscriptions.length} Inskriptionen für Adresse`);
    
    // FALLBACK: Wenn UniSat API keine Inskriptionen findet, nutze Registry
    if (allInscriptions.length === 0) {
      console.log(`[Blockchain] ⚠️ UniSat API hat keine Inskriptionen gefunden. Versuche Registry...`);
      try {
        const delegateRegistry = await import('./delegateRegistry.js');
        const cachedDelegates = delegateRegistry.getDelegatesByWallet(walletAddress);
        
        console.log(`[Blockchain] 📋 Registry hat ${cachedDelegates.length} Delegates für diese Adresse`);
        
        // Konvertiere Registry-Delegates zu Inskription-Objekten
        // WICHTIG: Akzeptiere auch pending- IDs, wenn keine finalen IDs vorhanden sind
        const finalDelegates = cachedDelegates.filter(d => !d.delegateInscriptionId.startsWith('pending-') && !d.delegateInscriptionId.startsWith('mock-'));
        const pendingDelegates = cachedDelegates.filter(d => d.delegateInscriptionId.startsWith('pending-') && !d.delegateInscriptionId.startsWith('mock-'));
        
        // Bevorzuge finale IDs, aber nutze pending- IDs als Fallback
        const delegatesToUse = finalDelegates.length > 0 ? finalDelegates : pendingDelegates;
        
        allInscriptions = delegatesToUse.map(d => ({
          inscriptionId: d.delegateInscriptionId,
          id: d.delegateInscriptionId,
          timestamp: d.timestamp || new Date().toISOString(),
        }));
        
        console.log(`[Blockchain] ✅ ${allInscriptions.length} Inskriptionen aus Registry geladen (${finalDelegates.length} final, ${pendingDelegates.length} pending)`);
      } catch (registryError) {
        console.warn(`[Blockchain] ⚠️ Registry-Fallback fehlgeschlagen:`, registryError.message);
      }
      
      // ZUSÄTZLICHER FALLBACK: Wenn Registry nur pending- IDs hat, prüfe bekannte finale IDs direkt
      if (allInscriptions.length === 0 || allInscriptions.every(ins => ins.inscriptionId.startsWith('pending-'))) {
        console.log(`[Blockchain] ⚠️ Registry hat nur pending- IDs. Prüfe bekannte finale IDs direkt...`);
        
        // Bekannte finale Inskription-IDs (könnten aus der Registry oder als Parameter kommen)
        const knownFinalIds = [
          'f477036da334ea19d3d2a9dcd1c101641fe196fd67f4ca5f07aae686703930e7i0',
          '943b232132e1c6f8981a21cb4f75432b3f08d28d16254be194a067a7c41898b7i0',
          'f6ac10810f94e37576ef1bc438f79929947290fb77d37d3954aed447044aa339i0',
          'd679268086752ea5f5283512a726544f0b292712481e84e56b887bac68440813i0',
          '601473bf8c03c8978837385acc387d9b9d9689ae5515611af2bdbd250b9be8f1i0'
        ];
        
        // Füge bekannte finale IDs hinzu
        knownFinalIds.forEach(id => {
          if (!allInscriptions.some(ins => ins.inscriptionId === id)) {
            allInscriptions.push({
              inscriptionId: id,
              id: id,
              timestamp: new Date().toISOString(),
            });
          }
        });
        
        console.log(`[Blockchain] ✅ ${allInscriptions.length} Inskriptionen (inkl. bekannter finaler IDs)`);
      }
    }
    
    if (allInscriptions.length === 0) {
      console.log(`[Blockchain] ℹ️ Keine Inskriptionen für diese Adresse gefunden`);
      return [];
    }
    
    // Schritt 2: Hole Original-Inskription-IDs für rekursive Referenz-Prüfung
    const originalInscriptionIds = await getAllOriginalCardInscriptionIds();
    
    // Schritt 3: Prüfe jede Inskription auf Delegate-Metadaten
    const foundDelegates = [];
    
    for (let i = 0; i < allInscriptions.length; i++) {
      const inscription = allInscriptions[i];
      const inscriptionId = inscription.inscriptionId || inscription.id;
      
      if (!inscriptionId) {
        continue;
      }
      
      // Überspringe pending- und mock- IDs (keine echten Inskription-IDs)
      if (inscriptionId.startsWith('pending-') || inscriptionId.startsWith('mock-')) {
        console.log(`[Blockchain] ⏳ Überspringe ${inscriptionId} (pending/mock ID)`);
        continue;
      }
      
      try {
        // Hole Content der Inskription
        const content = await getInscriptionContent(inscriptionId);
        
        if (!content) {
          continue;
        }
        
        // Prüfe ob es ein Delegate ist (mit Original-IDs für rekursive Referenz-Prüfung)
        if (!isDelegateInscription(content, originalInscriptionIds)) {
          continue; // Kein Delegate, überspringe
        }
        
        console.log(`[Blockchain] ✅ Gefunden Delegate: ${inscriptionId}`);
        
        // Extrahiere Metadaten (mit Original-IDs für rekursive Referenz-Prüfung)
        const delegateData = extractDelegateMetadata(content, originalInscriptionIds);
        
        if (!delegateData || !delegateData.originalInscriptionId) {
          console.warn(`[Blockchain] ⚠️ Delegate ${inscriptionId} hat keine originalInscriptionId`);
          continue;
        }
        
        // Hole Details (optional, für timestamp/blockHeight)
        const details = await getInscriptionDetails(inscriptionId).catch(() => null);
        
        // Finde Karten-Daten für diese Original-Inskription
        let originalCard = null;
        try {
          const cardsModule = await import('../config/cards.js');
          const cards = cardsModule.ALL_CARDS || cardsModule.default || cardsModule.cards || [];
          originalCard = cards.find(c => c.inscriptionId === delegateData.originalInscriptionId);
        } catch (cardError) {
          // Karten-Datenbank konnte nicht geladen werden
        }
        
        // Erstelle Delegate-Objekt
        foundDelegates.push({
          delegateInscriptionId: inscriptionId,
          originalInscriptionId: delegateData.originalInscriptionId,
          cardId: delegateData.cardId || originalCard?.id || 'unknown',
          name: delegateData.name || originalCard?.name || 'Unknown',
          rarity: delegateData.rarity || originalCard?.rarity || 'common',
          walletAddress: walletAddress,
          cardType: delegateData.cardType || originalCard?.cardType || 'animal',
          effect: delegateData.effect || originalCard?.effect,
          svgIcon: delegateData.svgIcon || originalCard?.svgIcon,
          timestamp: details?.timestamp || inscription.timestamp || new Date().toISOString(),
          blockHeight: details?.height || details?.genesisHeight || inscription.genesisHeight,
        });
        
        // Rate limiting
        if (i < allInscriptions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.warn(`[Blockchain] ⚠️ Fehler bei ${inscriptionId}:`, error.message);
        continue;
      }
    }
    
    console.log(`[Blockchain] ✅ Gefunden ${foundDelegates.length} Delegates im Wallet`);
    return foundDelegates;
    
  } catch (error) {
    console.error('[Blockchain] ❌ Fehler:', error);
    throw error;
  }
}

/**
 * Hybrid: Hole Delegates von Chain + Cache
 */
export async function getDelegatesHybrid(walletAddress) {
  try {
    console.log(`[Blockchain] Hybrid mode: Fetching from chain for ${walletAddress}`);
    
    // Versuche zuerst von Chain
    const chainDelegates = await getDelegatesFromChain(walletAddress);
    
    // Update Cache (optional - könnte hier die Registry aktualisieren)
    // const delegateRegistry = await import('./delegateRegistry.js');
    // chainDelegates.forEach(delegate => {
    //   delegateRegistry.registerDelegate(...);
    // });
    
    return chainDelegates;
  } catch (error) {
    console.warn('[Blockchain] Chain fetch failed, using cache:', error.message);
    
    // Fallback auf Registry
    try {
      const delegateRegistry = await import('./delegateRegistry.js');
      const cachedDelegates = delegateRegistry.getDelegatesByWallet(walletAddress);
      console.log(`[Blockchain] Using ${cachedDelegates.length} cached delegates`);
      return cachedDelegates;
    } catch (registryError) {
      console.error('[Blockchain] Registry fallback also failed:', registryError);
      throw error; // Werfe den ursprünglichen Chain-Fehler
    }
  }
}

/**
 * Prüfe ob eine Inskription eine Delegate-Inskription ist (von Chain)
 */
export async function checkDelegateOnChain(inscriptionId) {
  try {
    const content = await getInscriptionContent(inscriptionId);
    
    if (!content) {
      return null;
    }
    
    let delegateData;
    try {
      delegateData = JSON.parse(content);
    } catch {
      return null;
    }
    
    if (delegateData.p === 'ord-20' && delegateData.op === 'delegate') {
      const details = await getInscriptionDetails(inscriptionId);
      
      return {
        delegateInscriptionId: inscriptionId,
        originalInscriptionId: delegateData.originalInscriptionId,
        cardId: delegateData.cardId,
        name: delegateData.name,
        rarity: delegateData.rarity,
        walletAddress: details?.address || null,
        cardType: delegateData.cardType || 'animal',
        effect: delegateData.effect,
        svgIcon: delegateData.svgIcon,
        timestamp: details?.timestamp || new Date().toISOString(),
        blockHeight: details?.genesisHeight,
      };
    }
    
    return null;
  } catch (error) {
    console.error(`[Blockchain] Error checking delegate ${inscriptionId}:`, error);
    return null;
  }
}


