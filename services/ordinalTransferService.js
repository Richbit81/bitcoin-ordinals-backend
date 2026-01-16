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

// Admin Wallet privater Key (aus Environment Variable)
// Format: WIF (Wallet Import Format) oder hex
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || process.env.ADMIN_WIF;

/**
 * Erstelle Admin-Wallet KeyPair aus privatem Key
 */
function getAdminKeyPair() {
  if (!ADMIN_PRIVATE_KEY) {
    throw new Error('ADMIN_PRIVATE_KEY or ADMIN_WIF not set in environment variables');
  }

  try {
    // Versuche WIF-Format zuerst (typischerweise 51-52 Zeichen)
    if (ADMIN_PRIVATE_KEY.length === 52 || ADMIN_PRIVATE_KEY.length === 51) {
      return ECPair.fromWIF(ADMIN_PRIVATE_KEY, NETWORK);
    }
    
    // Sonst versuche Hex-Format
    const privateKeyBuffer = Buffer.from(ADMIN_PRIVATE_KEY, 'hex');
    return ECPair.fromPrivateKey(privateKeyBuffer, { network: NETWORK });
  } catch (error) {
    throw new Error(`Failed to parse admin private key: ${error.message}`);
  }
}

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
    console.log(`[OrdinalTransfer] âš ï¸  This PSBT will be signed by the wallet - NO PRIVATE KEY NEEDED!`);
    
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
      console.error(`[OrdinalTransfer] âŒ Failed to fetch inscription info: ${utxoResponse.status} ${utxoResponse.statusText}`, errorText);
      throw new Error(`Failed to fetch inscription info: ${utxoResponse.status} ${utxoResponse.statusText}`);
    }

    const inscriptionData = await utxoResponse.json();
    console.log(`[OrdinalTransfer] Inscription data received:`, JSON.stringify(inscriptionData, null, 2));
    
    if (inscriptionData.code !== 0 && inscriptionData.code !== undefined) {
      throw new Error(`UniSat API error (code ${inscriptionData.code}): ${inscriptionData.msg || 'Unknown error'}`);
    }
    
    const data = inscriptionData.data || inscriptionData.result || inscriptionData;
    
    if (!data) {
      console.error(`[OrdinalTransfer] âŒ No data in API response. Full response:`, JSON.stringify(inscriptionData, null, 2));
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
      console.log(`[OrdinalTransfer] âœ… Found UTXO object: txid=${txid}, vout=${vout}, value=${utxoValue}, scriptPk=${scriptPk ? scriptPk.substring(0, 20) + '...' : 'NOT FOUND'}`);
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
      console.error(`[OrdinalTransfer] âŒ Could not extract txid and vout.`);
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
        console.warn(`[OrdinalTransfer] âš ï¸ Failed to fetch transaction details: ${txError.message}`);
      }
    }
    
    // If we still don't have scriptPk, derive it from the recipient address
    if (!scriptPk) {
      console.warn(`[OrdinalTransfer] âš ï¸ ScriptPk not found. Deriving from recipient address...`);
      try {
        scriptPk = bitcoin.address.toOutputScript(recipientAddress, NETWORK).toString('hex');
        console.log(`[OrdinalTransfer] âœ… Derived scriptPk from recipient address: ${scriptPk.substring(0, 20)}...`);
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
      console.warn(`[OrdinalTransfer] âš ï¸ Owner address not found in UTXO data.`);
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
    console.log(`[OrdinalTransfer] ðŸ” Final verification before addInput:`);
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
          console.log(`[OrdinalTransfer] ðŸ” Taproot detected: Extracted taproot_output_key from scriptPubKey`);
          console.log(`[OrdinalTransfer] taproot_output_key (hex): ${tapInternalKey.toString('hex').substring(0, 20)}...`);
        }
      } catch (extractError) {
        console.warn(`[OrdinalTransfer] âš ï¸  Failed to extract taproot_output_key: ${extractError.message}`);
      }
    }

    // Prepare input data
    const inputData = {
      hash: txid,
      index: parseInt(vout),
      witnessUtxo: witnessUtxo,
    };

    // CRITICAL: DO NOT set tapInternalKey here!
    // The tapInternalKey must be set by the signer (admin key) in signPSBTWithAdmin
    // Setting it here with the wrong key (from scriptPk) causes signing to fail
    console.log(`[OrdinalTransfer] Adding input to PSBT (Taproot: ${isTaproot ? 'YES (tapInternalKey will be set by signer)' : 'NO'})`);
    
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
    
    // Debug: PrÃ¼fe PSBT-Struktur
    const outputCount = psbt.txOutputs ? psbt.txOutputs.length : (psbt.outputCount || 'unknown');
    console.log(`[OrdinalTransfer] âœ… UNSIGNED PSBT created: ${psbt.inputCount} input(s), ${outputCount} output(s)`);
    
    // Debug: Validiere PSBT-Struktur
    try {
      const psbtBase64Test = psbt.toBase64();
      console.log(`[OrdinalTransfer] PSBT Base64 length: ${psbtBase64Test.length} chars`);
      console.log(`[OrdinalTransfer] PSBT Base64 preview: ${psbtBase64Test.substring(0, 50)}...`);
    } catch (validationError) {
      console.error(`[OrdinalTransfer] âš ï¸ PSBT validation error:`, validationError);
      throw new Error(`PSBT validation failed: ${validationError.message}`);
    }
    
    console.log(`[OrdinalTransfer] â„¹ï¸  This PSBT will be signed by the wallet in the frontend - NO PRIVATE KEY NEEDED IN BACKEND!`);
    
    // Return both PSBT and ownerAddress for preparePresignedTransfer
    return {
      psbt: psbt,
      ownerAddress: ownerAddress
    };

  } catch (error) {
    console.error('[OrdinalTransfer] Error creating PSBT:', error);
    throw error;
  }
}

/**
 * Signiert eine PSBT mit dem Admin-Private-Key
 * @param {string} psbtBase64 - Die PSBT als Base64-String
 * @returns {Promise<string>} - Die signierte PSBT als Base64-String
 */
export function signPSBTWithAdmin(psbtBase64, expectedOwnerAddress = null) {
  try {
    // Trim whitespace from admin key
    const adminKey = ADMIN_PRIVATE_KEY ? ADMIN_PRIVATE_KEY.trim() : null;
    
    if (!adminKey) {
      throw new Error('ADMIN_PRIVATE_KEY not set - cannot sign PSBT');
    }
    
    console.log(`[OrdinalTransfer] ðŸ” Signing PSBT with admin key...`);
    console.log(`[OrdinalTransfer] ðŸ”„ RECREATING PSBT with correct tapInternalKey from scratch...`);
    
    // Import admin key
    let keyPair;
    try {
      if (adminKey.length === 52 || adminKey.length === 51) {
        keyPair = ECPair.fromWIF(adminKey, NETWORK);
        console.log(`[OrdinalTransfer] âœ… Admin key imported from WIF`);
      } else {
        const privateKeyBuffer = Buffer.from(adminKey, 'hex');
        keyPair = ECPair.fromPrivateKey(privateKeyBuffer, { network: NETWORK });
        console.log(`[OrdinalTransfer] âœ… Admin key imported from HEX`);
      }
    } catch (keyError) {
      throw new Error(`Failed to import admin key: ${keyError.message}`);
    }
    
    // Calculate our tapInternalKey (x-only pubkey for Taproot)
    const ourTapInternalKey = keyPair.publicKey.slice(1, 33); // Remove 0x02/0x03 prefix
    const ourTapInternalKeyHex = Buffer.from(ourTapInternalKey).toString('hex');
    console.log(`[OrdinalTransfer] âœ… Calculated tapInternalKey: ${ourTapInternalKeyHex}`);
    
    // Parse OLD PSBT to extract data
    let oldPsbt;
    try {
      oldPsbt = bitcoin.Psbt.fromBase64(psbtBase64, { network: NETWORK });
    } catch (base64Error) {
      try {
        oldPsbt = bitcoin.Psbt.fromHex(psbtBase64, { network: NETWORK });
      } catch (hexError) {
        throw new Error(`Failed to parse PSBT: ${base64Error.message} / ${hexError.message}`);
      }
    }
    
    console.log(`[OrdinalTransfer] Old PSBT has ${oldPsbt.inputCount} input(s) and ${oldPsbt.outputCount} output(s)`);
    
    // Extract input data from old PSBT
    if (oldPsbt.inputCount === 0) {
      throw new Error('Old PSBT has no inputs');
    }
    
    const input = oldPsbt.data.inputs[0];
    if (!input.witnessUtxo) {
      throw new Error('Input has no witnessUtxo');
    }
    
    const txid = oldPsbt.txInputs[0].hash.reverse().toString('hex');
    const vout = oldPsbt.txInputs[0].index;
    const value = input.witnessUtxo.value;
    const scriptPubKey = input.witnessUtxo.script;
    
    console.log(`[OrdinalTransfer] Extracted input data: txid=${txid}, vout=${vout}, value=${value.toString()}`);
    
    // Extract output data from old PSBT
    if (oldPsbt.outputCount === 0) {
      throw new Error('Old PSBT has no outputs');
    }
    
    const output = oldPsbt.txOutputs[0];
    const recipientAddress = bitcoin.address.fromOutputScript(output.script, NETWORK);
    const outputValue = output.value;
    
    console.log(`[OrdinalTransfer] Extracted output data: address=${recipientAddress}, value=${outputValue.toString()}`);
    
    // Check if it's Taproot
    const isTaproot = scriptPubKey[0] === 0x51 && scriptPubKey.length === 34;
    console.log(`[OrdinalTransfer] Input is Taproot: ${isTaproot}`);
    
    // CREATE NEW PSBT with correct tapInternalKey from the start
    const psbt = new bitcoin.Psbt({ network: NETWORK });
    
    // Prepare input data
    const inputData = {
      hash: txid,
      index: parseInt(vout),
      witnessUtxo: {
        script: scriptPubKey,
        value: value,
      },
    };
    
    // CRITICAL: Set tapInternalKey DIRECTLY if it's Taproot
    if (isTaproot) {
      inputData.tapInternalKey = ourTapInternalKey;
      console.log(`[OrdinalTransfer] âœ… Setting tapInternalKey directly in inputData: ${ourTapInternalKeyHex}`);
    }
    
    psbt.addInput(inputData);
    console.log(`[OrdinalTransfer] âœ… Added input to NEW PSBT with ${isTaproot ? 'tapInternalKey set' : 'no tapInternalKey'}`);
    
    // Add output
    psbt.addOutput({
      address: recipientAddress,
      value: outputValue,
    });
    console.log(`[OrdinalTransfer] âœ… Added output to NEW PSBT`);
    
    // Verify tapInternalKey is set (if Taproot)
    if (isTaproot) {
      const newPsbtInput = psbt.data.inputs[0];
      if (newPsbtInput.tapInternalKey) {
        console.log(`[OrdinalTransfer] âœ… Verified: tapInternalKey is set in NEW PSBT: ${Buffer.from(newPsbtInput.tapInternalKey).toString('hex')}`);
      } else {
        console.error(`[OrdinalTransfer] âŒ ERROR: tapInternalKey NOT set in NEW PSBT despite being Taproot!`);
      }
    }
    
    // Berechne Adressen fÃ¼r diesen Key (for verification)
    const p2pkhAddress = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
    const p2wpkhAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
    const p2trAddress = bitcoin.payments.p2tr({
      internalPubkey: ourTapInternalKey,
      network: NETWORK,
    }).address;
    
    // Zeige Public Key fÃ¼r Debugging
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    
    console.log(`[OrdinalTransfer] ========== KEY VERIFICATION ==========`);
    console.log(`[OrdinalTransfer]   - Private Key (WIF, first 10 chars): ${adminKey.substring(0, 10)}...`);
    console.log(`[OrdinalTransfer]   - Private Key (WIF, last 10 chars): ...${adminKey.substring(adminKey.length - 10)}`);
    console.log(`[OrdinalTransfer]   - Public Key (hex, FULL): ${publicKeyHex}`);
    console.log(`[OrdinalTransfer]   - P2TR address: ${p2trAddress}`);
    console.log(`[OrdinalTransfer]   - Our tapInternalKey (hex): ${ourTapInternalKeyHex}`);
    console.log(`[OrdinalTransfer] ======================================`);
    
    if (expectedOwnerAddress) {
      const matches = expectedOwnerAddress.toLowerCase() === p2pkhAddress.toLowerCase() ||
                     expectedOwnerAddress.toLowerCase() === p2wpkhAddress.toLowerCase() ||
                     expectedOwnerAddress.toLowerCase() === p2trAddress.toLowerCase();
      if (!matches) {
        console.warn(`[OrdinalTransfer] âš ï¸ WARNING: Expected owner address ${expectedOwnerAddress} does not match any address derived from admin key:`);
        console.warn(`[OrdinalTransfer]   - P2PKH: ${p2pkhAddress}`);
        console.warn(`[OrdinalTransfer]   - P2WPKH: ${p2wpkhAddress}`);
        console.warn(`[OrdinalTransfer]   - P2TR: ${p2trAddress}`);
      } else {
        console.log(`[OrdinalTransfer] âœ… Expected owner address matches admin key address`);
      }
    }
    
    // Signiere alle Inputs mit Admin-KeyPair
    for (let i = 0; i < psbt.inputCount; i++) {
      try {
        const inputType = psbt.data.inputs[i].witnessUtxo ? 
          (psbt.data.inputs[i].witnessUtxo.script[0] === 0x51 ? 'Taproot' : 'Segwit') : 
          'Legacy';
        console.log(`[OrdinalTransfer] Signing input ${i} (type: ${inputType})...`);
        
        psbt.signInput(i, keyPair);
        console.log(`[OrdinalTransfer] âœ… Signed input ${i}`);
      } catch (signError) {
        console.error(`[OrdinalTransfer] âŒ Failed to sign input ${i}:`, signError.message);
        console.error(`[OrdinalTransfer] Error details:`, signError);
        throw new Error(`Failed to sign input ${i}: ${signError.message}`);
      }
    }
    
    const signedPsbtBase64 = psbt.toBase64();
    console.log(`[OrdinalTransfer] âœ… PSBT signed with admin key`);
    
    return signedPsbtBase64;
  } catch (error) {
    console.error('[OrdinalTransfer] âŒ Error signing PSBT with admin key:', error);
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
    
    // createTransferPSBT returns both PSBT and ownerAddress
    const result = await createTransferPSBT(inscriptionId, recipientAddress, feeRate);
    const psbt = result.psbt || result;
    const ownerAddress = result.ownerAddress || null;
    
    const psbtBase64 = psbt.toBase64();
    console.log(`[OrdinalTransfer] âœ… Unsigned PSBT created for ${inscriptionId} (ready for wallet signing)`);
    if (ownerAddress) {
      console.log(`[OrdinalTransfer] Owner address (input address): ${ownerAddress}`);
    } else {
      console.warn(`[OrdinalTransfer] âš ï¸ Owner address not found`);
    }
    
    return { 
      psbtBase64, 
      inscriptionId, 
      feeRate, 
      recipientAddress,
      ownerAddress // Return owner address so frontend knows which address controls the input
    };
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
      console.log('[OrdinalTransfer] âœ… Successfully parsed as Base64 PSBT');
    } catch (base64Error) {
      console.log(`[OrdinalTransfer] Base64 parsing failed: ${base64Error.message}, trying hex...`);
      // If base64 fails, try hex
      try {
        psbt = bitcoin.Psbt.fromHex(signedPsbtHex, { network: NETWORK });
        console.log('[OrdinalTransfer] âœ… Successfully parsed as Hex PSBT');
      } catch (hexError) {
        console.error(`[OrdinalTransfer] âŒ Both Base64 and Hex parsing failed:`);
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
      
      // Detaillierte Analyse jedes Inputs vor der Finalisierung
      for (let i = 0; i < psbt.inputCount; i++) {
        const input = psbt.data.inputs[i];
        const isTaproot = input.tapInternalKey || input.tapMerkleRoot;
        
        console.log(`[OrdinalTransfer] Input ${i} analysis:`, {
          isTaproot,
          hasTapInternalKey: !!input.tapInternalKey,
          hasTapMerkleRoot: !!input.tapMerkleRoot,
          hasTapKeySig: !!input.tapKeySig,
          tapScriptSigCount: input.tapScriptSig?.length || 0,
          hasFinalScriptSig: !!input.finalScriptSig,
          hasFinalScriptWitness: !!input.finalScriptWitness,
          hasWitnessUtxo: !!input.witnessUtxo,
          hasNonWitnessUtxo: !!input.nonWitnessUtxo,
        });
        
        if (isTaproot) {
          console.log(`[OrdinalTransfer] Input ${i} is Taproot`);
          
          // PrÃ¼fe verschiedene Signatur-Formate
          const hasTapKeySig = !!input.tapKeySig;
          const hasTapScriptSig = input.tapScriptSig && input.tapScriptSig.length > 0;
          const hasFinalScriptWitness = !!input.finalScriptWitness;
          
          if (!hasTapKeySig && !hasTapScriptSig && !hasFinalScriptWitness) {
            console.warn(`[OrdinalTransfer] âš ï¸ Taproot input ${i} appears to have no signature, but attempting finalization anyway`);
            console.warn(`[OrdinalTransfer] Xverse may have signed in a way that's not immediately visible`);
          } else {
            console.log(`[OrdinalTransfer] âœ… Taproot input ${i} has signature indicators (tapKeySig: ${hasTapKeySig}, tapScriptSig: ${hasTapScriptSig}, finalScriptWitness: ${hasFinalScriptWitness})`);
          }
        }
      }
      
      // Finalize all inputs (extract signatures from PSBT)
      try {
        // FÃ¼r Taproot: bitcoinjs-lib sollte automatisch die richtige Finalisierungsmethode wÃ¤hlen
        psbt.finalizeAllInputs();
        console.log('[OrdinalTransfer] âœ… All inputs finalized');
      } catch (finalizeError) {
        console.error('[OrdinalTransfer] âŒ Error finalizing all inputs:', finalizeError);
        console.error('[OrdinalTransfer] Error details:', {
          message: finalizeError.message,
          stack: finalizeError.stack,
        });
        
        // Versuche manuelle Finalisierung fÃ¼r jeden Input einzeln
        console.log('[OrdinalTransfer] Attempting manual finalization per input...');
        try {
          for (let i = 0; i < psbt.inputCount; i++) {
            try {
              psbt.finalizeInput(i);
              console.log(`[OrdinalTransfer] âœ… Input ${i} finalized manually`);
            } catch (inputError) {
              console.error(`[OrdinalTransfer] âŒ Failed to finalize input ${i}:`, inputError.message);
              // Wenn es der letzte Input ist und fehlschlÃ¤gt, werfe den Fehler
              if (i === psbt.inputCount - 1) {
                throw inputError;
              }
            }
          }
          console.log('[OrdinalTransfer] âœ… Manual finalization completed');
        } catch (manualError) {
          throw new Error(`Failed to finalize PSBT: ${finalizeError.message}. Manual finalization also failed: ${manualError.message}`);
        }
      }
    } else {
      console.log('[OrdinalTransfer] âš ï¸ PSBT appears to be already finalized');
    }
    
    // Extract transaction
    console.log('[OrdinalTransfer] Extracting transaction from PSBT...');
    const tx = psbt.extractTransaction();
    const txHex = tx.toHex();
    const txId = tx.getId();
    
    console.log(`[OrdinalTransfer] âœ… PSBT finalized, extracted transaction: ${txId}`);
    console.log(`[OrdinalTransfer] Transaction hex length: ${txHex.length}`);
    console.log(`[OrdinalTransfer] Transaction has ${tx.ins.length} input(s) and ${tx.outs.length} output(s)`);
    
    return txHex;
  } catch (error) {
    console.error('[OrdinalTransfer] âŒ Error finalizing signed PSBT:', error);
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
    // Die Validierung sollte nicht zu strikt sein, da wir Base64 PSBTs akzeptieren mÃ¼ssen
    // Die Finalisierung wird spÃ¤ter prÃ¼fen, ob es eine gÃ¼ltige PSBT ist
    
    if (typeof signedTxHex !== 'string' || signedTxHex.length === 0) {
      throw new Error(`Invalid transaction format. Expected non-empty string, got: ${typeof signedTxHex}`);
    }
    
    // Wenn es sehr kurz ist, ist es wahrscheinlich ungÃ¼ltig
    if (signedTxHex.length < 50) {
      throw new Error(`Transaction data too short (${signedTxHex.length} chars). Expected at least 50 characters.`);
    }
    
    // UniSat API Broadcast-Endpoint (verschiedene mÃ¶gliche URLs)
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
          // Blockstream Mempool API (kein Auth benÃ¶tigt)
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
          console.log(`[OrdinalTransfer] âœ… Broadcast successful via ${broadcastUrl}`);
          break;
        } else {
          console.warn(`[OrdinalTransfer] âš ï¸ Broadcast failed via ${broadcastUrl}: ${broadcastResponse.status} ${broadcastResponse.statusText}`);
          lastError = `${broadcastResponse.status} ${broadcastResponse.statusText}`;
          broadcastResponse = null;
        }
      } catch (urlError) {
        console.warn(`[OrdinalTransfer] âš ï¸ Error broadcasting via ${broadcastUrl}:`, urlError.message);
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
      
      console.error(`[OrdinalTransfer] âŒ Broadcast failed: ${broadcastResponse.status} ${broadcastResponse.statusText}`);
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
        // Response ist kein JSON - kÃ¶nnte direkt die TXID sein
        console.log(`[OrdinalTransfer] Response is not JSON, treating as TXID`);
        txid = responseText.trim();
        broadcastData = { txid: txid };
      }
    } catch (parseError) {
      console.error(`[OrdinalTransfer] âŒ Error parsing broadcast response:`, parseError);
      throw new Error(`Failed to parse broadcast response: ${parseError.message}`);
    }
    
    // Falls keine TXID gefunden, versuche sie aus der Transaction zu extrahieren
    if (!txid || txid.length < 20) {
      try {
        const tx = bitcoin.Transaction.fromHex(signedTxHex);
        txid = tx.getId();
        console.log(`[OrdinalTransfer] Extracted TXID from transaction: ${txid}`);
      } catch (txError) {
        console.error(`[OrdinalTransfer] âŒ Could not extract TXID. Response:`, broadcastData);
        throw new Error('Broadcast successful but no transaction ID returned or extractable.');
      }
    }

    console.log(`[OrdinalTransfer] âœ… Pre-signed transaction broadcasted: ${txid}`);
    return { txid, broadcastData };
  } catch (error) {
    console.error('[OrdinalTransfer] âŒ Error broadcasting pre-signed transaction:', error);
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
    
    // PrÃ¼fe ob es eine PSBT (base64/hex) oder bereits eine finalisierte Transaction (hex) ist
    let finalTxHex = presignedTxHex;
    
    // Versuche, es als PSBT zu parsen (wenn es eine PSBT ist, muss sie finalisiert werden)
    try {
      // PrÃ¼fe ob es eine PSBT ist (Base64 mit PSBT magic bytes oder Hex)
      const isBase64PSBT = presignedTxHex.startsWith('cHNidP8BA'); // PSBT magic bytes in base64
      const isHexPSBT = /^[0-9a-fA-F]+$/.test(presignedTxHex) && presignedTxHex.length > 200 && presignedTxHex.length < 2000;
      const isBase64String = !/^[0-9a-fA-F]+$/.test(presignedTxHex) && presignedTxHex.length > 100; // Nicht-Hex, aber lang genug
      
      console.log(`[OrdinalTransfer] Input analysis: isBase64PSBT=${isBase64PSBT}, isHexPSBT=${isHexPSBT}, isBase64String=${isBase64String}, length=${presignedTxHex.length}`);
      
      // Wenn es Base64 ist (entweder PSBT magic bytes oder einfach nicht-Hex), versuche es als PSBT zu finalisieren
      if (isBase64PSBT || (isBase64String && !isHexPSBT)) {
        console.log('[OrdinalTransfer] Detected Base64 PSBT format, finalizing...');
        try {
          finalTxHex = finalizeSignedPSBT(presignedTxHex);
          console.log(`[OrdinalTransfer] âœ… PSBT finalized, transaction hex length: ${finalTxHex.length}`);
        } catch (finalizeError) {
          console.error(`[OrdinalTransfer] âŒ Failed to finalize Base64 PSBT:`, finalizeError.message);
          console.error(`[OrdinalTransfer] PSBT preview: ${presignedTxHex.substring(0, 100)}...`);
          throw new Error(`Failed to finalize PSBT: ${finalizeError.message}`);
        }
      } else if (isHexPSBT) {
        // PrÃ¼fe ob es bereits eine finalisierte Transaction ist (hex, typischerweise ~500-1000 chars)
        // oder eine Hex-PSBT (lÃ¤nger, ~2000+ chars)
        if (presignedTxHex.length > 200 && presignedTxHex.length < 2000) {
          console.log('[OrdinalTransfer] Assuming already finalized transaction hex');
          finalTxHex = presignedTxHex;
        } else {
          // LÃ¤ngere Hex-Strings kÃ¶nnten Hex-PSBTs sein
          console.log('[OrdinalTransfer] Attempting to finalize as Hex PSBT...');
          try {
            finalTxHex = finalizeSignedPSBT(presignedTxHex);
            console.log(`[OrdinalTransfer] âœ… Hex PSBT finalized successfully`);
          } catch (finalizeError) {
            console.warn('[OrdinalTransfer] âš ï¸ Finalization failed, using as-is:', finalizeError.message);
            finalTxHex = presignedTxHex;
          }
        }
      } else {
        // Unbekanntes Format - versuche trotzdem zu finalisieren
        console.log('[OrdinalTransfer] Unknown format, attempting to finalize as PSBT...');
        try {
          finalTxHex = finalizeSignedPSBT(presignedTxHex);
          console.log(`[OrdinalTransfer] âœ… PSBT finalized successfully`);
        } catch (finalizeError) {
          console.error('[OrdinalTransfer] âŒ Finalization failed:', finalizeError.message);
          throw new Error(`Failed to process transaction: ${finalizeError.message}`);
        }
      }
    } catch (psbtError) {
      // Wenn PSBT-Parsing fehlschlÃ¤gt, ist es wahrscheinlich bereits eine finalisierte Transaction
      console.error('[OrdinalTransfer] âŒ PSBT parsing error:', psbtError.message);
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
