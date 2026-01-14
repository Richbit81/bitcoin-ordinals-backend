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
    
    console.log('🔍 Prüfe verschiedene Derivation-Pfade...');
    console.log('');
    
    // Erweiterte Suche: Prüfe verschiedene Account-Indizes, Change-Indizes und Address-Indizes
    // Format: m/86'/0'/{account}'/{change}/{address}
    
    const maxAccount = 5;  // Prüfe Account 0-4
    const maxChange = 2;   // Prüfe Change 0-1
    const maxAddress = 50; // Prüfe Address 0-49
    
    let checked = 0;
    let foundAddresses = [];
    
    for (let account = 0; account < maxAccount; account++) {
      for (let change = 0; change < maxChange; change++) {
        for (let address = 0; address < maxAddress; address++) {
          try {
            const path = `m/86'/0'/${account}'/${change}/${address}`;
            const keyPair = root.derivePath(path);
            const derivedAddress = bitcoin.payments.p2tr({
              internalPubkey: keyPair.publicKey.slice(1, 33), // x-only pubkey
              network: NETWORK,
            }).address;
            
            checked++;
            
            // Zeige Fortschritt alle 50 Adressen
            if (checked % 50 === 0) {
              process.stdout.write(`\r🔍 Geprüft: ${checked} Adressen... (Account ${account}, Change ${change}, Address ${address})`);
            }
            
            // Speichere gefundene Adressen für Debugging
            if (checked <= 10) {
              foundAddresses.push({ path, address: derivedAddress });
            }
            
            if (derivedAddress.toLowerCase() === targetAddress.toLowerCase()) {
              // Gefunden!
              const privateKeyWIF = keyPair.toWIF();
              const privateKeyHex = keyPair.privateKey.toString('hex');
              
              console.log('');
              console.log('');
              console.log('✅✅✅ ADRESSE GEFUNDEN! ✅✅✅');
              console.log('═══════════════════════════════════════════════════════');
              console.log('📍 Adresse:', derivedAddress);
              console.log('🔑 Private Key (WIF):', privateKeyWIF);
              console.log('🔑 Private Key (Hex):', privateKeyHex);
              console.log('📋 Derivation-Pfad:', path);
              console.log('═══════════════════════════════════════════════════════');
              console.log('');
              console.log('⚠️  WICHTIG: Kopiere diesen Private Key und setze ihn in Railway als ADMIN_PRIVATE_KEY');
              console.log('⚠️  Verwende den WIF-Format (beginnt mit L oder K)');
              console.log('');
              
              return {
                address: derivedAddress,
                privateKeyWIF: privateKeyWIF,
                privateKeyHex: privateKeyHex,
                derivationPath: path,
              };
            }
          } catch (err) {
            // Ignoriere Fehler bei einzelnen Pfaden
          }
        }
      }
    }
    
    console.log('');
    console.log('');
    console.log('⚠️  Adresse nicht gefunden in geprüften Pfaden');
    console.log(`📊 Geprüft: ${checked} verschiedene Derivation-Pfade`);
    console.log('');
    console.log('🔍 Erste 10 generierte Adressen (zum Vergleich):');
    foundAddresses.forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.path} → ${item.address}`);
    });
    console.log('');
    
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
