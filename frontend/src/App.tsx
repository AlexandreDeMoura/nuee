import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from './api';

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth()
      .then(setHealth)
      .catch((requestError: unknown) => {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Unknown error';

        setError(message);
      });
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <section className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <h1 className="text-3xl font-bold">React + NestJS</h1>

        <div className="mt-6">
          {!health && !error && (
            <p className="text-slate-400">Checking API…</p>
          )}

          {health && (
            <p className="text-emerald-400">
              API status: {health.status}
            </p>
          )}

          {error && (
            <p className="text-red-400">
              API unavailable: {error}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;