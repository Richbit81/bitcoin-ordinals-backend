// Test script to check the prepare-psbt endpoint
// fetch is available globally in Node.js 18+

const API_URL = 'http://localhost:3003';
const ADMIN_ADDRESS = 'bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj'; // Replace with actual admin address
const TEST_INSCRIPTION_ID = '7a87062f7097d62071a728185bee380839df837b29a76f2923996a96a263fbafi0'; // Test inscription ID
const TEST_RECIPIENT_ADDRESS = 'bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj'; // Test recipient

async function testPreparePSBT() {
  try {
    console.log('🧪 Teste /api/point-shop/admin/prepare-psbt Endpoint...\n');
    
    // First, test health endpoint
    console.log('1. Teste /api/health...');
    const healthResponse = await fetch(`${API_URL}/api/health`);
    const healthData = await healthResponse.json();
    console.log('   ✅ Health Check:', healthData);
    console.log('');
    
    // Then test prepare-psbt endpoint
    console.log('2. Teste /api/point-shop/admin/prepare-psbt...');
    console.log('   InscriptionId:', TEST_INSCRIPTION_ID);
    console.log('   RecipientAddress:', TEST_RECIPIENT_ADDRESS);
    console.log('   FeeRate: 5 sat/vB');
    console.log('');
    
    const prepareResponse = await fetch(`${API_URL}/api/point-shop/admin/prepare-psbt`, {
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
    
    console.log('   Status:', prepareResponse.status, prepareResponse.statusText);
    
    const responseText = await prepareResponse.text();
    console.log('   Response:', responseText);
    
    if (prepareResponse.ok) {
      const responseData = JSON.parse(responseText);
      console.log('\n✅ Erfolg! PSBT vorbereitet:');
      console.log('   PSBT Base64:', responseData.psbtBase64?.substring(0, 50) + '...');
      console.log('   InscriptionId:', responseData.inscriptionId);
      console.log('   FeeRate:', responseData.feeRate);
    } else {
      console.log('\n❌ Fehler beim Vorbereiten des PSBT:');
      try {
        const errorData = JSON.parse(responseText);
        console.log('   Error:', errorData.error);
        console.log('   Details:', errorData.details);
      } catch (e) {
        console.log('   Raw Response:', responseText);
      }
    }
    
  } catch (error) {
    console.error('\n❌ Test fehlgeschlagen:', error.message);
    console.error('   Stack:', error.stack);
  }
}

testPreparePSBT();

