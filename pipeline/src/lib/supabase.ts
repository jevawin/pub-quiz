import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './database.types.js';

export type TypedSupabaseClient = SupabaseClient<Database>;

export function createSupabaseClient(url: string, serviceRoleKey: string): TypedSupabaseClient {
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
