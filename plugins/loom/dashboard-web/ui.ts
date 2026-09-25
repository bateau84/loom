import { dashboardStyles } from "./styles"
import { dashboardScript } from "./client"

function inlineJson(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c")
}

/** Self-contained: no third-party assets or CDN requests. */
export function dashboardHtml(controlToken = "") {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Loom Control Panel</title>
<style>${dashboardStyles}</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<div class="app-shell">
  <aside class="sidebar" aria-label="Workspace navigation">
    <a class="brand" href="#/" aria-label="Loom — Control panel">
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M7 3v26M16 3v26M25 3v26M3 7h26M3 16h26M3 25h26"/></svg>
      <span><strong>Loom</strong><small>CONTROL PLANE</small></span>
    </a>
    <nav id="primary-nav" class="nav-links" aria-label="Primary"></nav>
    <details id="projects-menu" class="projects-menu" open>
      <summary>Working directories</summary>
      <nav id="project-nav" class="project-links" aria-label="Working directories"><span class="meta">Waiting for projection…</span></nav>
    </details>
    <div class="sidebar-foot"><strong>Local control panel</strong>Understand current work, resume sessions, and clean up obsolete workflow state.</div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <nav id="breadcrumbs" class="breadcrumbs" aria-label="Location"><span>Control panel</span></nav>
      <div class="toolbar" aria-label="Display controls">
        <span id="feed" class="feed">Connecting to projection…</span>
        <button id="refresh" type="button">Refresh</button>
        <button id="pause" type="button" aria-pressed="false">Pause updates</button>
        <label class="sr-live" for="theme">Color theme</label>
        <select id="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select>
      </div>
    </header>
    <div id="projection-status" class="callout projection-status" role="status" hidden></div>
    <div id="page-heading"><div class="page-head"><h1 id="view-title">Loom Control Panel</h1></div></div>
    <main id="main" tabindex="-1" aria-labelledby="view-title" aria-busy="true"><section class="panel empty"><strong>Loading Loom…</strong><p class="notice">Connecting to the current control-plane view.</p></section></main>
    <div id="live" class="sr-live" aria-live="polite" aria-atomic="true"></div>
  </div>
</div>
<script>window.__LOOM_CONTROL_TOKEN__=${inlineJson(controlToken)};${dashboardScript}</script>
</body>
</html>`
}
