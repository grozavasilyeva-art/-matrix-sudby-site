const RED=n=>{let x=Number(n);while(x>22)x=String(x).split('').reduce((s,d)=>s+Number(d),0);return x};
function calculate(d,m,y){const day=+d,mon=+m,year=+y;const leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];if(!Number.isInteger(day)||!Number.isInteger(mon)||!Number.isInteger(year)||year<1||year>9999||mon<1||mon>12||day<1||day>days[mon-1])return null;
const A=RED(day),C=mon,E=RED(String(year).split('').reduce((s,x)=>s+Number(x),0)),G=RED(A+C+E),I=RED(A+C+E+G),B=RED(A+C),D=RED(C+E),F=RED(E+G),H=RED(G+A),A2=RED(A+I),E2=RED(E+I),C2=RED(C+I),G2=RED(G+I),F3=RED(G2+E2);
return {A,B,C,D,E,F,G,H,I,A2,A1:RED(A+A2),E2,E1:RED(E+E2),C2,C1:RED(C+C2),G2,G1:RED(G+G2),F3,FL:RED(G2+F3),FR:RED(E2+F3),earth:RED(A+E),sky:RED(C+G),personal:RED(RED(A+E)+RED(C+G)),father:RED(B+F),mother:RED(D+H),social:RED(RED(B+F)+RED(D+H))}}

export { RED as reduceArcana, calculate as calculateMatrix };
