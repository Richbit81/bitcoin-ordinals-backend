import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '@bitcoinerlab/secp256k1';

// Initialize ECC library
bitcoin.initEccLib(ecc);

const ECPair = ECPairFactory(ecc);
const NETWORK = bitcoin.networks.bitcoin;

const privateKey = 'Kxtc8p82sqppSrrcRnFkjE8Po2uJsAmo7nrdHyXde4n6S4YQMuqV';
const expectedAddress = 'bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9';
const errorKey = '03cb78999fc6c9205f5b75cfef775595baba475267689bb9289c303dce59a8d5a4';

console.log('🔍 Testing Private Key...');
console.log('Private Key:', privateKey);
console.log('');

try {
  const keyPair = ECPair.fromWIF(privateKey, NETWORK);
  const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
  const p2trAddress = bitcoin.payments.p2tr({
    internalPubkey: keyPair.publicKey.slice(1, 33),
    network: NETWORK,
  }).address;
  
  console.log('✅ Key imported successfully');
  console.log('Public Key (hex):', publicKeyHex);
  console.log('P2TR Address:', p2trAddress);
  console.log('Expected Address:', expectedAddress);
  console.log('');
  console.log('Address Match:', p2trAddress.toLowerCase() === expectedAddress.toLowerCase() ? '✅ YES' : '❌ NO');
  console.log('Error Key Match:', publicKeyHex === errorKey ? '❌ YES (PROBLEM!)' : '✅ NO (Good!)');
  console.log('');
  
  if (publicKeyHex === errorKey) {
    console.log('❌ PROBLEM: Der Public Key stimmt mit dem Fehler-Key überein!');
    console.log('   Das bedeutet, dass dieser Private Key NICHT der richtige ist.');
  } else {
    console.log('✅ Der Public Key stimmt NICHT mit dem Fehler-Key überein.');
    console.log('   Das bedeutet, dass der richtige Key geladen wird, aber es gibt ein anderes Problem.');
  }
} catch (error) {
  console.error('❌ Error:', error.message);
}
