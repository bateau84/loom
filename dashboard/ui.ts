import { dashboardStyles } from "./styles"
import { dashboardScript } from "./client"

/** Self-contained: no third-party assets, CDN requests, or workflow mutation controls. */
export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Loom Operations</title>
<style>${dashboardStyles}</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<div class="app-shell">
  <aside class="sidebar" aria-label="Workspace navigation">
    <a class="brand" href="#/" aria-label="Loom Operations — Fleet overview">
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M7 3v26M16 3v26M25 3v26M3 7h26M3 16h26M3 25h26"/></svg>
      <span><strong>Loom</strong><small>OPERATIONS</small></span>
    </a>
    <nav id="primary-nav" class="nav-links" aria-label="Primary"></nav>
    <details id="projects-menu" class="projects-menu" open>
      <summary>Projects</summary>
      <nav id="project-nav" class="project-links" aria-label="Projects"><span class="meta">Waiting for projection…</span></nav>
    </details>
    <div class="sidebar-foot"><strong>Read-only workspace</strong>Observe Loom. Execution stays in OpenCode.</div>
  </aside>
  <div class="workspace">
    <header class="topbar">
      <nav id="breadcrumbs" class="breadcrumbs" aria-label="Location"><span>Fleet</span></nav>
      <div class="toolbar" aria-label="Display controls">
        <span id="feed" class="feed">Connecting to projection…</span>
        <button id="refresh" type="button">Refresh</button>
        <button id="pause" type="button" aria-pressed="false">Pause updates</button>
        <label class="sr-live" for="theme">Color theme</label>
        <select id="theme"><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select>
      </div>
    </header>
    <div id="projection-status" class="callout projection-status" role="status" hidden></div>
    <div id="page-heading"><div class="page-head"><h1 id="view-title">Loom Operations</h1></div></div>
    <div id="filters" class="filters" aria-label="Fleet filters" hidden>
      <label class="field">Status<select id="status-filter"><option value="all">All work</option><option value="attention">Needs attention</option><option value="active">Active</option><option value="complete">Complete</option><option value="cancelled">Cancelled</option><option value="stale">Stale/offline</option></select></label>
      <label class="field search">Project<input id="project-filter" type="search" autocomplete="off" placeholder="Find a project by name, path, or ID"></label>
      <label class="field agent">Next agent<input id="agent-filter" type="search" autocomplete="off" placeholder="Next available agent"></label>
      <button id="clear-filters" type="button">Clear filters</button>
    </div>
    <main id="main" tabindex="-1" aria-labelledby="view-title" aria-busy="true"><section class="panel empty"><strong>Loading Loom projection…</strong><p class="notice">Connecting to the read-only view. Missing data is not a healthy zero.</p></section></main>
    <div id="live" class="sr-live" aria-live="polite" aria-atomic="true"></div>
  </div>
</div>
<script>${dashboardScript}</script>
</body>
</html>`
}
