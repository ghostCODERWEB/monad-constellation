'use client';

import { useEffect, useState } from 'react';
import type { Engine, EngineState } from '../engine';
import type { LogEntry } from '../core/log';
import { TelescopeHUD } from './TelescopeHUD';
import { AgentPanel } from './AgentPanel';
import { ShuttlePanel } from './ShuttlePanel';
import { ResearchPC } from './ResearchPC';
import type { TelescopeHud } from '../modes/telescope';

const KIND_ICON: Record<string, string> = { discovery: '✦', egg: '☺', research: '◈', eva: '⛑', flight: '➤', system: '●' };

export function StationHUD({ engine, state }: { engine: Engine; state: EngineState | null }) {
  const [log, setLog] = useState<LogEntry[]>(() => engine.log.entries);
  const [logOpen, setLogOpen] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => engine.log.subscribe(setLog), [engine]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyL' && !engine.input.suspended) setLogOpen((o) => !o);
      if (e.code === 'KeyH' && !engine.input.suspended) setHelp((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);
  if (!state) return null;
  const walking = state.mode === 'walk';

  return (
    <div className="st-hud">
      {walking && <div className="st-reticle" aria-hidden />}
      {state.prompt && <div className="st-prompt">{state.prompt.replace('Press E', state.pad ? 'Press Y' : 'Press E')}</div>}

      {walking && <div className="st-status">
        <b>{state.zone ?? 'Outside'}</b>
        <span>{state.modeTitle}{walking ? ` · ${state.speed.toFixed(2)} m/s${state.moveMode === 'float' ? ` · assist ${state.assist ? 'on' : 'off'}` : ''}` : ''}</span>
        <span className="st-sun">{state.sunlit > 0.5 ? '☀ orbital day' : '☾ orbital night'}</span>
        {state.gripping && <span className="st-chip">holding rail</span>}
        {state.holding && <span className="st-chip">holding {state.holding}</span>}
        {state.subject && <span className="st-subject">◈ researching {state.subject.label}<button onClick={() => engine.setSubject(null)} aria-label="Clear">✕</button></span>}
      </div>}

      {state.toast && <div className="st-toast">{state.toast}</div>}

      {state.mode === 'telescope' && state.modeHud?.telescope ? (
        <TelescopeHUD engine={engine} hud={state.modeHud.telescope as TelescopeHud} catalogOpen={!!state.modeHud.catalogOpen} />
      ) : null}

      {state.mode === 'agent' && <AgentPanel engine={engine} />}
      {state.mode === 'shuttle' && <ShuttlePanel engine={engine} />}
      {state.mode === 'pc' && <ResearchPC engine={engine} />}

      {walking && (
        <nav className="st-dock" aria-label="Station">
          <div className="st-seg" role="group" aria-label="Movement">
            <span>Movement</span>
            <button className={state.moveMode === 'walk' ? 'on' : ''} onClick={() => engine.setMoveMode('walk')} title="Feet on the floor (M)">Walk</button>
            <button className={state.moveMode === 'float' ? 'on' : ''} onClick={() => engine.setMoveMode('float')} title="Zero gravity (M)">Float</button>
            <kbd>M</kbd>
          </div>
          <div className="st-seg" role="group" aria-label="Camera">
            <span>Camera</span>
            <button className={state.view === 'first' ? 'on' : ''} onClick={() => engine.setView('first')}>First person</button>
            <button className={state.view === 'third' ? 'on' : ''} onClick={() => engine.setView('third')}>Third person</button>
            <kbd>Tab</kbd>
          </div>
          <span className="st-rooms">
            {([['hangar', 'Hangar', '1'], ['research', 'Research room', '2'], ['observation', 'Observatory', '3']] as const).map(([r, label, k]) => (
              <button key={r} onClick={() => (engine as unknown as { travel: (r: string) => void }).travel(r)}>⇢ {label} <kbd>{k}</kbd></button>
            ))}
          </span>
        </nav>
      )}

      {walking && !state.locked && !state.pad && (
        <div className="st-click">{state.dragLook ? 'Drag to look around' : 'Click to look around'} · <kbd>H</kbd> controls</div>
      )}

      {walking && help && (
        <ul className="st-help">
          {state.moveMode === 'walk' ? (
            <>
              <li><kbd>W A S D</kbd> walk · <kbd>Shift</kbd> run · mouse look</li>
              <li><kbd>M</kbd> switch to floating · <kbd>Tab</kbd> first / third person</li>
              <li><kbd>G</kbd> pick up · click throw · <kbd>E</kbd> use</li>
            </>
          ) : (
            <>
              <li><kbd>W A S D</kbd> drift · <kbd>Space</kbd>/<kbd>Ctrl</kbd> up/down</li>
              <li><kbd>Shift</kbd> push off a wall · <kbd>G</kbd> grab rail or object</li>
              <li>click throw · <kbd>X</kbd> brake · <kbd>Q</kbd>/<kbd>R</kbd> roll · <kbd>V</kbd> assist</li>
              <li><kbd>M</kbd> switch to walking · <kbd>Tab</kbd> first / third person</li>
            </>
          )}
          <li><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> autopilot to a room · <kbd>L</kbd> mission log</li>
          <li><kbd>N</kbd> Nansen AI · <kbd>P</kbd> research PC · shuttle controls in the hangar · <kbd>Esc</kbd> back · <kbd>H</kbd> hide</li>
        </ul>
      )}

      {(walking || state.mode === 'telescope') && <aside className={`st-log ${logOpen ? 'open' : ''}`}>
        <button onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen}>
          Mission log <span>{log.length}</span>
        </button>
        {logOpen && (
          <ol>
            {log.slice(0, 40).map((e) => (
              <li key={e.id} className={e.kind}>
                <i>{KIND_ICON[e.kind]}</i>
                <div><b>{e.title}</b><span>{e.text}</span></div>
              </li>
            ))}
          </ol>
        )}
      </aside>}
    </div>
  );
}
