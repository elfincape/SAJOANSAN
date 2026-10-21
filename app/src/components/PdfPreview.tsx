import { useEffect,useRef,useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPdfPage,canvasBlob } from '../lib/pdf-tools';
export function PdfPreview({pdf,pageNumber,width,rotation=0,className=''}:{pdf:PDFDocumentProxy;pageNumber:number;width:number;rotation?:number;className?:string}){
 const [view,setView]=useState({url:'',status:'페이지 불러오는 중…'}),sequence=useRef(0);
 useEffect(()=>{const token=++sequence.current;let url='';setView({url:'',status:'페이지 불러오는 중…'});void(async()=>{const canvas=await renderPdfPage(pdf,pageNumber,width,rotation);try{const blob=await canvasBlob(canvas,'image/png');if(token!==sequence.current)return;url=URL.createObjectURL(blob);setView({url,status:''});}finally{canvas.width=canvas.height=0;}})().catch(error=>{if(token===sequence.current)setView({url:'',status:error instanceof Error?error.message:String(error)});});return()=>{sequence.current++;if(url)URL.revokeObjectURL(url);};},[pdf,pageNumber,width,rotation]);
 return view.url?<img src={view.url} alt={`${pageNumber}페이지`} className={className} style={className ? undefined : {maxWidth:'none'}}/>:<>{view.status}</>;
}
