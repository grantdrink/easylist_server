// Simple foolproof payment linking system
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🎯 SIMPLE PAYMENT LINK API CALLED');

  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }

    console.log('👤 Processing for user:', user_id);

    // Get user details
    const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(user_id);
    
    if (userError || !authUser) {
      console.error('❌ User not found:', userError);
      return res.status(400).json({ error: 'User not found' });
    }
    
    const userEmail = authUser.user.email;
    console.log('📧 User email:', userEmail);

    // Generate a unique session ID
    const sessionId = `payment_${user_id}_${Date.now()}`;
    
    // Store the pending payment in Supabase
    const { data, error } = await supabase
      .from('pending_payments')
      .insert({
        session_id: sessionId,
        user_id: user_id,
        user_email: userEmail,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ error: 'Failed to create payment record' });
    }

    console.log('✅ Pending payment stored:', sessionId);

    // Return the payment link with session ID
    const paymentUrl = `https://buy.stripe.com/aFaaEXgzifOV5Z82GYb7y01?client_reference_id=${sessionId}`;
    
    return res.status(200).json({
      success: true,
      payment_url: paymentUrl,
      session_id: sessionId,
      user_id: user_id,
      user_email: userEmail,
      message: 'Payment link created - link stored in database'
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Failed to create payment link',
      details: error.message 
    });
  }
}
