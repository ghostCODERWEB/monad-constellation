/** Resolve a route destination without confusing an absent token with index 0. */
export function flightDestination(planets: readonly { address: string }[], address: string | null): number | null {
  if (!address) return null;
  const index = planets.findIndex((p) => p.address.toLowerCase() === address.toLowerCase());
  return index < 0 ? null : index;
}

export function phaseAfterJump(destination: number | null): 'free' | 'approach' {
  return destination == null ? 'free' : 'approach';
}
