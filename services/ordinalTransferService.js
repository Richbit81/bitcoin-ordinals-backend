import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Initialize ECC library for bitcoinjs-lib v7.0.1+
bitcoin.initEccLib(ecc);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.bitcoin;
const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';

/**
 * Creates an UNSIGNED PSBT for transferring an ordinal inscription
 * This PSBT will be signed by the wallet in the frontend (NO PRIVATE KEY NEEDED!)
 * @param {string} inscriptionId - The inscription ID to transfer
 * @param {string} recipientAddress - The recipient Bitcoin address
 * @param {number} feeRate - Fee rate in sat/vB
 * @returns {Promise<bitcoin.Psbt>} The unsigned PSBT (ready for wallet signing)
 */
export async function createTransferPSBT(inscriptionId, recipientAddress, feeRate = 5) {
  try {
    console.log(`[OrdinalTransfer] Creating UNSIGNED PSBT for inscription ${inscriptionId} to ${recipientAddress} at ${feeRate} sat/vB`);
    console.log(`[OrdinalTransfer] ⚠️  This PSBT will be signed by the wallet - NO PRIVATE KEY NEEDED!`);
    
    if (!UNISAT_API_KEY) {
      throw new Error('UNISAT_API_KEY is not set in environment variables');
    }
    
    console.log(`[OrdinalTransfer] Using UniSat API URL: ${UNISAT_API_URL}`);
    
    const utxoUrl = `${UNISAT_API_URL}/v1/indexer/inscription/info/${inscriptionId}`;
    console.log(`[OrdinalTransfer] Fetching inscription info from: ${utxoUrl}`);
    
    const utxoResponse = await fetch(utxoUrl, {
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!utxoResponse.ok) {
      const errorText = await utxoResponse.text().catch(() => 'Unknown error');
      console.error(`[OrdinalTransfer] ❌ Failed to fetch inscription info: ${utxoResponse.status} ${utxoResponse.statusText}`, errorText);
      throw new Error(`Failed to fetch inscription info: ${utxoResponse.status} ${utxoResponse.statusText}`);
    }

    const inscriptionData = await utxoResponse.json();
    console.log(`[OrdinalTransfer] Inscription data received:`, JSON.stringify(inscriptionData, null, 2));
    
    if (inscriptionData.code !== 0 && inscriptionData.code !== undefined) {
      throw new Error(`UniSat API error (code ${inscriptionData.code}): ${inscriptionData.msg || 'Unknown error'}`);
    }
    
    const data = inscriptionData.data || inscriptionData.result || inscriptionData;
    
    if (!data) {
      console.error(`[OrdinalTransfer] ❌ No data in API response. Full response:`, JSON.stringify(inscriptionData, null, 2));
      throw new Error('No data returned from UniSat API');
    }
    
    console.log(`[OrdinalTransfer] Inscription data fields:`, Object.keys(data).join(', '));
    
    // Extract UTXO information - UniSat API returns data.utxo as an object with txid, vout, etc.
    let txid = null;
    let vout = null;
    let utxoObject = null;
    let utxoValue = 546;
    let scriptPk = null;
    
    // Check if data.utxo is an object (UniSat API format)
    if (data.utxo && typeof data.utxo === 'object' && !Array.isArray(data.utxo)) {
      utxoObject = data.utxo;
      txid = utxoObject.txid || utxoObject.txId || null;
      vout = utxoObject.vout !== undefined ? utxoObject.vout : (utxoObject.vOut !== undefined ? utxoObject.vOut : null);
      utxoValue = utxoObject.satoshi || utxoObject.value || data.outSatoshi || 546;
      scriptPk = utxoObject.scriptPk || utxoObject.scriptpk || utxoObject.script || null;
      console.log(`[OrdinalTransfer] ✅ Found UTXO object: txid=${txid}, vout=${vout}, value=${utxoValue}, scriptPk=${scriptPk ? scriptPk.substring(0, 20) + '...' : 'NOT FOUND'}`);
    }
    // Try direct fields on data
    else if (data.txid || data.txId) {
      txid = data.txid || data.txId;
      vout = data.vout !== undefined ? data.vout : (data.vOut !== undefined ? data.vOut : null);
      utxoValue = data.outSatoshi || data.value || data.satoshi || 546;
      scriptPk = data.scriptPk || data.scriptpk || null;
      console.log(`[OrdinalTransfer] Using direct fields: txid=${txid}, vout=${vout}`);
    }
    // Try constructing from outpoint string (if available)
    else if (data.outpoint && typeof data.outpoint === 'string' && data.outpoint.includes(':')) {
      const outpointParts = data.outpoint.split(':');
      txid = outpointParts[0];
      vout = outpointParts[1] ? parseInt(outpointParts[1]) : null;
      console.log(`[OrdinalTransfer] Using outpoint string: txid=${txid}, vout=${vout}`);
    }
    
    if (!txid || vout === null || vout === undefined) {
      console.error(`[OrdinalTransfer] ❌ Could not extract txid and vout.`);
      console.error(`[OrdinalTransfer] Available data fields:`, Object.keys(data).join(', '));
      if (data.utxo) {
        console.error(`[OrdinalTransfer] utxo type:`, typeof data.utxo, Array.isArray(data.utxo) ? '(array)' : '(object)');
        if (typeof data.utxo === 'object' && !Array.isArray(data.utxo)) {
          console.error(`[OrdinalTransfer] utxo object fields:`, Object.keys(data.utxo).join(', '));
          console.error(`[OrdinalTransfer] utxo.txid:`, data.utxo.txid);
          console.error(`[OrdinalTransfer] utxo.vout:`, data.utxo.vout);
        }
      }
      console.error(`[OrdinalTransfer] Full data structure:`, JSON.stringify(data, null, 2));
      throw new Error(`Could not extract txid and vout from API response. Data has utxo field: ${!!data.utxo}, utxo type: ${typeof data.utxo}, isArray: ${Array.isArray(data.utxo)}. Available fields: ${Object.keys(data).join(', ')}`);
    }
    
    const outpoint = `${txid}:${vout}`;
    console.log(`[OrdinalTransfer] Outpoint: ${outpoint}`);
    console.log(`[OrdinalTransfer] Parsed TXID: ${txid}, VOUT: ${vout}`);
    
    // If we don't have scriptPk from UTXO object, try to fetch from transaction
    if (!scriptPk) {
      console.log(`[OrdinalTransfer] ScriptPk not found, fetching transaction details...`);
      const txDetailsUrl = `${UNISAT_API_URL}/v1/indexer/tx/${txid}`;
      
      try {
        const txDetailsResponse = await fetch(txDetailsUrl, {
          headers: {
            'Authorization': `Bearer ${UNISAT_API_KEY}`,
            'Content-Type': 'application/json',
          },
        });

        if (txDetailsResponse.ok) {
          const txData = await txDetailsResponse.json();
          if (txData.code === 0 && txData.data) {
            const outputs = txData.data.vout || txData.data.outputs || [];
            if (Array.isArray(outputs) && outputs[parseInt(vout)]) {
              const output = outputs[parseInt(vout)];
              if (!utxoValue || utxoValue === 546) {
                utxoValue = output.value || output.satoshi || 546;
              }
              scriptPk = output.scriptPubKey?.hex || output.scriptPk || output.script;
              console.log(`[OrdinalTransfer] Found output at index ${vout}: value=${utxoValue}, scriptPk=${scriptPk?.substring(0, 20)}...`);
            }
          }
        }
      } catch (txError) {
        console.warn(`[OrdinalTransfer] ⚠️ Failed to fetch transaction details: ${txError.message}`);
      }
    }
    
    // If we still don't have scriptPk, derive it from the recipient address
    if (!scriptPk) {
      console.warn(`[OrdinalTransfer] ⚠️ ScriptPk not found. Deriving from recipient address...`);
      try {
        scriptPk = bitcoin.address.toOutputScript(recipientAddress, NETWORK).toString('hex');
        console.log(`[OrdinalTransfer] ✅ Derived scriptPk from recipient address: ${scriptPk.substring(0, 20)}...`);
      } catch (deriveError) {
        throw new Error(`Cannot create PSBT: ScriptPk not found and cannot be derived. Error: ${deriveError.message}`);
      }
    }
    
    console.log(`[OrdinalTransfer] Final UTXO data: value=${utxoValue}, scriptPk=${scriptPk ? scriptPk.substring(0, 20) + '...' : 'NOT FOUND'}`);

    // Get the owner address from the UTXO data (this is the address that owns the inscription)
    // This is needed for potential change output, but we won't use it for signing
    const ownerAddress = utxoObject?.address || data.address || null;
    if (ownerAddress) {
      console.log(`[OrdinalTransfer] Owner address: ${ownerAddress} (this address will sign the PSBT in the frontend)`);
    } else {
      console.warn(`[OrdinalTransfer] ⚠️ Owner address not found in UTXO data.`);
    }

    // Create UNSIGNED PSBT for pre-signing (NO PRIVATE KEY NEEDED!)
    // The wallet will sign this PSBT in the frontend using the owner's private key
    const psbt = new bitcoin.Psbt({ network: NETWORK });

    // Convert scriptPk (hex string) to pure Uint8Array (NOT Buffer!)
    // bip174 requires pure Uint8Array, not Buffer
    let scriptBytes;
    try {
      // Step 1: Convert hex string to Buffer first (for hex parsing)
      const tempBuffer = Buffer.from(scriptPk, 'hex');
      
      // Step 2: Extract bytes to plain array (no Buffer references)
      const scriptLength = tempBuffer.length;
      const plainBytes = [];
      for (let i = 0; i < scriptLength; i++) {
        plainBytes.push(Number(tempBuffer[i]) & 0xFF);
      }

      // Step 3: Create ArrayBuffer and then Uint8Array from it
      // This ensures complete isolation from any Buffer references
      const arrayBuffer = new ArrayBuffer(plainBytes.length);
      scriptBytes = new Uint8Array(arrayBuffer);
      for (let i = 0; i < plainBytes.length; i++) {
        scriptBytes[i] = plainBytes[i];
      }

      // Step 4: Final verification - must be pure Uint8Array
      if (Buffer.isBuffer(scriptBytes)) {
        throw new Error(`FATAL: scriptBytes is still a Buffer after conversion!`);
      }
      if (scriptBytes.constructor.name !== 'Uint8Array') {
        throw new Error(`FATAL: scriptBytes constructor is ${scriptBytes.constructor.name}, expected Uint8Array`);
      }
      if (scriptBytes.constructor !== Uint8Array) {
        throw new Error(`FATAL: scriptBytes.constructor !== Uint8Array (got ${scriptBytes.constructor})`);
      }
    } catch (hexError) {
      throw new Error(`Invalid scriptPk format (not hex): ${scriptPk.substring(0, 50)}... Error: ${hexError.message}`);
    }

    // Convert value to BigInt (bip174 requires bigint, not number)
    const utxoValueBigInt = typeof utxoValue === 'bigint' ? utxoValue : BigInt(utxoValue);

    // Create witnessUtxo object with pure Uint8Array and BigInt
    // Use Object.freeze to prevent any modifications that might trigger Buffer detection
    const witnessUtxo = Object.freeze({
      script: scriptBytes,  // Pure Uint8Array (guaranteed no Buffer inheritance)
      value: utxoValueBigInt,   // BigInt (as required)
    });

    // Debug: Final verification before addInput
    console.log(`[OrdinalTransfer] 🔍 Final verification before addInput:`);
    console.log(`  - scriptBytes type: ${scriptBytes.constructor.name}`);
    console.log(`  - scriptBytes is Buffer: ${Buffer.isBuffer(scriptBytes)}`);
    console.log(`  - value type: ${typeof witnessUtxo.value}`);
    console.log(`  - value: ${witnessUtxo.value.toString()}`);

    // Check if this is a Taproot address (bc1p) and extract tapInternalKey from scriptPubKey
    // For Taproot UTXOs, Xverse requires tapInternalKey to be present in the PSBT
    // For P2TR, scriptPubKey format is: 5120<taproot_output_key> (34 bytes total)
    // The taproot_output_key (last 32 bytes) is the hash of tapInternalKey
    // However, some wallets (like Xverse) may accept the taproot_output_key as tapInternalKey
    // or derive it from the scriptPubKey during signing
    let tapInternalKey = null;
    const isTaproot = ownerAddress && ownerAddress.startsWith('bc1p');
    
    if (isTaproot && scriptBytes && scriptBytes.length >= 34) {
      try {
        // For P2TR, scriptPubKey is: 51 (OP_1) + 20 (push 32 bytes) + 32 bytes (taproot_output_key)
        // Extract the last 32 bytes as taproot_output_key
        // Note: This is technically the hash of tapInternalKey, not tapInternalKey itself
        // But some wallets may use this to derive or validate tapInternalKey
        const taprootOutputKey = scriptBytes.slice(2); // Skip first 2 bytes (51 20), get last 32 bytes
        if (taprootOutputKey.length === 32) {
          // Convert to Buffer for tapInternalKey (bitcoinjs-lib expects Buffer)
          tapInternalKey = Buffer.from(taprootOutputKey);
          console.log(`[OrdinalTransfer] 🔍 Taproot detected: Extracted taproot_output_key from scriptPubKey`);
          console.log(`[OrdinalTransfer] taproot_output_key (hex): ${tapInternalKey.toString('hex').substring(0, 20)}...`);
        }
      } catch (extractError) {
        console.warn(`[OrdinalTransfer] ⚠️  Failed to extract taproot_output_key: ${extractError.message}`);
      }
    }

    // Prepare input data
    const inputData = {
      hash: txid,
      index: parseInt(vout),
      witnessUtxo: witnessUtxo,
    };

    // Add tapInternalKey if we extracted it (for Taproot UTXOs)
    // Note: This is the taproot_output_key, not the actual tapInternalKey
    // The wallet should be able to use this to derive or validate the tapInternalKey
    if (tapInternalKey) {
      inputData.tapInternalKey = tapInternalKey;
      console.log(`[OrdinalTransfer] ✅ Added tapInternalKey to PSBT input (Taproot: YES)`);
    } else {
      console.log(`[OrdinalTransfer] Adding input to PSBT (Taproot: ${isTaproot ? 'YES (no tapInternalKey)' : 'NO'})`);
    }
    
    psbt.addInput(inputData);

    const estimatedVSize = 200;
    const fee = estimatedVSize * feeRate;
    
    console.log(`[OrdinalTransfer] Calculated fee: ${fee} sats (${feeRate} sat/vB * ${estimatedVSize} vB)`);

    // Note: For ordinal transfers, the fee is typically handled separately
    // We send the full UTXO value to the recipient
    // The wallet will handle fee calculation when signing

    // Output: Send ordinal to recipient (with the full UTXO value)
    psbt.addOutput({
      address: recipientAddress,
      value: utxoValueBigInt, // Ordinal keeps its full value (must be BigInt)
    });
    
    console.log(`[OrdinalTransfer] Output: ${utxoValueBigInt.toString()} sats to ${recipientAddress}`);
    
    // Debug: Prüfe PSBT-Struktur
    const outputCount = psbt.txOutputs ? psbt.txOutputs.length : (psbt.outputCount || 'unknown');
    console.log(`[OrdinalTransfer] ✅ UNSIGNED PSBT created: ${psbt.inputCount} input(s), ${outputCount} output(s)`);
    
    // Debug: Validiere PSBT-Struktur
    try {
      const psbtBase64Test = psbt.toBase64();
      console.log(`[OrdinalTransfer] PSBT Base64 length: ${psbtBase64Test.length} chars`);
      console.log(`[OrdinalTransfer] PSBT Base64 preview: ${psbtBase64Test.substring(0, 50)}...`);
    } catch (validationError) {
      console.error(`[OrdinalTransfer] ⚠️ PSBT validation error:`, validationError);
      throw new Error(`PSBT validation failed: ${validationError.message}`);
    }
    
    console.log(`[OrdinalTransfer] ℹ️  This PSBT will be signed by the wallet in the frontend - NO PRIVATE KEY NEEDED IN BACKEND!`);
    return psbt;

  } catch (error) {
    console.error('[OrdinalTransfer] Error creating PSBT:', error);
    throw error;
  }
}

/**
 * Prepares an unsigned PSBT for pre-signing
 * Returns the PSBT as Base64 for wallet signing
 * @param {string} inscriptionId - The inscription ID to transfer
 * @param {string} recipientAddress - The recipient Bitcoin address
 * @param {number} feeRate - Fee rate in sat/vB
 * @returns {Promise<{psbtBase64: string, inscriptionId: string, feeRate: number, recipientAddress: string}>}
 */
export async function preparePresignedTransfer(inscriptionId, recipientAddress, feeRate = 5) {
  try {
    console.log(`[OrdinalTransfer] Preparing UNSIGNED PSBT for pre-signing: ${inscriptionId} to ${recipientAddress} at ${feeRate} sat/vB`);
    const psbt = await createTransferPSBT(inscriptionId, recipientAddress, feeRate);
    const psbtBase64 = psbt.toBase64();
    console.log(`[OrdinalTransfer] ✅ Unsigned PSBT created for ${inscriptionId} (ready for wallet signing)`);
    return { psbtBase64, inscriptionId, feeRate, recipientAddress };
  } catch (error) {
    console.error('[OrdinalTransfer] Error preparing PSBT for pre-signing:', error);
    throw error;
  }
}

/**
 * Finalizes a signed PSBT and extracts the raw transaction hex
 * The PSBT should already be signed by the wallet
 * @param {string} signedPsbtHex - The signed PSBT in hex or base64 format
 * @returns {string} The raw transaction hex (ready for broadcasting)
 */
export function finalizeSignedPSBT(signedPsbtHex) {
  try {
    console.log(`[OrdinalTransfer] Finalizing PSBT... Input length: ${signedPsbtHex.length}, first 50 chars: ${signedPsbtHex.substring(0, 50)}`);
    
    let psbt;
    
    // Try to parse as base64 first (most common format from wallets)
    try {
      console.log('[OrdinalTransfer] Attempting to parse as Base64...');
      psbt = bitcoin.Psbt.fromBase64(signedPsbtHex, { network: NETWORK });
      console.log('[OrdinalTransfer] ✅ Successfully parsed as Base64 PSBT');
    } catch (base64Error) {
      console.log(`[OrdinalTransfer] Base64 parsing failed: ${base64Error.message}, trying hex...`);
      // If base64 fails, try hex
      try {
        psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: NETWORK });
        console.log('[OrdinalTransfer] ✅ Successfully parsed as Hex PSBT');
      } catch (hexError) {
        console.error(`[OrdinalTransfer] ❌ Both Base64 and Hex parsing failed:`);
        console.error(`  Base64 error: ${base64Error.message}`);
        console.error(`  Hex error: ${hexError.message}`);
        throw new Error(`Failed to parse PSBT as base64 or hex: ${base64Error.message} / ${hexError.message}`);
      }
    }
    
    console.log(`[OrdinalTransfer] PSBT has ${psbt.inputCount} input(s) and ${psbt.outputCount} output(s)`);
    
    // Check if PSBT is already finalized
    let needsFinalization = false;
    for (let i = 0; i < psbt.inputCount; i++) {
      const input = psbt.data.inputs[i];
      if (!input.finalScriptSig && !input.finalScriptWitness) {
        needsFinalization = true;
        break;
      }
    }
    
    if (needsFinalization) {
      console.log('[OrdinalTransfer] PSBT needs finalization, finalizing all inputs...');
      // Finalize all inputs (extract signatures from PSBT)
      psbt.finalizeAllInputs();
      console.log('[OrdinalTransfer] ✅ All inputs finalized');
    } else {
      console.log('[OrdinalTransfer] ⚠️ PSBT appears to be already finalized');
    }
    
    // Extract transaction
    console.log('[OrdinalTransfer] Extracting transaction from PSBT...');
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    const txId = tx.getId();
    
    console.log(`[OrdinalTransfer] ✅ PSBT finalized, extracted transaction: ${txId}`);
    console.log(`[OrdinalTransfer] Transaction hex length: ${txHex.length}`);
    console.log(`[OrdinalTransfer] Transaction has ${tx.ins.length} input(s) and ${tx.outs.length} output(s)`);
    
    return txHex;
  } catch (error) {
    console.error('[OrdinalTransfer] ❌ Error finalizing signed PSBT:', error);
    console.error('[OrdinalTransfer] Error stack:', error.stack);
    throw error;
  }
}

/**
 * Broadcasts a pre-signed raw transaction
 * @param {string} signedTxHex - The signed raw transaction in hex format
 * @returns {Promise<{txid: string, broadcastData: any}>}
 */
export async function broadcastPresignedTx(signedTxHex) {
  try {
    console.log('[OrdinalTransfer] Broadcasting pre-signed transaction...');
    console.log(`[OrdinalTransfer] Input length: ${signedTxHex.length}`);
    console.log(`[OrdinalTransfer] Input preview: ${signedTxHex.substring(0, 100)}...`);
    
    // WICHTIG: signedTxHex kann Base64 PSBT oder Hex Transaction sein
    // Die Validierung sollte nicht zu strikt sein, da wir Base64 PSBTs akzeptieren müssen
    // Die Finalisierung wird später prüfen, ob es eine gültige PSBT ist
    
    if (typeof signedTxHex !== 'string' || signedTxHex.length === 0) {
      throw new Error(`Invalid transaction format. Expected non-empty string, got: ${typeof signedTxHex}`);
    }
    
    // Wenn es sehr kurz ist, ist es wahrscheinlich ungültig
    if (signedTxHex.length < 50) {
      throw new Error(`Transaction data too short (${signedTxHex.length} chars). Expected at least 50 characters.`);
    }
    
    // UniSat API Broadcast-Endpoint (verschiedene mögliche URLs)
    const broadcastUrls = [
      `${UNISAT_API_URL}/v1/indexer/broadcast`,
      `${UNISAT_API_URL}/v1/broadcast`,
      `https://mempool.space/api/tx`, // Fallback: Blockstream Mempool API
    ];
    
    let broadcastResponse = null;
    let lastError = null;
    
    // Versuche verschiedene Broadcast-Endpoints
    for (const broadcastUrl of broadcastUrls) {
      try {
        console.log(`[OrdinalTransfer] Attempting broadcast to: ${broadcastUrl}`);
        
        if (broadcastUrl.includes('mempool.space')) {
          // Blockstream Mempool API (kein Auth benötigt)
          // Erwartet raw transaction hex als plain text
          console.log(`[OrdinalTransfer] Broadcasting to Blockstream Mempool (raw hex, length: ${signedTxHex.length})`);
          broadcastResponse = await fetch(broadcastUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain',
            },
            body: signedTxHex,
          });
        } else {
          // UniSat API (mit Auth)
          // Erwartet JSON mit rawtx field
          console.log(`[OrdinalTransfer] Broadcasting to UniSat API (JSON, hex length: ${signedTxHex.length})`);
          broadcastResponse = await fetch(broadcastUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${UNISAT_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ rawtx: signedTxHex }),
          });
        }
        
        if (broadcastResponse.ok) {
          console.log(`[OrdinalTransfer] ✅ Broadcast successful via ${broadcastUrl}`);
          break;
        } else {
          console.warn(`[OrdinalTransfer] ⚠️ Broadcast failed via ${broadcastUrl}: ${broadcastResponse.status} ${broadcastResponse.statusText}`);
          lastError = `${broadcastResponse.status} ${broadcastResponse.statusText}`;
          broadcastResponse = null;
        }
      } catch (urlError) {
        console.warn(`[OrdinalTransfer] ⚠️ Error broadcasting via ${broadcastUrl}:`, urlError.message);
        lastError = urlError.message;
        broadcastResponse = null;
      }
    }
    
    if (!broadcastResponse) {
      throw new Error(`All broadcast endpoints failed. Last error: ${lastError}`);
    }

    console.log(`[OrdinalTransfer] Broadcast response status: ${broadcastResponse.status} ${broadcastResponse.statusText}`);

    if (!broadcastResponse.ok) {
      const errorText = await broadcastResponse.text().catch(() => 'Unable to read error response');
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { message: errorText };
      }
      
      console.error(`[OrdinalTransfer] ❌ Broadcast failed: ${broadcastResponse.status} ${broadcastResponse.statusText}`);
      console.error(`[OrdinalTransfer] Error response:`, errorData);
      
      throw new Error(errorData.message || errorData.msg || `Broadcast failed: ${broadcastResponse.statusText}`);
    }

    // Parse response (kann JSON oder Text sein)
    let broadcastData;
    let txid;
    
    try {
      const responseText = await broadcastResponse.text();
      console.log(`[OrdinalTransfer] Broadcast response text:`, responseText.substring(0, 200));
      
      try {
        broadcastData = JSON.parse(responseText);
        console.log(`[OrdinalTransfer] Broadcast response data:`, JSON.stringify(broadcastData, null, 2));
        txid = broadcastData.result || broadcastData.data || broadcastData.txid || broadcastData;
      } catch (jsonError) {
        // Response ist kein JSON - könnte direkt die TXID sein
        console.log(`[OrdinalTransfer] Response is not JSON, treating as TXID`);
        txid = responseText.trim();
        broadcastData = { txid: txid };
      }
    } catch (parseError) {
      console.error(`[OrdinalTransfer] ❌ Error parsing broadcast response:`, parseError);
      throw new Error(`Failed to parse broadcast response: ${parseError.message}`);
    }
    
    // Falls keine TXID gefunden, versuche sie aus der Transaction zu extrahieren
    if (!txid || txid.length < 20) {
      try {
        const tx = bitcoin.Transaction.fromHex(signedTxHex);
        txid = tx.getId();
        console.log(`[OrdinalTransfer] Extracted TXID from transaction: ${txid}`);
      } catch (txError) {
        console.error(`[OrdinalTransfer] ❌ Could not extract TXID. Response:`, broadcastData);
        throw new Error('Broadcast successful but no transaction ID returned or extractable.');
      }
    }

    console.log(`[OrdinalTransfer] ✅ Pre-signed transaction broadcasted: ${txid}`);
    return { txid, broadcastData };
  } catch (error) {
    console.error('[OrdinalTransfer] ❌ Error broadcasting pre-signed transaction:', error);
    console.error('[OrdinalTransfer] Error stack:', error.stack);
    throw error;
  }
}

/**
 * Transfers an ordinal using a pre-signed transaction
 * NOTE: This function ONLY accepts pre-signed transactions - NO automatic signing!
 * @param {string} inscriptionId - The inscription ID to transfer
 * @param {string} recipientAddress - The recipient Bitcoin address
 * @param {number} feeRate - Fee rate in sat/vB (optional if using pre-signed)
 * @param {string} presignedTxHex - REQUIRED: Pre-signed PSBT (base64 or hex) or final transaction hex
 * @returns {Promise<{txid: string}>}
 */
export async function transferOrdinal(inscriptionId, recipientAddress, feeRate = 5, presignedTxHex = null) {
  try {
    // For pre-signing workflow: We ONLY accept pre-signed transactions
    // No automatic signing in the backend - the wallet signs in the frontend
    if (!presignedTxHex) {
      throw new Error('Pre-signed transaction required. Please use preparePresignedTransfer to create a PSBT, sign it with your wallet in the frontend, and then call this function with the signed transaction hex.');
    }

    console.log(`[OrdinalTransfer] Processing pre-signed transaction for ${inscriptionId}`);
    console.log(`[OrdinalTransfer] Input length: ${presignedTxHex.length} chars`);
    
    // Prüfe ob es eine PSBT (base64/hex) oder bereits eine finalisierte Transaction (hex) ist
    let finalTxHex = presignedTxHex;
    
    // Versuche, es als PSBT zu parsen (wenn es eine PSBT ist, muss sie finalisiert werden)
    try {
      // Prüfe ob es eine PSBT ist (Base64 mit PSBT magic bytes oder Hex)
      const isBase64PSBT = presignedTxHex.startsWith('cHNidP8BA'); // PSBT magic bytes in base64
      const isHexPSBT = /^[0-9a-fA-F]+$/.test(presignedTxHex) && presignedTxHex.length > 200 && presignedTxHex.length < 2000;
      const isBase64String = !/^[0-9a-fA-F]+$/.test(presignedTxHex) && presignedTxHex.length > 100; // Nicht-Hex, aber lang genug
      
      console.log(`[OrdinalTransfer] Input analysis: isBase64PSBT=${isBase64PSBT}, isHexPSBT=${isHexPSBT}, isBase64String=${isBase64String}, length=${presignedTxHex.length}`);
      
      // Wenn es Base64 ist (entweder PSBT magic bytes oder einfach nicht-Hex), versuche es als PSBT zu finalisieren
      if (isBase64PSBT || (isBase64String && !isHexPSBT)) {
        console.log('[OrdinalTransfer] Detected Base64 PSBT format, finalizing...');
        try {
          finalTxHex = finalizeSignedPSBT(presignedTxHex);
          console.log(`[OrdinalTransfer] ✅ PSBT finalized, transaction hex length: ${finalTxHex.length}`);
        } catch (finalizeError) {
          console.error(`[OrdinalTransfer] ❌ Failed to finalize Base64 PSBT:`, finalizeError.message);
          console.error(`[OrdinalTransfer] PSBT preview: ${presignedTxHex.substring(0, 100)}...`);
          throw new Error(`Failed to finalize PSBT: ${finalizeError.message}`);
        }
      } else if (isHexPSBT) {
        // Prüfe ob es bereits eine finalisierte Transaction ist (hex, typischerweise ~500-1000 chars)
        // oder eine Hex-PSBT (länger, ~2000+ chars)
        if (presignedTxHex.length > 200 && presignedTxHex.length < 2000) {
          console.log('[OrdinalTransfer] Assuming already finalized transaction hex');
          finalTxHex = presignedTxHex;
        } else {
          // Längere Hex-Strings könnten Hex-PSBTs sein
          console.log('[OrdinalTransfer] Attempting to finalize as Hex PSBT...');
          try {
            finalTxHex = finalizeSignedPSBT(presignedTxHex);
            console.log(`[OrdinalTransfer] ✅ Hex PSBT finalized successfully`);
          } catch (finalizeError) {
            console.warn('[OrdinalTransfer] ⚠️ Finalization failed, using as-is:', finalizeError.message);
            finalTxHex = presignedTxHex;
          }
        }
      } else {
        // Unbekanntes Format - versuche trotzdem zu finalisieren
        console.log('[OrdinalTransfer] Unknown format, attempting to finalize as PSBT...');
        try {
          finalTxHex = finalizeSignedPSBT(presignedTxHex);
          console.log(`[OrdinalTransfer] ✅ PSBT finalized successfully`);
        } catch (finalizeError) {
          console.error('[OrdinalTransfer] ❌ Finalization failed:', finalizeError.message);
          throw new Error(`Failed to process transaction: ${finalizeError.message}`);
        }
      }
    } catch (psbtError) {
      // Wenn PSBT-Parsing fehlschlägt, ist es wahrscheinlich bereits eine finalisierte Transaction
      console.error('[OrdinalTransfer] ❌ PSBT parsing error:', psbtError.message);
      console.log('[OrdinalTransfer] Using input as final transaction hex');
      finalTxHex = presignedTxHex;
    }
    
    console.log(`[OrdinalTransfer] Broadcasting final transaction for ${inscriptionId}`);
    return await broadcastPresignedTx(finalTxHex);
  } catch (error) {
    console.error('[OrdinalTransfer] Error transferring ordinal:', error);
    throw error;
  }
}
