import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

export const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_KEY);