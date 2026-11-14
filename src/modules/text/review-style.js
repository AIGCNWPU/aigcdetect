export function installReviewStyles() {
  if (document.querySelector('[data-text-review-style]')) return;
  const style = document.createElement('style');
  style.dataset.textReviewStyle = '';
  style.textContent = `
.text-workspace .text-review-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:18px;margin-top:16px;align-items:start}
.text-workspace .text-review-workspace[hidden]{display:none}
.text-workspace .text-review-source,.text-workspace .text-review-results{min-width:0;border:1px solid #dce6f2;border-radius:14px;background:#fff;overflow:hidden}
.text-workspace .text-review-source>header,.text-workspace .text-review-results>header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px;background:#f3f8fe;border-bottom:1px solid #dce6f2}
.text-workspace .text-review-source h4{font-size:13px;margin:0 6px 0 0}
.text-workspace .text-review-source select,.text-workspace .text-review-results select{max-width:100%;font:inherit;font-size:11px;padding:6px;border:1px solid #cbd9e9;background:#fff;border-radius:7px;color:#384c64}
.text-workspace .text-review-source>header>small,.text-workspace .text-review-results>header>small{flex-basis:100%;color:#718197;font-size:10px;line-height:1.6}
.text-workspace .text-review-source button,.text-workspace .text-review-results button{border:1px solid #cbd9e9;background:#fff;border-radius:7px;padding:6px 9px;font:inherit;font-size:10px;color:#1668bd;cursor:pointer}
.text-workspace .text-review-source button:disabled,.text-workspace .text-review-results button:disabled{opacity:.5;cursor:not-allowed}
.text-workspace .text-review-source-body{max-height:clamp(220px,45vh,440px);overflow:auto;overscroll-behavior:contain;padding:16px;color:#354052;font-size:13px;line-height:2}
.text-workspace .text-review-document h5{font-size:13px;margin:0 0 12px;color:#526a85}
.text-workspace .text-review-document+.text-review-document{margin-top:22px;border-top:1px dashed #dce6f2;padding-top:16px}
.text-workspace .text-review-original{white-space:pre-wrap;overflow-wrap:anywhere}
.text-workspace .text-review-original .text-review-mark{display:inline;margin:0;border:0;border-radius:3px;padding:1px 0;font:inherit;line-height:inherit;color:inherit;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0bf;cursor:pointer}
.text-workspace .text-review-original .is-ai{background:#ffdcdf}.text-workspace .text-review-original .is-human{background:#e8f5ed}.text-workspace .text-review-original .is-unscored{background:#eceff3}
.text-workspace .text-review-original .text-review-mark.is-active{outline:2px solid #1675d1;outline-offset:1px;background:#dceeff}
.text-workspace .text-review-problems{max-height:640px;overflow:auto;overscroll-behavior:contain;padding:10px}
.text-workspace .text-review-problems .ai-sentence-list,.text-workspace .text-review-problems .proofreading-stages,.text-workspace .text-review-problems .issue-finding-list{max-height:none;overflow:visible;margin-top:0}
.text-workspace .text-review-problems [data-review-entry].is-review-active{outline:2px solid #1675d1;outline-offset:-2px;border-radius:10px}
.text-workspace .text-review-actions{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin-top:10px;padding-top:9px;border-top:1px dashed #dce6f2}
.text-workspace .text-review-actions label{font-size:10px;color:#526a85;display:flex;align-items:center;gap:5px}
.text-workspace .text-review-actions small{flex-basis:100%;font-size:10px;color:#78879a}
.text-workspace .text-review-actions output{font-size:10px;color:#718197}
.text-workspace .text-review-announcement,.text-workspace .text-review-count,.text-workspace .text-review-empty{font-size:10px;color:#667b92;line-height:1.6}
.text-workspace .text-review-announcement{padding:8px 12px;min-height:30px;border-top:1px solid #e4ebf5}
.text-workspace .text-review-evidence{margin-top:10px;padding:10px;border:1px solid #dce6f2;border-radius:10px;background:#f5f9ff}
.text-workspace .text-review-evidence>strong{font-size:11px;color:#36536f}.text-workspace .text-review-evidence>p{font-size:10px;color:#718197;margin-top:5px}
.text-workspace .text-review-evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:9px}
.text-workspace .text-review-evidence figure{min-width:0;margin:0;padding:9px;background:#fff;border:1px solid #e1e9f3;border-radius:8px}
.text-workspace .text-review-evidence figcaption{font-size:10px;color:#647b95;margin-bottom:6px}
.text-workspace .text-review-evidence blockquote{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:210px;overflow:auto;font-size:11px;line-height:1.8}
.text-workspace .text-review-evidence mark{background:#ffedb2;color:inherit}.text-workspace .text-review-evidence details{margin-top:8px;font-size:10px;color:#526a85}
.text-workspace .text-review-evidence details p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:11px;line-height:1.8}
.text-workspace .text-review-empty{padding:10px}.text-workspace .text-review-workspace [hidden]{display:none!important}
@media(max-width:1100px){.text-workspace .text-review-workspace{grid-template-columns:1fr}.text-workspace .text-review-source-body{max-height:360px}}
@media(max-width:600px){.text-workspace .text-review-evidence-grid{grid-template-columns:1fr}.text-workspace .text-review-problems{max-height:520px}}
`;
  document.head.append(style);
}
