// API endpoint to process payment success and link subscription to user account
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

  console.log('💳 API called - process-payment-success');

  try {
    const { token, stripe_email } = req.body;
    
    if (!token) {
      console.error('❌ No token provided');
      return res.status(400).json({ error: 'token is required' });
    }

    if (!stripe_email) {
      console.error('❌ No stripe_email provided');
      return res.status(400).json({ error: 'stripe_email is required' });
    }

    console.log('🔍 Processing payment success for token:', token);
    console.log('📧 Stripe email:', stripe_email);

    // Find the payment token and get the user_id
    const { data: tokenData, error: tokenError } = await supabase
      .from('payment_tokens')
      .select('user_id, used, expires_at')
      .eq('token', token)
      .single();

    if (tokenError || !tokenData) {
      console.error('❌ Invalid or expired token:', tokenError);
      return res.status(400).json({ error: 'Invalid or expired payment token' });
    }

    if (tokenData.used) {
      console.error('❌ Token already used');
      return res.status(400).json({ error: 'Payment token already used' });
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      console.error('❌ Token expired');
      return res.status(400).json({ error: 'Payment token expired' });
    }

    const userId = tokenData.user_id;
    console.log('👤 Found user for token:', userId);

    // Search for Stripe customers with this email
    const customers = await stripe.customers.list({
      email: stripe_email,
      limit: 1,
    });

    if (customers.data.length === 0) {
      console.error('❌ No Stripe customer found with email:', stripe_email);
      return res.status(404).json({ error: 'No Stripe customer found with this email' });
    }

    const customer = customers.data[0];
    console.log('🎯 Found Stripe customer:', customer.id);
    
    // Get the customer's subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 1,
    });

    let subscriptionStatus = 'payment_required';
    let stripeSubscriptionId = null;
    let currentPeriodStart = null;
    let currentPeriodEnd = null;

    if (subscriptions.data.length > 0) {
      const subscription = subscriptions.data[0];
      stripeSubscriptionId = subscription.id;
      currentPeriodStart = new Date(subscription.current_period_start * 1000).toISOString();
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      
      // Map Stripe status to our status
      if (subscription.status === 'active' || subscription.status === 'trialing') {
        subscriptionStatus = 'active';
      } else if (subscription.status === 'past_due') {
        subscriptionStatus = 'past_due';
      } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
        subscriptionStatus = 'canceled';
      }
    }

    console.log('📊 Subscription status:', subscriptionStatus);

    // Update the user's subscription record
    const { data: subscriptionData, error: subscriptionError } = await supabase
      .from('user_subscriptions')
      .upsert({
        user_id: userId,
        stripe_customer_id: customer.id,
        stripe_subscription_id: stripeSubscriptionId,
        stripe_email: stripe_email,
        subscription_status: subscriptionStatus,
        payment_method_attached: true,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (subscriptionError) {
      console.error('❌ Error updating subscription:', subscriptionError);
      return res.status(500).json({ error: 'Failed to update subscription' });
    }

    // Mark the token as used
    await supabase
      .from('payment_tokens')
      .update({ used: true })
      .eq('token', token);

    console.log('✅ Payment processed successfully for user:', userId);
    
    res.status(200).json({
      success: true,
      user_id: userId,
      subscription_status: subscriptionStatus,
      stripe_customer_id: customer.id,
      stripe_email: stripe_email,
      has_active_subscription: subscriptionStatus === 'active',
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    res.status(500).json({ 
      error: 'Failed to process payment',
      message: error.message 
    });
  }
}
