import { useEffect, useRef, useState } from 'react';
import { apiManagement } from '../lib/api-management';
import type {
  ApiManagementStatus,
  ApiCompatibilityResult,
} from '../lib/api-management';

const catalogLabels = {
  ready: '모델 목록 조회됨',
  not_configured: '서버 키 미등록',
  access_denied: '목록 조회 권한 확인 필요',
  unavailable: '목록 조회 실패',
};
export function ApiManagement({ editable, stressEnabled = false }: { editable: boolean; stressEnabled?: boolean }) {
  const [stressResults, setStressResults] = useState<Record<string,unknown>[]>([]);
  const [stressProgress, setStressProgress] = useState('');
  const [stressRunning, setStressRunning] = useState(false);
  const [stressChoice, setStressChoice] = useState('');
  const [stressCases, setStressCases] = useState<{id:string;kind:string}[]>([]);
  const stressActive = useRef(false), stressStop = useRef(false);
  const [verification, setVerification] =
    useState<ApiCompatibilityResult | null>(null);
  const [data, setData] = useState<ApiManagementStatus | null>(null);
  const [draft, setDraft] = useState({ provider: '', model: '' });
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  const alive = useRef(false),
    sequence = useRef(0);
  async function load() {
    const request = ++sequence.current;
    setBusy(true);
    setFeedback('');
    setFailed(false);
    try {
      const result = await apiManagement.status();
      if (!alive.current || request !== sequence.current) return;
      setData(result);
      setDraft((current) =>
        current.provider
          ? current
          : { provider: result.default.provider, model: result.default.model },
      );
    } catch {
      if (alive.current && request === sequence.current) {
        setFailed(true);
        setFeedback(
          'API 설정을 불러오지 못했습니다. 기존 선택은 변경되지 않았습니다.',
        );
      }
    } finally {
      if (alive.current && request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      stressStop.current = true;
      sequence.current++;
    };
  }, []);
  const provider = data?.providers.find((item) => item.id === draft.provider);
  const model = provider?.models.find((item) => item.id === draft.model);
  const filtered =
    provider?.models.filter((item) =>
      item.id.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  const canSave =
    editable &&
    !busy &&
    provider?.catalogStatus === 'ready' &&
    model?.available &&
    !!model.capabilities;
  const canVerify = editable && !busy && provider?.catalogStatus === 'ready' && !!model?.available;
  async function save() {
    if (!canSave || !data) return;
    const request = ++sequence.current;
    setBusy(true);
    setFeedback('');
    setFailed(false);
    try {
      const result = await apiManagement.save(
        draft.provider,
        draft.model,
        data.default.revision,
      );
      if (!result.saved) throw Error('NOT_SAVED');
      if (!alive.current || request !== sequence.current) return;
      setData((current) =>
        current ? { ...current, default: result.default } : current,
      );
      setFeedback('기본 모델을 저장했습니다. 다음 분석부터 적용됩니다.');
    } catch (error) {
      if (alive.current && request === sequence.current) {
        setFailed(true);
        setFeedback(
          error instanceof Error && error.message === 'AI_CONFIG_CHANGED'
            ? '다른 관리자가 설정을 변경했습니다. 목록을 갱신한 뒤 다시 선택해 주세요.'
            : '기본 모델을 저장하지 못했습니다. 기존 설정을 유지합니다. 연결과 모델 목록을 확인해 주세요.',
        );
      }
    } finally {
      if (alive.current && request === sequence.current) setBusy(false);
    }
  }
  async function verify(provider = draft.provider, model = draft.model) {
    if (
      provider === 'typesafe'
        ? !editable || busy || !data?.judgment?.keyConfigured
        : !canVerify
    )
      return;
    const request = ++sequence.current;
    setBusy(true);
    setFeedback('');
    setFailed(false);
    setVerification(null);
    try {
      const result = await apiManagement.verify(provider, model);
      if (!alive.current || request !== sequence.current) return;
      setVerification(result);
      setFailed(!result.passed);
    } catch (error) {
      if (alive.current && request === sequence.current) {
        setFailed(true);
        const code = error instanceof Error ? error.message : '';
        setFeedback(code === 'AI_NOT_CONFIGURED'
          ? '서버 API 키가 설정되지 않았습니다. 기본 설정은 변경되지 않았습니다.'
          : code === 'AI_MODEL_UNSUPPORTED'
            ? '이 모델의 요청 프로토콜은 아직 지원하지 않습니다. 기본 설정은 변경되지 않았습니다.'
            : '호환검증을 완료하지 못했습니다. 기본 설정은 변경되지 않았습니다.');
      }
    } finally {
      if (alive.current && request === sequence.current) setBusy(false);
    }
  }
  function recordStress(result:Record<string,unknown>, id:string) {
    setStressResults(prior=>{
      const previous = prior.find(row=>row.caseId===id);
      const {previousResults = [], ...snapshot} = previous ?? {};
      return [...prior.filter(row=>row.caseId!==id),{...result,caseId:id,
        ...(previous ? {previousResults:[...(Array.isArray(previousResults)?previousResults:[]),snapshot]} : {})}];
    });
  }
  async function runStress(only?: string) {
    if (!stressEnabled || !editable || busy || stressActive.current) return;
    stressActive.current = true;
    stressStop.current = false;
    setBusy(true);
    setStressRunning(true);
    if (!only) setStressResults([]);
    setStressProgress('고정 합성 사례를 확인하고 있습니다.');
    try {
      const {cases} = await apiManagement.stressCases();
      if (alive.current) setStressCases(cases);
      if (cases.length !== 20 || new Set(cases.map(item=>item.id)).size !== 20)
        throw Error('STRESS_CATALOGUE_INVALID');
      const selected = only ? cases.filter(item=>item.id===only) : cases;
      if (!selected.length) throw Error('STRESS_CASE_INVALID');
      for (const [index,item] of selected.entries()) {
        if (stressStop.current || !alive.current) break;
        setStressProgress(`${index + 1}/${selected.length} · ${item.id}`);
        try {
          const result = await apiManagement.stressCase(item.id);
          if (alive.current) recordStress(result,item.id);
        } catch {
          // A lost response does not prove that the paid request never ran.
          if (alive.current) recordStress({status:'response_unknown',code:'RESPONSE_NOT_CONFIRMED'},item.id);
          stressStop.current = true;
        }
      }
      if (alive.current) setStressProgress(stressStop.current ? '중지했습니다. 실행된 건의 결과를 다운로드할 수 있습니다.' : '실행이 끝났습니다. 실패와 미검증 항목은 결과에서 확인하세요.');
    } catch {
      if (alive.current) setStressProgress('사례 목록을 확인하지 못해 실행하지 않았습니다.');
    } finally {
      stressActive.current = false;
      if (alive.current) { setBusy(false); setStressRunning(false); }
    }
  }
  function downloadStress() {
    const blob = new Blob([JSON.stringify(stressResults,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'daily-stress-results.json';
    anchor.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return (
    <section aria-label="API 관리" className="api-management">
      <div className="feature-toolbar">
        <h2 className="app-function-title mr-auto">API 관리</h2>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          모델 목록 갱신
        </button>
      </div>
      <p className="feature-help">
        적용 범위: 메일·카톡 일일정리 분석. 새로 시작하는 분석부터 적용하며,
        실패해도 다른 제공자나 유료 모델로 자동 전환하지 않습니다.
      </p>
      {data ? (
        <>
          <p>
            현재 기본:{' '}
            <strong>
              {data.providers.find((item) => item.id === data.default.provider)
                ?.label ?? data.default.provider}{' '}
              · {data.default.model}
            </strong>
          </p>
          <div className="api-provider-grid">
            {data.providers.map((item) => (
              <div className="feature-panel api-provider" key={item.id}>
                <h3>{item.label}</h3>
                <p>{catalogLabels[item.catalogStatus]}</p>
                <p className="feature-help">
                  서버 키: {item.maskedKey || '미등록'} · 실호출 미검증
                </p>
                <small>서버 비밀 설정: {item.secretName}</small>
              </div>
            ))}
          </div>
          <div className="feature-toolbar">
            <label htmlFor="api-provider">
              제공자
              <select
                className="app-input"
                id="api-provider"
                aria-label="제공자"
                value={draft.provider}
                disabled={busy || !editable}
                onChange={(event) => {
                  const next = data.providers.find(
                    (item) => item.id === event.target.value,
                  );
                  setDraft({
                    provider: event.target.value,
                    model:
                      next?.models.find(
                        (item) => item.available && item.capabilities,
                      )?.id ??
                      next?.models[0]?.id ??
                      '',
                  });
                  setSearch('');
                }}
              >
                {data.providers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="api-model-search">
              모델 검색
              <input
                className="app-input"
                id="api-model-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="모델 이름 검색"
              />
            </label>
          </div>
          <label htmlFor="api-model">
            기본 모델
            <select
              className="app-input"
              id="api-model"
              aria-label="기본 모델"
              value={draft.model}
              disabled={
                busy || !editable || provider?.catalogStatus !== 'ready'
              }
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
            >
              {!filtered.some((item) => item.id === draft.model) ? (
                <option value={draft.model}>
                  {draft.model || '모델 선택'}
                </option>
              ) : null}
              {filtered.map((item) => (
                <option
                  key={item.id}
                  value={item.id}
                  disabled={!item.available}
                >
                  {item.id}
                  {!item.available
                    ? ' · 미연결'
                    : !item.capabilities
                      ? item.support === 'unsupported'
                        ? ' · 분석용 미지원'
                        : ' · 호환 미검증'
                      : ' · 실호출 미검증'}
                </option>
              ))}
            </select>
          </label>
          <p className="feature-help">
            조회된 모델 {provider?.models.length ?? 0}개 · 검색 결과{' '}
            {filtered.length}개. 목록에 있어도 모델 접근·과금·실제 응답 성공을
            보장하지 않습니다.
          </p>
          {model?.capabilities ? (
            <p className="feature-help">
              요청 형식:{' '}
              {model.capabilities.protocol === 'anthropic'
                ? 'Anthropic Messages'
                : 'Responses'}{' '}
              · 이미지 입력 요청 ·{' '}
              {model.capabilities.structured === 'json_schema'
                ? 'JSON Schema 요청 + 서버 검증'
                : model.capabilities.structured === 'json_object'
                  ? 'JSON mode + 전체 Schema 서버 검증'
                  : 'JSON 형식 지시 + 서버 검증'}
            </p>
          ) : (
            <p className="feature-help">
              현재 분석 흐름과 호환이 확인되지 않은 모델은 기본값으로 저장할 수
              없습니다.
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={() => void save()}
          >
            기본 모델 저장
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!canVerify}
            onClick={() => void verify()}
          >
            합성 입력으로 호환검증 (유료 요청 최대 3회)
          </button>
          <p className="feature-help">
            검증은 선택한 제공자·모델에 비민감 텍스트, 공개 합성 이미지, JSON
            요청만 전송합니다. 기본값 저장과 별개이며 실패하면 중단합니다.
          </p>
          {verification ? (
            <p role="status">
              {verification.provider} · {verification.model} ·{' '}
              {verification.passed ? '합성 호환검증 통과' : '호환검증 미완료'} ·{' '}
              {verification.checks
                .map(
                  (check) =>
                    `${check.kind}: ${({ passed: '통과', auth: '인증/권한 확인 필요', model_missing: '모델 없음', unsupported: '요청 형식 미지원', transient: '일시 오류', model_mismatch: '반환 모델 불일치', invalid_response: '응답 검증 실패' } as Record<string, string>)[check.status] ?? check.status}${` (HTTP ${check.providerStatus ?? '응답 없음'}${check.diagnosticCode ? ', ' + check.diagnosticCode : ''}${check.responseReason ? ', ' + check.responseReason : ''}${check.retryAfterSeconds != null ? ', 재시도 대기 ' + check.retryAfterSeconds + '초' : ''})`}${check.returnedModel ? ` (반환 ${check.returnedModel}, ${check.stopReason}, 사용량 ${JSON.stringify(check.usage ?? {})}${check.unsupportedProbability !== undefined ? `, 검토 확률 ${check.unsupportedProbability}, 검토 대상 ${check.reviewRequired ? '포함' : '미포함'}` : ''})` : ''}`,
                )
                .join(' / ')}{' '}
              · {verification.checkedAt}
            </p>
          ) : null}
          <p className="feature-help">
            JEV 판단 API · 서버 키{' '}
            {data.judgment
              ? data.judgment.keyConfigured
                ? '설정됨'
                : '미설정'
              : '확인 필요'}{' '}
            ·{' '}
            {verification?.provider === 'typesafe' && verification.passed
              ? '현재 화면에서 연결 확인됨'
              : '실제 검증 미확인'}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || !editable || !data.judgment?.keyConfigured}
            onClick={() => void verify('typesafe', 'jev-1.14.0')}
          >
            판단 API 연결 확인 (유료 요청 1회)
          </button>
          <p className="feature-help">
            고정 합성 문장의 물량·톤수 혼동을 검토 대상으로 잡는지 확인합니다.
            실업무 정확도를 보장하지 않습니다.
          </p>
          <p className="feature-help">
            키는 서버 비밀 저장소에서 등록합니다. 이 화면은 키 값을 받거나
            표시하지 않습니다. 목록 갱신은 유료 추론을 실행하지 않습니다.
          </p>
        </>
      ) : null}
      {stressEnabled ? <details className="feature-panel">
        <summary>일일정리 격리 검증</summary>
        <p className="feature-help">고정 합성 20건을 순서대로 실행합니다. 실제 메일·카톡을 전송하거나 운영 업무·원노트에 저장하지 않습니다. 모델 호출은 과금될 수 있습니다. 화면을 닫으면 다음 건은 실행하지 않습니다.</p>
        <div className="feature-toolbar">
          <button type="button" className="btn btn-ghost" disabled={busy || !editable} onClick={()=>void runStress()}>고정 20건 실행</button>
          {stressRunning ? <button type="button" className="btn btn-ghost" onClick={()=>{stressStop.current=true;setStressProgress('현재 건을 마친 뒤 중지합니다.');}}>현재 건 이후 중지</button> : null}
          <button type="button" className="btn btn-ghost" disabled={!stressResults.length || stressRunning} onClick={downloadStress}>검증 결과 다운로드</button>
        </div>
        <div className="feature-toolbar">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>{void apiManagement.stressCases().then(({cases})=>{if(alive.current){setStressCases(cases);setStressChoice(cases[0]?.id??'');}}).catch(()=>{if(alive.current)setStressProgress('사례 목록을 확인하지 못했습니다.');});}}>검증 사례 조회</button>
          {stressCases.length ? <><label style={{minWidth:0,flex:'1 1 20rem'}}>재시험 사례<select style={{width:'100%',minWidth:0}} className="app-input" value={stressChoice} disabled={busy} onChange={event=>setStressChoice(event.target.value)}><option value="">사례 선택</option>{stressCases.map(item=><option key={item.id} value={item.id}>{item.id}</option>)}</select></label><button type="button" className="btn btn-ghost" disabled={busy || !editable || !stressChoice} onClick={()=>void runStress(stressChoice)}>선택 1건 재시험</button></> : null}
        </div>
        <p role="status" aria-live="polite">{stressProgress}</p>
        {stressResults.length ? <ul>{stressResults.map(result=><li key={String(result.caseId)}>{String(result.caseId)} · {result.automatedChecksPassed === true ? '자동 검사 통과 · 수동 검토 별도' : result.status === 'failed' ? `실패 · ${String(result.code ?? '원인 확인 필요')}` : result.status === 'response_unknown' ? '응답 미확인' : '기대값 불일치·검토 필요'}</li>)}</ul> : null}
      </details> : null}
      <p
        className="api-management-status"
        aria-live="polite"
        role={failed ? 'alert' : 'status'}
      >
        {busy ? '설정을 확인하는 중입니다…' : feedback}
      </p>
    </section>
  );
}
