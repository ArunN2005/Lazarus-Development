import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import NavAuth from '@/components/NavAuth';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Lazarus — AI-Powered Legacy Code Modernization',
  description: 'Transform legacy codebases into modern, deployable applications using AI agents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-gray-950 text-gray-100 min-h-screen`}>
        <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <a href="/" className="flex items-center gap-2">
                <span className="text-2xl">⚡</span>
                <span className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
                  Lazarus
                </span>
              </a>
              <div className="flex items-center gap-6">
                <a href="/dashboard" className="text-sm text-gray-400 hover:text-white transition-colors">
                  Dashboard
                </a>
                <a href="/new" className="text-sm bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg transition-colors">
                  New Project
                </a>
                <NavAuth />
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
