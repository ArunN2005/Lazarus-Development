'use client';

import { useState } from 'react';
import { EnvVar } from '@/lib/api';

interface EnvVarsFormProps {
  envVars: EnvVar[];
  onSubmit: (values: Record<string, string>) => void;
  submitting?: boolean;
}

const CLASSIFICATION_STYLES: Record<string, { badge: string; icon: string }> = {
  SECRET: { badge: 'bg-red-500/20 text-red-400', icon: '🔐' },
  BUILD: { badge: 'bg-yellow-500/20 text-yellow-400', icon: '⚙️' },
  PUBLIC: { badge: 'bg-green-500/20 text-green-400', icon: '🌍' },
};

export default function EnvVarsForm({ envVars, onSubmit, submitting }: EnvVarsFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    envVars.forEach((v) => {
      initial[v.name] = v.value || '';
    });
    return initial;
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const grouped = {
    SECRET: envVars.filter((v) => v.classification === 'SECRET'),
    BUILD: envVars.filter((v) => v.classification === 'BUILD'),
    PUBLIC: envVars.filter((v) => v.classification === 'PUBLIC'),
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Only submit non-empty values
    const filtered = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim().length > 0)
    );
    onSubmit(filtered);
  };

  const filledCount = Object.values(values).filter((v) => v.trim().length > 0).length;
  const secretCount = grouped.SECRET.length;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Info banner */}
      <div className="glass rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl">🔑</span>
          <div>
            <h3 className="text-sm font-medium text-gray-200">Environment Variables</h3>
            <p className="text-xs text-gray-500 mt-1">
              {envVars.length} variables detected. {secretCount} are secrets that will be
              stored securely in AWS Secrets Manager. Provide values to include them in the deployment.
            </p>
          </div>
        </div>
      </div>

      {/* Groups */}
      {(['SECRET', 'BUILD', 'PUBLIC'] as const).map((classification) => {
        const vars = grouped[classification];
        if (vars.length === 0) return null;
        const style = CLASSIFICATION_STYLES[classification];

        return (
          <div key={classification} className="space-y-3">
            <div className="flex items-center gap-2">
              <span>{style.icon}</span>
              <h4 className="text-sm font-medium text-gray-300">{classification}</h4>
              <span className={`px-1.5 py-0.5 rounded text-xs ${style.badge}`}>
                {vars.length}
              </span>
            </div>

            <div className="space-y-2">
              {vars.map((envVar) => (
                <div key={envVar.name} className="glass rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm text-gray-300 font-mono">{envVar.name}</label>
                    {classification === 'SECRET' && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowSecrets((prev) => ({
                            ...prev,
                            [envVar.name]: !prev[envVar.name],
                          }))
                        }
                        className="text-xs text-gray-500 hover:text-gray-300"
                      >
                        {showSecrets[envVar.name] ? 'Hide' : 'Show'}
                      </button>
                    )}
                  </div>
                  {envVar.description && (
                    <p className="text-xs text-gray-600 mb-1.5">{envVar.description}</p>
                  )}
                  <input
                    type={classification === 'SECRET' && !showSecrets[envVar.name] ? 'password' : 'text'}
                    value={values[envVar.name] || ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [envVar.name]: e.target.value }))
                    }
                    placeholder={`Enter ${envVar.name}`}
                    className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm
                      text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500
                      font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Submit */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-xs text-gray-500">
          {filledCount}/{envVars.length} provided
        </span>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium
            hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving...' : 'Save & Continue'}
        </button>
      </div>
    </form>
  );
}
