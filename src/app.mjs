import { ARCS, MONTHS } from './arcana.mjs';
import { calculateMatrix as calculate } from './calculator.mjs';
import { createPreviewPdf } from './pdf-preview.mjs';

'use strict';
const LABELS={A:'День рождения',A1:'Левая внешняя',A2:'Левая внутренняя',I:'Центр матрицы',E2:'Правая внутренняя',E1:'Правая внешняя',E:'Год рождения',C:'Месяц рождения',C1:'Верхняя внешняя',C2:'Верхняя внутренняя',G:'Нижняя точка',G1:'Кармический хвост · средняя',G2:'Кармический хвост · внутренняя',FL:'Линия любви · средняя',F3:'Связь любви и денег',FR:'Денежная линия · средняя',B:'Родовая диагональ · верх слева',D:'Родовая диагональ · верх справа',F:'Родовая диагональ · низ справа',H:'Родовая диагональ · низ слева'};
const DESCRIPTIONS={A:'Исходная личная точка. Символически описывает способ проявлять инициативу и выстраивать отношения с собой.',A1:'Промежуточная точка левой горизонтали. Предлагает исследовать привычный способ взаимодействовать с окружающими.',A2:'Внутренняя точка левой горизонтали. Обращает внимание на личные установки и повторяющиеся реакции.',I:'Центр собирает основные темы матрицы. Рассмотрите аркан как метафору внутренних опор, а не утверждение о характере.',E2:'Правая внутренняя точка связывает практические задачи с денежной линией.',E1:'Промежуточная правая точка посвящена тому, как идеи превращаются в действия.',E:'Правая исходная энергия связана в системе с материальной стороной и практической реализацией.',C:'Верхняя исходная точка символически связывается с интересами и способностями.',C1:'Верхняя внешняя точка линии талантов. Предлагает посмотреть на проявление собственных сильных сторон.',C2:'Верхняя внутренняя точка. Помогает поразмышлять, что хотелось бы развить.',G:'Нижняя исходная точка кармического хвоста. Относится к символическим сюжетам прошлого опыта.',G1:'Средняя точка кармического хвоста. Это метафора повторяющихся тем и привычек.',G2:'Внутренняя точка кармического хвоста. Символизирует возможность посмотреть на сценарий по-новому.',FL:'Средняя точка любовной линии. Служит поводом подумать о близости, доверии и договорённостях.',F3:'Общая связующая точка любовного и денежного каналов. Предлагает исследовать баланс внимания и ресурсов.',FR:'Средняя точка денежного канала. Помогает сформулировать вопросы о работе и материальных решениях.',B:'Угол родового квадрата; элемент семейной символики метода.',D:'Угол родового квадрата; элемент семейной символики метода.',F:'Угол родового квадрата; элемент семейной символики метода.',H:'Угол родового квадрата; элемент семейной символики метода.'};
const QUESTIONS={I:'Какие мои принципы действительно помогают принимать решения?',A1:'Какие ожидания окружающих на меня влияют?',A2:'Какие внутренние установки я готова пересмотреть?',E1:'Какой практический шаг я откладываю?',E2:'Какая опора у меня уже есть?',G1:'Какая ситуация повторяется, и какую роль я играю в ней?',G2:'Что я могу попробовать сделать иначе?',FL:'О чём в отношениях мне важно поговорить прямо?',F3:'Как я распределяю силы между близкими и собственными планами?',FR:'Какие решения о деньгах требуют фактов, а не догадок?'};
const CATEGORY={horizontal:{title:'Личность · слева и справа',keys:['A','A1','A2','I','E2','E1','E']},talents:{title:'Таланты',keys:['C','C1','C2']},tail:{title:'Кармический хвост',keys:['G2','G1','G']},love:{title:'Линия любви',keys:['G2','FL','F3']},money:{title:'Денежная линия',keys:['F3','FR','E2']},family:{title:'Родовые диагонали',keys:['B','D','F','H']},all:{title:'Все позиции',keys:['A','B','C','D','E','F','G','H','I','A1','A2','E1','E2','C1','C2','G1','G2','FL','F3','FR']}};
const POINTS=[['A',45,220],['B',95,95],['C',220,45],['D',345,95],['E',395,220],['F',345,345],['G',220,395],['H',95,345],['I',220,220],['A1',103,220],['A2',165,220],['E2',285,220],['E1',341,220],['C1',220,103],['C2',220,165],['G2',220,282],['G1',220,340],['FL',263,308],['F3',308,307],['FR',332,264]];
let state={d:23,m:8,y:1989,zone:'horizontal',selected:'I',vals:null};
const $=s=>document.querySelector(s);
$('#script-hint').hidden=true;
function fillSelect(id,values,selected){const el=$('#'+id);el.innerHTML=values.map(({v,l})=>`<option value="${v}"${Number(v)===selected?' selected':''}>${l}</option>`).join('')}
fillSelect('day',Array.from({length:31},(_,i)=>({v:i+1,l:String(i+1).padStart(2,'0')})),23);
fillSelect('month',MONTHS.map((m,i)=>({v:i+1,l:m})),8);
fillSelect('year',Array.from({length:127},(_,i)=>({v:2026-i,l:2026-i})),1989);
function formula(key,v){const sums={A:'число дня рождения',C:'число месяца рождения',E:'сумма цифр года',B:`${v.A} + ${v.C}`,D:`${v.C} + ${v.E}`,F:`${v.E} + ${v.G}`,H:`${v.G} + ${v.A}`,G:`${v.A} + ${v.C} + ${v.E}`,I:`${v.A} + ${v.C} + ${v.E} + ${v.G}`,A1:`${v.A} + ${v.A2}`,A2:`${v.A} + ${v.I}`,E1:`${v.E} + ${v.E2}`,E2:`${v.E} + ${v.I}`,C1:`${v.C} + ${v.C2}`,C2:`${v.C} + ${v.I}`,G1:`${v.G} + ${v.G2}`,G2:`${v.G} + ${v.I}`,F3:`${v.G2} + ${v.E2}`,FL:`${v.G2} + ${v.F3}`,FR:`${v.E2} + ${v.F3}`};return `${sums[key]} → ${v[key]} (приведение к 1–22)`}
function renderSVG(){const v=state.vals;const main=new Set('A B C D E F G H I'.split(' '));const highlighted=new Set(CATEGORY[state.zone].keys);const lines=`<polygon points="220,45 395,220 220,395 45,220" fill="none" stroke="#b79c79" stroke-width="1.6"/><polygon points="95,95 345,95 345,345 95,345" fill="none" stroke="#bea588" stroke-width="1.4"/><line x1="45" y1="220" x2="395" y2="220" stroke="#bd9e78"/><line x1="220" y1="45" x2="220" y2="395" stroke="#bd9e78"/><line x1="95" y1="95" x2="345" y2="345" stroke="#b7a994"/><line x1="345" y1="95" x2="95" y2="345" stroke="#b7a994"/><circle cx="220" cy="220" r="128" stroke="#d8c8b3" fill="none" stroke-dasharray="1 7"/><circle cx="220" cy="220" r="188" stroke="#ddcebc" fill="none" stroke-dasharray="1 10"/>`;
const elems=POINTS.map(([key,x,y])=>{const on=state.selected===key,hi=highlighted.has(key),rad=key==='I'?28:main.has(key)?21:17;const fill=on?'#dbc09d':key==='I'?'#e5d2b7':hi?'#f7eddf':'#f7f3ec';const color=on?'#3a281b':hi?'#4b3527':'#a3917c';return `<g class="matrix-node" data-key="${key}" role="button" tabindex="0" aria-label="${LABELS[key]}: аркан ${v[key]}" aria-pressed="${on}" aria-description="Нажмите, чтобы открыть расшифровку"><circle cx="${x}" cy="${y}" r="${rad}" fill="${fill}" stroke="${hi?'#a07c53':'#c6b69f'}" stroke-width="${on?3:1.3}"/><text x="${x}" y="${y+5.7}" text-anchor="middle" font-family="Georgia" font-size="${main.has(key)?19:15}" font-weight="${on?700:400}" fill="${color}" pointer-events="none">${v[key]}</text></g>`}).join('');$('#matrix-svg').innerHTML=lines+elems}
function renderCategories(){const box=$('#categories');box.innerHTML=Object.entries(CATEGORY).map(([id,x])=>`<button class="category-button" type="button" data-zone="${id}" aria-pressed="${state.zone===id}">${x.title}</button>`).join('')}
function renderPositions(){const box=$('#positions');box.innerHTML=CATEGORY[state.zone].keys.map(k=>`<button type="button" class="position-button" data-key="${k}" aria-pressed="${k===state.selected}" title="${LABELS[k]}" aria-label="${LABELS[k]}: ${state.vals[k]}">${state.vals[k]}</button>`).join('')}
function renderCard(){const k=state.selected,v=state.vals,n=v[k],a=ARCS[n],zone=state.zone;$('#position-kicker').textContent=CATEGORY[zone].title;$('#arcana-number').textContent=n;$('#arcana-name').textContent=a.name;$('#arcana-position').textContent=LABELS[k];$('#arcana-description').textContent=DESCRIPTIONS[k]+' '+a.meaning;$('#arcana-resource').textContent=zone==='love'?a.love:zone==='money'?a.money:zone==='talents'?a.talent:a.resource;$('#arcana-shadow').textContent=a.shadow;$('#arcana-question').textContent=QUESTIONS[k]||a.question;$('#arcana-formula').textContent='Расчёт: '+formula(k,v)}
function render(){const v=calculate(state.d,state.m,state.y),err=$('#date-error');if(!v){err.hidden=false;return false}err.hidden=true;state.vals=v;$('#current-date').textContent=`РАСЧЁТ ДЛЯ ${String(state.d).padStart(2,'0')}.${String(state.m).padStart(2,'0')}.${state.y}`;renderSVG();renderCategories();renderPositions();renderCard();renderPrint();return true}
function choose(key){if(!state.vals||!LABELS[key])return;state.selected=key;renderSVG();renderPositions();renderCard()}
function setZone(zone){if(!CATEGORY[zone])return;state.zone=zone;state.selected=CATEGORY[zone].keys[0];renderSVG();renderCategories();renderPositions();renderCard()}
function updateDate(){state.d=Number($('#day').value);state.m=Number($('#month').value);state.y=Number($('#year').value);render()}
$('#birth-form').addEventListener('submit',e=>{e.preventDefault();updateDate();if(state.vals&&$('#date-error').hidden){$('#matrix-svg').scrollIntoView({behavior:'smooth',block:'center'})}});
for(const id of ['day','month','year'])$('#'+id).addEventListener('change',updateDate);
$('#matrix-svg').addEventListener('click',e=>{const node=e.target.closest('[data-key]');if(node)choose(node.dataset.key)});
$('#matrix-svg').addEventListener('keydown',e=>{const node=e.target.closest('[data-key]');if(node&&(e.key==='Enter'||e.key===' ')){e.preventDefault();choose(node.dataset.key)}});
$('#categories').addEventListener('click',e=>{const button=e.target.closest('[data-zone]');if(button)setZone(button.dataset.zone)});
$('#positions').addEventListener('click',e=>{const button=e.target.closest('[data-key]');if(button)choose(button.dataset.key)});
document.querySelectorAll('[data-topic]').forEach(a=>a.addEventListener('click',()=>setZone(a.dataset.topic)));
const menu=$('#main-nav'),menuBtn=$('#menu-button');menuBtn.addEventListener('click',()=>{const open=!menu.classList.contains('open');menu.classList.toggle('open',open);menuBtn.setAttribute('aria-expanded',String(open));menuBtn.setAttribute('aria-label',open?'Закрыть меню':'Открыть меню')});menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{menu.classList.remove('open');menuBtn.setAttribute('aria-expanded','false')}));
function renderPrint(){
 if(!state.vals)return;
 const v=state.vals;
 const date=String(state.d).padStart(2,'0')+'.'+String(state.m).padStart(2,'0')+'.'+state.y;
 const keys=['I','A'];
 $('#print-page').innerHTML=`<p class="kicker">БЕСПЛАТНЫЙ ОБРАЗЕЦ</p><div class="print-title">Матрица судьбы</div><p class="print-small" style="text-align:center">Дата рождения: ${date} · Ознакомительный материал</p><p class="print-small">Этот фрагмент не является полным платным отчётом. Расшифровки символические, без доказанной предсказательной силы.</p><div class="print-chapter"><h2>Личность · фрагмент</h2>${keys.map(k=>{const arc=ARCS[v[k]];return `<p><b>${LABELS[k]} · ${v[k]} ${arc.name}</b><br>${DESCRIPTIONS[k]} ${arc.meaning}<br><i>${formula(k,v)}</i></p>`}).join('')}</div>`;
}
// PDF action attached below
$('#copy-results').addEventListener('click',async()=>{if(!state.vals)return;const t=`Матрица ${state.d}.${state.m}.${state.y}\n`+Object.entries(LABELS).map(([k,name])=>`${name}: ${state.vals[k]}`).join('\n');try{await navigator.clipboard.writeText(t);$('#copy-status').textContent='Числа скопированы в буфер обмена.'}catch(e){$('#copy-status').textContent='Копирование недоступно в этом просмотрщике. Откройте сайт в браузере.'}});

let pdfUrl=null;
function saveRealPdf(){
 const result=$('#pdf-result');if(!state.vals)return;
 const date=String(state.d).padStart(2,'0')+'.'+String(state.m).padStart(2,'0')+'.'+state.y;
 const v=state.vals;
 const blob=createPreviewPdf(date,v,{arcs:ARCS,labels:LABELS,descriptions:DESCRIPTIONS,points:POINTS});
 if(pdfUrl)URL.revokeObjectURL(pdfUrl);
 pdfUrl=URL.createObjectURL(blob);
 const fname=`matrix-demo-${state.y}-${String(state.m).padStart(2,'0')}-${String(state.d).padStart(2,'0')}.pdf`;
 $('#pdf-download').href=pdfUrl;$('#pdf-download').download=fname;
 $('#pdf-open').href=pdfUrl;
 result.hidden=false;
 result.scrollIntoView({behavior:'smooth',block:'center'});
}
function startPdf(){
 const feedback=$('#copy-status');feedback.textContent='Создаём PDF. Обычно это занимает несколько секунд…';
 setTimeout(()=>{try{saveRealPdf();feedback.textContent='PDF сформирован: откройте его по кнопке ниже.'}catch(e){console.error(e);feedback.textContent='Не удалось сформировать PDF. Попробуйте Safari или обновите страницу.'}},30);
}
$('#print-report').addEventListener('click',startPdf);
$('#report-button').addEventListener('click',()=>{startPdf();setTimeout(()=>$('#pdf-result').scrollIntoView({behavior:'smooth',block:'center'}),300)});

const previewBuy = document.getElementById('checkout-preview');
const checkoutDialog = document.getElementById('checkout-dialog');
previewBuy?.addEventListener('click',()=>{if(typeof checkoutDialog?.showModal==='function')checkoutDialog.showModal();else alert('Оплата пока не подключена. Сейчас ничего оплачивать не нужно.')});
document.getElementById('checkout-close')?.addEventListener('click',()=>checkoutDialog.close());
checkoutDialog?.addEventListener('click',e=>{if(e.target===checkoutDialog)checkoutDialog.close()});
render();
