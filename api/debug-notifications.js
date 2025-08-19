import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 Starting notification system debug...');

    // Check if notification tables exist
    const { data: notificationSettings, error: nsError } = await supabase
      .from('notification_settings')
      .select('*');

    const { data: notificationLogs, error: nlError } = await supabase
      .from('notification_logs')
      .select('*')
      .limit(5);

    // Check businesses
    const { data: businesses, error: businessError } = await supabase
      .from('businesses')
      .select('id, name')
      .limit(10);

    // Check inventory with thresholds
    const { data: inventory, error: invError } = await supabase
      .from('inventory')
      .select('id, item_name, current_stock, threshold, business_id')
      .gt('threshold', 0)
      .limit(10);

    // Check for low inventory items
    const { data: lowInventory, error: lowError } = await supabase
      .from('inventory')
      .select('id, item_name, current_stock, threshold, business_id')
      .gt('threshold', 0)
      .filter('current_stock', 'lte', 'threshold')
      .limit(10);

    const debugInfo = {
      database_check: {
        notification_settings: {
          error: nsError,
          count: notificationSettings?.length || 0,
          data: notificationSettings
        },
        notification_logs: {
          error: nlError,
          count: notificationLogs?.length || 0,
          data: notificationLogs
        }
      },
      businesses: {
        error: businessError,
        count: businesses?.length || 0,
        data: businesses
      },
      inventory: {
        total_with_thresholds: {
          error: invError,
          count: inventory?.length || 0,
          data: inventory
        },
        low_inventory: {
          error: lowError,
          count: lowInventory?.length || 0,
          data: lowInventory
        }
      },
      environment: {
        resend_api_key: !!process.env.VITE_RESEND_API_KEY,
        supabase_url: !!process.env.VITE_SUPABASE_URL,
        supabase_service_key: !!process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
      }
    };

    console.log('🔍 Debug info:', JSON.stringify(debugInfo, null, 2));

    return res.status(200).json({
      success: true,
      message: 'Debug information collected',
      debug: debugInfo
    });

  } catch (error) {
    console.error('❌ Debug error:', error);
    return res.status(500).json({
      success: false,
      error: 'Debug failed',
      details: error.message
    });
  }
};
