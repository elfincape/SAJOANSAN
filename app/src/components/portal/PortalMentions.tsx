import { createPortal } from 'react-dom';
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type {
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react';
import {
  mentionLabels,
  mentionRecord,
  searchMentions,
} from '../../lib/portal-mentions';
import type { MentionRecord, MentionRow } from '../../lib/portal-mentions';
import { usePortal } from './PortalStore';
import { PortalDialog } from './PortalDialog';
const pattern =
  /@\[([^\]\n]{1,200})\]\((task|incident|survey|routes|drivers|vehicles|companies|delivery_points):([0-9a-f-]{36})\)/gi;
const LabelContext = createContext(''),
  cache = new Map<string, { at: number; rows: MentionRow[] }>();
function token(node: Element) {
  return (
    '@[' +
    node.getAttribute('data-label') +
    '](' +
    node.getAttribute('data-kind') +
    ':' +
    node.getAttribute('data-id') +
    ')'
  );
}
function serialize(parent: Node): string {
  if (
    parent instanceof Element &&
    ['DIV', 'P'].includes(parent.tagName) &&
    parent.childNodes.length === 1 &&
    parent.firstChild?.nodeName === 'BR'
  )
    return '';
  let result = '';
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) result += child.textContent;
    else if (child instanceof Element) {
      if (child.matches('.db-mention')) result += token(child);
      else if (child.tagName === 'BR') result += '\n';
      else {
        if (
          ['DIV', 'P'].includes(child.tagName) &&
          child.previousSibling &&
          !result.endsWith('\n')
        )
          result += '\n';
        result += serialize(child);
      }
    }
  }
  return result;
}
function caretOffset(editor: HTMLElement) {
  const selection = getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode))
    return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return serialize(range.cloneContents()).length;
}
function restoreCaret(editor: HTMLElement, offset: number) {
  const range = document.createRange();
  let remaining = offset,
    found = false;
  function visit(node: Node) {
    for (const child of node.childNodes) {
      if (found) return;
      if (child instanceof Element && child.matches('.db-mention')) {
        const length = token(child).length;
        if (remaining <= length) {
          range.setStartAfter(child);
          found = true;
        } else remaining -= length;
      } else if (child.nodeType === Node.TEXT_NODE) {
        const length = child.textContent?.length ?? 0;
        if (remaining <= length) {
          range.setStart(child, remaining);
          found = true;
        } else remaining -= length;
      } else visit(child);
    }
  }
  visit(editor);
  if (!found) {
    range.selectNodeContents(editor);
    range.collapse(false);
  } else range.collapse(true);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
function MentionInformation({
  kind,
  id,
  title,
  onClose,
}: {
  kind: string;
  id: string;
  title: string;
  onClose: () => void;
}) {
  const { centerName } = usePortal(),
    [record, setRecord] = useState<MentionRecord | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void mentionRecord(kind, id)
      .then((row) => {
        if (active) setRecord(row);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [kind, id]);
  function show(row: Record<string, unknown>) {
    return (
      <>
        <dl>
          {Object.entries({
            title: '업무명',
            name: '이름',
            route_name: '코스명',
            code: '코드',
            plate_number: '차량번호',
            phone: '연락처',
            address: '주소',
            region: '지역',
            status: '상태',
            work_date: '시작일',
            work_end_date: '종료일',
            memo: '메모',
            delivery_method: '납품 방법',
            delivery_location: '납품 위치',
          })
            .filter(([key]) => row[key] != null && row[key] !== '')
            .map(([key, label]) => (
              <Fragment key={key}>
                <dt>{label}</dt>
                <dd>
                  <MentionText>{String(row[key])}</MentionText>
                </dd>
              </Fragment>
            ))}
        </dl>
        {row.inputs &&
        typeof row.inputs === 'object' &&
        'work_note' in row.inputs &&
        row.inputs.work_note ? (
          <p>
            <MentionText>{String(row.inputs.work_note)}</MentionText>
          </p>
        ) : null}
      </>
    );
  }
  return (
    <PortalDialog
      id={'mention-dialog-' + id}
      className="mention-dialog"
      label="멘션 정보"
      onClose={onClose}
    >
      <h2>{title}</h2>
      <button type="button" onClick={onClose}>
        닫기
      </button>
      <div>
        {error ? (
          <p>
            정보를 불러올 수 없습니다. 삭제되었거나 열람 권한이 없을 수
            있습니다.
          </p>
        ) : record ? (
          <>
            {record.row.center_code ? (
              <p>{centerName(String(record.row.center_code))}</p>
            ) : null}
            {show(record.row)}
            {record.relations.map((relation) => (
              <Fragment key={relation.kind}>
                {relation.error ? (
                  <p>
                    {mentionLabels[relation.kind]} 정보를 열람할 수 없습니다.
                  </p>
                ) : (
                  <>
                    <h3>{mentionLabels[relation.kind]}</h3>
                    {relation.rows.map((row, i) => (
                      <Fragment key={i}>{show(row)}</Fragment>
                    ))}
                  </>
                )}
              </Fragment>
            ))}
          </>
        ) : (
          '불러오는 중…'
        )}
      </div>
    </PortalDialog>
  );
}
function MentionChip({
  label,
  kind,
  id,
  inline = false,
}: {
  label: string;
  kind: string;
  id: string;
  inline?: boolean;
}) {
  const [open, setOpen] = useState(false),
    props = {
      className: 'db-mention',
      title: mentionLabels[kind] + ' 정보 보기',
      'data-kind': kind,
      'data-id': id,
      'data-label': label,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setOpen(true);
      },
    };
  return (
    <>
      {inline ? (
        <span
          {...props}
          contentEditable={false}
          role="button"
          aria-disabled="false"
          tabIndex={0}
          onKeyDown={(e) => {
            if (['Enter', ' '].includes(e.key)) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(true);
            }
          }}
        >
          @{label}
        </span>
      ) : (
        <button {...props} type="button">
          @{label}
        </button>
      )}
      {open
        ? createPortal(
            <MentionInformation
              kind={kind}
              id={id}
              title={label}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )
        : null}
    </>
  );
}
function pieces(value: string, inline = false) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    nodes.push(value.slice(last, match.index));
    nodes.push(
      <MentionChip
        key={match.index}
        label={match[1]}
        kind={match[2]}
        id={match[3]}
        inline={inline}
      />,
    );
    last = match.index! + match[0].length;
  }
  nodes.push(value.slice(last));
  return nodes;
}
export function MentionText({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.map(children, (child) =>
        typeof child === 'string' ? pieces(child) : child,
      )}
    </>
  );
}
interface PortalInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'children'
> {
  multiline?: boolean;
  onValue: (value: string) => void;
}
const isTextType = (type?: string) => !type || type === 'text';
export function PortalField({
  children,
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  const text = Children.toArray(children).some(
      (child) =>
        isValidElement<PortalInputProps>(child) &&
        child.type === PortalInput &&
        isTextType(child.props.type),
    ),
    caption = Children.toArray(children)
      .filter((child) => typeof child === 'string' || typeof child === 'number')
      .join('')
      .trim();
  return (
    <LabelContext.Provider value={caption}>
      {text ? (
        <div
          {...(props as HTMLAttributes<HTMLDivElement>)}
          className={(className + ' mention-field').trim()}
        >
          <MentionText>{children}</MentionText>
        </div>
      ) : (
        <label {...props} className={className || undefined}>
          <MentionText>{children}</MentionText>
        </label>
      )}
    </LabelContext.Provider>
  );
}
export function PortalInput({
  multiline = false,
  onValue,
  ...props
}: PortalInputProps) {
  const inputType = props.type;
  if (!multiline && !isTextType(inputType))
    return <input {...props} onChange={(e) => onValue(e.target.value)} />;
  return <MentionEditor {...props} multiline={multiline} onValue={onValue} />;
}
function MentionEditor({
  multiline,
  onValue,
  value = '',
  className = '',
  ...props
}: PortalInputProps) {
  const caption = useContext(LabelContext),
    { centerName } = usePortal(),
    text = String(value),
    [display, setDisplay] = useState(text),
    [epoch, setEpoch] = useState(0),
    [suggestion, setSuggestion] = useState<{
      query: string;
      from: number;
      to: number;
    } | null>(null),
    [choices, setChoices] = useState<MentionRow[]>([]),
    [hint, setHint] = useState('이름을 입력하세요.'),
    [selected, setSelected] = useState(0),
    [position, setPosition] = useState<CSSProperties>({}),
    editor = useRef<HTMLDivElement>(null),
    source = useRef<HTMLInputElement | HTMLTextAreaElement>(null),
    list = useRef<HTMLDivElement>(null),
    lastEmitted = useRef(text),
    caret = useRef<number | null>(null),
    composing = useRef(false),
    generation = useRef(0),
    optionRefs = useRef<(HTMLButtonElement | null)[]>([]),
    readonly = props.disabled || props.readOnly,
    [id] = useState(() => 'mention-editor-' + crypto.randomUUID());
  const selectionState = useRef({ choices, selected });
  selectionState.current = { choices, selected };
  function showRows(rows: MentionRow[]) {
    const previous =
      selectionState.current.choices[selectionState.current.selected];
    setChoices(rows);
    setSelected(
      Math.max(
        0,
        rows.findIndex(
          (row) =>
            previous && row.kind === previous.kind && row.id === previous.id,
        ),
      ),
    );
  }
  useLayoutEffect(() => {
    source.current?.setCustomValidity(
      props.maxLength && text.length > props.maxLength
        ? '최대 ' + props.maxLength + '자까지 입력할 수 있습니다.'
        : '',
    );
  }, [text, props.maxLength]);
  useLayoutEffect(() => {
    if (text !== lastEmitted.current) {
      lastEmitted.current = text;
      setDisplay(text);
      setEpoch((s) => s + 1);
    }
  }, [text]);
  useLayoutEffect(() => {
    if (caret.current !== null && editor.current) {
      editor.current.focus();
      restoreCaret(editor.current, caret.current);
      caret.current = null;
    }
  }, [epoch]);
  function emit(next: string) {
    lastEmitted.current = next;
    onValue(next);
  }
  function hide() {
    generation.current++;
    setSuggestion(null);
    setChoices([]);
    setSelected(0);
    composing.current = false;
  }
  function suggest() {
    const node = editor.current,
      selection = getSelection();
    if (!node || !selection?.rangeCount || !selection.isCollapsed) return;
    const offset = caretOffset(node);
    if (offset === null) return;
    const range = selection.getRangeAt(0);
    if (range.startContainer.parentElement?.closest('.db-mention')) return;
    const before =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.textContent!.slice(0, range.startOffset)
          : serialize(node).slice(0, offset),
      match = before.match(/(?:^|\s)@([^\s@\[\]]{0,100})$/);
    if (!match) {
      if (!composing.current) hide();
      return;
    }
    setSuggestion({
      query: match[1],
      from: offset - match[1].length - 1,
      to: offset,
    });
  }
  useEffect(() => {
    if (!suggestion) return;
    const key = suggestion.query.toLowerCase(),
      current = ++generation.current,
      cached = cache.get(key);
    if (cached && Date.now() - cached.at < 60000) {
      showRows(cached.rows);
      setHint('');
    } else {
      const prefix = [...cache.keys()]
          .filter(
            (v) =>
              v && key.startsWith(v) && Date.now() - cache.get(v)!.at < 60000,
          )
          .sort((a, b) => b.length - a.length)[0],
        matches = prefix
          ? cache
              .get(prefix)!
              .rows.filter((row) => row.title.toLowerCase().includes(key))
          : [];
      if (matches.length) showRows(matches);
      else if (!choices.length)
        setHint(suggestion.query ? '검색 중…' : '이름을 입력하세요.');
    }
    if (!suggestion.query) return;
    const timer = setTimeout(
      () => {
        void searchMentions(suggestion.query)
          .then((rows) => {
            if (current !== generation.current) return;
            cache.set(key, { at: Date.now(), rows });
            if (
              composing.current &&
              !rows.length &&
              selectionState.current.choices.length
            )
              return;
            showRows(rows);
            setHint(rows.length ? '' : '일치하는 항목이 없습니다.');
          })
          .catch(() => {
            if (
              current === generation.current &&
              !selectionState.current.choices.length
            )
              setHint('검색을 불러오지 못했습니다. 다시 입력해 주세요.');
          });
      },
      composing.current ? 120 : 60,
    );
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [suggestion]);
  useLayoutEffect(() => {
    if (!suggestion) return;
    function place() {
      if (!editor.current || !list.current) return;
      const rect = editor.current.getBoundingClientRect(),
        width = Math.min(rect.width, innerWidth - 16),
        height = Math.max(36, Math.min(260, rect.top - 12));
      setPosition({
        width: Math.max(120, width),
        left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
        maxHeight: height,
        top: Math.max(
          4,
          rect.top - Math.min(list.current.scrollHeight, height) - 6,
        ),
      });
    }
    place();
    window.addEventListener('resize', place);
    document.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
    };
  }, [suggestion, choices, hint]);
  useEffect(() => {
    if (!suggestion) return;
    const outside = (e: PointerEvent) => {
      if (
        !editor.current?.contains(e.target as Node) &&
        !list.current?.contains(e.target as Node)
      )
        hide();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [!!suggestion]);
  function choose(row: MentionRow) {
    if (!suggestion || !editor.current) return;
    const current = serialize(editor.current),
      label = row.title.replace(/[\]\n]/g, ''),
      token = '@[' + label + '](' + row.kind + ':' + row.id + ') ',
      next =
        current.slice(0, suggestion.from) +
        token +
        current.slice(suggestion.to);
    caret.current = suggestion.from + token.length;
    emit(next);
    setDisplay(next);
    setEpoch((s) => s + 1);
    hide();
  }
  const shared = {
    ...props,
    value: text,
    className: (className + ' mention-source').trim(),
    tabIndex: -1,
    'aria-hidden': true as const,
    onInvalid: (e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault();
      editor.current?.focus();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      emit(e.target.value),
  };
  return (
    <>
      {multiline ? (
        <textarea
          {...(shared as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          ref={(el) => {
            source.current = el;
          }}
        />
      ) : (
        <input
          {...shared}
          ref={(el) => {
            source.current = el;
          }}
        />
      )}
      {suggestion ? (
        <div
          ref={list}
          className="mention-suggestions"
          role="listbox"
          aria-label="DB 멘션 자동완성"
          style={position}
        >
          {choices.map((row, index) => (
            <button
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              key={row.kind + row.id}
              type="button"
              role="option"
              aria-selected={index === selected}
              data-row-id={row.kind + ':' + row.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(row)}
            >
              {(row.center_code ? centerName(row.center_code) + ' · ' : '') +
                row.title +
                ' · ' +
                mentionLabels[row.kind]}
            </button>
          ))}
          {!choices.length ? <small>{hint}</small> : null}
        </div>
      ) : null}
      <div
        key={epoch}
        ref={editor}
        id={id}
        className={'mention-editor' + (readonly ? ' mention-readonly' : '')}
        role="textbox"
        aria-label={caption || props['aria-label'] || props.name || '내용'}
        aria-multiline={multiline}
        data-multiline={String(multiline)}
        aria-readonly={readonly === true}
        aria-disabled={props.disabled === true}
        contentEditable={!readonly}
        suppressContentEditableWarning
        onInput={() => {
          if (!editor.current) return;
          emit(serialize(editor.current));
          suggest();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          if (editor.current) emit(serialize(editor.current));
          queueMicrotask(suggest);
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand(
            'insertText',
            false,
            e.clipboardData.getData('text/plain'),
          );
        }}
        onKeyDownCapture={(e) => {
          if (
            e.nativeEvent.isComposing ||
            e.keyCode === 229 ||
            composing.current
          )
            return;
          if (suggestion) {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              hide();
              return;
            }
            if (
              choices.length &&
              ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(e.key)
            ) {
              e.preventDefault();
              e.stopPropagation();
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                const index =
                  (selected +
                    (e.key === 'ArrowDown' ? 1 : -1) +
                    choices.length) %
                  choices.length;
                setSelected(index);
                optionRefs.current[index]?.scrollIntoView({ block: 'nearest' });
              } else choose(choices[selected]);
              return;
            }
          }
          if ((e.target as Element).closest('.db-mention')) return;
          if (e.key === 'Enter' && !multiline) {
            e.preventDefault();
            source.current?.form?.requestSubmit();
          }
        }}
      >
        {pieces(display, true)}
      </div>
    </>
  );
}
