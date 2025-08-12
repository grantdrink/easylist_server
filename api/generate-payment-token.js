// API endpoint to generate a payment token for linking Stripe payments to EasyList users
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🎫 API called - generate-payment-token');

  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      console.error('❌ No user_id provided');
      return res.status(400).json({ error: 'user_id is required' });
    }

    console.log('✅ Generating payment token for user:', user_id);

    // Clean up old expired tokens first
    await supabase.rpc('cleanup_expired_payment_tokens');

    // Generate a new payment token
    const { data: token, error } = await supabase
      .rpc('generate_payment_token', { p_user_id: user_id });

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ 
        error: 'Failed to generate payment token',
        details: error.message 
      });
    }

    console.log('✅ Payment token generated successfully');
    
    // The success URL should redirect to our app with the token
    // We'll need to configure this in Stripe Payment Link settings
    const successUrl = `${process.env.VITE_APP_URL || 'http://localhost:5173'}/payment-success?token=${token}`;
    
    return res.status(200).json({ 
      success: true, 
      token: token,
      success_url: successUrl,
      // Instructions for setting up the Stripe Payment Link
      setup_instructions: `Configure your Stripe Payment Link success URL to: ${successUrl}`
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
