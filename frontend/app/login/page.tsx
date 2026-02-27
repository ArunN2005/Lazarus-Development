'use client';

import { useEffect } from 'react';
import { getLoginUrl, getSignupUrl } from '@/lib/auth';

export default function LoginPage() {
  useEffect(() => {
    // Pre-warm the redirect URL (client-side only, window is available)
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      <div className="text-center max-w-md w-full">
        <div className="text-5xl mb-6">🔮</div>
        <h1 className="text-3xl font-bold text-white mb-2">Welcome to Lazarus</h1>
        <p className="text-gray-400 mb-8">Sign in to start modernizing your legacy code.</p>

        <div className="glass rounded-xl p-8 flex flex-col gap-4">
          <a
            href={typeof window !== 'undefined' ? getLoginUrl() : '#'}
            onClick={(e) => {
              e.preventDefault();
              window.location.href = getLoginUrl();
            }}
            className="w-full py-3 px-6 bg-indigo-600 text-white rounded-lg font-medium
              hover:bg-indigo-500 transition-all text-center"
          >
            Sign In
          </a>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.location.href = getSignupUrl();
            }}
            className="w-full py-3 px-6 border border-gray-700 text-gray-300 rounded-lg
              hover:border-indigo-500 hover:text-white transition-all text-center"
          >
            Create Account
          </a>
          <p className="text-xs text-gray-600 mt-2">
            Authentication is handled securely via Amazon Cognito.
          </p>
        </div>
      </div>
    </div>
  );
}
