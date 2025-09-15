import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for Supabase');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async (req, res) => {
  console.log('📊 Get inventory history request received');
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { inventory_id, business_id, limit = 50, days = 30 } = req.query;

    if (!inventory_id || !business_id) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        details: 'inventory_id and business_id are required'
      });
    }

    console.log(`Getting history for inventory_id: ${inventory_id}, business_id: ${business_id}, limit: ${limit}`);
    console.log(`Parameter types: inventory_id=${typeof inventory_id}, business_id=${typeof business_id}`);

    // Get inventory history - try main function first, fallback to simple version
    let historyData, historyError;
    
    try {
      const result = await supabase
        .rpc('get_inventory_history', {
          p_inventory_id: parseInt(inventory_id),
          p_business_id: business_id,
          p_limit: parseInt(limit)
        });
      historyData = result.data;
      historyError = result.error;
    } catch (err) {
      console.log('Main function failed, trying simple version:', err.message);
      // If main function fails, try the simple version
      const result = await supabase
        .rpc('get_inventory_history_simple', {
          p_inventory_id: parseInt(inventory_id),
          p_business_id: business_id,
          p_limit: parseInt(limit)
        });
      historyData = result.data;
      historyError = result.error;
    }

    if (historyError) {
      console.error('Error fetching inventory history:', historyError);
      return res.status(500).json({ 
        error: 'Failed to fetch inventory history',
        details: historyError.message
      });
    }

    console.log(`Raw history data returned:`, JSON.stringify(historyData, null, 2));
    console.log(`History record count: ${historyData?.length || 0}`);

    // Debug: Check raw records in the table
    const { data: rawRecords, error: rawError } = await supabase
      .from('inventory_history')
      .select('*')
      .eq('inventory_id', parseInt(inventory_id))
      .eq('business_id', business_id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!rawError) {
      console.log(`Raw records from inventory_history table:`, JSON.stringify(rawRecords, null, 2));
      console.log(`Raw record count: ${rawRecords?.length || 0}`);
    } else {
      console.error('Error querying raw records:', rawError);
    }

    // Get inventory statistics
    const { data: statsData, error: statsError } = await supabase
      .rpc('get_inventory_stats', {
        p_inventory_id: parseInt(inventory_id),
        p_business_id: business_id,
        p_days: parseInt(days)
      });

    if (statsError) {
      console.error('Error fetching inventory stats:', statsError);
      // Don't fail the request if stats fail, just log it
    }

    // Get item details
    const { data: itemData, error: itemError } = await supabase
      .from('inventory')
      .select('name, quantity, threshold, unit, category, store')
      .eq('id', inventory_id)
      .eq('business_id', business_id)
      .single();

    if (itemError) {
      console.error('Error fetching item details:', itemError);
      return res.status(500).json({ 
        error: 'Failed to fetch item details',
        details: itemError.message
      });
    }

    const response = {
      success: true,
      item: itemData,
      history: historyData || [],
      stats: statsData || {
        total_additions: 0,
        total_subtractions: 0,
        total_changes: 0,
        last_addition: null,
        last_subtraction: null,
        date_range_days: parseInt(days)
      },
      metadata: {
        total_records: historyData?.length || 0,
        limit: parseInt(limit),
        days: parseInt(days)
      }
    };

    console.log(`✅ Successfully fetched ${historyData?.length || 0} history records`);
    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Unexpected error in get-inventory-history:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message
    });
  }
};
