'use client';

import type { Engine } from '../engine';
import type { Telescope, TelescopeHud } from '../modes/telescope';

const KIND_LABEL: Record<string, string> = {
  universe: 'Monad universe', token: 'Monad token world', earth: 'Planet · home', moon: 'Natural satellite', sun: 'Star · G2V', planet: 'Planet', star: 'Star', nebula: 'Emission nebula',
  'dark-nebula': 'Dark nebula', 'open-cluster': 'Open cluster', globular: 'Globular cluster', spiral: 'Spiral galaxy',
  elliptical: 'Elliptical galaxy', interacting: 'Interacting galaxies', group: 'Galaxy group', cluster: 'Galaxy cluster',
  'deep-field': 'Deep field', 'black-hole': 'Black hole', remnant: 'Supernova remnant',
};

export function TelescopeHUD({ engine, hud, catalogOpen }: { engine: Engine; hud: TelescopeHud; catalogOpen: boolean }) {
  const scope = (engine as unknown as { telescope?: Telescope }).telescope;
  const fov = hud.fov < 1 / 60 ? `${(hud.fov * 3600).toFixed(1)}″` : hud.fov < 1 ? `${(hud.fov * 60).toFixed(1)}′` : `${hud.fov.toFixed(1)}°`;
  const found = hud.catalog.filter((c) => c.found).length;
  return (
    <div className="tel">
      <div className="tel-cross" aria-hidden><i /><i /></div>
      <div className="tel-read">
        <div><b>{hud.mag < 10 ? hud.mag.toFixed(1) : Math.round(hud.mag).toLocaleString()}×</b><span>magnification</span></div>
        <div><b>{fov}</b><span>field of view</span></div>
        <div><b>{hud.ra}</b><span>RA</span></div>
        <div><b>{hud.dec}</b><span>Dec</span></div>
        <div className="focus"><span>autofocus</span><em><i style={{ left: `${hud.focus * 100}%` }} /></em></div>
        <div><b className={hud.tracking ? 'on' : ''}>{hud.slewing ? 'SLEWING' : hud.tracking ? 'TRACKING' : 'FREE'}</b><span>mount</span></div>
        <div><b className={hud.filter ? 'on' : ''}>{hud.filter ? 'IN' : 'OUT'}</b><span>solar filter</span></div>
      </div>

      {hud.warning && <div className="tel-warn">⚠ {hud.warning}</div>}
      {!hud.warning && hud.hint && <div className="tel-hint">{hud.hint}</div>}

      {hud.target && (
        <section className="tel-target">
          <span className="eyebrow">{KIND_LABEL[hud.target.kind] ?? hud.target.kind}{hud.target.simulated ? ' · simulated' : ''}</span>
          <b>{hud.target.name}</b>
          <em>{hud.target.distance}</em>
          <ul>{hud.target.facts.map((f) => <li key={f}>{f}</li>)}</ul>
          {hud.target.token && (hud.target.resolved
            ? <p className="tel-next"><kbd>P</kbd> open its Nansen dossier on the PC · <kbd>B</kbd> plan a shuttle flight there</p>
            : <p className="tel-next dim">Zoom in and let it autofocus to open its dossier or plan a flight.</p>)}
        </section>
      )}

      {catalogOpen && scope && (
        <section className="tel-cat" aria-label="Celestial catalog">
          <header>
            <b>Catalog</b>
            <span>{found}/{hud.catalog.length} observed · click to slew</span>
            <span>{hud.tokens === 'loading' ? 'Loading Monad token worlds from Nansen…' : hud.tokens === 'unavailable' ? 'Monad token worlds unavailable: galaxy data not reachable.' : 'Token worlds: the Monad Constellation, from Nansen data.'}</span>
          </header>
          <ul>
            {hud.catalog.map((c) => (
              <li key={c.id}>
                <button onClick={() => scope.slewTo(c.id)}>
                  <i className={c.found ? 'found' : ''} />{c.name}<em>{KIND_LABEL[c.kind] ?? c.kind}</em>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="tel-keys">
        <li>mouse or <kbd>W A S D</kbd> aim · wheel or <kbd>+</kbd><kbd>−</kbd> zoom</li>
        <li>autofocus · <kbd>T</kbd> track · <kbd>F</kbd> solar filter · <kbd>C</kbd> catalog</li>
        <li><kbd>E</kbd> or <kbd>Esc</kbd> back to the station</li>
      </ul>
    </div>
  );
}
