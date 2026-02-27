'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { isAuthenticated } from '@/lib/auth';

export default function NewProjectPage() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = useState('');
  const [githubPat, setGithubPat] = useState('');
  const [showPat, setShowPat] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ message: string; handler?: string; timestamp?: string } | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    }
  }, [router]);

  const isValidUrl = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/i.test(repoUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidUrl) return;

    try {
      setSubmitting(true);
      setError(null);

      const { projectId } = await api.createProject({
        repoUrl: repoUrl.trim(),
        githubPat: githubPat.trim() || undefined,
      });

      router.push(`/project/${projectId}`);
    } catch (err) {
      if (err instanceof Error) {
        // APIError has handler and timestamp fields
        const apiErr = err as { message: string; handler?: string; timestamp?: string };
        setError({ message: apiErr.message, handler: apiErr.handler, timestamp: apiErr.timestamp });
      } else {
        setError({ message: 'Failed to create project' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <div className="text-4xl mb-4">🚀</div>
        <h1 className="text-2xl font-bold text-white mb-2">New Migration</h1>
        <p className="text-sm text-gray-500">
          Provide a GitHub repository URL to begin the modernization process.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Repo URL */}
        <div className="glass rounded-lg p-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            GitHub Repository URL
          </label>
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repository"
            required
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-200
              placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1
              focus:ring-indigo-500 text-sm font-mono"
          />
          {repoUrl && !isValidUrl && (
            <p className="mt-2 text-xs text-red-400">
              Please enter a valid GitHub URL (e.g., https://github.com/owner/repo)
            </p>
          )}
          {repoUrl && isValidUrl && (
            <p className="mt-2 text-xs text-green-400 flex items-center gap-1">
              <span>✓</span> Valid repository URL
            </p>
          )}
        </div>

        {/* Access settings */}
        <div className="glass rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-gray-300">Private Repository?</label>
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              className={`
                relative inline-flex h-5 w-9 items-center rounded-full transition-colors
                ${isPrivate ? 'bg-indigo-600' : 'bg-gray-700'}
              `}
            >
              <span
                className={`
                  inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
                  ${isPrivate ? 'translate-x-4' : 'translate-x-1'}
                `}
              />
            </button>
          </div>

          {isPrivate && (
            <div className="animate-fade-in">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                GitHub Personal Access Token
              </label>
              <div className="relative">
                <input
                  type={showPat ? 'text' : 'password'}
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-200
                    placeholder-gray-600 focus:outline-none focus:border-indigo-500 text-sm font-mono pr-16"
                />
                <button
                  type="button"
                  onClick={() => setShowPat(!showPat)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
                >
                  {showPat ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="mt-2 text-xs text-gray-500 space-y-1">
                <p>To create a PAT:</p>
                <ol className="list-decimal list-inside space-y-0.5 text-gray-600">
                  <li>Go to GitHub → Settings → Developer settings → Personal access tokens</li>
                  <li>Generate new token (classic) with <code className="text-gray-400">repo</code> scope</li>
                  <li>Copy and paste it above</li>
                </ol>
                <p className="text-amber-500/80 mt-2">
                  🔐 Your token is stored securely in AWS Secrets Manager and deleted after use.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-red-400 mt-0.5 shrink-0">✕</span>
              <p className="text-red-400 font-medium break-all">{error.message}</p>
            </div>
            {error.handler && (
              <p className="text-red-500/70 text-xs font-mono pl-5">Handler: {error.handler}</p>
            )}
            {error.timestamp && (
              <p className="text-red-500/70 text-xs font-mono pl-5">Time: {error.timestamp}</p>
            )}
            <p className="text-red-500/60 text-xs pl-5">
              Check{' '}
              <a
                href={`https://ap-south-1.console.aws.amazon.com/cloudwatch/home?region=ap-south-1#logsV2:log-groups/log-group/$252Flazarus$252Fcreateproject`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-red-400"
              >
                CloudWatch logs
              </a>{' '}
              for full details.
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!isValidUrl || submitting || (isPrivate && !githubPat)}
          className="w-full py-3 bg-indigo-600 text-white rounded-lg font-medium text-sm
            hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed
            flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-indigo-500/25"
        >
          {submitting ? (
            <>
              <span className="animate-spin-slow">🔮</span>
              Starting Migration...
            </>
          ) : (
            <>Start Migration →</>
          )}
        </button>
      </form>

      {/* How it works */}
      <div className="mt-12 glass rounded-lg p-6">
        <h3 className="text-sm font-medium text-gray-300 mb-4">How it works</h3>
        <div className="space-y-3">
          {[
            { step: '1', title: 'Inspect', desc: 'Clone and analyze your repository structure, dependencies, and tech stack' },
            { step: '2', title: 'Plan', desc: 'Generate a detailed migration plan with file-level changes and cost estimates' },
            { step: '3', title: 'Review', desc: 'You review and approve the plan before any code is generated' },
            { step: '4', title: 'Build', desc: 'AI generates modern code file-by-file with import reconciliation' },
            { step: '5', title: 'Test', desc: 'Automatic sandbox testing with up to 10 heal iterations' },
            { step: '6', title: 'Deploy', desc: 'Build Docker image and deploy to AWS App Runner with health checks' },
          ].map((item) => (
            <div key={item.step} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {item.step}
              </span>
              <div>
                <span className="text-sm text-gray-300 font-medium">{item.title}</span>
                <p className="text-xs text-gray-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
