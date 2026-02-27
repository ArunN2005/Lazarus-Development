import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] px-4">
      {/* Hero */}
      <div className="text-center max-w-3xl animate-fade-in">
        <div className="text-6xl mb-6">🔮</div>
        <h1 className="text-5xl font-bold text-white mb-4">
          Lazarus
        </h1>
        <p className="text-xl text-gray-400 mb-2">
          AI-Powered Legacy Code Modernization
        </p>
        <p className="text-sm text-gray-500 mb-8 max-w-xl mx-auto">
          Point Lazarus at any GitHub repository and watch it analyze, plan, rebuild,
          test, and deploy a modernized version — fully automated with a 6-agent pipeline.
        </p>

        <div className="flex items-center justify-center gap-4">
          <Link
            href="/new"
            className="px-8 py-3 bg-indigo-600 text-white rounded-lg font-medium
              hover:bg-indigo-500 transition-all hover:shadow-lg hover:shadow-indigo-500/25"
          >
            Start Migration →
          </Link>
          <Link
            href="/dashboard"
            className="px-8 py-3 border border-gray-700 text-gray-300 rounded-lg
              hover:border-gray-600 hover:text-white transition-colors"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="mt-20 w-full max-w-4xl">
        <h2 className="text-center text-sm font-medium text-gray-500 uppercase tracking-wider mb-8">
          6-Agent Pipeline
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { icon: '🔍', name: 'Inspector', desc: 'Scan & analyze codebase' },
            { icon: '📋', name: 'Architect', desc: 'Plan migration strategy' },
            { icon: '🔨', name: 'Builder', desc: 'Generate modern code' },
            { icon: '🧪', name: 'Sandbox', desc: 'Test & heal iteratively' },
            { icon: '🚀', name: 'Deployer', desc: 'Build & deploy to cloud' },
            { icon: '🩺', name: 'Validator', desc: 'Verify & health check' },
          ].map((agent, i) => (
            <div
              key={agent.name}
              className="glass rounded-lg p-4 text-center hover:border-indigo-500/30
                transition-all hover:-translate-y-1"
            >
              <div className="text-2xl mb-2">{agent.icon}</div>
              <div className="text-sm font-medium text-white mb-1">{agent.name}</div>
              <div className="text-xs text-gray-500">{agent.desc}</div>
              {i < 5 && (
                <div className="hidden lg:block absolute -right-3 top-1/2 text-gray-600">→</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="mt-16 w-full max-w-4xl grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {[
          {
            title: 'Multi-Language Support',
            desc: 'JavaScript, TypeScript, Python, Go — detects your stack and modernizes accordingly.',
            icon: '🌐',
          },
          {
            title: 'Cost Transparent',
            desc: 'Real-time AI token costs tracked per phase. No surprises — approve before building.',
            icon: '💰',
          },
          {
            title: 'Self-Healing',
            desc: '10-iteration sandbox loop catches build errors and fixes them automatically.',
            icon: '🔄',
          },
        ].map((feature) => (
          <div key={feature.title} className="glass rounded-lg p-6">
            <div className="text-2xl mb-3">{feature.icon}</div>
            <h3 className="text-sm font-medium text-white mb-2">{feature.title}</h3>
            <p className="text-xs text-gray-500">{feature.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
