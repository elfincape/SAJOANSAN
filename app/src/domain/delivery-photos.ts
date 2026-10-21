export interface DeliveryPhoto { id?: string; name?: string; type?: string; size?: number; dataUrl: string; createdAt?: string }
export const MAX_DELIVERY_POINT_PHOTOS = 6;
const MAX_DELIVERY_POINT_PHOTO_BYTES = 1024 * 1024;
const DELIVERY_POINT_PHOTO_MAX_WIDTH = 1280;
const DELIVERY_POINT_PHOTO_MAX_HEIGHT = 720;
    export function splitLegacyMemoAndPhotos(memo: string): { memo: string; photos: DeliveryPhoto[] } {
      const raw = String(memo || '');
      const marker = '<!--dp-photos:';
      const markerEnd = '-->';
      const start = raw.indexOf(marker);
      if (start < 0) return { memo: raw, photos: [] };
      const end = raw.indexOf(markerEnd, start);
      if (end < 0) return { memo: raw, photos: [] };
      const encoded = raw.slice(start + marker.length, end).trim();
      const cleanMemo = (raw.slice(0, start) + raw.slice(end + markerEnd.length)).trim();
      try {
        const json = decodeURIComponent(escape(atob(encoded)));
        return { memo: cleanMemo, photos: parseDeliveryPointPhotos(JSON.parse(json)) };
      } catch {
        return { memo: cleanMemo, photos: [] };
      }
    }

    export function stripLegacyPhotoPayload(memo: string) {
      return String(memo || '').replace(/<!--dp-photos:[\s\S]*?-->/g, '').trim();
    }

    export function parseDeliveryPointPhotos(value: unknown): DeliveryPhoto[] {
      if (!value) return [];
      if (Array.isArray(value)) return value.filter(p => p && p.dataUrl).slice(0, MAX_DELIVERY_POINT_PHOTOS);
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed.filter(p => p && p.dataUrl).slice(0, MAX_DELIVERY_POINT_PHOTOS) : [];
        } catch {
          return [];
        }
      }
      return [];
    }


    export function isProbablyImageFile(file: File | null | undefined) {
      if (!file) return false;
      if (file.type?.startsWith('image/')) return true;
      return /\.(jpe?g|png|webp|gif)$/i.test(file.name || '');
    }

    export async function compressDeliveryPointPhoto(file: File): Promise<DeliveryPhoto> {
      if (!isProbablyImageFile(file)) throw new Error('이미지 파일만 업로드할 수 있습니다.');

      const rawDataUrl = await fileToDataUrl(file);
      const rawPhoto = {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || 'delivery-point-photo',
        type: file.type || 'image/jpeg',
        size: file.size || rawDataUrl.length,
        dataUrl: rawDataUrl,
        createdAt: new Date().toISOString()
      };

      // 우선 업로드/미리보기 자체가 항상 되도록 FileReader 결과를 확보한다.
      // 1MB 이하 이미지는 추가 디코딩/캔버스 과정 없이 바로 등록한다.
      if ((file.size || 0) <= MAX_DELIVERY_POINT_PHOTO_BYTES) return rawPhoto;

      // 큰 이미지만 캔버스 압축을 시도하고, 브라우저가 디코딩하지 못하면 원본으로라도 등록한다.
      try {
        const bitmap = await fileToImage(file);
        const ratio = Math.min(1, DELIVERY_POINT_PHOTO_MAX_WIDTH / bitmap.naturalWidth, DELIVERY_POINT_PHOTO_MAX_HEIGHT / bitmap.naturalHeight);
        const width = Math.max(1, Math.round(bitmap.naturalWidth * ratio));
        const height = Math.max(1, Math.round(bitmap.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, 0, 0, width, height);
        for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
          const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
          if (blob.size <= MAX_DELIVERY_POINT_PHOTO_BYTES) {
            return {
              ...rawPhoto,
              name: file.name || 'delivery-point-photo.jpg',
              type: 'image/jpeg',
              size: blob.size,
              dataUrl: await blobToDataUrl(blob)
            };
          }
        }
      } catch (err) {
        console.warn('[delivery-points] 이미지 압축 실패, 원본 data URL로 등록합니다.', err);
      }
      return rawPhoto;
    }

    export function fileToImage(file: File): Promise<HTMLImageElement> {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
        img.src = url;
      });
    }
    export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
      return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
          if (blob) resolve(blob);
          else reject(new Error('브라우저가 이미지를 압축하지 못했습니다.'));
        }, type, quality);
      });
    }
    export function blobToDataUrl(blob: Blob) {
      return fileToDataUrl(blob);
    }
    export function fileToDataUrl(file: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
    }
    export function normalizeTime(str: string) {
      if (!str) return '';
      const s = String(str).trim();
      const m = s.match(/^(\d{1,2})\s*[:.시]\s*(\d{1,2})(?:\s*분)?(?:\s*(AM|PM|오전|오후))?$/i);
      if (!m) return '';
      let h = parseInt(m[1], 10);
      const mn = parseInt(m[2], 10);
      const meridiem = (m[3] || '').toUpperCase();
      if (Number.isNaN(h) || Number.isNaN(mn)) return '';
      if (mn < 0 || mn > 59) return '';
      if (meridiem === 'PM' || meridiem === '오후') {
        if (h >= 1 && h <= 11) h += 12;
      } else if (meridiem === 'AM' || meridiem === '오전') {
        if (h === 12) h = 0;
      }
      if (h < 0 || h > 23) return '';
      return `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
    }

    // 주소에서 시/구 또는 시/군 추출 (간단한 휴리스틱)
    export function extractRegionFromAddress(addr: string) {
      if (!addr) return '';
      const s = addr.trim();

      // 광역시/도 + (시|군|구) 형태를 우선 추출
      // 예: "서울특별시 강남구 ..." → "서울 강남구"
      //     "경기도 성남시 분당구 ..." → "성남시 분당구"
      const tokens = s.split(/\s+/);
      const out = [];
      for (const t of tokens) {
        if (out.length === 0 && /(특별시|광역시|특별자치시|특별자치도|도)$/.test(t)) {
          out.push(t.replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, ''));
          continue;
        }
        if (/(시|군|구)$/.test(t)) {
          out.push(t);
          // 성남시 분당구 같은 2단계까지
          if (out.length >= 3) break;
        } else if (out.length > 0) {
          // 광역 다음 처음 만난 비-시/군/구 토큰은 멈춤
          break;
        }
      }
      return out.join(' ').trim();
    }
