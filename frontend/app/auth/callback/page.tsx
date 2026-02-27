'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { exchangeCodeForTokens, saveTokens } from '@/lib/auth';
import { Suspense } from 'react';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const errorParam = searchParams.get('error');
    const errorDesc = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }

    if (!code) {
      setError('No authorization code received.');
      return;
    }

    exchangeCodeForTokens(code)
      .then((tokens) => {
        saveTokens(tokens);
        router.replace('/dashboard');
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-semibold text-white mb-2">Authentication Failed</h2>
        <p className="text-gray-400 mb-6 max-w-sm">{error}</p>
        <a
          href="/login"
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-all"
        >
          Try Again
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh]">
      <div className="flex items-center gap-3 text-gray-400">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Signing you in…
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[80vh] text-gray-400">
        Loading…
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
