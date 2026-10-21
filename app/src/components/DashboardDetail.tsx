import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { FileArea } from './FileArea';
import { useAdminPage } from './AdminPage';
import { dashboardDetail, saveDashboardDetail } from '../lib/dashboard';
import { withCenterParam } from '../lib/center';
import { formatPhone } from '../domain/phone';
import type { DashboardRow } from '../domain/dashboard';
import {
  parseDeliveryPointPhotos,
  MAX_DELIVERY_POINT_PHOTOS,
} from '../domain/delivery-photos';
import type { DeliveryPhoto } from '../domain/delivery-photos';
import { compressDashboardPhoto } from '../domain/dashboard-photos';
const labels = {
  name: '납품처명',
  code: '코드',
  region: '지역',
  contact: '연락처',
  address: '주소',
  delivery_method: '납품방식',
  access_method: '진입방식',
  delivery_location: '납품장소',
  security_key_location: '열쇠보관장소',
  security_password: '비밀번호',
  memo: '비고',
};
type DetailKey = keyof typeof labels;
type Fields = Record<DetailKey, string>;
export function DashboardDetail({
  row: r,
  onClose,
  onSaved,
  toast,
}: {
  row: DashboardRow;
  onClose: () => void;
  onSaved: (id: string, payload: Record<string, unknown>) => void;
  toast: (text: string, type?: 'info' | 'warn' | 'error' | 'success') => void;
}) {
  const { center } = useAdminPage(),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [photos, setPhotos] = useState<DeliveryPhoto[]>([]),
    [large, setLarge] = useState(''),
    file = useRef<HTMLInputElement>(null),
    saving = useRef(false);
  const [fields, setFields] = useState<Fields>(() => ({
    name: r.dp_name || '',
    code: r.dp_code || '',
    region: r.dp_region || '',
    contact: r.dp_contact || '',
    address: r.dp_address || '',
    delivery_method: r.base_delivery_method ?? r.delivery_method ?? '',
    access_method: r.base_access_method ?? r.access_method ?? '',
    delivery_location: r.base_delivery_location ?? r.delivery_location ?? '',
    security_key_location: r.security_key_location || '',
    security_password: r.security_password || '',
    memo: r.dp_memo || '',
  }));
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => {
    if (!r.delivery_point_id) return;
    let active = true;
    void dashboardDetail(center, r.delivery_point_id).then(
      ({ data, error }) => {
        if (!active) return;
        if (error) {
          toast('납품처 정보 불러오기 실패: ' + error.message, 'warn');
          setPhotos([]);
          return;
        }
        const values = Object.fromEntries(
          Object.keys(labels).map((key) => [
            key,
            String(data?.[key as keyof typeof data] ?? ''),
          ]),
        ) as Fields;
        setFields(values);
        const photos = parseDeliveryPointPhotos(data?.photos);
        setPhotos(photos);
        setLarge(photos[0]?.dataUrl || '');
        setLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [r.delivery_point_id, center.code]);
  async function addPhotos(files: File[]) {
    if (!loaded) {
      toast('납품처 정보를 불러온 뒤 사진을 추가할 수 있습니다.', 'warn');
      return;
    }
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    if (photosRef.current.length + images.length > MAX_DELIVERY_POINT_PHOTOS) {
      toast(
        `사진은 최대 ${MAX_DELIVERY_POINT_PHOTOS}장까지 저장할 수 있습니다.`,
        'warn',
      );
      return;
    }
    const next = [...photosRef.current];
    try {
      for (const image of images)
        next.push(await compressDashboardPhoto(image));
      setPhotos(next);
      setLarge((old) =>
        next.some((p) => p.dataUrl === old) ? old : next[0]?.dataUrl || '',
      );
    } catch (error) {
      photosRef.current = next;
      toast(
        error instanceof Error ? error.message : '사진 처리에 실패했습니다.',
        'error',
      );
    } finally {
      if (file.current) file.current.value = '';
    }
  }
  async function save() {
    if (!r.delivery_point_id || !loaded || saving.current) return;
    const payload: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          value.trim() || null,
        ]),
      ),
      photos: photosRef.current,
    };
    if (!payload.name) {
      toast('납품처명을 입력해 주세요.', 'warn');
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const { error } = await saveDashboardDetail(
        center,
        r.delivery_point_id,
        payload,
      );
      if (error) {
        toast('납품처 저장 실패: ' + error.message, 'error');
        return;
      }
      onSaved(r.delivery_point_id, payload);
      toast('납품처 정보가 저장되었습니다.', 'success');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function identity(
    name: string | null | undefined,
    phone: string | null | undefined,
  ) {
    return (
      <>
        {name || '-'}
        {phone ? (
          <span className="whitespace-nowrap"> {formatPhone(phone)}</span>
        ) : null}
      </>
    );
  }
  function field(key: DetailKey) {
    const id =
      key === 'security_key_location'
        ? 'security-key'
        : key === 'security_password'
          ? 'security-password'
          : key.replaceAll('_', '-');
    return (
      <label
        key={key}
        className={key === 'address' ? 'md:col-span-2' : undefined}
      >
        <span className="muted">{labels[key]}</span>
        <input
          id={'detail-' + id}
          className="app-input mt-1"
          inputMode={key === 'contact' ? 'tel' : undefined}
          value={fields[key]}
          onChange={(e) => setFields((s) => ({ ...s, [key]: e.target.value }))}
        />
      </label>
    );
  }
  return (
    <Modal width="5xl" onClose={onClose}>
      <div
        className="p-5 max-h-[85vh] overflow-auto"
        onPaste={(event) => {
          const files = [...(event.clipboardData.items || [])]
            .filter((item) => item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((file): file is File => !!file);
          if (files.length) {
            event.preventDefault();
            void addPhotos(files);
          }
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold">
              {r.dp_name || '(납품처 미지정)'}
            </h2>
            <div className="text-xs text-zinc-400 mt-0.5">
              {r.dp_code || ''} · {r.dp_region || ''}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {r.route_id ? (
              <a
                href={withCenterParam(
                  '/admin/route-edit.html?id=' + encodeURIComponent(r.route_id),
                  center,
                )}
                className="btn btn-ghost text-xs"
              >
                코스 수정
              </a>
            ) : null}
            <button
              id="detail-save"
              className="btn btn-primary text-xs"
              disabled={!loaded || busy}
              onClick={() => void save()}
            >
              {busy ? '저장 중...' : '납품처 저장'}
            </button>
            <button
              id="detail-close"
              className="btn btn-ghost text-xs"
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 text-sm">
          <div className="space-y-4">
            <section className="rounded-lg border border-zinc-700 bg-zinc-950/30 p-3">
              <h3 className="text-sm font-semibold mb-2">코스 정보</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {[
                  ['코스명', r.route_name || '-'],
                  ['호차', r.car_number || '-'],
                  ['운수사', r.company_name || '-'],
                  [
                    '주기사',
                    identity(r.primary_driver_name, r.primary_driver_phone),
                  ],
                  [
                    '보조기사',
                    identity(r.secondary_driver_name, r.secondary_driver_phone),
                  ],
                  ['차량번호', r.primary_vehicle_plate || '-'],
                ].map(([label, value], i) => (
                  <div key={i}>
                    <dt className="muted">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="rounded-lg border border-zinc-700 bg-zinc-950/30 p-3">
              <h3 className="text-sm font-semibold mb-2">납품처 정보</h3>
              <dl className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {(
                  ['name', 'code', 'region', 'contact', 'address'] as const
                ).map(field)}
                <div>
                  <dt className="muted">연락 담당자</dt>
                  <dd>{r.dp_contact_name || '-'}</dd>
                </div>
                {(
                  [
                    'delivery_method',
                    'access_method',
                    'delivery_location',
                    'security_key_location',
                    'security_password',
                  ] as const
                ).map(field)}
              </dl>
            </section>
          </div>
          <FileArea
            as="aside"
            className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-950/30 p-3"
            accept="image/*"
            multiple
            disabled={!loaded}
            onFiles={(files) => void addPhotos(files)}
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-semibold">납품처 사진</h4>
              <div className="flex items-center gap-2">
                <span
                  id="detail-photo-count"
                  className="text-[11px] text-zinc-500"
                >
                  {photos.length}/6
                </span>
                <label className="btn btn-ghost text-xs cursor-pointer">
                  사진 추가
                  <input
                    ref={file}
                    id="detail-photo-input"
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={!loaded}
                    onChange={(e) =>
                      void addPhotos([...(e.target.files || [])])
                    }
                  />
                </label>
              </div>
            </div>
            <div id="detail-photo-grid" className="grid grid-cols-3 gap-2">
              {photos.length ? (
                photos.map((photo, index) => (
                  <div
                    key={photo.id || index}
                    className="relative h-20 overflow-hidden rounded border border-zinc-700 bg-zinc-900"
                  >
                    <button
                      type="button"
                      data-detail-photo-view={index}
                      className="h-full w-full"
                      onClick={() => setLarge(photo.dataUrl)}
                    >
                      <img
                        src={photo.dataUrl}
                        alt={`납품처 사진 ${index + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      data-detail-photo-remove={index}
                      className="absolute right-1 top-1 h-6 w-6 rounded bg-red-700/90 text-xs"
                      aria-label="사진 삭제"
                      onClick={() => {
                        const next = photosRef.current.filter(
                          (_, i) => i !== index,
                        );
                        setPhotos(next);
                        setLarge(next[0]?.dataUrl || '');
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="col-span-3 rounded border border-zinc-700 bg-zinc-900/40 px-3 py-4 text-center text-xs text-zinc-500">
                  등록된 사진이 없습니다.
                </div>
              )}
            </div>
            <div
              id="detail-photo-large-wrap"
              className={`${photos.length ? '' : 'hidden '}rounded-lg border border-zinc-700 bg-black p-2`}
            >
              <img
                id="detail-photo-large"
                src={large || undefined}
                alt="선택한 납품처 사진"
                className="max-h-[360px] w-full rounded object-contain"
              />
            </div>
            <div>
              <div className="muted mb-1">비고</div>
              <textarea
                id="detail-memo"
                rows={5}
                className="app-textarea"
                value={fields.memo}
                onChange={(e) =>
                  setFields((s) => ({ ...s, memo: e.target.value }))
                }
              />
            </div>
          </FileArea>
        </div>
      </div>
    </Modal>
  );
}
