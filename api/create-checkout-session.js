// API endpoint to create Stripe Checkout Session with payment token
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.VITE_STRIPE_SECRET_KEY);
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

  console.log('🛒 ================================');
  console.log('🛒 CREATE-CHECKOUT-SESSION API CALLED');
  console.log('🛒 Timestamp:', new Date().toISOString());
  console.log('🛒 Request body:', JSON.stringify(req.body, null, 2));
  console.log('🛒 ================================');

  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      console.error('❌ No user_id provided');
      return res.status(400).json({ error: 'user_id is required' });
    }

    console.log('✅ Creating checkout session for user:', user_id);

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

    console.log('✅ Payment token generated:', token);

    // Get user details for better UX
    const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(user_id);
    
    if (userError || !authUser) {
      console.error('❌ Error fetching user details:', userError);
      return res.status(400).json({ error: 'User not found in auth system' });
    }
    
    const userPlatformEmail = authUser.user.email;
    console.log('📧 User platform email:', userPlatformEmail);

    // Create Stripe Customer with user metadata - KEY TO AUTOMATIC LINKING
    const customer = await stripe.customers.create({
      email: userPlatformEmail,
      metadata: {
        easylist_user_id: user_id,
        platform_email: userPlatformEmail,
        payment_token: token
      }
    });

    console.log('✅ Created Stripe Customer with metadata:', customer.id);
    console.log('🔍 Customer metadata:', JSON.stringify(customer.metadata, null, 2));

    // Create Stripe Checkout Session linked to customer
    const session = await stripe.checkout.sessions.create({
      customer: customer.id, // CRITICAL: Link to customer with metadata
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'EasyList Pro - Monthly Subscription',
              description: '7-day free trial, then $35/month',
            },
            unit_amount: 3500, // $35.00
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.VITE_APP_URL || 'https://easylistinventory.com'}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL || 'https://easylistinventory.com'}/`,
      subscription_data: {
        trial_period_days: 7,
        metadata: {
          easylist_user_id: user_id,
          platform_email: userPlatformEmail,
          payment_token: token
        }
      }
    });

    console.log('✅ Checkout session created:', session.id);
    console.log('🔗 Session URL:', session.url);
    console.log('🎫 Token embedded in metadata:', token);
    
    return res.status(200).json({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
      token: token,
      user_id: user_id,
      platform_email: userPlatformEmail,
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error.message 
    });
  }
}
