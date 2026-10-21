import type { DeliveryPhoto } from './delivery-photos';
const MAX_DELIVERY_POINT_PHOTO_BYTES = 1024 * 1024,
  DELIVERY_POINT_PHOTO_MAX_WIDTH = 1280,
  DELIVERY_POINT_PHOTO_MAX_HEIGHT = 720;
export async function compressDashboardPhoto(
  file: File,
): Promise<DeliveryPhoto> {
  if (!file || !file.type?.startsWith('image/'))
    throw new Error('이미지 파일만 업로드할 수 있습니다.');
  const img = await fileToImage(file);
  const ratio = Math.min(
    1,
    DELIVERY_POINT_PHOTO_MAX_WIDTH / img.naturalWidth,
    DELIVERY_POINT_PHOTO_MAX_HEIGHT / img.naturalHeight,
  );
  const width = Math.max(1, Math.round(img.naturalWidth * ratio));
  const height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  let blob: Blob | null = null;
  for (const quality of [0.86, 0.78, 0.7, 0.62, 0.54, 0.46]) {
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    if (blob.size <= MAX_DELIVERY_POINT_PHOTO_BYTES) break;
  }
  if (!blob || blob.size > MAX_DELIVERY_POINT_PHOTO_BYTES)
    throw new Error('사진을 1MB 이하로 압축하지 못했습니다.');
  return {
    id:
      crypto.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name || 'delivery-point-photo.jpg',
    type: 'image/jpeg',
    size: blob.size,
    dataUrl: await blobToDataUrl(blob),
    createdAt: new Date().toISOString(),
  };
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
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
function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob!), type, quality),
  );
}
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('압축 이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

// -----------------------------------------------------------------------------
// 모달
// -----------------------------------------------------------------------------
