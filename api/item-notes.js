import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { method } = req;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Get user from authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  
  if (userError || !user) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  try {
    switch (method) {
      case 'GET':
        return await handleGet(req, res, user);
      case 'POST':
        return await handlePost(req, res, user);
      case 'PUT':
        return await handlePut(req, res, user);
      case 'DELETE':
        return await handleDelete(req, res, user);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in item-notes API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /api/item-notes?inventory_id=123&business_id=abc
async function handleGet(req, res, user) {
  const { inventory_id, business_id } = req.query;

  if (!inventory_id || !business_id) {
    return res.status(400).json({ error: 'inventory_id and business_id are required' });
  }

  // Verify user has access to this business
  const { data: membership } = await supabase
    .from('business_members')
    .select('*')
    .eq('business_id', business_id)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }

  // Get notes for the item with user information
  const { data: notes, error } = await supabase
    .from('item_notes')
    .select(`
      *,
      users:created_by (
        email,
        user_metadata
      )
    `)
    .eq('inventory_id', inventory_id)
    .eq('business_id', business_id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching notes:', error);
    return res.status(500).json({ error: 'Failed to fetch notes' });
  }

  return res.status(200).json({ notes });
}

// POST /api/item-notes
async function handlePost(req, res, user) {
  const { inventory_id, business_id, note_text } = req.body;

  if (!inventory_id || !business_id || !note_text?.trim()) {
    return res.status(400).json({ error: 'inventory_id, business_id, and note_text are required' });
  }

  // Verify user has access to this business
  const { data: membership } = await supabase
    .from('business_members')
    .select('*')
    .eq('business_id', business_id)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    return res.status(403).json({ error: 'Access denied to this business' });
  }

  // Verify the inventory item exists and belongs to this business
  const { data: item } = await supabase
    .from('inventory')
    .select('id')
    .eq('id', inventory_id)
    .eq('business_id', business_id)
    .single();

  if (!item) {
    return res.status(404).json({ error: 'Inventory item not found' });
  }

  // Create the note
  const { data: note, error } = await supabase
    .from('item_notes')
    .insert({
      inventory_id,
      business_id,
      note_text: note_text.trim(),
      created_by: user.id
    })
    .select(`
      *,
      users:created_by (
        email,
        user_metadata
      )
    `)
    .single();

  if (error) {
    console.error('Error creating note:', error);
    return res.status(500).json({ error: 'Failed to create note' });
  }

  return res.status(201).json({ note });
}

// PUT /api/item-notes
async function handlePut(req, res, user) {
  const { note_id, note_text } = req.body;

  if (!note_id || !note_text?.trim()) {
    return res.status(400).json({ error: 'note_id and note_text are required' });
  }

  // Update the note (RLS will ensure user can only update their own notes)
  const { data: note, error } = await supabase
    .from('item_notes')
    .update({
      note_text: note_text.trim(),
      updated_at: new Date().toISOString()
    })
    .eq('id', note_id)
    .eq('created_by', user.id)
    .select(`
      *,
      users:created_by (
        email,
        user_metadata
      )
    `)
    .single();

  if (error) {
    console.error('Error updating note:', error);
    return res.status(500).json({ error: 'Failed to update note' });
  }

  if (!note) {
    return res.status(404).json({ error: 'Note not found or access denied' });
  }

  return res.status(200).json({ note });
}

// DELETE /api/item-notes
async function handleDelete(req, res, user) {
  const { note_id } = req.body;

  if (!note_id) {
    return res.status(400).json({ error: 'note_id is required' });
  }

  // Delete the note (RLS will ensure user can only delete their own notes)
  const { error } = await supabase
    .from('item_notes')
    .delete()
    .eq('id', note_id)
    .eq('created_by', user.id);

  if (error) {
    console.error('Error deleting note:', error);
    return res.status(500).json({ error: 'Failed to delete note' });
  }

  return res.status(200).json({ message: 'Note deleted successfully' });
}
