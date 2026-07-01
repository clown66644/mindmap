import type { MindMapNode, NodeFontSize, NodePriority } from '../types/mindmap';

export interface DbMindMapNode {
  id: string;
  user_id?: string;
  text: string;
  x: number;
  y: number;
  color: string;
  parent_id: string | null;
  is_collapsed: boolean | null;
  emoji: string | null;
  font_size: NodeFontSize | null;
  is_bold: boolean | null;
  note: string | null;
  priority: string | null;
  is_checked: boolean | null;
}

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isFontSize = (value: unknown): value is NodeFontSize => {
  return value === 'sm' || value === 'md' || value === 'lg';
};

const isPriority = (value: unknown): value is NodePriority => {
  return value === 'high' || value === 'medium' || value === 'low';
};

const normalizeNode = (value: unknown): MindMapNode | null => {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.trim() === '') return null;
  if (typeof value.text !== 'string') return null;
  if (typeof value.x !== 'number' || typeof value.y !== 'number') return null;
  if (typeof value.color !== 'string' || value.color.trim() === '') return null;

  let noteText: string | undefined = undefined;
  let hyperlink: string | undefined = undefined;
  let progress: number | undefined = undefined;
  let relationships: any[] | undefined = undefined;

  const rawNote = value.note;
  if (typeof rawNote === 'string' && rawNote !== '') {
    try {
      const parsed = JSON.parse(rawNote);
      if (parsed && typeof parsed === 'object') {
        noteText = parsed.text || undefined;
        if (parsed.meta) {
          hyperlink = parsed.meta.hyperlink || undefined;
          progress = typeof parsed.meta.progress === 'number' ? parsed.meta.progress : undefined;
          relationships = parsed.meta.relationships || undefined;
        }
      } else {
        noteText = rawNote;
      }
    } catch (e) {
      noteText = rawNote;
    }
  }

  if (typeof value.hyperlink === 'string' && value.hyperlink !== '') {
    hyperlink = value.hyperlink;
  }
  if (typeof value.progress === 'number') {
    progress = value.progress;
  }
  if (Array.isArray((value as any).relationships)) {
    relationships = (value as any).relationships;
  }

  const node: MindMapNode = {
    id: value.id,
    text: value.text,
    x: value.x,
    y: value.y,
    color: value.color,
    parentId: typeof value.parentId === 'string' && value.parentId !== '' ? value.parentId : undefined,
    isCollapsed: typeof value.isCollapsed === 'boolean' ? value.isCollapsed : false,
    emoji: typeof value.emoji === 'string' && value.emoji !== '' ? value.emoji : undefined,
    fontSize: isFontSize(value.fontSize) ? value.fontSize : 'sm',
    isBold: typeof value.isBold === 'boolean' ? value.isBold : false,
    note: noteText,
    priority: isPriority(value.priority) ? value.priority : undefined,
    isChecked: typeof value.isChecked === 'boolean' ? value.isChecked : undefined,
    hyperlink,
    progress,
  };

  if (relationships) {
    (node as any).relationships = relationships;
  }

  return node;
};

const hasParentCycle = (nodes: MindMapNode[], node: MindMapNode): boolean => {
  const nodeById = new Map(nodes.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current = node;

  while (current.parentId) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);

    const parent = nodeById.get(current.parentId);
    if (!parent) return false;
    current = parent;
  }

  return false;
};

export const normalizeMindMapNodes = (value: unknown): MindMapNode[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;

  const nodes = value.map(normalizeNode);
  if (nodes.some((node): node is null => node === null)) return null;

  const normalizedNodes = nodes as MindMapNode[];
  const ids = new Set(normalizedNodes.map((node) => node.id));
  if (ids.size !== normalizedNodes.length || !ids.has('root')) return null;

  const hasInvalidParent = normalizedNodes.some((node) => {
    return node.parentId && (!ids.has(node.parentId) || node.parentId === node.id);
  });
  if (hasInvalidParent) return null;

  if (normalizedNodes.some((node) => hasParentCycle(normalizedNodes, node))) return null;

  return normalizedNodes;
};

export const toDbNode = (node: MindMapNode, userId: string): DbMindMapNode & { user_id: string } => {
  const meta: Record<string, any> = {};
  if (node.hyperlink) meta.hyperlink = node.hyperlink;
  if (node.progress !== undefined) meta.progress = node.progress;
  if (node.id === 'root' && (node as any).relationships) {
    meta.relationships = (node as any).relationships;
  }

  let noteValue: string | null = null;
  if (node.note || Object.keys(meta).length > 0) {
    noteValue = JSON.stringify({
      text: node.note || '',
      meta
    });
  } else {
    noteValue = null;
  }

  return {
    id: node.id,
    user_id: userId,
    text: node.text,
    x: node.x,
    y: node.y,
    color: node.color,
    parent_id: node.parentId || null,
    is_collapsed: node.isCollapsed || false,
    emoji: node.emoji || null,
    font_size: node.fontSize || 'sm',
    is_bold: node.isBold || false,
    note: noteValue,
    priority: node.priority || null,
    is_checked: node.isChecked ?? null,
  };
};

export const fromDbNode = (dbNode: DbMindMapNode): MindMapNode => {
  let noteText: string | undefined = undefined;
  let hyperlink: string | undefined = undefined;
  let progress: number | undefined = undefined;
  let relationships: any[] | undefined = undefined;

  if (dbNode.note) {
    try {
      const parsed = JSON.parse(dbNode.note);
      if (parsed && typeof parsed === 'object' && ('text' in parsed || 'meta' in parsed)) {
        noteText = parsed.text || undefined;
        if (parsed.meta) {
          hyperlink = parsed.meta.hyperlink || undefined;
          progress = typeof parsed.meta.progress === 'number' ? parsed.meta.progress : undefined;
          relationships = parsed.meta.relationships || undefined;
        }
      } else {
        noteText = dbNode.note;
      }
    } catch (e) {
      noteText = dbNode.note;
    }
  }

  const node: MindMapNode = {
    id: dbNode.id,
    text: dbNode.text,
    x: dbNode.x,
    y: dbNode.y,
    color: dbNode.color,
    parentId: dbNode.parent_id || undefined,
    isCollapsed: dbNode.is_collapsed || false,
    emoji: dbNode.emoji || undefined,
    fontSize: dbNode.font_size || 'sm',
    isBold: dbNode.is_bold || false,
    note: noteText,
    priority: isPriority(dbNode.priority) ? dbNode.priority : undefined,
    isChecked: dbNode.is_checked ?? undefined,
    hyperlink,
    progress,
  };

  if (relationships) {
    (node as any).relationships = relationships;
  }

  return node;
};

export const buildNodeMap = (nodes: MindMapNode[]) => {
  return new Map(nodes.map((node) => [node.id, node]));
};

export const buildChildrenMap = (nodes: MindMapNode[]) => {
  const childrenByParent = new Map<string, MindMapNode[]>();

  nodes.forEach((node) => {
    if (!node.parentId) return;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) || []), node]);
  });

  return childrenByParent;
};

export const isNodeVisible = (node: MindMapNode, nodeById: Map<string, MindMapNode>): boolean => {
  const seen = new Set<string>();
  let current = node;

  while (current.parentId) {
    if (seen.has(current.id)) return false;
    seen.add(current.id);

    const parent = nodeById.get(current.parentId);
    if (!parent || parent.isCollapsed) return false;
    current = parent;
  }

  return true;
};

export const isDescendant = (nodes: MindMapNode[], parentId: string, childId: string): boolean => {
  const nodeById = buildNodeMap(nodes);
  let child = nodeById.get(childId);

  while (child?.parentId) {
    if (child.parentId === parentId) return true;
    child = nodeById.get(child.parentId);
  }

  return false;
};

export const getDescendantIds = (nodes: MindMapNode[], nodeId: string): string[] => {
  const childrenByParent = buildChildrenMap(nodes);
  const descendants: string[] = [nodeId];
  const children = childrenByParent.get(nodeId) || [];

  children.forEach((child) => {
    descendants.push(...getDescendantIds(nodes, child.id));
  });

  return descendants;
};

export const getChildrenCount = (childrenByParent: Map<string, MindMapNode[]>, nodeId: string) => {
  return childrenByParent.get(nodeId)?.length || 0;
};

export const applyColorToBranch = (nodes: MindMapNode[], nodeId: string, color: string): MindMapNode[] => {
  const targetIds = new Set(getDescendantIds(nodes, nodeId));
  return nodes.map((node) => targetIds.has(node.id) ? { ...node, color } : node);
};

export const getErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof Error && error.message ? error.message : fallback;
};

// Clone a subtree with new IDs
export const cloneSubtree = (nodes: MindMapNode[], rootNodeId: string, newParentId: string): MindMapNode[] => {
  const idMap = new Map<string, string>();
  const descendantIds = getDescendantIds(nodes, rootNodeId);
  const nodeById = buildNodeMap(nodes);
  
  // Generate new IDs
  descendantIds.forEach((id, index) => {
    idMap.set(id, `node-${Date.now()}-${index}`);
  });

  const clonedNodes: MindMapNode[] = [];
  descendantIds.forEach((oldId) => {
    const original = nodeById.get(oldId);
    if (!original) return;
    
    const newId = idMap.get(oldId)!;
    const isCloneRoot = oldId === rootNodeId;
    const newParent = isCloneRoot ? newParentId : idMap.get(original.parentId || '');
    
    clonedNodes.push({
      ...original,
      id: newId,
      parentId: newParent || newParentId,
      x: original.x + 40,
      y: original.y + 40,
    });
  });

  return clonedNodes;
};

// Calculate bounding box of all visible nodes
export const getNodesBoundingBox = (nodes: MindMapNode[], nodeWidth: number, nodeHeight: number) => {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + nodeWidth);
    maxY = Math.max(maxY, n.y + nodeHeight);
  });
  
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};
