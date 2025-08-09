// Simple webhook test endpoint to verify server is reachable
export default async function handler(req, res) {
  console.log('🧪 WEBHOOK TEST ENDPOINT HIT!');
  console.log('🧪 Method:', req.method);
  console.log('🧪 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('🧪 Body:', req.body);
  console.log('🧪 Environment variables:');
  console.log('  - VITE_STRIPE_SECRET_KEY:', !!process.env.VITE_STRIPE_SECRET_KEY);
  console.log('  - VITE_STRIPE_WEBHOOK_SECRET:', !!process.env.VITE_STRIPE_WEBHOOK_SECRET);
  console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
  console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

  res.status(200).json({ 
    success: true, 
    message: 'EasyList Server - Webhook test endpoint working!',
    timestamp: new Date().toISOString(),
    method: req.method,
    server: 'EasyList API Server',
    env_check: {
      stripe_key: !!process.env.VITE_STRIPE_SECRET_KEY,
      webhook_secret: !!process.env.VITE_STRIPE_WEBHOOK_SECRET,
      supabase_url: !!process.env.VITE_SUPABASE_URL,
      service_key: !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
    }
  });
}
