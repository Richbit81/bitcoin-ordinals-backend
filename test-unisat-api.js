// Test script to check UniSat API response structure
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UNISAT_API_KEY = process.env.UNISAT_API_KEY;
const UNISAT_API_URL = process.env.UNISAT_API_URL || 'https://open-api.unisat.io';
const TEST_INSCRIPTION_ID = '7a87062f7097d62071a728185bee380839df837b29a76f2923996a96a263fbafi0';

async function testUniSatAPI() {
  try {
    console.log('🧪 Testing UniSat API response structure...\n');
    console.log(`API URL: ${UNISAT_API_URL}`);
    console.log(`API Key: ${UNISAT_API_KEY ? UNISAT_API_KEY.substring(0, 8) + '...' : 'NOT SET'}`);
    console.log(`Inscription ID: ${TEST_INSCRIPTION_ID}\n`);
    
    const url = `${UNISAT_API_URL}/v1/indexer/inscription/info/${TEST_INSCRIPTION_ID}`;
    console.log(`Fetching from: ${url}\n`);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${UNISAT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    
    const responseText = await response.text();
    console.log(`Response length: ${responseText.length} bytes\n`);
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Failed to parse JSON:', e.message);
      console.log('Raw response (first 1000 chars):', responseText.substring(0, 1000));
      return;
    }
    
    console.log('=== FULL API RESPONSE ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n=== DATA STRUCTURE ANALYSIS ===');
    
    if (data.data) {
      console.log('✅ data.data exists');
      console.log('Fields in data.data:', Object.keys(data.data).join(', '));
      
      if (data.data.outpoint) {
        console.log(`✅ outpoint found: ${data.data.outpoint}`);
      } else {
        console.log('❌ outpoint NOT found');
      }
      
      if (data.data.txid) {
        console.log(`✅ txid found: ${data.data.txid}`);
      } else {
        console.log('❌ txid NOT found');
      }
      
      if (data.data.vout !== undefined) {
        console.log(`✅ vout found: ${data.data.vout}`);
      } else {
        console.log('❌ vout NOT found');
      }
      
      if (data.data.utxo) {
        console.log(`✅ utxo found: ${data.data.utxo}`);
      } else {
        console.log('❌ utxo NOT found');
      }
    } else {
      console.log('❌ data.data does NOT exist');
      console.log('Top-level keys:', Object.keys(data).join(', '));
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

testUniSatAPI();

