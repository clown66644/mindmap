import { INITIAL_NODES, STORAGE_KEYS } from '../constants/mindmap';
import type { MindMapNode, MindMapFile } from '../types/mindmap';
import { normalizeMindMapNodes } from './mindmap';

// --- Node storage (per-map) ---
const getNodeStorageKey = (fileId: string) => `mindmap_data_${fileId}`;

export const loadStoredNodes = (fileId?: string): MindMapNode[] => {
  const key = fileId ? getNodeStorageKey(fileId) : STORAGE_KEYS.nodes;
  const saved = localStorage.getItem(key);
  if (!saved) return INITIAL_NODES;

  try {
    return normalizeMindMapNodes(JSON.parse(saved)) || INITIAL_NODES;
  } catch {
    return INITIAL_NODES;
  }
};

export const persistNodes = (nodes: MindMapNode[], fileId?: string) => {
  const key = fileId ? getNodeStorageKey(fileId) : STORAGE_KEYS.nodes;
  localStorage.setItem(key, JSON.stringify(nodes));
};

// --- File list management ---
const DEFAULT_FILE: MindMapFile = {
  id: 'default',
  name: 'マイマップ',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

export const loadFileList = (): MindMapFile[] => {
  const saved = localStorage.getItem(STORAGE_KEYS.files);
  if (!saved) return [DEFAULT_FILE];
  try {
    const files = JSON.parse(saved);
    if (Array.isArray(files) && files.length > 0) return files;
    return [DEFAULT_FILE];
  } catch {
    return [DEFAULT_FILE];
  }
};

export const persistFileList = (files: MindMapFile[]) => {
  localStorage.setItem(STORAGE_KEYS.files, JSON.stringify(files));
};

export const getActiveFileId = (): string => {
  return localStorage.getItem(STORAGE_KEYS.activeFileId) || 'default';
};

export const setActiveFileId = (id: string) => {
  localStorage.setItem(STORAGE_KEYS.activeFileId, id);
};

export const deleteFileData = (fileId: string) => {
  localStorage.removeItem(getNodeStorageKey(fileId));
};

// Migration: if old 'mindmap_nodes' exists but no file list, migrate data
export const migrateOldStorage = () => {
  const oldNodes = localStorage.getItem(STORAGE_KEYS.nodes);
  const existingFiles = localStorage.getItem(STORAGE_KEYS.files);
  
  if (oldNodes && !existingFiles) {
    // Copy old data to default file
    localStorage.setItem(getNodeStorageKey('default'), oldNodes);
    persistFileList([DEFAULT_FILE]);
    setActiveFileId('default');
  }
};
