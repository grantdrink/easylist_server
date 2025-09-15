import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for Supabase');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default async (req, res) => {
  console.log('🔍 Debug history setup request received');
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const debug = {
    timestamp: new Date().toISOString(),
    checks: []
  };

  try {
    // Check 1: Can we connect to Supabase?
    debug.checks.push({ name: 'Supabase Connection', status: 'checking...' });
    
    // Check 2: Does inventory_history table exist?
    try {
      const { data: tableCheck, error: tableError } = await supabase
        .from('inventory_history')
        .select('id')
        .limit(1);
      
      if (tableError) {
        debug.checks.push({ 
          name: 'inventory_history table', 
          status: 'MISSING', 
          error: tableError.message 
        });
      } else {
        debug.checks.push({ 
          name: 'inventory_history table', 
          status: 'EXISTS', 
          record_count: tableCheck?.length || 0 
        });
      }
    } catch (err) {
      debug.checks.push({ 
        name: 'inventory_history table', 
        status: 'ERROR', 
        error: err.message 
      });
    }

    // Check 3: Do the functions exist?
    const functions = ['get_inventory_history', 'get_inventory_stats', 'log_inventory_change'];
    
    for (const funcName of functions) {
      try {
        // Test with dummy parameters to see if function exists
        const { data, error } = await supabase.rpc(funcName, 
          funcName === 'get_inventory_history' ? { p_inventory_id: 999999, p_business_id: '00000000-0000-0000-0000-000000000000', p_limit: 1 } :
          funcName === 'get_inventory_stats' ? { p_inventory_id: 999999, p_business_id: '00000000-0000-0000-0000-000000000000', p_days: 1 } :
          { p_inventory_id: 999999, p_business_id: '00000000-0000-0000-0000-000000000000', p_change_type: 'addition', p_quantity_before: 0, p_quantity_after: 1 }
        );
        
        if (error) {
          if (error.message.includes('function') && error.message.includes('does not exist')) {
            debug.checks.push({ 
              name: `function ${funcName}`, 
              status: 'MISSING', 
              error: error.message 
            });
          } else {
            // Function exists but failed for other reasons (expected with dummy data)
            debug.checks.push({ 
              name: `function ${funcName}`, 
              status: 'EXISTS',
              note: 'Function exists (test with dummy data failed as expected)'
            });
          }
        } else {
          debug.checks.push({ 
            name: `function ${funcName}`, 
            status: 'EXISTS',
            test_result: data
          });
        }
      } catch (err) {
        debug.checks.push({ 
          name: `function ${funcName}`, 
          status: 'ERROR', 
          error: err.message 
        });
      }
    }

    // Check 4: Does the trigger exist?
    try {
      const { data: triggerCheck, error: triggerError } = await supabase
        .from('pg_trigger')
        .select('tgname')
        .eq('tgname', 'inventory_change_trigger')
        .limit(1);
      
      if (triggerError) {
        debug.checks.push({ 
          name: 'inventory_change_trigger', 
          status: 'CANNOT_CHECK', 
          error: triggerError.message 
        });
      } else {
        debug.checks.push({ 
          name: 'inventory_change_trigger', 
          status: triggerCheck?.length > 0 ? 'EXISTS' : 'MISSING'
        });
      }
    } catch (err) {
      debug.checks.push({ 
        name: 'inventory_change_trigger', 
        status: 'ERROR', 
        error: err.message 
      });
    }

    // Check 5: Test a simple inventory query
    try {
      const { data: inventoryTest, error: inventoryError } = await supabase
        .from('inventory')
        .select('id, name, business_id')
        .limit(1);
      
      if (inventoryError) {
        debug.checks.push({ 
          name: 'inventory table access', 
          status: 'ERROR', 
          error: inventoryError.message 
        });
      } else {
        debug.checks.push({ 
          name: 'inventory table access', 
          status: 'OK',
          sample_record: inventoryTest?.[0] || 'no records'
        });
      }
    } catch (err) {
      debug.checks.push({ 
        name: 'inventory table access', 
        status: 'ERROR', 
        error: err.message 
      });
    }

    // Summary
    const missing = debug.checks.filter(c => c.status === 'MISSING').length;
    const errors = debug.checks.filter(c => c.status === 'ERROR').length;
    
    debug.summary = {
      total_checks: debug.checks.length,
      missing_components: missing,
      errors: errors,
      overall_status: missing === 0 && errors === 0 ? 'READY' : 'NEEDS_SETUP'
    };

    console.log('✅ Debug check completed:', debug.summary);
    return res.status(200).json(debug);

  } catch (error) {
    console.error('❌ Unexpected error in debug-history-setup:', error);
    debug.checks.push({ 
      name: 'overall_check', 
      status: 'FATAL_ERROR', 
      error: error.message 
    });
    
    return res.status(500).json(debug);
  }
};
