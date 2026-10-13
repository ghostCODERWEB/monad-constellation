// A world's moons are its biggest real holders: the wallets with the largest
// share of supply (tgm/holders) that call this token home. Contracts and
// pools are not moons.
import type { Galaxy } from './galaxy';

export interface MoonPick { star: number; share: number; name: string }

export function moonsOf(galaxy: Galaxy, planet: number, max = 3): MoonPick[] {
  const out: MoonPick[] = [];
  galaxy.stars.forEach((s, i) => {
    if (s.kind === 'contract' || s.home !== planet) return;
    const l = s.links.find((x) => x.p === planet);
    if (l && l.share >= 0.004) out.push({ star: i, share: l.share, name: s.name });
  });
  return out.sort((a, b) => b.share - a.share).slice(0, max);
}
