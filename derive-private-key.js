/**
 * Tool zum Ableiten des Private Keys aus einer Mnemonic-Phrase
 * 
 * WICHTIG: Führe dieses Script NUR lokal aus, NIEMALS online!
 * 
 * Usage:
 *   node derive-private-key.js "deine mnemonic phrase hier" "bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9"
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import ecc from '@bitcoinerlab/secp256k1';
import { ECPairFactory } from 'ecpair';

// Initialize
bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);
const NETWORK = bitcoin.networks.bitcoin;

// Admin-Adresse, für die wir den Private Key brauchen
const TARGET_ADDRESS = process.argv[3] || 'bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9';

function derivePrivateKeyFromMnemonic(mnemonic, targetAddress) {
  try {
    console.log('🔐 Leite Private Key aus Mnemonic ab...');
    console.log('📍 Ziel-Adresse:', targetAddress);
    console.log('');
    
    // Validiere Mnemonic
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Ungültige Mnemonic-Phrase!');
    }
    
    // Erstelle Seed aus Mnemonic
    const seed = mnemonicToSeedSync(mnemonic);
    console.log('✅ Mnemonic validiert');
    
    // Erstelle Root-Key
    const root = bip32.fromSeed(seed, NETWORK);
    console.log('✅ Root-Key erstellt');
    
    // Versuche verschiedene Derivation-Pfade
    // Taproot verwendet normalerweise BIP86: m/86'/0'/0'/0/0
    const derivationPaths = [
      "m/86'/0'/0'/0/0",  // BIP86 Taproot (Standard)
      "m/84'/0'/0'/0/0",  // BIP84 Native SegWit
      "m/44'/0'/0'/0/0",  // BIP44 Legacy
      "m/86'/0'/0'/0/1",  // Taproot, zweite Adresse
      "m/86'/0'/0'/0/2",  // Taproot, dritte Adresse
    ];
    
    console.log('🔍 Prüfe verschiedene Derivation-Pfade...');
    console.log('');
    
    for (const path of derivationPaths) {
      try {
        const keyPair = root.derivePath(path);
        const address = bitcoin.payments.p2tr({
          internalPubkey: keyPair.publicKey.slice(1, 33), // x-only pubkey
          network: NETWORK,
        }).address;
        
        console.log(`📋 Pfad: ${path}`);
        console.log(`   Adresse: ${address}`);
        
        if (address.toLowerCase() === targetAddress.toLowerCase()) {
          // Gefunden!
          const privateKeyWIF = keyPair.toWIF();
          const privateKeyHex = keyPair.privateKey.toString('hex');
          
          console.log('');
          console.log('✅ ADRESSE GEFUNDEN!');
          console.log('═══════════════════════════════════════════════════════');
          console.log('📍 Adresse:', address);
          console.log('🔑 Private Key (WIF):', privateKeyWIF);
          console.log('🔑 Private Key (Hex):', privateKeyHex);
          console.log('📋 Derivation-Pfad:', path);
          console.log('═══════════════════════════════════════════════════════');
          console.log('');
          console.log('⚠️  WICHTIG: Kopiere diesen Private Key und setze ihn in Railway als ADMIN_PRIVATE_KEY');
          console.log('⚠️  Verwende den WIF-Format (beginnt mit L oder K)');
          console.log('');
          
          return {
            address: address,
            privateKeyWIF: privateKeyWIF,
            privateKeyHex: privateKeyHex,
            derivationPath: path,
          };
        }
      } catch (err) {
        console.log(`   ❌ Fehler: ${err.message}`);
      }
    }
    
    // Wenn nicht gefunden, versuche mehr Pfade
    console.log('');
    console.log('⚠️  Adresse nicht in Standard-Pfaden gefunden. Prüfe erweiterte Pfade...');
    
    // Prüfe weitere Indizes
    for (let i = 0; i < 20; i++) {
      try {
        const path = `m/86'/0'/0'/0/${i}`;
        const keyPair = root.derivePath(path);
        const address = bitcoin.payments.p2tr({
          internalPubkey: keyPair.publicKey.slice(1, 33),
          network: NETWORK,
        }).address;
        
        if (address.toLowerCase() === targetAddress.toLowerCase()) {
          const privateKeyWIF = keyPair.toWIF();
          const privateKeyHex = keyPair.privateKey.toString('hex');
          
          console.log('');
          console.log('✅ ADRESSE GEFUNDEN!');
          console.log('═══════════════════════════════════════════════════════');
          console.log('📍 Adresse:', address);
          console.log('🔑 Private Key (WIF):', privateKeyWIF);
          console.log('🔑 Private Key (Hex):', privateKeyHex);
          console.log('📋 Derivation-Pfad:', path);
          console.log('═══════════════════════════════════════════════════════');
          console.log('');
          console.log('⚠️  WICHTIG: Kopiere diesen Private Key und setze ihn in Railway als ADMIN_PRIVATE_KEY');
          console.log('');
          
          return {
            address: address,
            privateKeyWIF: privateKeyWIF,
            privateKeyHex: privateKeyHex,
            derivationPath: path,
          };
        }
      } catch (err) {
        // Ignoriere Fehler
      }
    }
    
    throw new Error(`Adresse ${targetAddress} nicht gefunden in den geprüften Derivation-Pfaden.`);
    
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    throw error;
  }
}

// Main
const mnemonic = process.argv[2];

if (!mnemonic) {
  console.error('❌ Fehler: Mnemonic-Phrase fehlt!');
  console.log('');
  console.log('Usage:');
  console.log('  node derive-private-key.js "deine mnemonic phrase hier" "bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9"');
  console.log('');
  console.log('⚠️  WICHTIG: Führe dieses Script NUR lokal aus!');
  console.log('⚠️  Gib deine Mnemonic-Phrase NIEMALS in Online-Tools ein!');
  process.exit(1);
}

try {
  derivePrivateKeyFromMnemonic(mnemonic, TARGET_ADDRESS);
} catch (error) {
  console.error('❌ Fehler beim Ableiten des Private Keys:', error.message);
  process.exit(1);
}
