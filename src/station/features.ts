// Every station feature installs itself here, in order. Each returns a
// cleanup if it needs one, and none reaches into another's internals.
import type { Engine } from './engine';
import { installTelescope } from './modes/telescope';
import { installHangar } from './features/hangar';
import { installRobot } from './features/robot';
import { installPC } from './features/pc';
import { installTravel } from './features/travel';
import { installAstronaut } from './features/astronaut';
import { installColliders, enableShadows } from './features/colliders';

export function installFeatures(e: Engine) {
  const cleanups: (() => void)[] = [];
  const run = (f: (e: Engine) => (() => void) | void) => { const c = f(e); if (c) cleanups.push(c); };
  run(installTelescope);
  run(installHangar);
  run(installRobot);
  run(installPC);
  run(installTravel);
  run(installAstronaut);
  run(installColliders); // last: it reads the props the others added
  enableShadows(e);
  return () => cleanups.forEach((f) => f());
}
