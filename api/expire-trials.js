// API endpoint to automatically expire trials and cut off access
// This should be called periodically (daily) via cron job or scheduled task

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  console.log('🕒 Trial expiration check called');
  console.log('🕒 Method:', req.method);
  console.log('🕒 Environment check:');
  console.log('  - VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL);
  console.log('  - VITE_SUPABASE_SERVICE_ROLE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🕒 Starting trial expiration check...');

    // Call the database function to expire trials
    const { data, error } = await supabase.rpc('expire_trials');

    if (error) {
      console.error('❌ Error expiring trials:', error);
      return res.status(500).json({ 
        error: 'Failed to expire trials', 
        details: error.message 
      });
    }

    const expiredCount = data || 0;
    console.log(`✅ Expired ${expiredCount} trial subscriptions`);

    // Optional: Get list of users who just lost access for notification
    if (expiredCount > 0) {
      const { data: expiredUsers, error: listError } = await supabase
        .from('user_subscriptions')
        .select(`
          user_id,
          trial_end_date,
          updated_at
        `)
        .eq('subscription_status', 'unpaid')
        .gte('updated_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()); // Users updated in last 5 minutes

      if (!listError && expiredUsers?.length > 0) {
        console.log('📧 Consider sending expiration notifications to:', expiredUsers.map(u => u.user_id));
        // Here you could integrate with an email service to notify users
      }
    }

    // Optional: Also check for any subscriptions that should have been updated by webhooks
    // but may have been missed (backup validation)
    const { data: subscriptionsToCheck } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('subscription_status', 'active')
      .not('current_period_end', 'is', null)
      .lt('current_period_end', new Date().toISOString());

    if (subscriptionsToCheck?.length > 0) {
      console.log(`⚠️ Found ${subscriptionsToCheck.length} active subscriptions past their end date - may need manual review`);
      
      // You could automatically set these to 'unpaid' or investigate why webhooks didn't fire
      for (const sub of subscriptionsToCheck) {
        console.log(`⚠️ Subscription ${sub.stripe_subscription_id} ended ${sub.current_period_end} but still marked active`);
      }
    }

    return res.status(200).json({
      success: true,
      message: `Successfully processed trial expirations`,
      expired_count: expiredCount,
      subscriptions_to_review: subscriptionsToCheck?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Trial expiration error:', error);
    return res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message 
    });
  }
}
