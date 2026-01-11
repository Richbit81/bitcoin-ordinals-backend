// Test script that captures server logs
import { spawn } from 'child_process';
import fetch from 'node-fetch';

const API_URL = 'http://localhost:3003';
const ADMIN_ADDRESS = 'bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj';
const TEST_INSCRIPTION_ID = '7a87062f7097d62071a728185bee380839df837b29a76f2923996a96a263fbafi0';
const TEST_RECIPIENT_ADDRESS = 'bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj';

async function waitForServer(maxWait = 30000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      if (response.ok) {
        console.log('✅ Server is ready');
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function testEndpoint() {
  console.log('\n🧪 Testing /api/point-shop/admin/prepare-psbt...\n');
  
  try {
    const response = await fetch(`${API_URL}/api/point-shop/admin/prepare-psbt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Address': ADMIN_ADDRESS,
      },
      body: JSON.stringify({
        inscriptionId: TEST_INSCRIPTION_ID,
        recipientAddress: TEST_RECIPIENT_ADDRESS,
        feeRate: 5,
      }),
    });
    
    const responseText = await response.text();
    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response: ${responseText}\n`);
    
    if (!response.ok) {
      try {
        const errorData = JSON.parse(responseText);
        console.log('Error:', errorData.error);
        console.log('Details:', errorData.details);
        console.log('Name:', errorData.name);
      } catch (e) {
        console.log('Raw Response:', responseText);
      }
    }
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}

// This is just the test function - server should be started separately
if (import.meta.url === `file://${process.argv[1]}`) {
  waitForServer().then(ready => {
    if (ready) {
      testEndpoint();
    } else {
      console.error('❌ Server did not start in time');
      process.exit(1);
    }
  });
}

