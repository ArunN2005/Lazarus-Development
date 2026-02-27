'use client';

const COGNITO_DOMAIN = process.env.NEXT_PUBLIC_COGNITO_DOMAIN || '';
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || '';
const REDIRECT_URI =
  typeof window !== 'undefined'
    ? `${window.location.origin}/auth/callback`
    : 'http://localhost:3000/auth/callback';

export function getLoginUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
  });
  return `${COGNITO_DOMAIN}/login?${params}`;
}

export function getSignupUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: REDIRECT_URI,
  });
  return `${COGNITO_DOMAIN}/signup?${params}`;
}

export function getLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri:
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  });
  return `${COGNITO_DOMAIN}/logout?${params}`;
}

export interface TokenSet {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export interface UserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri:
      typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : 'http://localhost:3000/auth/callback',
  });

  const res = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  return res.json();
}

export function saveTokens(tokens: TokenSet): void {
  localStorage.setItem('lazarus_access_token', tokens.access_token);
  localStorage.setItem('lazarus_id_token', tokens.id_token);
  if (tokens.refresh_token) {
    localStorage.setItem('lazarus_refresh_token', tokens.refresh_token);
  }
  localStorage.setItem(
    'lazarus_token_expires',
    String(Date.now() + tokens.expires_in * 1000)
  );
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  const expires = Number(localStorage.getItem('lazarus_token_expires') || 0);
  if (Date.now() > expires) {
    clearTokens();
    return null;
  }
  return localStorage.getItem('lazarus_access_token');
}

export function getIdToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('lazarus_id_token');
}

export function clearTokens(): void {
  localStorage.removeItem('lazarus_access_token');
  localStorage.removeItem('lazarus_id_token');
  localStorage.removeItem('lazarus_refresh_token');
  localStorage.removeItem('lazarus_token_expires');
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}

export function parseIdToken(idToken: string): UserInfo | null {
  try {
    const payload = idToken.split('.')[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return {
      sub: decoded.sub,
      email: decoded.email,
      name: decoded.name || decoded['cognito:username'],
      picture: decoded.picture,
    };
  } catch {
    return null;
  }
}
