// API endpoint to create a Stripe Customer Portal session for subscription management
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

  console.log('🏛️ API called - create-customer-portal-session');

  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      console.error('❌ No user_id provided');
      return res.status(400).json({ error: 'user_id is required' });
    }

    console.log('🔍 Creating portal session for user:', user_id);

    // Get the user's subscription record with Stripe customer ID
    const { data: subscription, error: subError } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id, stripe_email')
      .eq('user_id', user_id)
      .single();

    if (subError || !subscription) {
      console.error('❌ Subscription not found:', subError);
      return res.status(404).json({ error: 'No subscription found for this user' });
    }

    if (!subscription.stripe_customer_id) {
      console.error('❌ No Stripe customer ID found');
      return res.status(400).json({ error: 'No Stripe customer ID found. Please complete your payment setup first.' });
    }

    console.log('✅ Found Stripe customer:', subscription.stripe_customer_id);

    // Create the customer portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${process.env.VITE_APP_URL || 'http://localhost:5173'}`,
    });

    console.log('✅ Portal session created:', session.id);
    
    return res.status(200).json({ 
      success: true, 
      portal_url: session.url,
      customer_id: subscription.stripe_customer_id,
      stripe_email: subscription.stripe_email
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Failed to create customer portal session',
      details: error.message 
    });
  }
}
