/** Shared visual tokens and responsive layout for the read-only operations UI. */
export const dashboardStyles = `
:root {
  color-scheme: dark;
  --bg:#0d1117; --rail:#10161e; --surface:#161e28; --surface-2:#1c2733;
  --text:#edf2f7; --muted:#a3b2c2; --line:#344457; --control:#77889c;
  --accent:#82e2c5; --accent-bg:#173c35; --focus:#9cc7ff;
  --danger:#ffacb2; --danger-bg:#41232b; --warn:#f3cf86; --warn-bg:#3b321e;
  --ok:#9bdfb3; --ok-bg:#20392d; --stale:#cabbf7; --stale-bg:#332d48;
  --info:#b2d2ff; --info-bg:#25354c;
  --font:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;
}
:root[data-theme="light"] {
  color-scheme:light;
  --bg:#f4f6f8; --rail:#fff; --surface:#fff; --surface-2:#ecf1f5;
  --text:#172533; --muted:#4d6174; --line:#c1cdd8; --control:#758598;
  --accent:#096c57; --accent-bg:#dcefe8; --focus:#185fba;
  --danger:#a42638; --danger-bg:#fbe9ed; --warn:#755000; --warn-bg:#fff1ce;
  --ok:#21693c; --ok-bg:#e4f2e7; --stale:#63459a; --stale-bg:#eee8f9;
  --info:#215b9b; --info-bg:#e8f0fd;
}
* { box-sizing:border-box; }
html { min-height:100%; background:var(--bg); scroll-padding-top:1rem; }
body { margin:0; color:var(--text); font:0.875rem/1.5 var(--font); }
button,input,select { font:inherit; }
button,select,summary { cursor:pointer; }
a { color:var(--accent); text-underline-offset:0.2em; }
button,input,select { color:var(--text); background:var(--surface); border:1px solid var(--control); border-radius:6px; min-height:2.5rem; padding:0.45rem 0.7rem; }
button:hover,select:hover { background:var(--surface-2); }
button:active { transform:translateY(1px); }
button:disabled { cursor:wait; opacity:0.7; }
:focus-visible { outline:2px solid var(--focus); outline-offset:3px; }
main:focus { outline:none; }
main:focus-visible { outline:2px solid var(--focus); outline-offset:5px; }
[hidden] { display:none !important; }
.sr-live { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; }
.skip { position:fixed; top:-6rem; left:1rem; z-index:20; background:var(--surface); padding:0.7rem 1rem; border:2px solid var(--focus); border-radius:6px; }
.skip:focus { top:1rem; }
.app-shell { display:grid; min-height:100vh; grid-template-columns:14.5rem minmax(0,1fr); }
.sidebar { padding:1.5rem 1rem; background:var(--rail); border-right:1px solid var(--line); position:sticky; top:0; height:100vh; overflow-y:auto; display:flex; flex-direction:column; gap:1.6rem; }
.brand { display:flex; align-items:center; gap:0.7rem; text-decoration:none; color:var(--text); }
.brand svg { width:32px; height:32px; color:var(--accent); flex-shrink:0; }
.brand strong { display:block; font-size:1.35rem; letter-spacing:-0.04em; }
.brand small { color:var(--muted); font-size:0.72rem; }
.nav-links,.project-links { display:grid; gap:0.3rem; }
.nav-link { color:var(--muted); text-decoration:none; border:1px solid transparent; border-radius:6px; min-height:2.75rem; padding:0.6rem 0.7rem; display:flex; gap:0.65rem; align-items:center; }
.nav-link:hover { color:var(--text); background:var(--surface-2); }
.nav-link[aria-current="page"],.nav-link[aria-current="location"] { background:var(--accent-bg); color:var(--accent); border-color:var(--accent); }
.nav-symbol { font-size:1rem; width:1.15rem; text-align:center; flex-shrink:0; }
.nav-count { margin-left:auto; font:0.75rem var(--mono); }
.project-name { min-width:0; overflow-wrap:anywhere; }
.project-name small { display:block; font-size:0.68rem; color:var(--muted); }
.projects-menu>summary { color:var(--muted); font-size:0.72rem; font-weight:650; letter-spacing:0.1em; text-transform:uppercase; padding:0.45rem 0.7rem; min-height:2rem; }
.projects-menu[open]>summary { margin-bottom:0.45rem; }
.sidebar-foot { margin-top:auto; color:var(--muted); border-top:1px solid var(--line); padding:1rem 0.7rem 0; font-size:0.75rem; }
.sidebar-foot strong { color:var(--text); display:block; margin-bottom:0.25rem; }
.workspace { min-width:0; padding:1.5rem clamp(1rem,2.4vw,2.5rem) 2.5rem; width:100%; max-width:110rem; }
.topbar { display:flex; align-items:center; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding-bottom:1.15rem; margin-bottom:1.5rem; border-bottom:1px solid var(--line); }
.breadcrumbs { display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center; min-width:0; font-size:0.8rem; color:var(--muted); overflow-wrap:anywhere; }
.breadcrumbs a { color:var(--muted); }
.toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:0.5rem; }
.toolbar button,.toolbar select { min-height:2.15rem; font-size:0.75rem; padding:0.35rem 0.6rem; }
.feed { font-size:0.75rem; color:var(--muted); margin-right:0.3rem; }
.feed[data-health="connected"]::before { content:"● "; color:var(--accent); }
.feed[data-health="error"]::before { content:"! "; color:var(--danger); font-weight:700; }
.feed[data-health="paused"]::before { content:"Ⅱ "; color:var(--warn); }
.page-head { display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap; margin-bottom:1.3rem; }
.eyebrow { display:block; font-size:0.7rem; color:var(--accent); font-weight:650; letter-spacing:0.12em; text-transform:uppercase; margin-bottom:0.35rem; }
h1 { font-size:clamp(1.45rem,2.3vw,1.9rem); line-height:1.2; letter-spacing:-0.035em; margin:0; overflow-wrap:anywhere; }
h2 { font-size:1rem; line-height:1.4; margin:0; letter-spacing:-0.01em; }
h3 { font-size:0.875rem; margin:0; }
p { margin:0.4rem 0 0; }
.subtitle,.meta,.path { color:var(--muted); }
.subtitle { max-width:70ch; }
.meta,.path { font-size:0.76rem; overflow-wrap:anywhere; }
.mono { font-family:var(--mono); }
.identity { min-width:0; }
.name { font-weight:650; overflow-wrap:anywhere; }
.panel { background:var(--surface); border:1px solid var(--line); border-radius:9px; min-width:0; }
.panel-head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding:1rem 1.15rem; border-bottom:1px solid var(--line); }
.panel-body { padding:1rem 1.15rem; }
.section { margin-top:1.25rem; }
.stack { display:grid; gap:1rem; align-content:start; min-width:0; }
.detail-grid { display:grid; grid-template-columns:minmax(0,1.75fr) minmax(16rem,1fr); gap:1rem; align-items:start; }
.badges { display:flex; gap:0.4rem; flex-wrap:wrap; align-items:center; }
.badge { display:inline-flex; gap:0.3rem; align-items:center; font-size:0.72rem; font-weight:550; line-height:1.5; border:1px solid var(--line); background:var(--surface-2); color:var(--muted); border-radius:4px; padding:0.2rem 0.45rem; overflow-wrap:anywhere; }
.badge[data-tone="danger"] { color:var(--danger); background:var(--danger-bg); border-color:var(--danger); }
.badge[data-tone="warn"] { color:var(--warn); background:var(--warn-bg); border-color:var(--warn); }
.badge[data-tone="ok"] { color:var(--ok); background:var(--ok-bg); border-color:var(--ok); }
.badge[data-tone="stale"] { color:var(--stale); background:var(--stale-bg); border-color:var(--stale); }
.badge[data-tone="info"] { color:var(--info); background:var(--info-bg); border-color:var(--info); }
.badge[data-state="consistency conflict"]::before { content:"!"; }
.badge[data-state="failed"]::before { content:"×"; }
.badge[data-state="blocked"]::before { content:"!"; }
.badge[data-state="stale/offline"]::before { content:"◷"; }
.badge[data-state="active"]::before { content:"▶"; font-size:0.65em; }
.badge[data-state="complete"]::before { content:"✓"; }
.badge[data-state="cancelled"]::before { content:"×"; }
.stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:0; border:1px solid var(--line); background:var(--surface); border-radius:9px; overflow:hidden; margin-bottom:1.25rem; }
.stat { padding:0.85rem 1.1rem; min-width:0; }
.stat+.stat { border-left:1px solid var(--line); }
.stat strong { display:block; font-size:1.4rem; font-weight:620; letter-spacing:-0.04em; font-variant-numeric:tabular-nums; overflow-wrap:anywhere; }
.stat span { color:var(--muted); font-size:0.76rem; }
button.stat { border:0; border-radius:0; background:none; text-align:left; color:var(--text); }
button.stat+.stat { border-left:1px solid var(--line); }
button.stat:hover,button.stat[aria-pressed="true"] { background:var(--surface-2); }
button.stat[aria-pressed="true"] { box-shadow:inset 0 -3px var(--accent); }
button.stat:focus-visible { outline-offset:-4px; }
.stat[data-tone="warn"] strong { color:var(--warn); }
.stat[data-tone="danger"] strong { color:var(--danger); }
.filters { display:flex; flex-wrap:wrap; gap:0.75rem; align-items:end; margin-bottom:1rem; }
.field { display:grid; gap:0.3rem; color:var(--muted); font-size:0.75rem; min-width:0; }
.field input { width:100%; min-width:0; }
.field.search { flex:1 1 12rem; }
.field.agent { flex:0 1 11rem; }
.filter-note { font-size:0.75rem; color:var(--muted); margin-bottom:0.65rem; }
.grid { display:grid; gap:0.7rem; }
.workflow { display:grid; grid-template-columns:minmax(0,1.4fr) minmax(0,1fr); gap:0.65rem 1rem; padding:1rem 1.15rem; text-decoration:none; color:var(--text); border-left:3px solid var(--line); }
.workflow:hover { background:var(--surface-2); border-color:var(--accent); }
.workflow[data-tone="danger"] { border-left-color:var(--danger); }
.workflow[data-tone="warn"] { border-left-color:var(--warn); }
.workflow[data-tone="stale"] { border-left-color:var(--stale); }
.workflow-head { display:flex; justify-content:space-between; align-items:flex-start; gap:1rem; flex-wrap:wrap; }
.workflow .workflow-head { grid-column:1/-1; }
.workflow .name { font-size:1rem; }
.workflow .project-cue { font-size:0.7rem; color:var(--accent); margin-bottom:0.2rem; font-weight:600; }
.card-step { overflow-wrap:anywhere; }
.card-step .meta { margin-bottom:0.2rem; }
.card-metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:0.75rem; align-items:start; }
.card-metrics strong { display:block; font-size:0.9rem; font-weight:600; font-variant-numeric:tabular-nums; }
.card-metrics span { display:block; color:var(--muted); font-size:0.7rem; }
.card-foot { grid-column:1/-1; display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.4rem 1rem; border-top:1px solid var(--line); padding-top:0.6rem; }
.card-reasons { color:var(--warn); font-size:0.75rem; }
progress,meter { display:block; width:100%; height:0.35rem; margin-top:0.6rem; border:0; border-radius:1rem; accent-color:var(--accent); background:var(--line); }
progress::-webkit-progress-bar { background:var(--line); border-radius:1rem; }
progress::-webkit-progress-value { background:var(--accent); border-radius:1rem; }
progress::-moz-progress-bar { background:var(--accent); border-radius:1rem; }
meter::-webkit-meter-bar { background:var(--line); border:0; height:0.35rem; }
meter::-webkit-meter-optimum-value { background:var(--accent); }
meter::-webkit-meter-suboptimum-value,meter::-webkit-meter-even-less-good-value { background:var(--warn); }
.notice { color:var(--muted); font-size:0.8rem; line-height:1.6; }
.callout { padding:0.85rem 1rem; border:1px solid var(--line); border-left:3px solid var(--warn); border-radius:6px; background:var(--surface); margin-bottom:1rem; overflow-wrap:anywhere; }
.callout strong { display:block; }
.callout[data-tone="danger"] { border-left-color:var(--danger); }
.callout[data-tone="stale"] { border-left-color:var(--stale); }
.callout .notice { margin-top:0.25rem; }
.projection-status { display:flex; justify-content:space-between; gap:1rem; align-items:center; }
.list { display:grid; gap:0.6rem; }
.row { padding:0.75rem; border:1px solid var(--line); border-radius:6px; background:var(--surface-2); overflow-wrap:anywhere; }
a.row { text-decoration:none; color:var(--text); display:flex; align-items:center; gap:0.65rem; }
a.row:hover { border-color:var(--accent); }
a.row .go { color:var(--accent); margin-left:auto; }
.step { display:flex; gap:0.8rem; align-items:flex-start; padding:0.8rem 0; border-bottom:1px solid var(--line); }
.step:first-child { padding-top:0; }
.step:last-child { border:0; padding-bottom:0; }
.step-symbol { color:var(--accent); font-size:1.2rem; line-height:1.2; width:1.2rem; flex-shrink:0; }
.step .badges { margin-top:0.4rem; }
.facts { margin:0; display:grid; gap:0; }
.fact { padding:0.85rem 0; border-bottom:1px solid var(--line); }
.fact:first-child { padding-top:0; }
.fact:last-child { padding-bottom:0; border:0; }
.fact dt { color:var(--muted); font-size:0.73rem; margin-bottom:0.25rem; }
.fact dd { margin:0; overflow-wrap:anywhere; }
.disclosure { border:1px solid var(--line); border-radius:7px; background:var(--surface); min-width:0; }
.disclosure>summary { padding:0.85rem 1rem; min-height:2.75rem; font-weight:550; }
.disclosure[open]>summary { border-bottom:1px solid var(--line); }
.disclosure .list { padding:1rem; }
.hierarchy { display:grid; gap:0.6rem; }
.hierarchy details { border:1px solid var(--line); border-radius:6px; background:var(--surface); min-width:0; }
.hierarchy details details { margin:0.6rem; background:var(--surface-2); }
.hierarchy summary { min-height:2.75rem; padding:0.65rem 0.8rem; overflow-wrap:anywhere; }
.hierarchy summary .meta { display:block; padding-left:1.05rem; }
.hierarchy ul { padding:0 0.8rem 0.5rem 2rem; margin:0; }
.hierarchy li { margin:0.5rem 0; overflow-wrap:anywhere; }
.empty { padding:2.5rem 1.25rem; text-align:center; }
.empty strong { display:block; color:var(--text); font-size:1.1rem; margin-bottom:0.5rem; }
.empty .notice { max-width:62ch; margin:0 auto 1rem; }
.empty-icon { display:block; font-size:1.8rem; color:var(--muted); margin-bottom:0.75rem; }
.provenance { font-size:0.72rem; color:var(--muted); margin-top:1.25rem; }
@media (min-width:100rem) { .workspace { padding-top:1.75rem; } }
@media (max-width:74rem) { .detail-grid { grid-template-columns:minmax(0,1fr); } }
@media (max-width:55rem) {
  .app-shell { grid-template-columns:minmax(0,1fr); }
  .sidebar { position:static; height:auto; border-right:0; border-bottom:1px solid var(--line); padding:0.8rem 1rem; gap:0.65rem; }
  .brand small { display:none; }
  .brand strong { font-size:1.15rem; }
  .brand svg { width:25px; height:25px; }
  .sidebar .nav-links { display:flex; flex-wrap:wrap; }
  .nav-link { min-height:2.5rem; padding:0.45rem 0.6rem; }
  .sidebar-foot { display:none; }
  .project-links { max-height:12rem; overflow-y:auto; }
  .workspace { padding:1rem; }
  .topbar { margin-bottom:1.1rem; }
}
@media (max-width:40rem) {
  .stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .stat { padding:0.8rem; }
  .stat:nth-child(3) { border-left:0; }
  .stat:nth-child(n+3) { border-top:1px solid var(--line); }
  .workflow { grid-template-columns:minmax(0,1fr); padding:0.9rem; }
  .workflow-head { gap:0.6rem; }
  .card-metrics { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .field.agent { flex:1 1 8rem; }
  .filters .field:first-child { flex:1 1 8rem; }
  .feed { width:100%; }
  .panel-head,.panel-body { padding:0.9rem; }
  .projection-status { align-items:flex-start; flex-direction:column; }
}
@media (prefers-reduced-motion:reduce) {
  *,*::before,*::after { scroll-behavior:auto !important; transition:none !important; animation:none !important; }
}
@media (forced-colors:active) {
  .badge,.workflow,.nav-link[aria-current] { border:1px solid CanvasText; }
  button.stat[aria-pressed="true"] { outline:2px solid Highlight; outline-offset:-4px; }
}
`;
