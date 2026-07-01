import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STORAGE_KEYS } from '../constants/mindmap';

let supabaseInstance: SupabaseClient | null = null;

export interface SupabaseConfig {
  url: string | null;
  key: string | null;
}

export const getSupabaseConfig = (): SupabaseConfig => {
  const url = localStorage.getItem(STORAGE_KEYS.supabaseUrl);
  const key = localStorage.getItem(STORAGE_KEYS.supabaseAnonKey);
  return { url, key };
};

export const initSupabase = (url: string, key: string): SupabaseClient | null => {
  try {
    if (!url || !key) {
      supabaseInstance = null;
      return null;
    }
    
    // Electron or Capacitor environments sometimes conflict with standard auth redirect settings.
    // Setting detectSessionInUrl to false avoids potential issues.
    supabaseInstance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
    return supabaseInstance;
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    supabaseInstance = null;
    return null;
  }
};

export const getSupabase = (): SupabaseClient | null => {
  if (supabaseInstance) return supabaseInstance;
  const { url, key } = getSupabaseConfig();
  if (url && key) {
    return initSupabase(url, key);
  }
  return null;
};
