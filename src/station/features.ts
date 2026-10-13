// Every station feature installs itself here, in order. Each returns a
// cleanup if it needs one, and none reaches into another's internals.
import type { Engine } from './engine';
import { installLife } from './features/life';

export function installFeatures(e: Engine) {
  const cleanups: (() => void)[] = [];
  const run = (f: (e: Engine) => (() => void) | void) => { const c = f(e); if (c) cleanups.push(c); };
  run(installLife);
  return () => cleanups.forEach((f) => f());
}
