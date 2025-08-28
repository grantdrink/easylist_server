// Emergency manual subscription activation
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

  console.log('🚨 EMERGENCY MANUAL ACTIVATION');

  try {
    const { user_email, stripe_customer_id, stripe_subscription_id, stripe_email } = req.body;
    
    if (!user_email || !stripe_customer_id) {
      return res.status(400).json({ error: 'user_email and stripe_customer_id are required' });
    }

    console.log('🔍 Finding user by email:', user_email);

    // Find user by email in Supabase auth
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('❌ Error listing users:', listError);
      return res.status(500).json({ error: 'Failed to find user' });
    }

    const user = users.find(u => u.email === user_email);
    
    if (!user) {
      console.error('❌ User not found for email:', user_email);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('✅ Found user:', user.id);

    // Manually create subscription record
    const subscriptionData = {
      user_id: user.id,
      user_email: user_email,
      stripe_customer_id: stripe_customer_id,
      stripe_subscription_id: stripe_subscription_id || null,
      stripe_email: stripe_email || user_email,
      subscription_status: 'active',
      payment_method_attached: true,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log('🔍 Creating subscription record:', JSON.stringify(subscriptionData, null, 2));

    const { data, error } = await supabase
      .from('user_subscriptions')
      .upsert(subscriptionData, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ error: 'Failed to activate subscription' });
    }

    console.log('🎉 MANUAL SUBSCRIPTION ACTIVATION SUCCESSFUL!');
    console.log('✅ User:', user.id, '(' + user_email + ')');
    
    return res.status(200).json({ 
      success: true, 
      user_id: user.id,
      message: 'Subscription manually activated',
      data: data
    });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Failed to manually activate subscription',
      details: error.message 
    });
  }
}
