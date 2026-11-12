import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { DashboardRow } from '../domain/dashboard';
import { COL_MAP } from '../domain/dashboard';
import { useAdminPage } from './AdminPage';
import {
  cellFields,
  cellScopes,
  defaultCellScope,
  entryFields,
  initialCellDraft,
  readCell,
  writeCell,
  type CellDraft,
  type CellScope,
  type CellSnapshot,
} from '../lib/dashboard-edit';
import { permissionAllowed } from '../lib/permissions';
import '../styles/dashboard-edit.css';

export interface CellSelection {
  row: DashboardRow;
  column: string;
  left: number;
  top: number;
}
interface PendingCell {
  selection: CellSelection;
  snapshot: CellSnapshot;
  draft: CellDraft;
}
export interface CellEditorHandle {
  commit: () => Promise<boolean>;
}
const storageKey = (id: string) => `ean.dashboard.pending-cell.v1:${id}`;
export function pendingCell(id: string): PendingCell | null {
  try {
    const item = JSON.parse(sessionStorage.getItem(storageKey(id)) || 'null');
    return item?.selection &&
      cellFields[item.selection.column] &&
      item.snapshot?.column === item.selection.column &&
      typeof item.draft?.value === 'string'
      ? item
      : null;
  } catch {
    return null;
  }
}
export const DashboardCellEditor = forwardRef<
  CellEditorHandle,
  {
    selection: CellSelection;
    restored?: PendingCell | null;
    close: () => void;
    saved: () => Promise<void>;
    status: (message: string) => void;
  }
>(function DashboardCellEditor(
  { selection, restored, close, saved, status },
  ref,
) {
  const { permissions, profile } = useAdminPage();
  const [scope, setScope] = useState<CellScope>(
    restored?.snapshot.scope ??
      defaultCellScope(selection.row, selection.column),
  );
  const [snapshot, setSnapshot] = useState<CellSnapshot | null>(
    restored?.snapshot ?? null,
  );
  const [draft, setDraft] = useState<CellDraft | null>(restored?.draft ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!restored),
    [saving, setSaving] = useState(false);
  const [compare, setCompare] = useState('');
  const [latestSnapshot, setLatestSnapshot] = useState<CellSnapshot | null>(
    null,
  );
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const mounted = useRef(true),
    locked = useRef(false);
  const spec = cellFields[selection.column];
  const dirty =
    !!snapshot &&
    !!draft &&
    JSON.stringify(draft) !== JSON.stringify(initialCellDraft(snapshot));
  const canWrite =
    !!snapshot &&
    permissionAllowed(
      permissions,
      snapshot.table,
      'edit',
      String(snapshot.source.center_code || 'unclassified'),
    );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (restored && restored.snapshot.scope === scope) {
      setSnapshot(restored.snapshot);
      setDraft(restored.draft);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setSnapshot(null);
    setDraft(null);
    setError('');
    setCompare('');
    readCell(selection.row, selection.column, scope, permissions)
      .then((value) => {
        if (active) {
          setSnapshot(value);
          setDraft(initialCellDraft(value));
        }
      })
      .catch((reason) => {
        if (active) setError(reason.message || String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selection, scope, permissions, restored]);
  useEffect(() => {
    if (!loading) input.current?.focus({ preventScroll: true });
  }, [loading, scope]);
  function retain(next: CellDraft, source = snapshot) {
    setDraft(next);
    setError('');
    if (source) {
      try {
        sessionStorage.setItem(
          storageKey(profile.id),
          JSON.stringify({ selection, snapshot: source, draft: next }),
        );
      } catch {
        status(
          '브라우저가 초안 보관을 허용하지 않습니다. 새로고침 전에 저장하세요.',
        );
      }
    }
  }
  function discard() {
    if (locked.current) return;
    try {
      sessionStorage.removeItem(storageKey(profile.id));
    } catch {
      /* Storage can be unavailable. */
    }
    close();
  }
  async function commit() {
    if (locked.current) return false;
    if (loading || !snapshot || !draft) return false;
    if (!dirty) {
      discard();
      return true;
    }
    if (!canWrite) {
      setError('수정 권한이 없습니다. 입력은 보존됩니다.');
      return false;
    }
    locked.current = true;
    setSaving(true);
    setError('');
    status('저장 중…');
    try {
      await writeCell(snapshot, draft);
      try {
        sessionStorage.removeItem(storageKey(profile.id));
      } catch {
        /* DB success is authoritative. */
      }
      status('저장됨');
      // A list refresh failure is different from a failed save; do not offer a duplicate write.
      try {
        await saved();
      } catch (reason) {
        status(
          `저장됨 · 목록 갱신 실패: ${reason instanceof Error ? reason.message : String(reason)}`,
        );
      }
      close();
      return true;
    } catch (reason) {
      if (mounted.current)
        setError((reason as Error).message || String(reason));
      status('저장 실패 · 입력 보존');
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  useImperativeHandle(ref, () => ({ commit }));
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);
  const label = COL_MAP[selection.column]?.label || selection.column;
  const scopeLabel = (value: CellScope) =>
    value === 'link'
      ? '이 코스의 연결'
      : value === 'common'
        ? '공통 납품처'
        : (spec.condition || spec.stop) && selection.row.route_id
          ? '이 코스만'
          : {
              routes: '코스 기본정보',
              delivery_points: '공통 납품처',
              drivers: '기사 공통정보',
              vehicles: '차량 공통정보',
              companies: '운수사 공통정보',
            }[spec.table];
  const pendingCondition = !!spec.condition && !!snapshot?.stops;
  const editorTop = Math.max(
    80,
    selection.top + 150 < window.innerHeight
      ? selection.top
      : selection.top - 310,
  );
  return (
    <Dialog.Root open modal={false}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          aria-modal={false}
          className="dashboard-cell-editor"
          style={{
            left: Math.max(
              12,
              Math.min(selection.left, window.innerWidth - 332),
            ),
            top: editorTop,
            maxHeight: window.innerHeight - editorTop - 12,
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              if (document.querySelector('.dashboard-cell-editor')) return;
              const origin = [
                ...document.querySelectorAll<HTMLElement>('[data-cell-edit]'),
              ].find(
                (element) =>
                  element.dataset.cellEdit === selection.column &&
                  element.closest<HTMLElement>('[data-stop-id]')?.dataset
                    .stopId === selection.row.stop_id &&
                  element.offsetParent,
              );
              (
                origin ?? document.querySelector<HTMLElement>('#search-input')
              )?.focus({ preventScroll: true });
            });
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            discard();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
            if (!(
              event.target instanceof Element &&
              event.target.closest('[data-cell-edit]')
            ))
              void commit();
          }}
        >
          <div className="dashboard-cell-heading">
            <Dialog.Title>{label}</Dialog.Title>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="셀 편집 취소"
              disabled={saving}
              onClick={discard}
            >
              취소
            </button>
          </div>
          <div className="dashboard-cell-scopes">
            {cellScopes(selection.row, selection.column).map((value) => (
              <button
                type="button"
                key={value}
                className="btn btn-ghost"
                aria-pressed={scope === value}
                disabled={saving || (dirty && scope !== value)}
                onClick={() => {
                  setScope(value);
                  setQuery('');
                }}
              >
                {scopeLabel(value)}
              </button>
            ))}
          </div>
          {loading ? (
            <p role="status">현재값 확인 중…</p>
          ) : snapshot && draft ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void commit();
              }}
            >
              <fieldset disabled={saving || !canWrite}>
                {pendingCondition && (
                  <label>
                    적용 방식
                    <select
                      className="app-input"
                      aria-label="조건 적용 방식"
                      value={draft.mode}
                      onChange={(event) =>
                        retain({
                          ...draft,
                          mode: event.target.value as CellDraft['mode'],
                        })
                      }
                    >
                      <option value="inherit">공통값 사용</option>
                      <option value="set">이 코스에 지정</option>
                      <option value="clear">이 코스에서 비움</option>
                    </select>
                  </label>
                )}
                {scope === 'link' ? (
                  <>
                    <input
                      className="app-input"
                      aria-label="연결 후보 검색"
                      placeholder="후보 검색"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <select
                      ref={(node) => {
                        input.current = node;
                      }}
                      className="app-input"
                      aria-label={`${label} 연결`}
                      value={draft.value}
                      onChange={(event) =>
                        retain({ ...draft, value: event.target.value })
                      }
                    >
                      {snapshot.field !== 'delivery_point_id' && (
                        <option value="">연결 없음</option>
                      )}
                      {snapshot.candidates
                        .filter(
                          (item) =>
                            item.id === draft.value ||
                            item.label
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                        )
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.label}
                          </option>
                        ))}
                    </select>
                  </>
                ) : spec.type === 'conditions' ? (
                  entryFields.map((field, index) => (
                    <label key={field}>
                      {
                        ['1톤 이하', '3.5톤 이하', '5톤 초과', '무인 진입'][
                          index
                        ]
                      }
                      <select
                        className="app-input"
                        aria-label={
                          ['1톤 이하', '3.5톤 이하', '5톤 초과', '무인 진입'][
                            index
                          ]
                        }
                        value={
                          draft.conditions[field] == null
                            ? 'null'
                            : String(draft.conditions[field])
                        }
                        onChange={(event) =>
                          retain({
                            ...draft,
                            conditions: {
                              ...draft.conditions,
                              [field]:
                                event.target.value === 'null'
                                  ? null
                                  : event.target.value === 'true',
                            },
                          })
                        }
                      >
                        <option value="null">미지정</option>
                        <option value="true">허용</option>
                        <option value="false">불가</option>
                      </select>
                    </label>
                  ))
                ) : (
                  <input
                    ref={(node) => {
                      input.current = node;
                    }}
                    className="app-input"
                    aria-label={`${label} 수정값`}
                    name={snapshot.field}
                    autoComplete="off"
                    value={draft.value}
                    disabled={pendingCondition && draft.mode !== 'set'}
                    inputMode={spec.type === 'number' ? 'decimal' : undefined}
                    placeholder={spec.type === 'time' ? '00:00' : undefined}
                    onChange={(event) =>
                      retain({ ...draft, value: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (
                        event.nativeEvent.isComposing &&
                        event.key === 'Enter'
                      )
                        event.preventDefault();
                    }}
                  />
                )}
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!dirty}
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </fieldset>
            </form>
          ) : null}
          {error && (
            <div role="alert" className="dashboard-cell-error">
              <p>{error}</p>
              {snapshot && (
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void readCell(
                      selection.row,
                      selection.column,
                      scope,
                      permissions,
                    )
                      .then((latest) => {
                        setLatestSnapshot(latest);
                        const value = initialCellDraft(latest);
                        setCompare(
                          `${scope === 'link' ? latest.candidates.find((item) => item.id === value.value)?.label || '연결 없음' : value.value || '(빈 값)'}${latest.stops && spec.condition ? ' · ' + { inherit: '공통값 사용', set: '개별 지정', clear: '비움' }[value.mode] : ''}`,
                        );
                      })
                      .catch((reason) =>
                        setError(reason.message || String(reason)),
                      );
                  }}
                >
                  최신값 확인
                </button>
              )}
            </div>
          )}
          {compare && (
            <p className="dashboard-cell-compare">현재 저장값: {compare}</p>
          )}
          {latestSnapshot && draft && (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={saving}
              onClick={() => {
                setSnapshot(latestSnapshot);
                retain(draft, latestSnapshot);
                setLatestSnapshot(null);
                input.current?.focus();
              }}
            >
              내 입력을 유지하고 최신값 기준으로 재검토
            </button>
          )}
          <span className="dashboard-cell-hint">
            Enter · 다른 셀 선택 시 저장 / Esc 취소
          </span>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
