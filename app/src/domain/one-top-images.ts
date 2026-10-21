import { VISION_MAX_WIDTH,VISION_MAX_BYTES,EXCEL_IMAGE_MAX_WIDTH,EXCEL_IMAGE_MAX_HEIGHT,EXCEL_IMAGE_MAX_BYTES,SUPPLEMENT_EXCEL_IMAGE_MAX_WIDTH,SUPPLEMENT_EXCEL_IMAGE_MAX_HEIGHT,SUPPLEMENT_EXCEL_IMAGE_TARGET_BYTES,SUPPLEMENT_EXCEL_IMAGE_MIN_BYTES } from './one-top-config';
export async function readImageWithoutCrop(file: File) {
    const dataUrl=await fileToDataUrl(file);
    if(/^data:image\/(?:png|jpe?g);/i.test(dataUrl))return dataUrl;
    const img=await fileToImage(file),canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.92);
  }

export async function compressSupplementToHd(file: File) {
    const img=await fileToImage(file),scale=Math.min(1,1600/img.naturalWidth,1200/img.naturalHeight);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
    const context=canvas.getContext('2d')!;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.9);
  }

export function cropSourceToFourThree(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, zoom=1) {
    const ratio = 4 / 3;
    let sx = 0, sy = 0, sw = sourceWidth, sh = sourceHeight;
    if (sourceWidth / sourceHeight > ratio) { sw = sourceHeight * ratio; sx = (sourceWidth - sw) / 2; }
    else { sh = sourceWidth / ratio; sy = (sourceHeight - sh) / 2; }
    zoom=Math.max(1,Math.min(2,Number(zoom)||1));
    const croppedWidth=sw/zoom,croppedHeight=sh/zoom;
    sx+=(sw-croppedWidth)/2;sy+=(sh-croppedHeight)/2;sw=croppedWidth;sh=croppedHeight;
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1200;
    canvas.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .88);
  }

export async function prepareVisionImage(dataUrl: string) {
    const image=await loadVisionImage(dataUrl);
    const scale=Math.min(1,VISION_MAX_WIDTH/image.naturalWidth);
    let width=Math.max(1,Math.round(image.naturalWidth*scale));
    let height=Math.max(1,Math.round(image.naturalHeight*scale));
    let quality=.92,encoded='';
    for(let attempt=0;attempt<12;attempt++){
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('API 전송용 이미지 캔버스를 만들지 못했습니다.');
      context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
      encoded=canvas.toDataURL('image/jpeg',quality);
      if(dataUrlByteLength(encoded)<=VISION_MAX_BYTES)break;
      if(quality>.56)quality-=.08;
      else {width=Math.max(1,Math.round(width*.88));height=Math.max(1,Math.round(height*.88));}
    }
    if(dataUrlByteLength(encoded)>VISION_MAX_BYTES)throw new Error('API 전송용 이미지를 1MB 이하로 압축하지 못했습니다.');
    console.info('[one-top-two-room] API 전송 이미지 준비',{width,height,bytes:dataUrlByteLength(encoded),maxBytes:VISION_MAX_BYTES});
    return encoded;
  }

export async function prepareExcelImage(dataUrl: string) {
    const image=await loadVisionImage(dataUrl);
    let scale=Math.min(1,EXCEL_IMAGE_MAX_WIDTH/image.naturalWidth,EXCEL_IMAGE_MAX_HEIGHT/image.naturalHeight);
    let width=Math.max(1,Math.round(image.naturalWidth*scale));
    let height=Math.max(1,Math.round(image.naturalHeight*scale));
    let quality=.72,encoded='';
    for(let attempt=0;attempt<5;attempt++){
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('Excel 사진 압축용 캔버스를 만들지 못했습니다.');
      context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
      encoded=canvas.toDataURL('image/jpeg',quality);
      if(dataUrlByteLength(encoded)<=EXCEL_IMAGE_MAX_BYTES)break;
      if(quality>.44)quality-=.1;
      else {width=Math.max(1,Math.round(width*.82));height=Math.max(1,Math.round(height*.82));}
    }
    console.info('[one-top-two-room] Excel 삽입 이미지 압축',{width,height,bytes:dataUrlByteLength(encoded)});
    return encoded;
  }

export async function prepareSupplementExcelImage(dataUrl: string) {
    const image=await loadVisionImage(dataUrl);
    let scale=Math.min(1,SUPPLEMENT_EXCEL_IMAGE_MAX_WIDTH/image.naturalWidth,SUPPLEMENT_EXCEL_IMAGE_MAX_HEIGHT/image.naturalHeight);
    let width=Math.max(1,Math.round(image.naturalWidth*scale));
    let height=Math.max(1,Math.round(image.naturalHeight*scale));
    let quality=.92,encoded='';
    for(let attempt=0;attempt<6;attempt++){
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d',{alpha:false});
      if(!context)throw new Error('P열 사진 압축용 캔버스를 만들지 못했습니다.');
      context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(image,0,0,width,height);
      encoded=canvas.toDataURL('image/jpeg',quality);
      const bytes=dataUrlByteLength(encoded);
      if(bytes<=SUPPLEMENT_EXCEL_IMAGE_TARGET_BYTES)break;
      if(quality>.72)quality-=.06;
      else {width=Math.max(1,Math.round(width*.9));height=Math.max(1,Math.round(height*.9));}
    }
    console.info('[one-top-two-room] P열 Excel 사진 압축',{width,height,bytes:dataUrlByteLength(encoded),targetBytes:SUPPLEMENT_EXCEL_IMAGE_TARGET_BYTES,minPreferredBytes:SUPPLEMENT_EXCEL_IMAGE_MIN_BYTES});
    return encoded;
  }

  function loadVisionImage(src: string) {
    return new Promise<HTMLImageElement>((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('API 전송용 이미지를 읽지 못했습니다.'));image.src=src;});
  }

export function dataUrlByteLength(value: string) {
    const base64=String(value||'').split(',')[1]||'';
    return Math.ceil(base64.length*3/4)-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);
  }

  function fileToImage(file: File){return new Promise<HTMLImageElement>((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('이미지를 읽지 못했습니다.'));};img.src=url;});}
  function fileToDataUrl(file: File){return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(new Error('이미지 파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});}
