import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('🚀 ACTIVATE SUBSCRIPTION API called');
  console.log('📋 Method:', req.method);
  console.log('📋 Body:', req.body);
  console.log('🔧 Environment check:');
  console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
  console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check environment variables first
  if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing environment variables');
    return res.status(500).json({ 
      error: 'Server configuration error',
      missing: {
        VITE_SUPABASE_URL: !process.env.VITE_SUPABASE_URL,
        VITE_SUPABASE_SERVICE_ROLE_KEY: !process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
      }
    });
  }

  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      console.error('❌ No user_id provided');
      return res.status(400).json({ error: 'user_id is required' });
    }

    console.log('✅ Activating subscription for user:', user_id);

    // Activate the user's subscription
    const { data, error } = await supabase
      .from('user_subscriptions')
      .upsert({
        user_id: user_id,
        subscription_status: 'active',
        payment_method_attached: true,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ 
        error: 'Failed to activate subscription',
        details: error.message 
      });
    }

    console.log('✅ Subscription activated successfully:', data);
    return res.status(200).json({ success: true, subscription: data });

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
