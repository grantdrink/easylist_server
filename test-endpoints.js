// Simple test script to verify endpoints are working
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

async function testEndpoints() {
  console.log('🧪 Testing EasyList API Server endpoints...');
  console.log('🌐 Server URL:', SERVER_URL);

  try {
    // Test health endpoint
    console.log('\n1. Testing /api/health...');
    const healthResponse = await fetch(`${SERVER_URL}/api/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData.status);
    console.log('📋 Environment check:', healthData.env_check);

    // Test webhook test endpoint
    console.log('\n2. Testing /api/webhook-test...');
    const webhookResponse = await fetch(`${SERVER_URL}/api/webhook-test`);
    const webhookData = await webhookResponse.json();
    console.log('✅ Webhook test:', webhookData.success ? 'PASS' : 'FAIL');

    // Test activate subscription endpoint
    console.log('\n3. Testing /api/activate-subscription (without user_id - should fail)...');
    const activateResponse = await fetch(`${SERVER_URL}/api/activate-subscription`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const activateData = await activateResponse.json();
    console.log('❌ Expected error:', activateData.error);

    console.log('\n✅ All endpoint tests completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Deploy this server to Railway');
    console.log('2. Update your frontend to use the server URL');
    console.log('3. Configure Stripe webhook to point to your server');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testEndpoints();
