export type NodeFontSize = 'sm' | 'md' | 'lg';
export type NodePriority = 'high' | 'medium' | 'low';

export interface MindMapNode {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  parentId?: string;
  isCollapsed?: boolean;
  emoji?: string;
  fontSize?: NodeFontSize;
  isBold?: boolean;
  note?: string;
  priority?: NodePriority;
  isChecked?: boolean;
  hyperlink?: string;
  progress?: number; // 0, 25, 50, 75, 100
}

export interface Relationship {
  id: string;
  fromId: string;
  toId: string;
  text?: string;
}

export interface MindMapFile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Point {
  x: number;
  y: number;
}

