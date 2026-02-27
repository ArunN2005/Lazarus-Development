'use client';

import { useState, useMemo } from 'react';
import { GeneratedFile } from '@/lib/api';

interface FileTreeProps {
  files: GeneratedFile[];
  selectedFile?: string;
  onSelect: (filePath: string) => void;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  file?: GeneratedFile;
}

function buildTree(files: GeneratedFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDirectory: true, children: [] };

  for (const file of files) {
    const parts = file.filePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path,
          isDirectory: !isLast,
          children: [],
          file: isLast ? file : undefined,
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetical
  const sortNode = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
  };
  sortNode(root);

  return root;
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const icons: Record<string, string> = {
    ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️',
    json: '📦', md: '📝', css: '🎨', scss: '🎨',
    html: '🌐', py: '🐍', go: '🔷', rs: '🦀',
    yaml: '⚙️', yml: '⚙️', toml: '⚙️',
    env: '🔐', lock: '🔒', gitignore: '👁️',
    dockerfile: '🐳', sh: '📜',
  };
  return icons[ext || ''] || '📄';
}

function TreeNodeItem({
  node,
  depth,
  selectedFile,
  onSelect,
  expandedDirs,
  toggleDir,
}: {
  node: TreeNode;
  depth: number;
  selectedFile?: string;
  onSelect: (path: string) => void;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
}) {
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = node.path === selectedFile;

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => toggleDir(node.path)}
          className={`
            w-full flex items-center gap-1.5 px-2 py-1 text-sm text-left
            hover:bg-gray-800/50 rounded transition-colors
          `}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-xs text-gray-500">{isExpanded ? '▼' : '▶'}</span>
          <span className="text-yellow-500">📁</span>
          <span className="text-gray-300 truncate">{node.name}</span>
          <span className="text-xs text-gray-600 ml-auto">{node.children.length}</span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelect={onSelect}
                expandedDirs={expandedDirs}
                toggleDir={toggleDir}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`
        w-full flex items-center gap-1.5 px-2 py-1 text-sm text-left rounded
        transition-colors
        ${isSelected ? 'bg-indigo-600/20 text-indigo-300' : 'hover:bg-gray-800/50 text-gray-400'}
      `}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span>{getFileIcon(node.name)}</span>
      <span className="truncate">{node.name}</span>
      {node.file && (
        <span className="text-xs text-gray-600 ml-auto">
          {node.file.size > 1024 ? `${(node.file.size / 1024).toFixed(1)}KB` : `${node.file.size}B`}
        </span>
      )}
    </button>
  );
}

export default function FileTree({ files, selectedFile, onSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    // Expand top-level directories by default
    const dirs = new Set<string>();
    tree.children.forEach((child) => {
      if (child.isDirectory) dirs.add(child.path);
    });
    return dirs;
  });
  const [search, setSearch] = useState('');

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const filteredFiles = useMemo(() => {
    if (!search) return files;
    const lower = search.toLowerCase();
    return files.filter((f) => f.filePath.toLowerCase().includes(lower));
  }, [files, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-gray-800">
        <input
          type="text"
          placeholder="Search files..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm
            text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1">
        {search ? (
          // Flat search results
          filteredFiles.map((file) => (
            <button
              key={file.filePath}
              onClick={() => onSelect(file.filePath)}
              className={`
                w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left rounded
                ${file.filePath === selectedFile
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'hover:bg-gray-800/50 text-gray-400'}
              `}
            >
              <span>{getFileIcon(file.filePath.split('/').pop() || '')}</span>
              <span className="truncate">{file.filePath}</span>
            </button>
          ))
        ) : (
          tree.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={0}
              selectedFile={selectedFile}
              onSelect={onSelect}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-gray-800 text-xs text-gray-600">
        {files.length} files
      </div>
    </div>
  );
}
