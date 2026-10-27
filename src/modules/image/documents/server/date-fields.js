// Calendar validation of explicitly typed displayed fields, never a legal-validity decision.
const formats = {
  'YYYY.MM.DD': { pattern:/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/, order:[1,2,3] },
  'YYYY年MM月DD日': { pattern:/^(\d{4})年(\d{1,2})月(\d{1,2})日$/, order:[1,2,3] },
  'YYYY-MM-DD': { pattern:/^(\d{4})-(\d{2})-(\d{2})$/, order:[1,2,3] },
  'YYYY/MM/DD': { pattern:/^(\d{4})\/(\d{2})\/(\d{2})$/, order:[1,2,3] },
  'DD/MM/YYYY': { pattern:/^(\d{2})\/(\d{2})\/(\d{4})$/, order:[3,2,1] },
  'MM/DD/YYYY': { pattern:/^(\d{2})\/(\d{2})\/(\d{4})$/, order:[3,1,2] },
  'DD-MM-YYYY': { pattern:/^(\d{2})-(\d{2})-(\d{4})$/, order:[3,2,1] },
};
export function displayedDate(value, format) {
  const spec=formats[format];
  if (!spec) return {status:'NEI',reason:'date_format_not_confirmed'};
  const match=typeof value==='string' ? value.trim().match(spec.pattern) : null;
  if (!match) return {status:'NEI',reason:'date_text_does_not_match_confirmed_format'};
  const [year,month,day]=spec.order.map(i=>Number(match[i]));
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if (!year || month<1 || month>12 || day<1 || day>days[month-1]) return {status:'FAIL',reason:'impossible_calendar_date'};
  return {status:'PASS',reason:'calendar_date_only',canonical:`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`};
}
