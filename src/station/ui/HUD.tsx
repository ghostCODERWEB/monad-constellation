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
  const [help, setHelp] = useState(true);
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
        <span>{state.modeTitle}{walking ? ` · ${state.speed.toFixed(2)} m/s · assist ${state.assist ? 'on' : 'off'}` : ''}</span>
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
          <button onClick={() => engine.setMode('agent')}><img src="/brand/nansen-mark.gif" alt="" />Nansen AI <kbd>N</kbd></button>
          <button onClick={() => engine.setMode('pc')}>▣ Research PC <kbd>P</kbd></button>
          <button onClick={() => engine.setMode('shuttle')}>➤ Shuttle <kbd>B</kbd></button>
          <button onClick={() => engine.setMode('telescope')}>✦ Telescope</button>
        </nav>
      )}

      {walking && !state.locked && !state.pad && (
        <div className="st-click">{state.dragLook ? 'Drag to look around' : 'Click to look around'} · <kbd>H</kbd> controls</div>
      )}

      {walking && help && (
        <ul className="st-help">
          <li><kbd>W A S D</kbd> drift · <kbd>Space</kbd>/<kbd>Ctrl</kbd> up/down</li>
          <li><kbd>Shift</kbd> push off a wall · <kbd>G</kbd> grab rail or object</li>
          <li>click throw · <kbd>X</kbd> brake · <kbd>Q</kbd>/<kbd>R</kbd> roll</li>
          <li><kbd>V</kbd> stabiliser assist · <kbd>E</kbd> use · <kbd>L</kbd> mission log</li>
          <li><kbd>N</kbd> Nansen AI · <kbd>P</kbd> research PC · <kbd>B</kbd> shuttle</li>
          <li><kbd>Esc</kbd> leaves any mode · <kbd>H</kbd> hide</li>
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
