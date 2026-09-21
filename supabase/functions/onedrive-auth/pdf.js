export function fitImage(width,height,pageWidth,pageHeight,margin=18) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Invalid image size');
  const scale=Math.min((pageWidth-2*margin)/width,(pageHeight-2*margin)/height);
  return {x:(pageWidth-width*scale)/2,y:(pageHeight-height*scale)/2,width:width*scale,height:height*scale};
}
export function makePdfBuilder(PDFDocument) {
  return async images=>{
    if(images.length!==8)throw new Error('Eight images required');
    const pdf=await PDFDocument.create();
    pdf.setTitle('Permit documents');pdf.setCreator('SAJO driver document manager');
    for(const bytes of images){
      const image=await pdf.embedJpg(new Uint8Array(bytes));
      const size=image.width>image.height?[841.89,595.28]:[595.28,841.89];
      const page=pdf.addPage(size);
      page.drawImage(image,fitImage(image.width,image.height,...size));
    }
    return pdf.save();
  };
}
