// Every station feature installs itself here, in order. Each returns a
// cleanup if it needs one, and none reaches into another's internals.
import type { Engine } from './engine';
import { installLife } from './features/life';
import { installTelescope } from './modes/telescope';
import { installHangar } from './features/hangar';
import { installRobot } from './features/robot';
import { installPC } from './features/pc';

export function installFeatures(e: Engine) {
  const cleanups: (() => void)[] = [];
  const run = (f: (e: Engine) => (() => void) | void) => { const c = f(e); if (c) cleanups.push(c); };
  run(installLife);
  run(installTelescope);
  run(installHangar);
  run(installRobot);
  run(installPC);
  return () => cleanups.forEach((f) => f());
}
