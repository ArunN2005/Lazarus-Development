'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { isAuthenticated, getIdToken, parseIdToken, clearTokens, getLogoutUrl } from '@/lib/auth';

export default function NavAuth() {
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      const idToken = getIdToken();
      if (idToken) {
        const info = parseIdToken(idToken);
        if (info) setUser({ email: info.email, name: info.name });
      }
    }
    setChecked(true);
  }, []);

  if (!checked) return null;

  if (!user) {
    return (
      <Link
        href="/login"
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        Sign In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-400 hidden sm:block">{user.name || user.email}</span>
      <button
        onClick={() => {
          clearTokens();
          window.location.href = getLogoutUrl();
        }}
        className="text-sm text-gray-500 hover:text-white transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
