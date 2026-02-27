'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useProject } from '@/hooks/useProject';
import FileTree from '@/components/FileTree';
import CodeEditor from '@/components/CodeEditor';
import api from '@/lib/api';

export default function FilePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const initialPath = searchParams.get('path') || '';
  const { project, files } = useProject(projectId);

  const [selectedFile, setSelectedFile] = useState(initialPath);
  const [fileContent, setFileContent] = useState('');
  const [fileLanguage, setFileLanguage] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedFile) {
      loadFileContent(selectedFile);
    }
  }, [selectedFile]);

  async function loadFileContent(filePath: string) {
    try {
      setLoadingContent(true);
      const { content, language } = await api.getFileContent(projectId, filePath);
      setFileContent(content);
      setFileLanguage(language);
    } catch {
      setFileContent('// Failed to load file content');
      setFileLanguage('text');
    } finally {
      setLoadingContent(false);
    }
  }

  async function handleSave(content: string) {
    try {
      setSaving(true);
      await api.updateFileContent(projectId, selectedFile, content);
      setSaveMessage('Saved successfully');
      setTimeout(() => setSaveMessage(null), 2000);
    } catch {
      setSaveMessage('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-4">
        <Link href="/dashboard" className="hover:text-gray-300">Dashboard</Link>
        <span>/</span>
        <Link href={`/project/${projectId}`} className="hover:text-gray-300">{project?.repoName}</Link>
        <span>/</span>
        <span className="text-gray-400">Files</span>
      </div>

      {saveMessage && (
        <div className={`mb-4 px-3 py-2 rounded text-sm ${
          saveMessage.includes('success') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {saveMessage}
        </div>
      )}

      <div className="flex gap-4 h-[calc(100vh-180px)]">
        {/* Sidebar file tree */}
        <div className="w-64 shrink-0 glass rounded-lg overflow-hidden">
          <FileTree
            files={files}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
          />
        </div>

        {/* Code editor */}
        <div className="flex-1 min-w-0">
          {selectedFile ? (
            loadingContent ? (
              <div className="flex items-center justify-center h-full glass rounded-lg">
                <div className="animate-spin-slow text-2xl">🔮</div>
              </div>
            ) : (
              <CodeEditor
                content={fileContent}
                language={fileLanguage}
                filePath={selectedFile}
                onSave={handleSave}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full glass rounded-lg text-gray-500 text-sm">
              Select a file to view its contents
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
