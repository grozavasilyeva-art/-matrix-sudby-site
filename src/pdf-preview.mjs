/**
 * Free sample PDF generated entirely in the visitor's browser.
 * The private paid report must never be shipped to client-side code.
 */
export function createPreviewPdf(date, v, { arcs: ARCS, labels: LABELS, descriptions: DESCRIPTIONS, points: POINTS }) {
// Standalone PDF generation. No servers, network requests or external libraries.
// Text is rendered using the device's own Cyrillic-capable fonts and embedded in A4 JPEG pages.
const PDF_PW=960, PDF_PH=1358, PDF_PAD=72;
function pdfCanvas(bg='#faf6ee'){
 const cv=document.createElement('canvas');cv.width=PDF_PW;cv.height=PDF_PH;
 const c=cv.getContext('2d',{alpha:false}); c.fillStyle=bg;c.fillRect(0,0,PDF_PW,PDF_PH);return [cv,c];
}
function pdfText(c,text,x,y,font='23px Arial',color='#33251c'){
 c.font=font;c.fillStyle=color;c.fillText(String(text),x,y);
}
function wrapPdf(c,text,width){
 const words=String(text).split(/\s+/),lines=[];let line='';
 for(const w of words){const next=line?line+' '+w:w;
  if(c.measureText(next).width>width && line){lines.push(line);line=w;}else line=next;
 } if(line)lines.push(line);return lines;
}
function pdfPara(c,text,x,y,maxWidth,opts={}){
 const size=opts.size||22, lh=opts.lineHeight||size*1.5;
 c.font=`${opts.bold?'bold ':''}${size}px Arial`;
 c.fillStyle=opts.color||'#56483e';
 const lines=wrapPdf(c,text,maxWidth);for(const l of lines){c.fillText(l,x,y);y+=lh};return y;
}
function pdfFrame(c,n,label){
 c.strokeStyle='#dcc9b3';c.lineWidth=2;c.strokeRect(35,35,PDF_PW-70,PDF_PH-70);
 pdfText(c,'М А Т Р И Ц А   С У Д Ь Б Ы',PDF_PAD,78,'17px Arial','#8f6e4c');
 c.fillStyle='#ae8962';c.fillRect(PDF_PAD,100,PDF_PW-PDF_PAD*2,2);
 pdfText(c,label,PDF_PAD,PDF_PH-75,'17px Arial','#8f7b65');
 pdfText(c,String(n).padStart(2,'0'),PDF_PW-110,PDF_PH-75,'18px Georgia','#8f7b65');
}
function pdfCover(date,v){
 const [cv,c]=pdfCanvas('#281e18');
 c.strokeStyle='#a88d6c';c.lineWidth=2;
 c.strokeRect(44,44,PDF_PW-88,PDF_PH-88);
 for(const r of [185,260,332]){c.beginPath();c.arc(480,650,r,0,2*Math.PI);c.stroke();}
 c.strokeStyle='#5f5145';c.beginPath();c.moveTo(480,315);c.lineTo(480,975);c.moveTo(155,650);c.lineTo(805,650);c.stroke();
 c.fillStyle='#d8b991';c.beginPath();c.arc(480,650,78,0,2*Math.PI);c.fill();
 c.textAlign='center';pdfText(c,'МАТРИЦА',480,205,'68px Georgia','#fff8ef');pdfText(c,'СУДЬБЫ',480,283,'68px Georgia','#fff8ef');
 pdfText(c,'ПЕРСОНАЛЬНЫЙ АТЛАС СИМВОЛОВ',480,344,'19px Arial','#d5b58b');
 pdfText(c,String(v.I),480,675,'83px Georgia','#291d17');
 pdfText(c,'Дата рождения: '+date,480,1075,'30px Georgia','#f2ddbe');
 c.textAlign='left';pdfPara(c,'Демонстрационный отчёт по системе 22 арканов. Интерпретации символические и не являются научными выводами о личности или будущем.',125,1150,700,{size:18,lineHeight:28,color:'#cab9a4'});
 return cv;
}
function pdfDiagramPage(date,v,n){
 const [cv,c]=pdfCanvas();pdfFrame(c,n,'СХЕМА И КЛЮЧЕВЫЕ ПОЗИЦИИ · '+date);
 pdfText(c,'Ваша матрица',PDF_PAD,192,'62px Georgia','#2b1c15');
 const ox=PDF_PW/2, oy=595,scale=1.17;
 const pos=(x,y)=>[ox+(x-220)*scale,oy+(y-220)*scale];
 const poly=(pts)=>{c.beginPath();pts.forEach(([x,y],i)=>{let [X,Y]=pos(x,y);i?c.lineTo(X,Y):c.moveTo(X,Y)});c.closePath();c.stroke()};
 c.strokeStyle='#c8ab87';c.lineWidth=2;
 poly([[220,45],[395,220],[220,395],[45,220]]);poly([[95,95],[345,95],[345,345],[95,345]]);
 const line=(a,b)=>{const p=pos(...a),q=pos(...b);c.beginPath();c.moveTo(...p);c.lineTo(...q);c.stroke()};
 line([45,220],[395,220]);line([220,45],[220,395]);line([95,95],[345,345]);line([345,95],[95,345]);
 POINTS.forEach(([k,x,y])=>{const [X,Y]=pos(x,y);const r=k==='I'?37:k.length===1?28:21;
 c.beginPath();c.arc(X,Y,r,0,2*Math.PI);c.fillStyle=k==='I'?'#d6b68f':'#faf6ee';c.fill();c.strokeStyle='#a9865d';c.stroke();
 c.textAlign='center';pdfText(c,String(v[k]),X,Y+9,(k==='I'?29:22)+'px Georgia',k==='I'?'#2d1f16':'#483324');c.textAlign='left';});
 pdfText(c,'Основные числовые темы',PDF_PAD,925,'34px Georgia','#2f2118');
 let y=981;const groups=[['Центр',v.I],['Личность',`${v.A} · ${v.A1} · ${v.A2}`],['Таланты',`${v.C} · ${v.C1} · ${v.C2}`],['Кармический хвост',`${v.G2} · ${v.G1} · ${v.G}`],['Любовь',`${v.G2} · ${v.FL} · ${v.F3}`],['Деньги',`${v.F3} · ${v.FR} · ${v.E2}`]];
 groups.forEach(([l,val],i)=>{pdfText(c,l,PDF_PAD,y+i*46,'23px Arial','#6b5946');pdfText(c,String(val),500,y+i*46,'24px Georgia','#302117')});
 return cv;
}
function pdfChapterPages(title,keys,date,v,startNumber){
 let canvas,c,y,pageIndex=0;const result=[];
 function next(){[canvas,c]=pdfCanvas();pageIndex++;pdfFrame(c,startNumber+result.length,date);
  pdfText(c,title,PDF_PAD,188,'54px Georgia','#2c2017');
  pdfText(c,pageIndex===1?'Символическое прочтение позиций':'Продолжение',PDF_PAD,238,'18px Arial','#977e65');y=292;result.push(canvas)}
 next();
 for(const k of keys){const arc=ARCS[v[k]];
  const paragraphs=[DESCRIPTIONS[k]+' '+arc.meaning,'Ресурс: '+(arc.resource||arc.meaning),'Вопрос: '+(QUESTIONS[k]||arc.question||'Что для меня означает этот символ?')];
  c.font='22px Arial';const height=93+paragraphs.reduce((sum,p)=>sum+wrapPdf(c,p,PDF_PW-PDF_PAD*2-22).length*34+14,0)+35;
  if(y+height>PDF_PH-150)next();
  c.strokeStyle='#d6bfa0';c.beginPath();c.moveTo(PDF_PAD,y+18);c.lineTo(PDF_W()-PDF_PAD,y+18);c.stroke();
  y+=60;pdfText(c,`${LABELS[k]}  ·  ${v[k]}  ${arc.name}`,PDF_PAD,y,'bold 27px Georgia','#3c2a20');y+=40;
  for(const paragraph of paragraphs){y=pdfPara(c,paragraph,PDF_PAD+9,y,PDF_PW-PDF_PAD*2-22,{size:22,lineHeight:34});y+=15;}y+=25;
 }
 return result;
}
function PDF_W(){return PDF_PW}
function packPdf(canvases){
 const all=[];let length=0;const offsets=[];
 function bytes(str){return new TextEncoder().encode(str)}
 function push(b){all.push(b);length+=b.byteLength}
 function txt(str){push(bytes(str))}
 function begin(n){offsets[n]=length;txt(`${n} 0 obj\n`)}
 function end(){txt('endobj\n')}
 const total=2+canvases.length*3;
 txt('%PDF-1.4\n%\xC2\xA5\xC2\xA5\n');
 begin(1);txt('<< /Type /Catalog /Pages 2 0 R >>\n');end();
 begin(2);txt(`<< /Type /Pages /Count ${canvases.length} /Kids [${canvases.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>\n`);end();
 canvases.forEach((cv,i)=>{
  const page=3+i*3,content=page+1,img=page+2;
  begin(page);txt(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>\n`);end();
  const commands='q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n';
  begin(content);txt(`<< /Length ${bytes(commands).length} >>\nstream\n${commands}endstream\n`);end();
  const data=cv.toDataURL('image/jpeg',.84).split(',')[1],raw=atob(data),jpg=new Uint8Array(raw.length);
  for(let j=0;j<raw.length;j++)jpg[j]=raw.charCodeAt(j);
  begin(img);txt(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);push(jpg);txt('\nendstream\n');end();
 });
 const xref=length;txt(`xref\n0 ${total+1}\n0000000000 65535 f \n`);
 for(let i=1;i<=total;i++)txt(`${String(offsets[i]).padStart(10,'0')} 00000 n \n`);
 txt(`trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
 return new Blob(all,{type:'application/pdf'});
}

 const canvases=[pdfCover(date,v),pdfDiagramPage(date,v,2)];
 canvases.push(pdfChapterPages('Личность · фрагмент',['I','A'],date,v,3)[0]);
 canvases.forEach(cv=>{
   const ctx=cv.getContext('2d');
   ctx.save();ctx.translate(cv.width/2,cv.height/2);ctx.rotate(-Math.PI/6);
   ctx.textAlign='center';ctx.fillStyle='rgba(112,82,55,.11)';ctx.font='bold 76px Arial';
   ctx.fillText('БЕСПЛАТНЫЙ ОБРАЗЕЦ',0,0);ctx.restore();
 });
 return packPdf(canvases);
}
