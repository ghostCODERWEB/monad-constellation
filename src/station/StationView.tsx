'use client';

import { useEffect, useRef, useState } from 'react';
import { Engine, type EngineState } from './engine';
import { StationHUD } from './ui/HUD';

/** Hosts the engine and its React HUD. Features install themselves into the engine. */
export default function StationView({ setup }: { setup?: (e: Engine) => (() => void) | void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [state, setState] = useState<EngineState | null>(null);

  useEffect(() => {
    const e = new Engine(mount.current!);
    const cleanup = setup?.(e);
    const off = e.on(setState);
    e.start();
    // Development aid: inspect the running engine from the console.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __station?: Engine }).__station = e;
    setEngine(e);
    return () => { off(); cleanup?.(); e.dispose(); setEngine(null); };
    // The engine is built once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="station">
      <div ref={mount} className="st-canvas" />
      {engine && <StationHUD engine={engine} state={state} />}
    </main>
  );
}
