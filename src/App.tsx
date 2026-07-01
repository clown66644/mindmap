import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Download, 
  Upload, 
  RefreshCw,
  Undo2,
  Redo2,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  FileImage,
  Bold,
  Settings,
  Cloud,
  CloudOff,
  User as UserIcon,
  LogOut,
  X,
  Edit2,
  ExternalLink,
  FileText,
  Share2
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { getSupabase, initSupabase, getSupabaseConfig } from './lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';
import {
  CANVAS_SIZE,
  DEFAULT_COLORS,
  EMOJIS,
  INITIAL_NODES,
  NODE_SIZE,
  ROOT_POSITION,
  STORAGE_KEYS,
  ZOOM_LIMITS,
} from './constants/mindmap';
import type { DbMindMapNode } from './lib/mindmap';
import {
  applyColorToBranch,
  buildChildrenMap,
  buildNodeMap,
  fromDbNode,
  getChildrenCount,
  getDescendantIds,
  getErrorMessage,
  isDescendant,
  isNodeVisible,
  normalizeMindMapNodes,
  toDbNode,
} from './lib/mindmap';
import { loadStoredNodes, persistNodes } from './lib/storage';
import type { MindMapNode, NodeFontSize, Relationship, NodePriority } from './types/mindmap';

type SaveOptions = {
  skipHistory?: boolean;
  syncRemote?: boolean;
  statusMessage?: string;
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

export default function App() {
  // State
  const [nodes, setNodes] = useState<MindMapNode[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [relationStartNodeId, setRelationStartNodeId] = useState<string | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  
  // History State (Undo / Redo)
  const [history, setHistory] = useState<MindMapNode[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Supabase Dynamic Client and Auth States
  const [supabaseClient, setSupabaseClient] = useState<SupabaseClient | null>(() => getSupabase());
  const [user, setUser] = useState<User | null>(null);
  
  // Modals & Forms States
  const [showSyncSettings, setShowSyncSettings] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [configUrl, setConfigUrl] = useState(() => getSupabaseConfig().url || '');
  const [configKey, setConfigKey] = useState(() => getSupabaseConfig().key || '');
  
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('ローカルに保存済み');
  
  // Refs
  const workspaceRef = useRef<HTMLDivElement>(null);
  const sidebarInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const dragInfo = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    nodeStartX: number;
    nodeStartY: number;
    hasMoved: boolean;
  } | null>(null);
  
  const panInfo = useRef<{
    startX: number;
    startY: number;
    panStartX: number;
    panStartY: number;
  } | null>(null);

  // Initialize nodes from LocalStorage
  useEffect(() => {
    const initialList = loadStoredNodes();
    
    setNodes(initialList);
    setHistory([initialList]);
    setHistoryIndex(0);

    // rootノードから関連線リストを復元
    const rootNode = initialList.find(n => n.id === 'root');
    if (rootNode && (rootNode as any).relationships) {
      setRelationships((rootNode as any).relationships);
    } else {
      setRelationships([]);
    }

    // Initial center pan
    const width = window.innerWidth;
    const height = window.innerHeight;
    setPan({ x: width / 2 - ROOT_POSITION.x - 90, y: height / 2 - ROOT_POSITION.y - 25 });
  }, []);


  // Monitor Auth Session
  useEffect(() => {
    if (!supabaseClient) {
      setUser(null);
      return;
    }

    // Get current session
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        syncWithCloud(supabaseClient, session.user.id);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        syncWithCloud(supabaseClient, session.user.id);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseClient]);

  // 関連線を埋め込んでノードを保存するヘルパー
  const embedRelationships = (currentNodes: MindMapNode[], rels: Relationship[]): MindMapNode[] => {
    return currentNodes.map(n => n.id === 'root' ? { ...n, relationships: rels } as any : n);
  };

  // Sync with Cloud (Download if exists, Upload if empty)
  const syncWithCloud = async (client: SupabaseClient, userId: string) => {
    setSyncLoading(true);
    setStatusMessage('クラウドと同期中...');
    try {
      const { data: cloudNodes, error } = await client
        .from('nodes')
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;

      if (cloudNodes && cloudNodes.length > 0) {
        // Load cloud data to local
        const localNodes = normalizeMindMapNodes(
          cloudNodes.map((node) => fromDbNode(node as DbMindMapNode))
        ) || INITIAL_NODES;
        setNodes(localNodes);
        persistNodes(localNodes);
        
        // 関連線の復元
        const rootNode = localNodes.find(n => n.id === 'root');
        if (rootNode && (rootNode as any).relationships) {
          setRelationships((rootNode as any).relationships);
        } else {
          setRelationships([]);
        }

        // Reset undo history with cloud data
        setHistory([localNodes]);
        setHistoryIndex(0);
        setStatusMessage('クラウドから読み込みました');
      } else {
        // Cloud is empty, upload local data
        const localNodes = loadStoredNodes();
        if (localNodes.length > 0) {
          const dbNodes = localNodes.map(n => toDbNode(n, userId));
          const { error: insertError } = await client
            .from('nodes')
            .insert(dbNodes);
          if (insertError) throw insertError;
        }
        setStatusMessage('クラウドへ保存しました');
      }
    } catch (err) {
      console.error('Cloud synchronization failed:', err);
      setStatusMessage('クラウド同期に失敗しました');
    } finally {
      setSyncLoading(false);
    }
  };

  // Save Nodes (Local and Cloud Sync)
  const saveNodes = useCallback(async (updatedNodes: MindMapNode[], options: SaveOptions = {}, currentRels = relationships) => {
    const { skipHistory = false, syncRemote = true, statusMessage: nextStatus = '保存しました' } = options;
    const nodesWithRels = embedRelationships(updatedNodes, currentRels);
    
    setNodes(nodesWithRels);
    persistNodes(nodesWithRels);
    
    if (!skipHistory) {
      const nextHistory = history.slice(0, historyIndex + 1);
      setHistory([...nextHistory, nodesWithRels]);
      setHistoryIndex(nextHistory.length);
    }

    // Cloud push if logged in
    if (syncRemote && supabaseClient && user) {
      setStatusMessage('クラウドへ保存中...');
      try {
        // Truncate & insert strategy for simple deleted nodes sync
        await supabaseClient
          .from('nodes')
          .delete()
          .eq('user_id', user.id);

        if (nodesWithRels.length > 0) {
          const dbNodes = nodesWithRels.map(n => toDbNode(n, user.id));
          const { error } = await supabaseClient
            .from('nodes')
            .insert(dbNodes);
          if (error) throw error;
        }
        setStatusMessage(nextStatus);
      } catch (err) {
        console.error('Failed to sync changes to cloud database:', err);
        setStatusMessage('クラウド保存に失敗しました');
      }
    } else {
      setStatusMessage(nextStatus);
    }
  }, [history, historyIndex, supabaseClient, user, relationships]);


  const nodeById = useMemo(() => buildNodeMap(nodes), [nodes]);
  const childrenByParent = useMemo(() => buildChildrenMap(nodes), [nodes]);
  const visibleNodeIds = useMemo(() => {
    return new Set(nodes.filter((node) => isNodeVisible(node, nodeById)).map((node) => node.id));
  }, [nodeById, nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
  const rootChildrenCount = getChildrenCount(childrenByParent, 'root');

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setSelectedNodeId(null);
      saveNodes(history[prevIndex], { skipHistory: true, statusMessage: '元に戻しました' });
    }
  }, [history, historyIndex, saveNodes]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setSelectedNodeId(null);
      saveNodes(history[nextIndex], { skipHistory: true, statusMessage: 'やり直しました' });
    }
  }, [history, historyIndex, saveNodes]);

  // Add Child Node
  const addChildNode = useCallback((parentId: string) => {
    const parent = nodeById.get(parentId);
    if (!parent) return;

    let updatedNodes = [...nodes];
    if (parent.isCollapsed) {
      updatedNodes = updatedNodes.map(n => n.id === parentId ? { ...n, isCollapsed: false } : n);
    }

    const existingChildren = updatedNodes.filter(n => n.parentId === parentId);
    const yOffset = (existingChildren.length - (existingChildren.length / 2)) * 80 * (existingChildren.length % 2 === 0 ? 1 : -1);
    
    const color = parent.id === 'root'
      ? DEFAULT_COLORS[(existingChildren.length) % DEFAULT_COLORS.length]
      : parent.color;

    const newNode: MindMapNode = {
      id: `node-${Date.now()}`,
      text: '新規ノード',
      x: parent.x + 240,
      y: parent.y + yOffset,
      color,
      parentId,
      fontSize: 'sm',
      isBold: false
    };

    const updated = [...updatedNodes, newNode];
    saveNodes(updated, { statusMessage: '子ノードを追加しました' });
    setSelectedNodeId(newNode.id);
    setEditingNodeId(newNode.id);
  }, [nodeById, nodes, saveNodes]);

  // Delete Node
  const deleteNode = useCallback((nodeId: string) => {
    if (nodeId === 'root') return;

    const idsToRemove = getDescendantIds(nodes, nodeId);
    const updated = nodes.filter(n => !idsToRemove.includes(n.id));
    saveNodes(updated, { statusMessage: 'ノードを削除しました' });

    if (selectedNodeId && idsToRemove.includes(selectedNodeId)) {
      setSelectedNodeId(null);
    }
    if (editingNodeId && idsToRemove.includes(editingNodeId)) {
      setEditingNodeId(null);
    }
  }, [editingNodeId, nodes, saveNodes, selectedNodeId]);


  // Auto Layout
  const autoLayout = () => {
    const nodeMap = buildChildrenMap(nodes);

    const getSubtreeHeight = (id: string): number => {
      const children = nodeMap.get(id) || [];
      const visibleChildren = children.filter(c => visibleNodeIds.has(c.id));
      if (visibleChildren.length === 0) return 70;
      let total = 0;
      visibleChildren.forEach(c => {
        total += getSubtreeHeight(c.id);
      });
      return Math.max(total, visibleChildren.length * 70);
    };

    const rootX = ROOT_POSITION.x;
    const rootY = ROOT_POSITION.y;

    const newNodes = nodes.map(n => {
      if (n.id === 'root') {
        return { ...n, x: rootX, y: rootY };
      }
      return { ...n };
    });

    const updatePosition = (id: string, x: number, y: number) => {
      const idx = newNodes.findIndex(n => n.id === id);
      if (idx !== -1) {
        newNodes[idx].x = x;
        newNodes[idx].y = y;
      }
    };

    const rootChildren = nodeMap.get('root') || [];
    const rightTree = rootChildren.slice(0, Math.ceil(rootChildren.length / 2));
    const leftTree = rootChildren.slice(Math.ceil(rootChildren.length / 2));

    const layout = (parentId: string, startX: number, startY: number, direction: 'right' | 'left') => {
      const children = nodeMap.get(parentId) || [];
      if (children.length === 0) return;

      let currentY = startY;
      const xOffset = direction === 'right' ? 260 : -260;

      children.forEach(child => {
        const childHeight = getSubtreeHeight(child.id);
        const childY = currentY + childHeight / 2 - 25;
        updatePosition(child.id, startX + xOffset, childY);
        
        if (!child.isCollapsed) {
          layout(child.id, startX + xOffset, currentY, direction);
        }
        currentY += childHeight;
      });
    };

    let rightTotalHeight = 0;
    rightTree.forEach(c => { rightTotalHeight += getSubtreeHeight(c.id); });
    let rightStartY = rootY + 25 - rightTotalHeight / 2;
    
    let currentRightY = rightStartY;
    rightTree.forEach(child => {
      const h = getSubtreeHeight(child.id);
      const cy = currentRightY + h / 2 - 25;
      updatePosition(child.id, rootX + 260, cy);
      if (!child.isCollapsed) {
        layout(child.id, rootX + 260, currentRightY, 'right');
      }
      currentRightY += h;
    });

    let leftTotalHeight = 0;
    leftTree.forEach(c => { leftTotalHeight += getSubtreeHeight(c.id); });
    let leftStartY = rootY + 25 - leftTotalHeight / 2;

    let currentLeftY = leftStartY;
    leftTree.forEach(child => {
      const h = getSubtreeHeight(child.id);
      const cy = currentLeftY + h / 2 - 25;
      updatePosition(child.id, rootX - 260, cy);
      if (!child.isCollapsed) {
        layout(child.id, rootX - 260, currentLeftY, 'left');
      }
      currentLeftY += h;
    });

    saveNodes(newNodes, { statusMessage: '自動整列しました' });
    handleResetView();
  };

  // Node mouse drag handle
  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (editingNodeId === nodeId) return;

    if (relationStartNodeId) {
      handleAddRelationship(relationStartNodeId, nodeId);
      return;
    }
    
    const node = nodeById.get(nodeId);
    if (!node) return;

    setSelectedNodeId(nodeId);

    dragInfo.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
      hasMoved: false
    };
  };

  // Node Touch Drag Handle
  const handleNodeTouchStart = (e: React.TouchEvent, nodeId: string) => {
    e.stopPropagation();

    if (relationStartNodeId) {
      handleAddRelationship(relationStartNodeId, nodeId);
      return;
    }

    const touch = e.touches[0];
    const node = nodeById.get(nodeId);
    if (!node) return;

    setSelectedNodeId(nodeId);

    dragInfo.current = {
      nodeId,
      startX: touch.clientX,
      startY: touch.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
      hasMoved: false
    };
  };

  // Workspace Mouse Pan handle
  const handleWorkspaceMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setSelectedNodeId(null);
    setEditingNodeId(null);

    panInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      panStartX: pan.x,
      panStartY: pan.y
    };
  };

  // Workspace Touch Pan handle
  const handleWorkspaceTouchStart = (e: React.TouchEvent) => {
    setSelectedNodeId(null);
    setEditingNodeId(null);

    const touch = e.touches[0];
    panInfo.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      panStartX: pan.x,
      panStartY: pan.y
    };
  };

  // Drag & Pan Effect (supporting Mouse & Touch)
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (dragInfo.current) {
        const { nodeId, startX, startY, nodeStartX, nodeStartY } = dragInfo.current;
        const dx = (clientX - startX) / zoom;
        const dy = (clientY - startY) / zoom;

        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragInfo.current.hasMoved = true;
        }

        setNodes(prevNodes => 
          prevNodes.map(n => 
            n.id === nodeId 
              ? { ...n, x: Math.round(nodeStartX + dx), y: Math.round(nodeStartY + dy) }
              : n
          )
        );
      } else if (panInfo.current) {
        const { startX, startY, panStartX, panStartY } = panInfo.current;
        const dx = clientX - startX;
        const dy = clientY - startY;

        setPan({
          x: panStartX + dx,
          y: panStartY + dy
        });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        // Prevent default touch scrolling when dragging map elements
        if (dragInfo.current || panInfo.current) {
          e.preventDefault();
        }
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleUp = () => {
      if (dragInfo.current) {
        const { nodeId, hasMoved } = dragInfo.current;
        
        if (hasMoved && nodeId !== 'root') {
          const draggedNode = nodeById.get(nodeId);
          if (draggedNode) {
            let closestNode: MindMapNode | null = null;
            let minDistance = 100;

            nodes.forEach(n => {
              if (n.id === nodeId || n.id === draggedNode.parentId) return;
              if (isDescendant(nodes, nodeId, n.id)) return;

              const dist = Math.hypot(n.x - draggedNode.x, n.y - draggedNode.y);
              if (dist < minDistance) {
                minDistance = dist;
                closestNode = n;
              }
            });

            if (closestNode) {
              const updated = nodes.map(n => 
                n.id === nodeId 
                  ? { ...n, parentId: (closestNode as MindMapNode).id, color: (closestNode as MindMapNode).color } 
                  : n
              );
              saveNodes(updated, { statusMessage: '親ノードを変更しました' });
            } else {
              saveNodes(nodes, { statusMessage: '配置を保存しました' });
            }
          }
        } else if (hasMoved) {
          saveNodes(nodes, { statusMessage: '配置を保存しました' });
        }
        
        dragInfo.current = null;
      }
      if (panInfo.current) {
        panInfo.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [zoom, nodes, nodeById, user, supabaseClient, saveNodes]);

  // Zoom wheel
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = ZOOM_LIMITS.wheelFactor;
    let newZoom = zoom;

    if (e.deltaY < 0) {
      newZoom = Math.min(zoom * zoomFactor, ZOOM_LIMITS.max);
    } else {
      newZoom = Math.max(zoom / zoomFactor, ZOOM_LIMITS.min);
    }
    
    setZoom(newZoom);
  };

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingNodeId || isEditableTarget(e.target)) return;
      const modifierPressed = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (e.key === 'Escape') {
        setSelectedNodeId(null);
        setEditingNodeId(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId && selectedNodeId !== 'root') {
          deleteNode(selectedNodeId);
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedNodeId) {
          addChildNode(selectedNodeId);
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (selectedNodeId && selectedNodeId !== 'root') {
          const node = nodeById.get(selectedNodeId);
          if (node && node.parentId) {
            addChildNode(node.parentId);
          }
        }
      } else if (modifierPressed && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((modifierPressed && key === 'y') || (modifierPressed && e.shiftKey && key === 'z')) {
        e.preventDefault();
        redo();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const current = selectedNodeId ? nodeById.get(selectedNodeId) : null;
        if (!current) {
          setSelectedNodeId('root');
          return;
        }

        const visibleNodes = nodes.filter(n => visibleNodeIds.has(n.id) && n.id !== current.id);
        let candidates = visibleNodes;
        if (e.key === 'ArrowUp') {
          candidates = visibleNodes.filter(n => n.y < current.y - 10);
        } else if (e.key === 'ArrowDown') {
          candidates = visibleNodes.filter(n => n.y > current.y + 10);
        } else if (e.key === 'ArrowLeft') {
          candidates = visibleNodes.filter(n => n.x < current.x - 10);
        } else if (e.key === 'ArrowRight') {
          candidates = visibleNodes.filter(n => n.x > current.x + 10);
        }

        if (candidates.length > 0) {
          let closest = candidates[0];
          let minDist = Math.hypot(closest.x - current.x, closest.y - current.y);
          for (let i = 1; i < candidates.length; i++) {
            const dist = Math.hypot(candidates[i].x - current.x, candidates[i].y - current.y);
            if (dist < minDist) {
              minDist = dist;
              closest = candidates[i];
            }
          }
          setSelectedNodeId(closest.id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNodeId, editingNodeId, nodes, nodeById, visibleNodeIds, historyIndex, history, undo, redo, deleteNode, addChildNode]);

  // Center view
  const handleResetView = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    setPan({ x: width / 2 - ROOT_POSITION.x - 90, y: height / 2 - ROOT_POSITION.y - 25 });
    setZoom(1);
  };

  // Node editing actions
  const handleTextChange = (id: string, text: string) => {
    const updated = nodes.map(n => n.id === id ? { ...n, text } : n);
    saveNodes(updated, { skipHistory: true, syncRemote: false, statusMessage: '編集中...' });
  };

  const handleTextBlur = () => {
    setEditingNodeId(null);
    saveNodes(nodes, { statusMessage: 'テキストを更新しました' });
  };

  // Dynamic text input changes from the side editing input panel
  const handleSideTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedNodeId) return;
    handleTextChange(selectedNodeId, e.target.value);
  };

  const handleColorChange = (id: string, color: string) => {
    const updated = applyColorToBranch(nodes, id, color);
    saveNodes(updated, { statusMessage: '色を変更しました' });
  };

  const handleEmojiSelect = (id: string, emoji: string | undefined) => {
    const updated = nodes.map(n => n.id === id ? { ...n, emoji } : n);
    saveNodes(updated, { statusMessage: '絵文字を変更しました' });
  };

  const handleNoteChange = (id: string, note: string) => {
    const updated = nodes.map(n => n.id === id ? { ...n, note: note || undefined } : n);
    saveNodes(updated, { skipHistory: true, syncRemote: false, statusMessage: 'メモを保存中...' });
  };

  const handleHyperlinkChange = (id: string, hyperlink: string) => {
    const updated = nodes.map(n => n.id === id ? { ...n, hyperlink: hyperlink || undefined } : n);
    saveNodes(updated, { statusMessage: 'リンクを更新しました' });
  };

  const handlePriorityChange = (id: string, priority: NodePriority | undefined) => {
    const updated = nodes.map(n => n.id === id ? { ...n, priority } : n);
    saveNodes(updated, { statusMessage: '優先度を変更しました' });
  };

  const handleProgressChange = (id: string, progress: number | undefined) => {
    const updated = nodes.map(n => n.id === id ? { ...n, progress } : n);
    saveNodes(updated, { statusMessage: '進捗率を変更しました' });
  };

  const handleAddRelationship = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    if (relationships.some(r => (r.fromId === fromId && r.toId === toId) || (r.fromId === toId && r.toId === fromId))) {
      setStatusMessage('関連線は既に存在します');
      setRelationStartNodeId(null);
      return;
    }
    const newRel: Relationship = {
      id: `rel-${Date.now()}`,
      fromId,
      toId,
    };
    const nextRels = [...relationships, newRel];
    setRelationships(nextRels);
    saveNodes(nodes, { statusMessage: '関連線を追加しました' }, nextRels);
    setRelationStartNodeId(null);
  };

  const handleDeleteRelationship = (relId: string) => {
    const nextRels = relationships.filter(r => r.id !== relId);
    setRelationships(nextRels);
    saveNodes(nodes, { statusMessage: '関連線を削除しました' }, nextRels);
  };

  const toggleBold = (id: string) => {
    const updated = nodes.map(n => n.id === id ? { ...n, isBold: !n.isBold } : n);
    saveNodes(updated, { statusMessage: '太字を切り替えました' });
  };

  const changeFontSize = (id: string, fontSize: NodeFontSize) => {
    const updated = nodes.map(n => n.id === id ? { ...n, fontSize } : n);
    saveNodes(updated, { statusMessage: '文字サイズを変更しました' });
  };

  // Exports / Imports
  const exportData = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(nodes, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `mindmap_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setStatusMessage('JSONを書き出しました');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        const importedNodes = normalizeMindMapNodes(imported);
        if (importedNodes) {
          saveNodes(importedNodes, { statusMessage: 'JSONを読み込みました' });
          handleResetView();
        } else {
          alert('不正なマインドマップファイル形式です。');
        }
      } catch {
        alert('ファイルの読み込みに失敗しました。');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // PNG Capture
  const exportAsPng = () => {
    const el = document.querySelector('.canvas-transform') as HTMLElement;
    if (!el) return;

    const prevZoom = zoom;
    const prevPan = pan;

    setZoom(1);
    setPan({ x: 0, y: 0 });

    setTimeout(() => {
      toPng(el, { 
        backgroundColor: '#0d1117',
        style: {
          transform: 'none',
          width: `${CANVAS_SIZE.width}px`,
          height: `${CANVAS_SIZE.height}px`
        },
        width: CANVAS_SIZE.width,
        height: CANVAS_SIZE.height
      })
      .then((dataUrl) => {
        const link = document.createElement('a');
        link.download = `mindmap_${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
        setStatusMessage('PNGを書き出しました');
        
        setZoom(prevZoom);
        setPan(prevPan);
      })
      .catch((err) => {
        console.error('PNG export error', err);
        alert('画像の書き出しに失敗しました。');
        setZoom(prevZoom);
        setPan(prevPan);
      });
    }, 100);
  };

  // Connections Bezier Line
  const getBezierPath = (parent: MindMapNode, child: MindMapNode) => {
    const parentIsLeft = parent.x < child.x;
    const x1 = parentIsLeft ? parent.x + NODE_SIZE.width : parent.x;
    const y1 = parent.y + NODE_SIZE.height / 2;
    const x2 = parentIsLeft ? child.x : child.x + NODE_SIZE.width;
    const y2 = child.y + NODE_SIZE.height / 2;

    const dx = Math.abs(x2 - x1);
    const controlOffset = Math.min(dx * 0.5, 140);
    const cp1x = parentIsLeft ? x1 + controlOffset : x1 - controlOffset;
    const cp1y = y1;
    const cp2x = parentIsLeft ? x2 - controlOffset : x2 + controlOffset;
    const cp2y = y2;

    return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
  };

  const getRelationshipPath = (from: MindMapNode, to: MindMapNode) => {
    const fromX = from.x + NODE_SIZE.width / 2;
    const fromY = from.y + NODE_SIZE.height / 2;
    const toX = to.x + NODE_SIZE.width / 2;
    const toY = to.y + NODE_SIZE.height / 2;
    
    const dx = toX - fromX;
    const dy = toY - fromY;
    const cx1 = fromX + dx * 0.25;
    const cy1 = fromY + dy * 0.75;
    const cx2 = fromX + dx * 0.75;
    const cy2 = fromY + dy * 0.25;
    
    return `M ${fromX} ${fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${toX} ${toY}`;
  };

  // Save Supabase config dynamic settings
  const handleSaveConfig = () => {
    if (!configUrl || !configKey) {
      alert('URLとAnon Keyの両方を入力してください。');
      return;
    }
    
    localStorage.setItem(STORAGE_KEYS.supabaseUrl, configUrl.trim());
    localStorage.setItem(STORAGE_KEYS.supabaseAnonKey, configKey.trim());
    
    const client = initSupabase(configUrl.trim(), configKey.trim());
    setSupabaseClient(client);
    
    if (client) {
      setStatusMessage('同期設定を保存しました');
      setShowSyncSettings(false);
    } else {
      alert('Supabaseの初期化に失敗しました。設定値を確認してください。');
    }
  };

  const handleClearConfig = () => {
    if (confirm('接続設定をクリアしますか？ オフライン（ローカル保存）に戻ります。')) {
      localStorage.removeItem(STORAGE_KEYS.supabaseUrl);
      localStorage.removeItem(STORAGE_KEYS.supabaseAnonKey);
      setConfigUrl('');
      setConfigKey('');
      setSupabaseClient(null);
      setUser(null);
      setStatusMessage('ローカル保存モードに戻しました');
      setShowSyncSettings(false);
    }
  };

  // Authentication Handlers
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseClient) return;
    
    setAuthLoading(true);
    setAuthError(null);
    
    try {
      if (authMode === 'login') {
        const { error } = await supabaseClient.auth.signInWithPassword({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        setShowAuthModal(false);
      } else {
        const { error } = await supabaseClient.auth.signUp({
          email: authEmail,
          password: authPassword
        });
        if (error) throw error;
        alert('サインアップが完了しました！入力したメールアドレスの確認メールが届く場合があります。ログインしてください。');
        setAuthMode('login');
      }
    } catch (err) {
      setAuthError(getErrorMessage(err, '認証エラーが発生しました。'));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!supabaseClient) return;
    if (confirm('ログアウトしますか？（ローカルのデータはそのまま残ります）')) {
      await supabaseClient.auth.signOut();
      setUser(null);
    }
  };

  return (
    <div 
      className="workspace-container" 
      ref={workspaceRef}
      onWheel={handleWheel}
    >
      <div className="grid-background" />

      {/* Header Toolbar */}
      <div className="toolbar-panel glass-panel" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
        <span className="app-title">MindMapper</span>
        
        <div className="toolbar-group">
          <button type="button" className="toolbar-btn icon-only" onClick={undo} disabled={historyIndex <= 0} title="元に戻す (Ctrl+Z)" aria-label="元に戻す">
            <Undo2 size={16} />
          </button>
          <button type="button" className="toolbar-btn icon-only" onClick={redo} disabled={historyIndex >= history.length - 1} title="やり直す (Ctrl+Y)" aria-label="やり直す">
            <Redo2 size={16} />
          </button>
        </div>

        <button type="button" className="toolbar-btn" onClick={autoLayout} title="自動で綺麗に整列">
          <LayoutGrid size={16} />
          <span className="desktop-only">自動整列</span>
        </button>

        <button type="button" className="toolbar-btn" onClick={exportAsPng} title="PNG画像として保存">
          <FileImage size={16} />
          <span className="desktop-only">画像保存</span>
        </button>

        <button type="button" className="toolbar-btn" onClick={exportData} title="JSON形式で保存">
          <Download size={16} />
          <span className="desktop-only">書き出し</span>
        </button>

        <button type="button" className="toolbar-btn" onClick={() => importFileInputRef.current?.click()} title="JSONファイルを読み込む">
          <Upload size={16} />
          <span className="desktop-only">読み込み</span>
        </button>
        <input
          ref={importFileInputRef}
          className="visually-hidden"
          type="file"
          accept=".json"
          onChange={handleImport}
        />

        <button 
          type="button"
          className="toolbar-btn" 
          onClick={() => {
            if(confirm('マインドマップをリセットしますか？')) {
              saveNodes(INITIAL_NODES, { statusMessage: '初期状態へリセットしました' });
              handleResetView();
            }
          }}
          title="ローカルデータを初期状態にリセット"
          aria-label="リセット"
        >
          <RefreshCw size={16} />
        </button>

        <button 
          type="button"
          className="toolbar-btn"
          onClick={() => setShowSyncSettings(true)}
          title="Supabase同期設定"
        >
          <Settings size={16} />
          <span className="desktop-only">同期設定</span>
        </button>
      </div>

      {/* Sidebar Panel / Bottom Sheet */}
      <div className="sidebar-panel glass-panel" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
        {selectedNode ? (
          <div>
            {/* Grab handle header for mobile bottom sheet swipe feel */}
            <div className="bottom-sheet-grab-bar" />
            
            <h3 className="sidebar-title">スタイル・テキスト編集</h3>
            <div className="sidebar-editor">
              
              {/* Text Edit Input Field (Critical fix for Mobile Keyboard entry) */}
              <div>
                <label className="field-label" htmlFor="selected-node-text">ノードテキスト</label>
                <input 
                  id="selected-node-text"
                  type="text"
                  ref={sidebarInputRef}
                  value={selectedNode.text}
                  onChange={handleSideTextChange}
                  onBlur={handleTextBlur}
                  className="panel-input"
                  placeholder="テキストを入力"
                />
              </div>

              {/* Bold & Font size tools */}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button 
                  type="button"
                  className={`toolbar-btn ${selectedNode.isBold ? 'active' : ''}`}
                  onClick={() => toggleBold(selectedNode.id)}
                  style={{ padding: '10px', minWidth: '44px', justifyContent: 'center', borderColor: selectedNode.isBold ? 'var(--accent-blue)' : undefined }}
                  title="太字"
                >
                  <Bold size={18} />
                </button>

                <button 
                  type="button"
                  className={`toolbar-btn ${selectedNode.fontSize === 'sm' ? 'active' : ''}`}
                  onClick={() => changeFontSize(selectedNode.id, 'sm')}
                  style={{ padding: '10px', flexGrow: 1, fontSize: '0.75rem', justifyContent: 'center' }}
                >
                  小
                </button>
                <button 
                  type="button"
                  className={`toolbar-btn ${selectedNode.fontSize === 'md' ? 'active' : ''}`}
                  onClick={() => changeFontSize(selectedNode.id, 'md')}
                  style={{ padding: '10px', flexGrow: 1, fontSize: '0.85rem', justifyContent: 'center' }}
                >
                  中
                </button>
                <button 
                  type="button"
                  className={`toolbar-btn ${selectedNode.fontSize === 'lg' ? 'active' : ''}`}
                  onClick={() => changeFontSize(selectedNode.id, 'lg')}
                  style={{ padding: '10px', flexGrow: 1, fontSize: '0.95rem', justifyContent: 'center' }}
                >
                  大
                </button>
              </div>

              {/* Emoji list */}
              <div>
                <span className="field-label">アイコン絵文字</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  <button 
                    type="button"
                    className="toolbar-btn" 
                    onClick={() => handleEmojiSelect(selectedNode.id, undefined)}
                    style={{ padding: '6px 10px', fontSize: '0.80rem' }}
                  >
                    なし
                  </button>
                  {EMOJIS.map(em => (
                    <button 
                      type="button"
                      key={em}
                      className={`toolbar-btn ${selectedNode.emoji === em ? 'active' : ''}`}
                      onClick={() => handleEmojiSelect(selectedNode.id, em)}
                      style={{ padding: '6px 10px', fontSize: '1.1rem', borderColor: selectedNode.emoji === em ? 'var(--accent-blue)' : undefined }}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              {selectedNode.id !== 'root' && (
                <div>
                  <span className="field-label">ノードカラー</span>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {DEFAULT_COLORS.map(color => (
                      <button
                        type="button"
                        key={color}
                        className={`color-option ${selectedNode.color === color ? 'active' : ''}`}
                        style={{ backgroundColor: color, width: '28px', height: '28px' }}
                        onClick={() => handleColorChange(selectedNode.id, color)}
                        aria-label={`${color}に変更`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 優先度と進捗率設定 */}
              <div style={{ display: 'flex', gap: '10px', flexDirection: 'column', marginTop: '12px' }}>
                <div>
                  <span className="field-label">優先度</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {([
                      { value: undefined, label: 'なし' },
                      { value: 'high', label: '高' },
                      { value: 'medium', label: '中' },
                      { value: 'low', label: '低' }
                    ] as const).map(p => (
                      <button
                        type="button"
                        key={p.label}
                        className={`toolbar-btn ${selectedNode.priority === p.value ? 'active' : ''}`}
                        onClick={() => handlePriorityChange(selectedNode.id, p.value)}
                        style={{ flexGrow: 1, padding: '6px 0', fontSize: '0.8rem', justifyContent: 'center' }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="field-label">進捗率</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {([
                      { value: undefined, label: 'なし' },
                      { value: 0, label: '0%' },
                      { value: 25, label: '25%' },
                      { value: 50, label: '50%' },
                      { value: 75, label: '75%' },
                      { value: 100, label: '100%' }
                    ] as const).map(pr => (
                      <button
                        type="button"
                        key={pr.label}
                        className={`toolbar-btn ${selectedNode.progress === pr.value ? 'active' : ''}`}
                        onClick={() => handleProgressChange(selectedNode.id, pr.value)}
                        style={{ flexGrow: 1, minWidth: '40px', padding: '6px 0', fontSize: '0.75rem', justifyContent: 'center' }}
                      >
                        {pr.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 外部リンクとメモ */}
              <div style={{ marginTop: '12px' }}>
                <label className="field-label" htmlFor="selected-node-link">外部リンク (URL)</label>
                <input 
                  id="selected-node-link"
                  type="text"
                  value={selectedNode.hyperlink || ''}
                  onChange={(e) => handleHyperlinkChange(selectedNode.id, e.target.value)}
                  className="panel-input"
                  placeholder="https://example.com"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <label className="field-label" htmlFor="selected-node-note">詳細メモ</label>
                <textarea 
                  id="selected-node-note"
                  value={selectedNode.note || ''}
                  onChange={(e) => handleNoteChange(selectedNode.id, e.target.value)}
                  className="panel-input"
                  placeholder="メモ内容を入力..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid var(--border-light)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                    fontSize: '0.85rem'
                  }}
                />
              </div>

              {/* 関連線 (Relationships) */}
              <div style={{ marginTop: '12px' }}>
                <span className="field-label">他ノードへの関連線</span>
                <button
                  type="button"
                  className={`toolbar-btn primary ${relationStartNodeId === selectedNode.id ? 'active' : ''}`}
                  onClick={() => setRelationStartNodeId(relationStartNodeId ? null : selectedNode.id)}
                  style={{ width: '100%', padding: '10px', justifyContent: 'center', fontSize: '0.85rem' }}
                >
                  <Share2 size={14} style={{ marginRight: '6px' }} />
                  {relationStartNodeId === selectedNode.id ? '接続先を選択中...' : '新しく関連線を追加'}
                </button>
                
                {/* 既存の関連線一覧 */}
                {relationships.filter(r => r.fromId === selectedNode.id || r.toId === selectedNode.id).length > 0 && (
                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>設定済みの接続:</span>
                    {relationships
                      .filter(r => r.fromId === selectedNode.id || r.toId === selectedNode.id)
                      .map(r => {
                        const otherNodeId = r.fromId === selectedNode.id ? r.toId : r.fromId;
                        const otherNode = nodeById.get(otherNodeId);
                        return (
                          <div 
                            key={r.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 10px',
                              borderRadius: '6px',
                              background: 'rgba(255,255,255,0.04)',
                              border: '1px solid var(--border-light)',
                              fontSize: '0.8rem'
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>
                              🔗 {otherNode ? otherNode.text : '不明なノード'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteRelationship(r.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: '#f87171',
                                cursor: 'pointer',
                                padding: '2px'
                              }}
                              title="関連線を削除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
              
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px', marginTop: '12px', display: 'flex', gap: '8px' }}>
                <button 
                  type="button"
                  className="toolbar-btn primary" 
                  style={{ flexGrow: 1, justifyContent: 'center', padding: '12px' }}
                  onClick={() => addChildNode(selectedNode.id)}
                >
                  <Plus size={16} />
                  子追加
                </button>
                {selectedNode.id !== 'root' && (
                  <button 
                    type="button"
                    className="toolbar-btn" 
                    style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', padding: '12px' }}
                    onClick={() => deleteNode(selectedNode.id)}
                    title="ノードを削除"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="bottom-sheet-grab-bar" />
            <h3 className="sidebar-title">マップ概要</h3>
            <div className="map-summary-grid">
              <div className="summary-tile">
                <span className="summary-value">{nodes.length}</span>
                <span className="summary-label">ノード</span>
              </div>
              <div className="summary-tile">
                <span className="summary-value">{rootChildrenCount}</span>
                <span className="summary-label">第1階層</span>
              </div>
              <div className="summary-tile">
                <span className="summary-value">{Math.round(zoom * 100)}%</span>
                <span className="summary-label">ズーム</span>
              </div>
            </div>
            <div className="sidebar-action-stack">
              <button type="button" className="toolbar-btn primary" onClick={() => addChildNode('root')}>
                <Plus size={16} />
                ルートに追加
              </button>
              <button type="button" className="toolbar-btn" onClick={autoLayout}>
                <LayoutGrid size={16} />
                自動整列
              </button>
            </div>
          </div>
        )}

        {/* Sync Status Badge Panel */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-light)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {supabaseClient ? (
            user ? (
              <div className="glass-panel" style={{ padding: '10px', borderRadius: '8px', background: 'rgba(20, 184, 166, 0.05)' }}>
                <div style={{ display: 'flex', justifyItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div className="sync-badge" style={{ padding: '4px 10px' }}>
                    <Cloud size={12} />
                    {syncLoading ? '同期中...' : 'クラウド同期中'}
                  </div>
                  <button onClick={handleLogout} className="toolbar-btn" style={{ padding: '6px', borderRadius: '6px', background: 'transparent', border: 'none' }} title="ログアウト">
                    <LogOut size={16} style={{ color: 'var(--accent-orange)' }} />
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={user.email}>
                  👤 {user.email}
                </div>
              </div>
            ) : (
              <div className="glass-panel" style={{ padding: '10px', borderRadius: '8px' }}>
                <div className="sync-badge offline" style={{ color: 'var(--accent-blue)', background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)', marginBottom: '8px' }}>
                  <CloudOff size={12} />
                  オフライン (接続済)
                </div>
                <button 
                  className="toolbar-btn primary" 
                  style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '0.85rem' }}
                  onClick={() => {
                    setAuthError(null);
                    setAuthMode('login');
                    setShowAuthModal(true);
                  }}
                >
                  <UserIcon size={14} />
                  同期ログイン
                </button>
              </div>
            )
          ) : (
            <div className="sync-badge offline" style={{ width: 'fit-content' }}>
              <CloudOff size={12} />
              ローカル保存モード
            </div>
          )}
        </div>
      </div>

      <div className="status-strip glass-panel" role="status" aria-live="polite">
        <span className={`status-dot ${syncLoading ? 'syncing' : user ? 'online' : 'local'}`} />
        <span>{syncLoading ? 'クラウドと同期中...' : statusMessage}</span>
      </div>

      {relationStartNodeId && (
        <div 
          className="status-strip glass-panel" 
          style={{ 
            bottom: '52px', 
            background: 'rgba(139, 92, 246, 0.25)', 
            borderColor: 'rgba(139, 92, 246, 0.5)',
            color: '#e9d5ff',
            fontWeight: 'bold',
            zIndex: 999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>🔗 接続先のノードをタップしてください</span>
          <button
            type="button"
            onClick={() => setRelationStartNodeId(null)}
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 'normal'
            }}
          >
            キャンセル
          </button>
        </div>
      )}

      {/* Controls Overlay */}
      <div className="controls-panel glass-panel" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
        <button className="control-btn" onClick={() => setZoom(z => Math.min(z * ZOOM_LIMITS.buttonFactor, ZOOM_LIMITS.max))} title="拡大">
          <ZoomIn size={20} />
        </button>
        <button className="control-btn" onClick={() => setZoom(z => Math.max(z / ZOOM_LIMITS.buttonFactor, ZOOM_LIMITS.min))} title="縮小">
          <ZoomOut size={20} />
        </button>
        <button className="control-btn" onClick={handleResetView} title="画面中央へ">
          <Maximize2 size={20} />
        </button>
      </div>

      {/* Canvas Transform Container */}
      <div 
        className="canvas-transform"
        onMouseDown={handleWorkspaceMouseDown}
        onTouchStart={handleWorkspaceTouchStart}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          width: `${CANVAS_SIZE.width}px`,
          height: `${CANVAS_SIZE.height}px`,
          touchAction: 'none'
        }}
      >
        {/* Connections SVG */}
        <svg className="connections-svg" style={{ width: CANVAS_SIZE.svg, height: CANVAS_SIZE.svg }}>
          <defs>
            <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.7" />
            </linearGradient>
            <marker 
              id="arrow" 
              viewBox="0 0 10 10" 
              refX="16" 
              refY="5" 
              markerWidth="6" 
              markerHeight="6" 
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b5cf6" />
            </marker>
          </defs>
          {nodes.map(node => {
            if (!node.parentId) return null;
            const parent = nodeById.get(node.parentId);
            if (!parent) return null;
            if (!visibleNodeIds.has(node.id)) return null;

            return (
              <path 
                key={`line-${node.id}`}
                className={`connection-line ${selectedNodeId === node.id || selectedNodeId === parent.id ? 'active' : ''}`}
                d={getBezierPath(parent, node)}
                style={{
                  stroke: selectedNodeId === node.id || selectedNodeId === parent.id ? node.color : undefined
                }}
              />
            );
          })}
          {relationships.map(rel => {
            const fromNode = nodeById.get(rel.fromId);
            const toNode = nodeById.get(rel.toId);
            if (!fromNode || !toNode) return null;
            if (!visibleNodeIds.has(fromNode.id) || !visibleNodeIds.has(toNode.id)) return null;

            return (
              <path
                key={`rel-path-${rel.id}`}
                className="relationship-line"
                d={getRelationshipPath(fromNode, toNode)}
                fill="none"
                stroke="#8b5cf6"
                strokeWidth="2"
                strokeDasharray="6,4"
                markerEnd="url(#arrow)"
                style={{
                  opacity: 0.85
                }}
              />
            );
          })}
        </svg>

        {/* Node Elements */}
        {nodes.map(node => {
          const isRoot = node.id === 'root';
          const isSelected = selectedNodeId === node.id;
          const isEditing = editingNodeId === node.id;
          
          if (!visibleNodeIds.has(node.id)) return null;

          const childCount = getChildrenCount(childrenByParent, node.id);

          return (
            <div
              key={node.id}
              className={`mindmap-node ${isRoot ? 'root-node' : ''} ${isSelected ? 'selected' : ''}`}
              style={{
                left: node.x,
                top: node.y,
                width: NODE_SIZE.width,
                height: NODE_SIZE.height,
                background: isRoot 
                  ? undefined 
                  : `linear-gradient(135deg, ${node.color}cc 0%, rgba(15, 23, 42, 0.92) 100%)`,
                borderColor: isSelected ? undefined : node.color,
                fontWeight: node.isBold ? '700' : '500',
                fontSize: node.fontSize === 'sm' ? '0.85rem' : node.fontSize === 'lg' ? '1.1rem' : '0.95rem',
                touchAction: 'none' // Important to isolate touch drag from page gestures
              }}
              onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
              onTouchStart={(e) => handleNodeTouchStart(e, node.id)}
              onDoubleClick={() => setEditingNodeId(node.id)}
            >
              {/* 優先度インジケータ */}
              {node.priority && (
                <span 
                  className={`priority-badge ${node.priority}`}
                  style={{
                    display: 'inline-flex',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    marginRight: '6px',
                    flexShrink: 0,
                    backgroundColor: node.priority === 'high' ? '#ef4444' : node.priority === 'medium' ? '#f59e0b' : '#10b981',
                    boxShadow: `0 0 6px ${node.priority === 'high' ? '#ef4444' : node.priority === 'medium' ? '#f59e0b' : '#10b981'}`
                  }}
                  title={`優先度: ${node.priority === 'high' ? '高' : node.priority === 'medium' ? '中' : '低'}`}
                />
              )}

              {/* 進捗バッジ */}
              {node.progress !== undefined && (
                <span 
                  style={{
                    fontSize: '0.65rem',
                    padding: '1px 3px',
                    borderRadius: '3px',
                    background: 'rgba(255,255,255,0.1)',
                    color: node.progress === 100 ? '#10b981' : '#3b82f6',
                    marginRight: '6px',
                    fontWeight: 'bold',
                    flexShrink: 0,
                    border: '1px solid rgba(255,255,255,0.15)'
                  }}
                >
                  {node.progress}%
                </span>
              )}

              {node.emoji && (
                <span style={{ fontSize: '1.1rem', marginRight: '4px', display: 'inline-block', flexShrink: 0 }}>
                  {node.emoji}
                </span>
              )}

              {isEditing ? (
                <input
                  type="text"
                  className="node-input"
                  value={node.text}
                  onChange={(e) => handleTextChange(node.id, e.target.value)}
                  onBlur={handleTextBlur}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTextBlur();
                  }}
                  autoFocus
                />
              ) : (
                <span className="node-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexGrow: 1 }}>
                  {node.text}
                </span>
              )}

              {/* メモ & リンクアイコン */}
              <div style={{ display: 'inline-flex', gap: '4px', marginLeft: 'auto', paddingLeft: '4px', flexShrink: 0, alignItems: 'center' }}>
                {node.note && (
                  <span
                    title={`【詳細メモ】\n${node.note}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      alert(`【詳細メモ】\n${node.note}`);
                    }}
                    style={{ display: 'inline-flex', cursor: 'pointer' }}
                  >
                    <FileText 
                      size={13} 
                      className="node-meta-icon"
                      style={{ color: 'rgba(255,255,255,0.6)' }}
                    />
                  </span>
                )}
                {node.hyperlink && (
                  <span
                    title={`リンクを開く: ${node.hyperlink}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(node.hyperlink, '_blank');
                    }}
                    style={{ display: 'inline-flex', cursor: 'pointer' }}
                  >
                    <ExternalLink 
                      size={13}
                      className="node-meta-icon"
                      style={{ color: '#60a5fa' }}
                    />
                  </span>
                )}
              </div>

              {childCount > 0 && (
                <button 
                  className="node-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    const updated = nodes.map(n => 
                      n.id === node.id ? { ...n, isCollapsed: !n.isCollapsed } : n
                    );
                    saveNodes(updated);
                  }}
                  style={{
                    position: 'absolute',
                    right: '-12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    zIndex: 100,
                    width: '24px', // Bigger touch target
                    height: '24px',
                    background: node.color,
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    borderRadius: '50%'
                  }}
                  title={node.isCollapsed ? "展開する" : "折りたたむ"}
                >
                  {node.isCollapsed ? (
                    <ChevronRight size={14} style={{ color: '#fff' }} />
                  ) : (
                    <ChevronDown size={14} style={{ color: '#fff' }} />
                  )}
                </button>
              )}

              <div className="node-actions">
                <button 
                  className="node-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    addChildNode(node.id);
                  }}
                  title="子ノードを追加"
                >
                  <Plus size={14} />
                </button>
                
                {/* Text edit pencil button: Critical for mobile text editing */}
                <button 
                  className="node-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(node.id);
                    // Focus on input in sidebar
                    setTimeout(() => {
                      sidebarInputRef.current?.focus();
                      sidebarInputRef.current?.select();
                    }, 80);
                  }}
                  title="テキストを編集"
                >
                  <Edit2 size={12} />
                </button>

                {!isRoot && (
                  <button 
                    className="node-btn node-btn-delete" 
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteNode(node.id);
                    }}
                    title="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Supabase Sync Settings Modal */}
      {showSyncSettings && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="sync-settings-title">
          <div className="glass-panel modal-content modal-content-wide">
            <button 
              type="button"
              className="modal-close"
              onClick={() => setShowSyncSettings(false)}
              aria-label="同期設定を閉じる"
            >
              <X size={20} />
            </button>

            <h3 id="sync-settings-title" className="modal-title">
              Supabase 同期接続設定
            </h3>
            
            <p className="modal-description">
              ご自身のSupabaseプロジェクトの接続情報を入力してください。設定情報はローカルにのみ保存され、クラウド（データベース）とリアルタイム同期できるようになります。
            </p>

            <div className="form-stack">
              <div>
                <label className="field-label">
                  Supabase URL
                </label>
                <input 
                  type="text" 
                  value={configUrl}
                  onChange={(e) => setConfigUrl(e.target.value)}
                  placeholder="https://xxxxxx.supabase.co"
                  className="panel-input"
                />
              </div>

              <div>
                <label className="field-label">
                  Supabase Anon Key
                </label>
                <textarea 
                  value={configKey}
                  onChange={(e) => setConfigKey(e.target.value)}
                  placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                  rows={4}
                  className="panel-input mono-input"
                />
              </div>
            </div>

            <div className="modal-actions">
              {supabaseClient && (
                <button 
                  type="button"
                  onClick={handleClearConfig}
                  className="toolbar-btn warning"
                >
                  設定クリア
                </button>
              )}
              <button 
                type="button"
                onClick={handleSaveConfig}
                className="toolbar-btn primary"
              >
                接続して保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Authentication Modal */}
      {showAuthModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
          <div className="glass-panel modal-content">
            <button 
              type="button"
              className="modal-close"
              onClick={() => setShowAuthModal(false)}
              aria-label="ログイン画面を閉じる"
            >
              <X size={20} />
            </button>

            <h3 id="auth-modal-title" className="modal-title centered">
              {authMode === 'login' ? '同期アカウントへログイン' : '新規アカウント登録'}
            </h3>

            <form onSubmit={handleAuth} className="form-stack">
              {authError && (
                <div className="auth-error">
                  ⚠️ {authError}
                </div>
              )}

              <div>
                <label className="field-label">
                  メールアドレス
                </label>
                <input 
                  type="email" 
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  className="panel-input"
                />
              </div>

              <div>
                <label className="field-label">
                  パスワード
                </label>
                <input 
                  type="password" 
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="panel-input"
                />
              </div>

              <button 
                type="submit" 
                className="toolbar-btn primary"
                disabled={authLoading}
              >
                {authLoading ? '処理中...' : authMode === 'login' ? 'ログイン' : 'アカウントを作成'}
              </button>

              <div className="centered-action">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode(authMode === 'login' ? 'signup' : 'login');
                    setAuthError(null);
                  }}
                  className="link-button"
                >
                  {authMode === 'login' ? '新規アカウントを作成する' : '登録済みの方はこちらからログイン'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
