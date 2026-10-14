'use client';

import { useState } from 'react';

import type { Engine } from '../engine';
import type { Telescope, TelescopeHud } from '../modes/telescope';

const KIND_LABEL: Record<string, string> = {
  universe: 'Monad universe', token: 'Monad token world', earth: 'Planet · home', moon: 'Natural satellite', sun: 'Star · G2V', planet: 'Planet', star: 'Star', nebula: 'Emission nebula',
  'dark-nebula': 'Dark nebula', 'open-cluster': 'Open cluster', globular: 'Globular cluster', spiral: 'Spiral galaxy',
  elliptical: 'Elliptical galaxy', interacting: 'Interacting galaxies', group: 'Galaxy group', cluster: 'Galaxy cluster',
  'deep-field': 'Deep field', 'black-hole': 'Black hole', remnant: 'Supernova remnant',
};

// The catalog remembers which category you were browsing between openings.
let lastTab = 'majors';

/** The catalog by category: each Monad universe (its worlds to discover), then the deep sky. */
function Catalog({ hud, slew }: { hud: TelescopeHud; slew: (id: string) => void }) {
  const [tab, setTabRaw] = useState(lastTab);
  const setTab = (t: string) => { lastTab = t; setTabRaw(t); };
  const sky = hud.catalog.filter((c) => c.group === 'sky');
  const skyFound = sky.filter((c) => c.found).length;
  const uni = hud.universes.find((u) => u.id === tab);
  const whole = hud.catalog.find((c) => c.id === `universe-${tab}`);
  const worlds = hud.catalog.filter((c) => c.group === tab && c.kind === 'token').sort((a, b) => b.size - a.size);
  const totalWorlds = hud.universes.reduce((n, u) => n + u.worlds, 0), totalFound = hud.universes.reduce((n, u) => n + u.found, 0);
  return (
    <section className="tel-cat" aria-label="Celestial catalog">
      <header>
        <b>Catalog</b>
        <span>{totalFound}/{totalWorlds} Monad worlds observed · {skyFound}/{sky.length} deep sky · click to slew</span>
      </header>
      <nav className="tel-tabs" aria-label="Categories">
        {hud.universes.map((u) => (
          <button key={u.id} className={tab === u.id ? 'on' : ''} style={{ ['--u' as string]: u.color }} onClick={() => setTab(u.id)}>
            <i />{u.name}<em>{u.state === 'ready' ? `${u.found}/${u.worlds}` : u.state === 'loading' ? '…' : '—'}</em>
          </button>
        ))}
        <button className={tab === 'sky' ? 'on' : ''} style={{ ['--u' as string]: '#c4b5fd' }} onClick={() => setTab('sky')}>
          <i />Deep sky<em>{skyFound}/{sky.length}</em>
        </button>
      </nav>
      {tab === 'sky' ? (
        <ul>
          {sky.map((c) => (
            <li key={c.id}><button onClick={() => slew(c.id)}><i className={c.found ? 'found' : ''} />{c.name}<em>{KIND_LABEL[c.kind] ?? c.kind}</em></button></li>
          ))}
        </ul>
      ) : uni ? (
        <>
          <div className="tel-uni" style={{ ['--u' as string]: uni.color }}>
            <b>{uni.name} universe</b>
            <p>{uni.blurb}</p>
            {uni.state === 'ready' && <div className="tel-prog" aria-label={`${uni.found} of ${uni.worlds} worlds observed`}><span style={{ width: `${uni.worlds ? (uni.found / uni.worlds) * 100 : 0}%` }} /></div>}
            <small>{uni.state === 'loading' ? 'Charting this universe from Nansen…' : uni.state === 'unavailable' ? 'Not reachable right now: its galaxy data could not be loaded.' : `${uni.found} of ${uni.worlds} worlds observed · categories assigned by this app from each token’s Nansen name`}</small>
          </div>
          {uni.state === 'ready' && (
            <ul>
              {whole && <li><button className="whole" onClick={() => slew(whole.id)}><i className={whole.found ? 'found' : ''} />Whole {uni.name} galaxy<em>slew and frame the universe</em></button></li>}
              {worlds.map((c) => (
                <li key={c.id}><button onClick={() => slew(c.id)}><i className={c.found ? 'found' : ''} />{c.name}<em>{c.found ? 'observed' : 'not yet observed'}</em></button></li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </section>
  );
}

export function TelescopeHUD({ engine, hud, catalogOpen }: { engine: Engine; hud: TelescopeHud; catalogOpen: boolean }) {
  const scope = (engine as unknown as { telescope?: Telescope }).telescope;
  const fov = hud.fov < 1 / 60 ? `${(hud.fov * 3600).toFixed(1)}″` : hud.fov < 1 ? `${(hud.fov * 60).toFixed(1)}′` : `${hud.fov.toFixed(1)}°`;
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
            ? <p className="tel-next"><kbd>P</kbd> open its Nansen dossier on the PC · launch from the hangar wall console</p>
            : <p className="tel-next dim">Zoom in and let it autofocus to open its dossier or plan a flight.</p>)}
        </section>
      )}

      {catalogOpen && scope && <Catalog hud={hud} slew={(id) => scope.slewTo(id)} />}

      <ul className="tel-keys">
        <li>mouse or <kbd>W A S D</kbd> aim · wheel or <kbd>+</kbd><kbd>−</kbd> zoom</li>
        <li>autofocus · <kbd>T</kbd> track · <kbd>F</kbd> solar filter · <kbd>C</kbd> catalog</li>
        <li><kbd>E</kbd> or <kbd>Esc</kbd> back to the station</li>
      </ul>
    </div>
  );
}
