export function installReviewStyles() {
  if (document.querySelector('[data-text-review-style]')) return;
  const style = document.createElement('style');
  style.dataset.textReviewStyle = '';
  style.textContent = `
.text-workspace .text-review-workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.12fr);gap:18px;margin-top:16px;align-items:start}
.text-workspace .text-review-workspace[hidden]{display:none}
.text-workspace .text-review-source,.text-workspace .text-review-results{min-width:0;border:1px solid #dce6f2;border-radius:14px;background:#fff;overflow:hidden}
.text-workspace .text-review-source>header,.text-workspace .text-review-results>header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 14px;background:#f4f8fe;border-bottom:1px solid #dce6f2}
.text-workspace .text-review-source h4{font-size:14px;font-weight:650;color:#1b283b;margin:0 6px 0 0}
.text-workspace .text-review-source select,.text-workspace .text-review-results select{max-width:100%;font:inherit;font-size:12.5px;padding:6px 9px;border:1px solid #cbd9e9;background:#fff;border-radius:8px;color:#32455c}
.text-workspace .text-review-source>header>small,.text-workspace .text-review-results>header>small{flex-basis:100%;color:#66788f;font-size:12px;line-height:1.55}
.text-workspace .text-review-source button,.text-workspace .text-review-results button{border:1px solid #cbd9e9;background:#fff;border-radius:8px;padding:6px 10px;font:inherit;font-size:12px;font-weight:500;color:#155fb0;cursor:pointer;transition:background .14s,border-color .14s}
.text-workspace .text-review-source button:hover:not(:disabled),.text-workspace .text-review-results button:hover:not(:disabled){background:#eff6ff;border-color:#98c1f0}
.text-workspace .text-review-source button:disabled,.text-workspace .text-review-results button:disabled{opacity:.48;cursor:not-allowed}
.text-workspace .text-review-source-body{max-height:clamp(220px,45vh,440px);overflow:auto;overscroll-behavior:contain;padding:16px 18px;color:#273446;font-size:14px;line-height:1.95}
.text-workspace .text-review-edit-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-basis:100%}
.text-workspace .text-review-edit-actions>small{flex-basis:100%;font-size:12px;line-height:1.55;color:#8a6420}
.text-workspace .text-review-edit-actions>small:empty{display:none}
.text-workspace .text-review-edit-actions.is-editing-active>button:nth-child(2){background:#0875e8;color:#fff;border-color:#0875e8;font-weight:600}
.text-workspace .text-review-editor{display:block;box-sizing:border-box;width:100%;min-height:260px;resize:vertical;padding:12px;border:1px solid #cbd9e9;border-radius:10px;font:inherit;font-size:14px;line-height:1.85;color:#273446;background:#fff}
.text-workspace .text-review-results>header .ai-result-filter{margin-top:0;flex-basis:100%;padding-top:4px}
.text-workspace .text-review-result-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-left:auto}
.text-workspace .text-review-result-tabs [aria-selected=true]{color:#0875e8;background:#e7f1ff;border-color:#8cbcf3;font-weight:650}
.text-workspace .text-review-problems>.novel-rewrite{border:0;padding:4px;margin:0;background:transparent}
.text-workspace .text-review-problems .novel-rewrite-heading{flex-direction:column;align-items:stretch}
.text-workspace .text-review-problems .novel-rewrite-compare{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:1280px){.text-workspace .text-review-problems .novel-rewrite-compare{grid-template-columns:1fr}}
.text-workspace .text-review-results .novel-rewrite .text-primary{font-size:13px;padding:9px 14px;line-height:1.45;background:#0875e8;color:#fff;border-color:#0875e8}
.text-workspace .text-review-results .novel-rewrite .text-secondary{font-size:12.5px;padding:8px 12px;line-height:1.45}
.text-workspace .text-review-results.is-review-stale>header{background:#fff7e5}
.text-workspace .text-review-document h5{font-size:14px;font-weight:650;margin:0 0 12px;color:#3d5673}
.text-workspace .text-review-document+.text-review-document{margin-top:22px;border-top:1px dashed #dce6f2;padding-top:16px}
.text-workspace .text-review-original{white-space:pre-wrap;overflow-wrap:anywhere}
.text-workspace .text-review-original .text-review-mark{display:inline;margin:0;border:0;border-radius:3px;padding:1px 0;font:inherit;line-height:inherit;color:inherit;text-align:start;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0bf;cursor:pointer}
.text-workspace .text-review-original .is-ai{background:#ffdcdf}.text-workspace .text-review-original .is-human{background:#e8f5ed}.text-workspace .text-review-original .is-unscored{background:#eceff3}
.text-workspace .text-review-original .text-review-mark.is-active{outline:2px solid #1675d1;outline-offset:1px;background:#dceeff}
.text-workspace .text-review-problems{max-height:640px;overflow:auto;overscroll-behavior:contain;padding:12px}
.text-workspace .text-review-problems .ai-sentence-list,.text-workspace .text-review-problems .proofreading-stages,.text-workspace .text-review-problems .issue-finding-list{max-height:none;overflow:visible;margin-top:0}
.text-workspace .text-review-problems [data-review-entry].is-review-active{outline:2px solid #1675d1;outline-offset:-2px;border-radius:10px}
.text-workspace .text-review-actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:9px;border-top:1px dashed #dce6f2}
.text-workspace .text-review-actions label{font-size:12px;color:#4a607a;display:flex;align-items:center;gap:6px}
.text-workspace .text-review-actions small{flex-basis:100%;font-size:12px;color:#6d7f95}
.text-workspace .text-review-actions output{font-size:12px;color:#66788f}
.text-workspace .text-review-announcement,.text-workspace .text-review-count,.text-workspace .text-review-empty{font-size:12px;color:#5a6e85;line-height:1.6}
.text-workspace .text-review-announcement{padding:8px 14px;min-height:32px;border-top:1px solid #e4ebf5}
.text-workspace .text-review-announcement:empty{display:none}
.text-workspace .text-review-evidence{margin-top:10px;padding:12px;border:1px solid #dce6f2;border-radius:10px;background:#f5f9ff}
.text-workspace .text-review-evidence>strong{font-size:13px;color:#2c4663}.text-workspace .text-review-evidence>p{font-size:12px;color:#647890;margin-top:5px}
.text-workspace .text-review-evidence-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:9px}
.text-workspace .text-review-evidence figure{min-width:0;margin:0;padding:10px;background:#fff;border:1px solid #e1e9f3;border-radius:8px}
.text-workspace .text-review-evidence figcaption{font-size:12px;font-weight:600;color:#526984;margin-bottom:6px}
.text-workspace .text-review-evidence blockquote{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:210px;overflow:auto;font-size:13px;line-height:1.8;color:#2c3a4d}
.text-workspace .text-review-evidence mark{background:#ffedb2;color:inherit}.text-workspace .text-review-evidence details{margin-top:8px;font-size:12px;color:#4a607a}
.text-workspace .text-review-evidence details p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;font-size:13px;line-height:1.8;margin-top:6px;color:#334257}
.text-workspace .text-review-empty{padding:14px}.text-workspace .text-review-workspace [hidden]{display:none!important}
@media(max-width:1100px){.text-workspace .text-review-workspace{grid-template-columns:1fr}.text-workspace .text-review-source-body{max-height:360px}}
@media(max-width:600px){.text-workspace .text-review-evidence-grid{grid-template-columns:1fr}.text-workspace .text-review-problems{max-height:520px}}
`;
  document.head.append(style);
}
