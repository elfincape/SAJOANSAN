import { useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { KBarProvider, KBarSearch, KBarResults, useKBar, useMatches, useRegisterActions, VisualState } from 'kbar';
import type { Action } from 'kbar';
import { useContextualActions } from '../lib/workspace-actions';

export interface WorkspaceCommand {
  id: string;
  title: string;
  description?: string;
  group: string;
  run: () => void;
}
const options = { disableDocumentLock: true, disableScrollbarManagement: true, animations: { enterMs: 0, exitMs: 0 } };

function RegisteredPalette({ actions, disabled, pending }: { actions: Action[]; disabled: boolean; pending: RefObject<(() => void) | null> }) {
  useRegisterActions(actions, [actions]);
  return <Palette disabled={disabled} pending={pending} />;
}

function Palette({ disabled, pending }: { disabled: boolean; pending: RefObject<(() => void) | null> }) {
  const { query, showing } = useKBar(state => ({ showing: state.visualState !== VisualState.hidden }));
  const { results } = useMatches();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const backdropPointer = useRef(false);
  useEffect(() => { query.disable(disabled); }, [disabled, query]);
  useEffect(() => {
    function protectTask(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'
        && !showing && (disabled || [...document.querySelectorAll('dialog:modal, [aria-modal="true"]')].some(el => el.checkVisibility()))) {
        event.preventDefault();
      }
    }
    window.addEventListener('keydown', protectTask, true);
    return () => window.removeEventListener('keydown', protectTask, true);
  }, [disabled, showing]);
  useEffect(() => {
    if (!showing || !dialog.current) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : trigger.current;
    const element = dialog.current;
    element.showModal();
    return () => {
      element.close();
      const action = pending.current;
      pending.current = null;
      if (action) requestAnimationFrame(action);
      else if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [showing]);
  return <>
    <button ref={trigger} type="button" className="workspace-command-trigger" aria-label="화면 빠른 이동" aria-keyshortcuts="Control+k Meta+k" title="화면 빠른 이동 (Ctrl/⌘ K)" disabled={disabled} onClick={() => query.toggle()}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
      <span>빠른 이동</span><kbd>Ctrl / ⌘ K</kbd>
    </button>
    {showing ? <dialog ref={dialog} className="workspace-command-dialog" aria-label="화면 빠른 이동" onCancel={event => { event.preventDefault(); query.setVisualState(VisualState.hidden); }} onPointerDown={event => { backdropPointer.current = event.target === event.currentTarget; }} onClick={event => { if (backdropPointer.current && event.target === event.currentTarget) query.setVisualState(VisualState.hidden); backdropPointer.current = false; }}>
      <div className="workspace-command-panel">
        <div className="workspace-command-heading"><label htmlFor="workspace-command-search">어떤 업무로 이동할까요?</label><button type="button" aria-label="빠른 이동 닫기" onClick={() => query.setVisualState(VisualState.hidden)}>닫기 <kbd>Esc</kbd></button></div>
        <KBarSearch id="workspace-command-search" defaultPlaceholder="화면 또는 현재 작업 검색…" aria-label="화면 이름이나 업무 검색" className="workspace-command-search" />
        {results.length ? <KBarResults maxHeight={360} items={results} onRender={({ item, active }) => typeof item === 'string'
          ? <div className="workspace-command-group">{item}</div>
          : <div className="workspace-command-result" data-active={active}><span><strong>{item.name}</strong>{item.subtitle ? <small>{item.subtitle}</small> : null}</span><span aria-hidden="true">↵</span></div>} />
          : <p className="workspace-command-empty" role="status">일치하는 화면이 없습니다. 다른 이름으로 검색해 보세요.</p>}
        <p className="workspace-command-help">접근 가능한 화면과 현재 실행할 수 있는 작업입니다.<span><kbd>↑ ↓</kbd> 선택 <kbd>Enter</kbd> 실행</span></p>
      </div>
    </dialog> : null}
  </>;
}

export function WorkspaceCommands({ commands, disabled = false }: { commands: WorkspaceCommand[]; disabled?: boolean }) {
  const contextual = useContextualActions();
  const pending = useRef<(() => void) | null>(null);
  const actions = useMemo<Action[]>(() => [...contextual.map(action => ({ ...action, group: '이 화면의 작업' })), ...commands].map(command => ({
    id: command.id, name: command.title, subtitle: command.description,
    keywords: command.description, section: command.group,
    perform: () => { if (!disabled) pending.current = command.run; },
  })), [commands, contextual, disabled]);
  return <KBarProvider options={options}><RegisteredPalette actions={actions} disabled={disabled} pending={pending} /></KBarProvider>;
}
