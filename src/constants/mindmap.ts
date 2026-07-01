import type { MindMapNode } from '../types/mindmap';

export const STORAGE_KEYS = {
  nodes: 'mindmap_nodes',
  files: 'mindmap_files',
  activeFileId: 'mindmap_active_file_id',
  supabaseUrl: 'supabase_url',
  supabaseAnonKey: 'supabase_anon_key',
} as const;

export const DEFAULT_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#0d9488',
  '#ea580c',
  '#dc2626',
  '#16a34a',
];

export const EMOJIS = ['🔥', '💡', '✅', '🚀', '⚠️', '📅', '👤', '🌟', '❓', '🎯', '📝', '💻', '📈', '🎉'];

export const PRIORITY_CONFIG = {
  high: { label: '高', color: '#ef4444', emoji: '🔴' },
  medium: { label: '中', color: '#eab308', emoji: '🟡' },
  low: { label: '低', color: '#22c55e', emoji: '🟢' },
} as const;

export const ROOT_POSITION = {
  x: 1000,
  y: 1000,
} as const;

export const CANVAS_SIZE = {
  width: 2000,
  height: 2000,
  svg: 2500,
} as const;

export const NODE_SIZE = {
  width: 180,
  height: 50,
} as const;

export const ZOOM_LIMITS = {
  min: 0.25,
  max: 3,
  wheelFactor: 1.08,
  buttonFactor: 1.15,
} as const;

export const INITIAL_NODES: MindMapNode[] = [
  { id: 'root', text: 'メインテーマ', x: ROOT_POSITION.x, y: ROOT_POSITION.y, color: DEFAULT_COLORS[0], fontSize: 'lg', isBold: true },
  { id: 'node-1', text: 'アイデア 1', x: 1260, y: 880, color: DEFAULT_COLORS[1], parentId: 'root', emoji: '💡' },
  { id: 'node-2', text: 'アイデア 2', x: 1260, y: 1120, color: DEFAULT_COLORS[3], parentId: 'root', emoji: '🔥' },
  { id: 'node-3', text: '詳細情報', x: 1520, y: 880, color: DEFAULT_COLORS[1], parentId: 'node-1', emoji: '📝' },
];
