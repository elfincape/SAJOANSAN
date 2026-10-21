import type { Center } from '../lib/center';
import type { StoredTransfer } from '../lib/transfers';
export interface TransferRow { _uid:string; id:string|null;center:string;center_code:string;delivery_date:string;company_id:string|null;route_id:string|null;driver_id:string|null;vehicle_id:string|null;company_name:string;route_name:string;driver_name:string;driver_phone:string;vehicle_plate:string;photos:(string|null)[];memo:string;created_at?:string;updated_at?:string;_dirty:boolean }
export function dbRowToStateRow(x: StoredTransfer, selectedCenter: Center): TransferRow {
  return {
    _uid: makeUid(),
    id: x.id,

    center: x.center || selectedCenter.name,
    center_code: x.center_code || selectedCenter.code,
    delivery_date: x.delivery_date || '',

    company_id: x.company_id,
    route_id: x.route_id,
    driver_id: x.driver_id,
    vehicle_id: x.vehicle_id,

    company_name: x.company_name || '',
    route_name: x.route_name || '',
    driver_name: x.driver_name || '',
    driver_phone: x.driver_phone || '',
    vehicle_plate: x.vehicle_plate || '',

    photos: [
      x.photo1_data_url || null,
      x.photo2_data_url || null,
      x.photo3_data_url || null,
      x.photo4_data_url || null
    ],

    memo: x.memo || '',
    created_at: x.created_at,
    updated_at: x.updated_at,
    _dirty: false
  };
}

export function stateRowToPayload(r: TransferRow, selectedCenter: Center, profile: {id:string}) {
  return {
    center: r.center || selectedCenter.name,
    center_code: selectedCenter.code,
    delivery_date: r.delivery_date,

    company_id: r.company_id,
    route_id: r.route_id,
    driver_id: r.driver_id,
    vehicle_id: r.vehicle_id,

    company_name: r.company_name,
    route_name: r.route_name,
    driver_name: r.driver_name,
    driver_phone: r.driver_phone,
    vehicle_plate: r.vehicle_plate,

    photo1_data_url: r.photos?.[0] || null,
    photo2_data_url: r.photos?.[1] || null,
    photo3_data_url: r.photos?.[2] || null,
    photo4_data_url: r.photos?.[3] || null,

    memo: r.memo || '',
    created_by: profile?.id || null
  };
}

export function formatDateKr(dateStr: string) {
  if (!dateStr) return '';

  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;

  return `${d.getMonth() + 1}월${d.getDate()}일`;
}

export function formatBytes(bytes: number) {
  if (bytes == null || Number.isNaN(bytes)) return '';

  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;

  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

export function makeUid() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `uid_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function compressImageToDataUrl(file: File, maxBytes: number) {
  if (!file.type.startsWith('image/')) {
    throw new Error('이미지 파일만 첨부할 수 있습니다.');
  }

  const img = await fileToImage(file);

  let maxSide = 1600;
  let quality = 0.85;

  for (let attempt = 0; attempt < 12; attempt++) {
    const { width, height } = fitSize(img.width, img.height, maxSide);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if(!ctx)throw new Error('사진 처리 중 오류가 발생했습니다.');
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = dataUrlBytes(dataUrl);

    if (bytes <= maxBytes) return dataUrl;

    if (quality > 0.45) {
      quality -= 0.1;
    } else {
      maxSide = Math.floor(maxSide * 0.85);
    }
  }

  throw new Error('사진을 1MB 이하로 압축하지 못했습니다.');
}

function fileToImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했습니다.'));
    };

    img.src = url;
  });
}

function fitSize(w: number, h: number, maxSide: number) {
  const ratio = Math.min(1, maxSide / Math.max(w, h));
  return {
    width: Math.round(w * ratio),
    height: Math.round(h * ratio)
  };
}

export function dataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || '';
  return Math.ceil(base64.length * 3 / 4);
}

