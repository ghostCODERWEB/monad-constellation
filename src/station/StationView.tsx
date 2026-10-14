'use client';

import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineState } from './engine';
import { StationHUD } from './ui/HUD';

type Failure = { kind: 'init' | 'lost'; detail: string } | null;

/** Hosts the engine and its React HUD. Features install themselves into the engine. */
export default function StationView({ setup }: { setup?: (e: Engine) => (() => void) | void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let built: Engine | null = null;
    let cleanup: (() => void) | void;
    try {
      built = new Engine(mount.current!);
      cleanup = setup?.(built);
    } catch (err) {
      try { built?.dispose(); } catch { /* half-built */ }
      // No WebGL, or the GPU refused the context: say so instead of loading forever.
      if (mount.current) mount.current.innerHTML = '';
      setFailure({ kind: 'init', detail: (err as Error).message || 'WebGL could not start.' });
      return;
    }
    const e = built;
    const canvas = e.renderer.domElement;
    // A lost GPU context (driver reset, too many reloads) stops rendering; offer a restart.
    const onLost = (ev: Event) => { ev.preventDefault(); setFailure({ kind: 'lost', detail: 'The graphics context was lost (driver reset or the browser reclaimed the GPU).' }); };
    canvas.addEventListener('webglcontextlost', onLost);
    const off = e.on(setState);
    e.start();
    // Development aid: inspect the running engine from the console.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __station?: Engine }).__station = e;
    setEngine(e);
    setFailure(null);
    return () => { canvas.removeEventListener('webglcontextlost', onLost); off(); cleanup?.(); e.dispose(); setEngine(null); };
    // The engine is rebuilt only on an explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <main className="station">
      <div ref={mount} className="st-canvas" />
      {engine && !failure && <StationHUD engine={engine} state={state} />}
      {failure && (
        <div className="st-fail" role="alert">
          <b>{failure.kind === 'init' ? 'The station can’t start its 3D view' : 'The 3D view stopped'}</b>
          <p>{failure.detail}</p>
          <p className="dim">The station needs WebGL 2. Try enabling hardware acceleration, closing other 3D tabs, or another browser.</p>
          <div>
            <button onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            <button onClick={() => window.location.reload()}>Reload page</button>
          </div>
        </div>
      )}
    </main>
  );
}
