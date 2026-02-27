'use client';

import { useState, useEffect, useRef } from 'react';

interface CodeEditorProps {
  content: string;
  language: string;
  filePath: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
  onSave?: (content: string) => void;
}

function getLanguageComment(language: string): string {
  const doubleSlash = ['typescript', 'javascript', 'java', 'go', 'rust', 'c', 'cpp', 'swift'];
  const hash = ['python', 'ruby', 'shell', 'bash', 'yaml'];
  if (doubleSlash.includes(language)) return '//';
  if (hash.includes(language)) return '#';
  return '//';
}

export default function CodeEditor({
  content,
  language,
  filePath,
  readOnly = false,
  onChange,
  onSave,
}: CodeEditorProps) {
  const [value, setValue] = useState(content);
  const [isDirty, setIsDirty] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineCount = value.split('\n').length;

  useEffect(() => {
    setValue(content);
    setIsDirty(false);
  }, [content]);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setIsDirty(newValue !== content);
    onChange?.(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty && onSave) {
        onSave(value);
        setIsDirty(false);
      }
    }

    // Tab to indent
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      handleChange(newValue);

      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="flex flex-col h-full border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400 font-mono truncate">{filePath}</span>
          {isDirty && <span className="w-2 h-2 rounded-full bg-amber-500" title="Unsaved changes" />}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600">{language}</span>
          <span className="text-xs text-gray-600">{lineCount} lines</span>
          {isDirty && onSave && (
            <button
              onClick={() => {
                onSave(value);
                setIsDirty(false);
              }}
              className="px-2 py-0.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-500 transition-colors"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex overflow-auto bg-[#0d1117]">
        {/* Line numbers */}
        <div className="flex-shrink-0 pt-3 pb-3 pr-3 pl-3 text-right select-none border-r border-gray-800/50">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className="text-xs text-gray-600 leading-5 font-mono">
              {i + 1}
            </div>
          ))}
        </div>

        {/* Code area */}
        {readOnly ? (
          <pre className="flex-1 p-3 text-sm text-gray-300 font-mono leading-5 whitespace-pre overflow-auto !bg-transparent !rounded-none !m-0">
            {value}
          </pre>
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            className="flex-1 p-3 bg-transparent text-sm text-gray-300 font-mono leading-5
              resize-none outline-none whitespace-pre overflow-auto"
          />
        )}
      </div>
    </div>
  );
}
