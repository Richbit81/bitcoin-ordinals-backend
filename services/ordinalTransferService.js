import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

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

    // Add input (the UTXO containing the ordinal)
    // Note: We only add the UTXO data here - NO signing information!
    // The wallet will add tapInternalKey, signatures, etc. when signing
    psbt.addInput({
      hash: txid,
      index: parseInt(vout),
      witnessUtxo: witnessUtxo,
      // NO tapInternalKey, NO signing info - wallet will add that!
    });

    const estimatedVSize = 200;
    const fee = estimatedVSize * feeRate;
    
    console.log(`[OrdinalTransfer] Calculated fee: ${fee} sats (${feeRate} sat/vB * ${estimatedVSize} vB)`);

    // Note: For ordinal transfers, the fee is typically handled separately
    // We send the full UTXO value to the recipient
    // The wallet will handle fee calculation when signing

    // Output: Send ordinal to recipient (with the full UTXO value)
    psbt.addOutput({
      address: recipientAddress,
      value: utxoValue, // Ordinal keeps its full value
    });
    
    console.log(`[OrdinalTransfer] Output: ${utxoValue} sats to ${recipientAddress}`);
    console.log(`[OrdinalTransfer] ✅ UNSIGNED PSBT created: ${psbt.inputCount} input(s), ${psbt.outputCount} output(s)`);
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
    let psbt;
    
    // Try to parse as base64 first (most common format from wallets)
    try {
      psbt = bitcoin.Psbt.fromBase64(signedPsbtHex, { network: NETWORK });
    } catch (base64Error) {
      // If base64 fails, try hex
      try {
        psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: NETWORK });
      } catch (hexError) {
        throw new Error(`Failed to parse PSBT as base64 or hex: ${base64Error.message} / ${hexError.message}`);
      }
    }
    
    // Finalize all inputs (extract signatures from PSBT)
    psbt.finalizeAllInputs();
    
    // Extract transaction
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    
    console.log(`[OrdinalTransfer] ✅ PSBT finalized, extracted transaction: ${tx.getId()}`);
    return txHex;
  } catch (error) {
    console.error('[OrdinalTransfer] Error finalizing signed PSBT:', error);
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
    
    const broadcastUrl = `${UNISAT_API_URL}/v1/indexer/broadcast`;
    const broadcastResponse = await fetch(broadcastUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rawtx: signedTxHex }),
    });

    if (!broadcastResponse.ok) {
      const errorData = await broadcastResponse.json().catch(() => ({}));
      throw new Error(errorData.message || `Broadcast failed: ${broadcastResponse.statusText}`);
    }

    const broadcastData = await broadcastResponse.json();
    const txid = broadcastData.result || broadcastData.data || broadcastData.txid;
    
    if (!txid) {
      throw new Error('Broadcast successful but no transaction ID returned.');
    }

    console.log(`[OrdinalTransfer] ✅ Pre-signed transaction broadcasted: ${txid}`);
    return { txid, broadcastData };
  } catch (error) {
    console.error('[OrdinalTransfer] Error broadcasting pre-signed transaction:', error);
    throw error;
  }
}

/**
 * Transfers an ordinal using a pre-signed transaction
 * NOTE: This function ONLY accepts pre-signed transactions - NO automatic signing!
 * @param {string} inscriptionId - The inscription ID to transfer
 * @param {string} recipientAddress - The recipient Bitcoin address
 * @param {number} feeRate - Fee rate in sat/vB (optional if using pre-signed)
 * @param {string} presignedTxHex - REQUIRED: Pre-signed transaction hex
 * @returns {Promise<{txid: string}>}
 */
export async function transferOrdinal(inscriptionId, recipientAddress, feeRate = 5, presignedTxHex = null) {
  try {
    // For pre-signing workflow: We ONLY accept pre-signed transactions
    // No automatic signing in the backend - the wallet signs in the frontend
    if (!presignedTxHex) {
      throw new Error('Pre-signed transaction required. Please use preparePresignedTransfer to create a PSBT, sign it with your wallet in the frontend, and then call this function with the signed transaction hex.');
    }

    console.log(`[OrdinalTransfer] Broadcasting pre-signed transaction for ${inscriptionId}`);
    return await broadcastPresignedTx(presignedTxHex);
  } catch (error) {
    console.error('[OrdinalTransfer] Error transferring ordinal:', error);
    throw error;
  }
}
