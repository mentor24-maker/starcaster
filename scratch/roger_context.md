# ROGER DIAGNOSTIC CONTEXT BUNDLE

Below is the current state of the application for debugging the CSS/DOM collision on the Acquire Hub:

## public/styles.css
```

:root {
  --bg-left: #020205;
  --bg-mid: #031122;
  --bg-right: #043b79;
  --paper: #ffffff;
  --paper-elevated: #ffffff;
  --ink: #101923;
  --accent: #27a6ff;
  --accent-strong: #0b82d4;
  --accent-soft: #1a4f81;
  --muted: #445465;
  --border: #0f4f8f;
  --field-bg: #ffffff;
  --black: #000;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: "Trebuchet MS", "Segoe UI", sans-serif;
  background: #ffffff;
  color: var(--ink);
}

.auth-landing {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 480px);
  gap: 2rem;
  align-items: center;
  padding: 2rem 2.5rem;
  background: #000000;
}

.auth-hero h1 {
  margin: 0.6rem 0 0.9rem;
  font-size: 2.6rem;
  line-height: 1.1;
  color: #ffffff;
}

.auth-hero p {
  margin: 0;
  max-width: 52ch;
  font-size: 1.55rem;
  line-height: 1.6;
  color: #d7e7f8;
}

.auth-logo {
  width: min(100%, 840px);
  height: auto;
}

.auth-card {
  background: #fff;
  border: 1px solid #b7d5ef;
  border-radius: 14px;
  box-shadow: 0 16px 28px rgba(15, 55, 90, 0.12);
  padding: 1rem 1rem 1.2rem;
}

.auth-card h2 {
  margin: 0.1rem 0 0.8rem;
  text-align: center;
}

.auth-mode-toggle {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.auth-mode-toggle button {
  margin: 0;
}

.auth-mode-toggle button.active {
  background: #0a6aaa;
  color: #fff;
}

#authLoginForm button[type="submit"],
#authRegisterForm button[type="submit"] {
  width: 100%;
  min-width: 0;
  align-self: stretch;
}

.auth-message {
  min-height: 1.1rem;
  margin: 0.3rem 0 0.7rem;
  color: #1f3f5a;
}

.auth-message.error {
  color: #9d1212;
}

.auth-welcome-name {
  margin: 0;
  color: #07325a;
  font-weight: 700;
  text-decoration: none;
}

.auth-header-meta {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
}

.auth-user-menu {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.auth-user-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  display: none;
  margin-top: 0.35rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid #cde4ff;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.15);
  z-index: 40;
}

.auth-user-menu:hover .auth-user-dropdown {
  display: block;
}

.auth-logout-link {
  width: auto;
  margin: 0;
  border: none;
  border-radius: 0;
  padding: 0;
  background: transparent;
  color: #07325a;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.auth-welcome-name:hover,
.auth-logout-link:hover {
  text-decoration: underline;
}

header {
  padding: 0 1rem;
  background: linear-gradient(90deg, #000000 0%, #cceeff 100%);
  border-bottom: 1px solid #0f4d85;
  min-height: 103px;
  display: flex;
  align-items: center;
}

.brand-wordmark {
  display: block;
  height: 98px;
  max-height: none;
  width: auto;
  object-fit: contain;
  filter: drop-shadow(0 0 8px rgba(39, 166, 255, 0.35));
}

.brand-fallback {
  display: none;
  margin: 0;
  color: #90ddff;
  font-size: 2rem;
  font-weight: 500;
}

.brand-profile-button {
  margin-left: 1rem;
  display: inline-flex;
  flex: 0 0 auto;
  width: fit-content;
  align-items: center;
  gap: 0.7rem;
  justify-content: flex-end;
  min-height: 58px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: #07325a;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  text-decoration: none;
}

.brand-profile-button:hover {
  background: transparent;
}

.brand-profile-logo {
  display: block;
  width: 52px;
  height: 52px;
  margin-left: auto;
  border-radius: 50%;
  object-fit: contain;
  background: transparent;
  border: none;
  padding: 0;
}

.brand-profile-button span {
  display: inline;
  color: #07325a;
  font-weight: 700;
}

.brand-profile-button.has-logo span {
  display: none;
}

.settings-projects-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.settings-project-column {
  min-height: 320px;
}

.settings-project-list {
  display: grid;
  gap: 0.4rem;
  margin: 0.6rem 0 0.8rem;
}

.settings-project-inline-list {
  display: grid;
  gap: 0.3rem;
  margin-top: 0.35rem;
  color: #20384f;
}

.settings-project-list-item {
  border: 1px solid #b8d7f0;
  border-radius: 8px;
  background: #f7fbff;
  padding: 0.55rem 0.7rem;
  cursor: pointer;
  text-align: left;
}

.settings-project-list-item.is-active {
  border-color: #0b82d4;
  background: #e7f4ff;
}

.settings-project-list-item-name {
  font-weight: 700;
  color: #0f2f4c;
}

.settings-project-list-item-meta {
  font-size: 0.82rem;
  color: #3d5870;
}

.project-details-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  align-items: start;
}

.project-details-form,
.project-details-media {
  display: grid;
  gap: 0.75rem;
  align-content: start;
}

.project-logo-preview-wrap {
  min-height: 220px;
  border: 1px solid #c8ddef;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: #f7fbff;
  padding: 0.8rem;
}

#settingsProjectLogoPreview {
  max-width: 100%;
  max-height: 240px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.top-nav {
  background: #000000;
  border-bottom: 1px solid #ffffff;
  padding: 0;
  position: relative;
  z-index: 20;
}

.menu-root {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: stretch;
}

.menu-item {
  position: relative;
  border-right: 1px solid #ffffff;
}

.menu-item:last-child {
  border-right: none;
}

.menu-item-right-start {
  margin-left: auto;
  border-left: 1px solid #ffffff;
}

.menu-item-right {
  border-left: 1px solid #ffffff;
}

.menu-link {
  display: block;
  padding: 0.8rem 1rem;
  text-decoration: none;
  color: #ffffff;
  font-weight: 700;
  line-height: 1;
  transition: background-color 140ms ease, color 140ms ease;
}

.menu-link:hover,
.menu-link.active {
  background: #cceeff;
  color: #003366;
}

.submenu {
  display: none;
  position: absolute;
  left: 0;
  top: 100%;
  min-width: 180px;
  background: #000000;
  border: 1px solid #ffffff;
}

.docs-menu-anchor .submenu,
.menu-item-right .submenu {
  left: auto;
  right: 0;
  min-width: 220px;
  max-width: min(92vw, 360px);
}

.submenu .submenu-link {
  border-bottom: 1px solid #ffffff;
  white-space: normal;
  line-height: 1.25;
}

.submenu .submenu-link:last-child {
  border-bottom: none;
}

.menu-item.has-submenu:hover .submenu {
  display: block;
}

main {
  display: block;
  padding: 1rem;
  background: #ffffff;
}

.app-page {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  box-shadow: 0 8px 18px rgba(0, 22, 44, 0.08);
}

h2 {
  margin-top: 0;
}

.page-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.page-heading-row h2 {
  margin: 0;
}

.training-page .page-heading-row h2 {
  font-size: 2rem;
  font-weight: 800;
}

.training-page .youtube-miner-category-header-row label,
.training-page .form-row > label {
  font-size: 1.15rem;
  font-weight: 800;
}

.page-heading-row button {
  width: auto;
  min-height: 42px;
  box-sizing: border-box;
}

.section-settings-gear-btn {
  background: #000;
  border-color: #000;
  color: #fff;
}

.section-settings-gear-btn:hover,
.section-settings-gear-btn:focus-visible {
  background: #111;
  border-color: #2aa7fa;
  color: #fff;
}

.page-heading-actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: nowrap;
}

.page-heading-actions button {
  height: 42px;
  line-height: normal;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.section-settings-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(260px, 0.8fr);
  gap: 1.25rem;
  align-items: start;
}

.section-settings-main,
.section-settings-nav {
  min-width: 0;
}

.section-settings-nav-list {
  display: grid;
  gap: 0.65rem;
}

.section-settings-nav-btn {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  padding-left: 1rem;
  padding-right: 1rem;
}

.section-settings-nav-btn.is-active,
.section-settings-nav-btn:disabled {
  background: #000;
  border-color: #000;
  color: #fff;
  opacity: 1;
  cursor: default;
}

@media (max-width: 960px) {
  .section-settings-shell {
    grid-template-columns: 1fr;
  }
}

.acquire-workbench-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(320px, 0.9fr);
  gap: 50px;
  align-items: start;
}

.acquire-workbench-pane {
  height: 100%;
}

.form-container-spacious {
  padding: 50px;
}

.bluesky-posting-panel {
  background: linear-gradient(180deg, #edf7ff 0%, #dff1ff 100%);
}

.acquire-workbench-form {
  padding: 0;
}

.acquire-workbench-form .form-row,
.acquire-workbench-form .grid-form {
  margin-bottom: 1.1rem;
}

.acquire-workbench-compact-grid {
  grid-template-columns: 1fr;
}

@media (max-width: 1100px) {
  .acquire-workbench-layout {
    grid-template-columns: 1fr;
    gap: 30px;
  }

  .form-container-spacious {
    padding: 30px;
  }
}

input,
textarea,
select,
button {
  width: 100%;
  margin: 0.3rem 0;
  padding: 0.55rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  color: var(--ink);
  background: var(--field-bg);
}

input[type="color"] {
  -webkit-appearance: none;
  appearance: none;
  width: 84px;
  min-width: 84px;
  height: 46px;
  padding: 4px;
  border: 1px solid #444;
  border-radius: 12px;
  cursor: pointer;
  background:
    linear-gradient(#fff, #fff) 8px 8px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 14px 8px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 20px 8px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 8px 14px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 14px 14px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 20px 14px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 8px 20px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 14px 20px / 4px 4px no-repeat,
    linear-gradient(#fff, #fff) 20px 20px / 4px 4px no-repeat,
    linear-gradient(135deg, #ef4444 0%, #f59e0b 25%, #eab308 40%, #22c55e 55%, #0ea5e9 72%, #8b5cf6 86%, #ec4899 100%);
  background-color: #d7e5f5;
  background-repeat: no-repeat;
  box-shadow: none;
}

input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 0;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
}

input[type="color"]::-webkit-color-swatch {
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

input[type="color"]::-moz-color-swatch {
  border: 1px solid rgba(0, 0, 0, 0.25);
  border-radius: 8px;
}

.develop-landing-page-editing input.develop-field-complete,
.develop-landing-page-editing textarea.develop-field-complete,
.develop-landing-page-editing select.develop-field-complete {
  border-color: #1f9d55;
  box-shadow: 0 0 0 2px rgba(31, 157, 85, 0.16);
}

.develop-landing-page-editing input.develop-field-missing,
.develop-landing-page-editing textarea.develop-field-missing,
.develop-landing-page-editing select.develop-field-missing {
  border-color: #d43f3a;
  box-shadow: 0 0 0 2px rgba(212, 63, 58, 0.14);
}

.develop-landing-pages-form {
  gap: 0.9rem;
}

.develop-landing-pages-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem 1.2rem;
  align-items: start;
}

.develop-landing-pages-column {
  display: grid;
  gap: 0.8rem;
  align-content: start;
}

.develop-landing-pages-column > input,
.develop-landing-pages-column > select,
.develop-landing-pages-column .develop-color-control {
  margin: 0;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0;
  font-size: 0.95rem;
}

.checkbox-row input {
  width: auto;
  margin: 0;
}

button {
  background: #000;
  color: white;
  border: 1px solid var(--border);
  cursor: pointer;
  text-align: center;
  justify-content: center;
  box-shadow: none;
  transition: box-shadow 140ms ease, border-color 140ms ease, transform 140ms ease;
}

button:hover {
  background: #020202;
  border-color: #2aa7fa;
  box-shadow: 0 0 0 1px rgba(39, 166, 255, 0.35), 0 0 16px rgba(39, 166, 255, 0.5);
  transform: translateY(-1px);
}

button[type="submit"] {
  display: inline-flex;
  align-self: flex-start;
  justify-content: center;
  width: auto;
  min-width: 400px;
  max-width: 100%;
}

.grid-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.35rem;
}

.stack-form {
  display: flex;
  flex-direction: column;
}

.standard-form-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.75rem;
  align-items: center;
}

.standard-form-grid > label {
  text-align: right;
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.standard-form-grid > input,
.standard-form-grid > select,
.standard-form-grid > textarea,
.standard-form-grid > button {
  margin: 0;
  width: 100%;
}

.standard-form-grid-full {
  grid-column: 1 / -1;
  margin: 0;
}

/* Checkbox Variant within Standard Form Grids */
.standard-form-checkbox {
  width: auto;
  margin: 0;
  display: inline-block;
  vertical-align: middle;
}

.table-wrap {
  overflow-x: auto;
  width: 100%;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.7rem;
}

th,
td {
  text-align: left;
  border-bottom: 1px solid var(--border);
  padding: 12px 14px;
  font-size: 0.93rem;
  color: var(--ink);
  vertical-align: middle;
}

th {
  background: transparent;
  color: var(--ink);
  font-weight: 600;
  white-space: nowrap;
  border-bottom: 2px solid var(--border);
}

.contacts-filter-row th {
  background: #eaf6ff;
  color: var(--ink);
}

.contacts-filter-row input {
  margin: 0;
  min-width: 110px;
}

.contacts-filter-row select {
  margin: 0;
  min-width: 120px;
}

.table-filter-row th {
  background: #eaf6ff;
  color: var(--ink);
}

.table-filter-row input,
.table-filter-row select {
  margin: 0;
}

.assets-bulk-action-row {
  display: flex;
  justify-content: center;
  gap: 0.45rem;
}

.assets-bulk-action-row .tiny-btn {
  width: auto;
}

.assets-select-checkbox {
  width: auto;
  margin: 0;
}

.bluesky-discovery-quality-select {
  min-width: 88px;
}

#blueskyDiscoveryBulkActions {
  justify-content: flex-start;
  align-items: center;
  gap: 0.65rem;
}

#blueskyDiscoveryBulkActions label {
  margin: 0;
}

.bluesky-discovery-feedback-pop textarea {
  min-height: 140px;
}

#blueskyDiscoveryResultsTable {
  table-layout: fixed;
  width: 100%;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-post-col,
#blueskyDiscoveryResultsTable .bluesky-discovery-post-cell {
  width: 24%;
  max-width: 24%;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-score-col,
#blueskyDiscoveryResultsTable .bluesky-discovery-score-cell {
  width: 58px;
  min-width: 58px;
  text-align: center;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-metric-col,
#blueskyDiscoveryResultsTable .bluesky-discovery-metric-cell {
  width: 64px;
  min-width: 64px;
  text-align: center;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-actions-col,
#blueskyDiscoveryResultsTable .bluesky-discovery-actions-cell {
  min-width: 168px;
  width: 168px;
  white-space: nowrap;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-post-cell {
  overflow: visible;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-post-preview-wrap {
  position: relative;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-post-link {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-post-link {
  cursor: pointer;
}

.bluesky-discovery-post-overlay {
  position: fixed;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  padding: 0;
  border-radius: 14px;
  border: 1px solid #8bc4f4;
  background: #f4fbff;
  box-shadow: 0 24px 60px rgba(9, 28, 48, 0.28);
  color: #16324c;
  font-size: 1rem;
}

.bluesky-discovery-post-overlay.hidden {
  display: none;
}

.bluesky-discovery-post-overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem 0.7rem;
  border-bottom: 1px solid #c7e3fb;
  background: linear-gradient(180deg, #e8f5ff 0%, #f4fbff 100%);
}

.bluesky-discovery-post-overlay-body {
  flex: 1 1 auto;
  padding: 1rem 1.15rem 1.1rem;
  white-space: pre-wrap;
  overflow-y: auto;
  overflow-x: hidden;
  line-height: 1.65;
}

#blueskyDiscoveryResultsTable .bluesky-discovery-actions-cell > * {
  vertical-align: middle;
}

.bluesky-reply-source-row td {
  padding: 0.55rem 0.65rem;
}

.bluesky-reply-source-card {
  background: linear-gradient(180deg, #edf7ff 0%, #dff1ff 100%);
  border: 1px solid #b9dfff;
  border-radius: 10px;
  padding: 0.85rem 1rem;
}

.bluesky-reply-source-label {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #1d4f91;
  margin-bottom: 0.35rem;
}

.bluesky-reply-source-text {
  font-weight: 700;
  color: #123456;
  white-space: pre-wrap;
}

.bluesky-reply-feedback-pop textarea {
  min-height: 150px;
}

.bluesky-prompt-summary {
  margin-bottom: 0.85rem;
  padding: 0.85rem 1rem;
  border: 1px solid #b9dfff;
  border-radius: 10px;
  background: #f6fbff;
  color: #17324d;
  line-height: 1.45;
}

.bluesky-prompt-summary.is-missing {
  border-color: #f0b6a3;
  background: #fff4ef;
  color: #8a2d17;
}

.youtube-date-filter-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  align-items: flex-start;
}

.youtube-date-filter-wrap input[type="date"] {
  min-width: 150px;
}

.youtube-date-filter-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.youtube-date-filter-item span {
  min-width: 34px;
  font-size: 0.82rem;
  color: #1b3554;
  white-space: nowrap;
}

.contacts-go-cell {
  min-width: 78px;
  width: 78px;
}

.contacts-go-cell button {
  width: 100%;
  min-width: 56px;
}

#segmentsList {
  list-style: none;
  padding-left: 0;
}

#segmentsList li {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.5rem;
  margin: 0.35rem 0;
  background: #ffffff;
}

.cards {
  display: grid;
  gap: 0.7rem;
  margin-top: 0.8rem;
}

#messagingPage .cards {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.card {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.7rem;
  background: var(--paper-elevated);
}

.messaging-content-map {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.9rem;
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid rgba(16, 126, 208, 0.16);
  border-radius: 22px;
  background:
    radial-gradient(circle at top left, rgba(216, 241, 255, 0.65) 0%, rgba(255, 255, 255, 0.95) 38%, #ffffff 100%);
}

.messaging-content-node {
  display: grid;
  gap: 0.3rem;
  min-height: 104px;
  padding: 0.9rem;
  border: 1px solid rgba(16, 126, 208, 0.2);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  color: #16324c;
  text-align: left;
  box-shadow: 0 10px 20px rgba(16, 38, 58, 0.06);
  cursor: pointer;
}

.messaging-content-node:hover {
  border-color: rgba(16, 126, 208, 0.4);
  background: #dff1ff;
  box-shadow: 0 14px 24px rgba(16, 38, 58, 0.1);
}

.messaging-content-node-kicker {
  font-size: 0.73rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6d88a4;
}

.messaging-content-node-title {
  font-size: 1rem;
  font-weight: 800;
  line-height: 1.15;
}

.messaging-content-node-short {
  background: linear-gradient(180deg, rgba(255, 251, 239, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.messaging-content-node-social {
  background: linear-gradient(180deg, rgba(238, 250, 255, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.messaging-content-node-long {
  background: linear-gradient(180deg, rgba(241, 247, 255, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.messaging-content-node-support {
  background: linear-gradient(180deg, rgba(244, 255, 245, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.messaging-category-map {
  margin-bottom: 1rem;
}

#messagingPage .messaging-category-map.messaging-content-map {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.1rem;
  padding: 1.2rem;
}

#messagingPage .messaging-category-map .messaging-content-node {
  min-height: 136px;
  padding: 1.1rem;
}

.messaging-category-node {
  background: linear-gradient(180deg, rgba(232, 245, 255, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.develop-flow-map {
  position: relative;
  min-height: 560px;
  margin-top: 1.15rem;
  border: 1px solid rgba(16, 126, 208, 0.16);
  border-radius: 26px;
  background:
    radial-gradient(circle at center, rgba(195, 226, 252, 0.26) 0%, rgba(255, 255, 255, 0) 42%),
    linear-gradient(180deg, rgba(247, 252, 255, 0.96) 0%, rgba(241, 248, 253, 0.98) 100%);
}

.develop-flow-node {
  position: absolute;
  width: 220px;
  min-height: 126px;
  padding: 1rem 1.1rem;
  border: 2px solid #4f96dc;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  color: #16324c;
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
  box-shadow: 0 14px 28px rgba(16, 38, 58, 0.08);
  cursor: pointer;
  transition: transform 140ms ease, box-shadow 140ms ease, background-color 140ms ease;
}

.develop-flow-node:hover {
  background: #dff1ff;
  box-shadow: 0 18px 34px rgba(16, 38, 58, 0.13);
}

.develop-flow-node-kicker {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6d88a4;
}

.develop-flow-node-title {
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.15;
}

.develop-flow-node-top {
  top: 34px;
  left: 50%;
  transform: translateX(-50%);
}

.develop-flow-node-top:hover {
  transform: translateX(-50%) translateY(-3px);
}

.develop-flow-node-upper-right {
  top: 160px;
  right: 16%;
}

.develop-flow-node-lower-right {
  right: 23%;
  bottom: 54px;
}

.develop-flow-node-lower-left {
  left: 23%;
  bottom: 54px;
}

.develop-flow-node-upper-left {
  top: 160px;
  left: 16%;
}

.messaging-content-filter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin: 0.25rem 0 0.8rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(16, 126, 208, 0.18);
  border-radius: 14px;
  background: rgba(223, 241, 255, 0.7);
}

.messaging-content-filter span {
  font-weight: 700;
  color: #0b4d80;
}

.messaging-content-filter button {
  width: auto;
}

.asset-launcher-block {
  margin-top: 1rem;
}

.asset-launcher-map {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 0.8rem;
}

.asset-launcher-node {
  display: grid;
  justify-items: center;
  gap: 0.6rem;
  min-height: 140px;
  padding: 1rem;
  border: 1px solid rgba(16, 126, 208, 0.2);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 10px 20px rgba(16, 38, 58, 0.06);
  color: #16324c;
  text-align: center;
  cursor: pointer;
}

.asset-launcher-node:hover {
  border-color: rgba(16, 126, 208, 0.42);
  background: #dff1ff;
  box-shadow: 0 14px 24px rgba(16, 38, 58, 0.1);
}

.asset-launcher-node-icon {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 18px;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #0b4d80;
  border: 1px solid rgba(16, 126, 208, 0.18);
  background: rgba(255, 255, 255, 0.92);
}

.asset-launcher-node-title {
  font-size: 1.06rem;
  font-weight: 800;
  line-height: 1.1;
}

.asset-launcher-node-image {
  background: linear-gradient(180deg, rgba(255, 248, 236, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.asset-launcher-node-audio {
  background: linear-gradient(180deg, rgba(238, 250, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.asset-launcher-node-video {
  background: linear-gradient(180deg, rgba(243, 244, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.asset-launcher-node-magnet {
  background: linear-gradient(180deg, rgba(244, 255, 245, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
}

.asset-category-map .messaging-content-node {
  min-height: 92px;
}

.asset-category-node {
  background: linear-gradient(180deg, rgba(232, 245, 255, 0.96) 0%, rgba(255, 255, 255, 0.98) 100%);
}

#messagingContentPage .page-heading-row h2 {
  font-size: 2.25rem;
}

.messaging-content-actions-heading,
.messaging-content-actions-cell {
  width: 1%;
  white-space: nowrap;
}

.campaign-actions-cell {
  width: 1%;
  white-space: nowrap;
}

.hidden {
  display: none;
}

.icon-builder-result {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.9rem;
  align-items: center;
  margin: 0.8rem 0 1.2rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--paper-elevated);
}

.icon-builder-result img {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #ffffff;
}

.icon-builder-result-meta {
  display: grid;
  gap: 0.25rem;
}

.icon-builder-result-meta strong {
  font-size: 0.98rem;
}

.icon-builder-result-meta span {
  color: var(--muted);
  font-size: 0.88rem;
}

.docs-page {
  max-width: 1000px;
  margin: 0 auto;
}

.profile-logo-preview {
  margin-top: 0.25rem;
}

.media-edit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(260px, 0.9fr);
  gap: 1.5rem;
  align-items: start;
}

.media-edit-primary,
.media-edit-sidebar {
  display: grid;
  gap: 0.9rem;
  align-content: start;
}

.media-edit-preview {
  justify-items: center;
  align-items: center;
  min-height: 280px;
}

.profile-logo-preview {
  width: 100%;
}

.profile-logo-preview-link {
  display: flex;
  width: 100%;
  justify-content: center;
  text-decoration: none;
}

.profile-logo-preview-link.is-disabled {
  cursor: default;
  pointer-events: none;
}

.profile-logo-preview img {
  display: block;
  max-width: min(75%, 720px);
  max-height: 440px;
  width: auto;
  height: auto;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  object-fit: contain;
}

.profile-save-row {
  display: flex;
  justify-content: center;
  margin-top: 0.25rem;
}

@media (max-width: 900px) {
  .media-edit-layout {
    grid-template-columns: 1fr;
  }

  .media-edit-preview {
    justify-items: center;
  }

  .project-details-layout {
    grid-template-columns: 1fr;
  }
}

.docs-intro {
  max-width: 1000px;
  margin: 0.35rem auto 1rem;
  line-height: 1.6;
}

.docs-nav-grid,
.docs-panel-grid {
  display: block;
  max-width: 1000px;
  margin: 1rem auto 0;
}

.docs-nav-grid {
  margin-bottom: 1.35rem;
}

.docs-nav-btn {
  display: block;
  width: auto;
  min-width: 220px;
  margin: 0 0 0.7rem 0;
}

.docs-flow-infographic {
  max-width: 1000px;
  margin: 1.2rem auto 1.6rem;
  padding: 1.2rem 1.25rem 1.3rem;
  border: 1px solid rgba(16, 126, 208, 0.34);
  border-radius: 18px;
  position: relative;
  background:
    radial-gradient(circle at top right, rgba(166, 219, 255, 0.9), transparent 34%),
    linear-gradient(180deg, #fafdff 0%, #edf6ff 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
}

.docs-flow-row {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr) 42px minmax(0, 1fr);
  align-items: stretch;
  gap: 0.75rem;
}

.docs-flow-row + .docs-flow-row {
  margin-top: 0.9rem;
}

.docs-flow-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 42px;
  color: #0b73c6;
  font-size: 1.8rem;
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 2px 0 rgba(255, 255, 255, 0.9), 0 0 18px rgba(11, 115, 198, 0.14);
}

.docs-flow-drop {
  position: relative;
  z-index: 1;
  width: 78%;
  height: 0;
  margin: -0.15rem auto -0.5rem;
  border-left: 180px solid transparent;
  border-right: 180px solid transparent;
  border-top: 42px solid rgba(127, 195, 244, 0.24);
  filter: drop-shadow(0 10px 16px rgba(61, 137, 199, 0.08));
}

.docs-flow-drop-secondary {
  border-top-color: rgba(110, 184, 241, 0.2);
}

.docs-flow-node {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  justify-content: stretch;
  column-gap: 0.9rem;
  width: 100%;
  min-width: 0;
  max-width: none;
  padding: 0.9rem 1rem;
  border-radius: 16px;
  border: 1px solid rgba(24, 117, 194, 0.28);
  text-align: left;
  line-height: 1.25;
  color: #10263a;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 12px 24px rgba(16, 38, 58, 0.06);
}

.docs-flow-node:hover {
  transform: translateY(-1px);
  border-color: rgba(16, 126, 208, 0.5);
  box-shadow: 0 14px 30px rgba(16, 38, 58, 0.1);
}

.docs-flow-node-copy {
  display: block;
  min-width: 0;
}

.docs-flow-node-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 52px;
  height: 52px;
  margin-top: 0.05rem;
  padding: 0 0.5rem;
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(219, 242, 255, 0.95) 0%, rgba(194, 228, 250, 0.92) 100%);
  border: 1px solid rgba(16, 126, 208, 0.34);
  color: #0a5e9f;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
}

.docs-flow-node-kicker {
  display: block;
  margin-bottom: 0.25rem;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4f7aa3;
}

.docs-flow-node-title {
  display: block;
  font-size: 1.02rem;
  font-weight: 800;
}

.docs-flow-node-meta {
  display: block;
  margin-top: 0.28rem;
  font-size: 0.82rem;
  color: #52667c;
}

.docs-flow-node-intake {
  background: linear-gradient(180deg, #ffffff 0%, #eef8ef 100%);
}

.docs-flow-node-structure {
  background: linear-gradient(180deg, #ffffff 0%, #f4f8ff 100%);
}

.docs-flow-node-build {
  background: linear-gradient(180deg, #ffffff 0%, #fff7ea 100%);
}

.docs-flow-node-launch {
  background: linear-gradient(180deg, #ffffff 0%, #fef2e8 100%);
}

.docs-flow-node-execute {
  background: linear-gradient(180deg, #ffffff 0%, #eef7ff 100%);
}

.docs-flow-node-measure {
  background: linear-gradient(180deg, #ffffff 0%, #eefaf9 100%);
}

.docs-flow-support {
  display: grid;
  grid-template-columns: 1fr;
  align-items: stretch;
  gap: 0.8rem;
  margin-top: 1rem;
  padding-top: 0.95rem;
  border-top: 1px solid rgba(16, 126, 208, 0.16);
}

.docs-flow-support-label {
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5a7188;
}

.docs-flow-node-support {
  background: linear-gradient(180deg, #ffffff 0%, #f3f8ff 100%);
}

.docs-flow-node-wide {
  min-height: 96px;
}

.docs-flow-node-support-secondary {
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.acquire-flow-map {
  position: relative;
  min-height: 920px;
  margin: 1.2rem 0 1.8rem;
  padding: 1.35rem 1.25rem 1.5rem;
  border-radius: 22px;
  border: 1px solid rgba(16, 126, 208, 0.18);
  background:
    radial-gradient(circle at center, rgba(196, 230, 252, 0.45) 0%, rgba(244, 250, 255, 0.9) 30%, #ffffff 72%);
}

.acquire-flow-core-wrap {
  position: absolute;
  left: 50%;
  top: 510px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
}

.acquire-flow-core {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 540px;
  height: 540px;
  border-radius: 50%;
  border: 2px solid rgba(16, 126, 208, 0.28);
  background: radial-gradient(circle at 35% 30%, #ffffff 0%, #dff1ff 45%, #cbe7fb 100%);
  color: #0b4d80;
  box-shadow: 0 14px 28px rgba(13, 75, 125, 0.12);
  text-align: center;
}

.acquire-flow-core-kicker {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5c7e9e;
}

.acquire-flow-core-title {
  margin-top: 0.35rem;
  font-size: 6.6rem;
  font-weight: 900;
  line-height: 1;
}

.acquire-flow-node {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  height: 120px;
  padding: 1rem;
  border: 1px solid rgba(16, 126, 208, 0.22);
  border-radius: 25px;
  background: rgba(255, 255, 255, 0.94);
  color: #16324c;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 10px 20px rgba(16, 38, 58, 0.06);
  text-align: center;
}

.acquire-flow-node:hover {
  border-color: rgba(16, 126, 208, 0.42);
  box-shadow: 0 12px 24px rgba(16, 38, 58, 0.1);
}

.acquire-flow-node::before {
  content: "";
  position: absolute;
  left: auto;
  right: auto;
  top: auto;
  bottom: auto;
  width: 72px;
  height: 10px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.96) 0%, rgba(11, 130, 212, 0.78) 100%);
  pointer-events: none;
}

.acquire-flow-node::after {
  content: "";
  position: absolute;
  left: auto;
  right: auto;
  top: auto;
  bottom: auto;
  width: 0;
  height: 0;
  border-top: 16px solid transparent;
  border-bottom: 16px solid transparent;
  border-left: 24px solid rgba(11, 130, 212, 0.96);
  pointer-events: none;
}

.acquire-flow-label {
  line-height: 1.1;
  font-size: 0.98rem;
}

.acquire-flow-node-web {
  left: 430px;
  top: 140px;
}

.acquire-flow-node-web::before {
  left: 100%;
  top: 50%;
  width: 72px;
  height: 10px;
  transform: translate(10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.96) 0%, rgba(11, 130, 212, 0.78) 100%);
}

.acquire-flow-node-web::after {
  left: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-top: 16px solid transparent;
  border-bottom: 16px solid transparent;
  border-left: 24px solid rgba(11, 130, 212, 0.96);
  border-right: 0;
}

.acquire-flow-node-youtube {
  left: 380px;
  top: 300px;
}

.acquire-flow-node-youtube::before {
  left: 100%;
  top: 50%;
  transform: translate(10px, -50%);
}

.acquire-flow-node-youtube::after {
  left: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
}

.acquire-flow-node-instagram {
  left: 340px;
  top: 460px;
}

.acquire-flow-node-instagram::before {
  left: 100%;
  top: 50%;
  transform: translate(10px, -50%);
}

.acquire-flow-node-instagram::after {
  left: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
}

.acquire-flow-node-tiktok {
  left: 380px;
  top: 620px;
}

.acquire-flow-node-tiktok::before {
  left: 100%;
  top: 50%;
  transform: translate(10px, -50%);
}

.acquire-flow-node-tiktok::after {
  left: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
}

.acquire-flow-node-facebook {
  left: 430px;
  top: 780px;
}

.acquire-flow-node-facebook::before {
  left: 100%;
  top: 50%;
  transform: translate(10px, -50%);
}

.acquire-flow-node-facebook::after {
  left: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
}

.acquire-flow-node-x {
  right: 430px;
  top: 140px;
}

.acquire-flow-node-x::before {
  right: 100%;
  top: 50%;
  transform: translate(-10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.78) 0%, rgba(11, 130, 212, 0.96) 100%);
}

.acquire-flow-node-x::after {
  right: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-left: 0;
  border-right: 24px solid rgba(11, 130, 212, 0.96);
}

.acquire-flow-node-reddit {
  right: 380px;
  top: 300px;
}

.acquire-flow-node-reddit::before {
  right: 100%;
  top: 50%;
  transform: translate(-10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.78) 0%, rgba(11, 130, 212, 0.96) 100%);
}

.acquire-flow-node-reddit::after {
  right: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-left: 0;
  border-right: 24px solid rgba(11, 130, 212, 0.96);
}

.acquire-flow-node-quora {
  right: 340px;
  top: 460px;
}

.acquire-flow-node-quora::before {
  right: 100%;
  top: 50%;
  transform: translate(-10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.78) 0%, rgba(11, 130, 212, 0.96) 100%);
}

.acquire-flow-node-quora::after {
  right: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-left: 0;
  border-right: 24px solid rgba(11, 130, 212, 0.96);
}

.acquire-flow-node-substack {
  right: 380px;
  top: 620px;
}

.acquire-flow-node-substack::before {
  right: 100%;
  top: 50%;
  transform: translate(-10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.78) 0%, rgba(11, 130, 212, 0.96) 100%);
}

.acquire-flow-node-substack::after {
  right: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-left: 0;
  border-right: 24px solid rgba(11, 130, 212, 0.96);
}

.acquire-flow-node-medium {
  right: 430px;
  top: 780px;
}

.acquire-flow-node-medium::before {
  right: 100%;
  top: 50%;
  transform: translate(-10px, -50%);
  background: linear-gradient(90deg, rgba(11, 130, 212, 0.78) 0%, rgba(11, 130, 212, 0.96) 100%);
}

.acquire-flow-node-medium::after {
  right: calc(100% + 82px);
  top: 50%;
  transform: translateY(-50%);
  border-left: 0;
  border-right: 24px solid rgba(11, 130, 212, 0.96);
}

@media (max-width: 1100px) {
  .acquire-flow-map {
    min-height: 760px;
  }

  .acquire-flow-core {
    width: 360px;
    height: 360px;
  }

  .acquire-flow-core-title {
    font-size: 4.4rem;
  }

  .acquire-flow-node {
    width: 112px;
    height: 112px;
    font-size: 0.94rem;
  }

  .acquire-flow-node::before {
    width: 60px;
    height: 9px;
  }

  .acquire-flow-node::after {
    border-top-width: 14px;
    border-bottom-width: 14px;
    border-left-width: 22px;
  }
}

@media (max-width: 900px) {
  .acquire-flow-map {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-height: auto;
    padding: 1rem;
  }

  .acquire-flow-core-wrap,
  .acquire-flow-node {
    position: static;
    transform: none;
  }

  .acquire-flow-core-wrap {
    order: -1;
    margin-bottom: 0.35rem;
  }

  .acquire-flow-core {
    width: 150px;
    height: 150px;
  }

  .acquire-flow-node {
    width: 100%;
    height: auto;
    min-height: 78px;
  }

  .acquire-flow-node::before,
  .acquire-flow-node::after {
    display: none;
  }
}

.docs-panel {
  margin: 0 0 1.5rem 0;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: 0;
}

.docs-panel h3 {
  margin: 0 0 0.45rem 0;
}

.docs-panel p:last-child,
.docs-panel ul:last-child {
  margin-bottom: 0;
}

.docs-platform-selector {
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.docs-platform-selector-left {
  display: grid;
  gap: 0.55rem;
}

.docs-platform-selector-left .docs-nav-btn {
  margin: 0;
  width: 100%;
  min-width: 0;
  text-align: left;
}

.docs-platform-selector-right {
  border: 1px solid rgba(16, 126, 208, 0.2);
  border-radius: 10px;
  padding: 0.85rem 0.95rem;
  background: #f7fbff;
}

.docs-platform-detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.docs-platform-docs-body h4 {
  margin: 0.25rem 0 0.5rem;
}

.docs-platform-docs-body ul {
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
  padding-left: 1.1rem;
}

.docs-list {
  margin: 0;
  padding-left: 1.15rem;
  line-height: 1.6;
}

.docs-list li + li {
  margin-top: 0.35rem;
}

.docs-kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem 1rem;
}

.docs-kv-item {
  font-size: 0.95rem;
}

.docs-checklist-line {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0 0 0.35rem 0;
}

.docs-checklist-line input[type='checkbox'] {
  margin-top: 0.2rem;
}

.docs-checklist-line a {
  margin-left: 0.1rem;
  font-size: 0.88rem;
}

#docsOrchestratorChannelsBody tr.docs-orchestrator-row-complete {
  background: #eaf8ec;
}

#docsOrchestratorChannelsBody tr.docs-orchestrator-row-incomplete {
  background: #fdecef;
}

.docs-portal-link {
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 2px solid #b91c1c;
  color: #b91c1c;
  text-decoration: none;
  font-weight: 700;
  line-height: 1;
  background: #fff;
}

.docs-portal-link:hover {
  background: #fff5f5;
}

.docs-portal-link-done {
  border-color: #157347;
  color: #157347;
}

.docs-portal-link-done:hover {
  background: #eefaf3;
}

.docs-kicker {
  display: block;
  margin: 0 0 0.35rem 0;
  padding: 0;
  background: transparent;
  color: #0b82d4;
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

@media (max-width: 900px) {
  .docs-flow-infographic {
    padding: 1rem;
  }

  .docs-flow-row {
    grid-template-columns: 1fr;
    gap: 0.55rem;
  }

  .docs-flow-arrow {
    display: none;
  }

  .docs-flow-drop {
    display: none;
  }

  .docs-flow-node {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .docs-flow-support {
    grid-template-columns: 1fr;
    align-items: flex-start;
  }

  .docs-kv-grid {
    grid-template-columns: 1fr;
  }
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}

.toolbar button {
  width: auto;
}

.contacts-top-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
  margin-bottom: 0.8rem;
}

.top-module {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.8rem;
  background: #ffffff;
}

.top-module h3 {
  margin: 0 0 0.6rem;
}

.code-box {
  margin: 0.5rem 0 1rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #08131f;
  color: #d6f1ff;
  font-size: 0.86rem;
  line-height: 1.45;
  max-height: 280px;
  overflow: auto;
}

.filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.35rem;
  margin-bottom: 0.5rem;
}

.social-grid-left {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.35rem;
}

.filters.filters-contacts {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.filters.filters-contacts-3x4 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.filters input {
  margin: 0;
}

.segment-social-controls {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.6rem;
  margin-bottom: 0.6rem;
  background: #ffffff;
}

.segment-social-mode {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 0.45rem;
}

.segment-social-mode .checkbox-row {
  padding: 0;
  margin: 0;
}

.segment-social-checks {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.2rem 0.8rem;
  margin-bottom: 0.45rem;
}

.labeled-form .form-row {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 0.6rem;
  align-items: center;
}

.labeled-form .form-row.hidden {
  display: none;
}

.labeled-form .form-row > label {
  font-weight: 600;
}

.labeled-form .form-row .field-stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.labeled-form .form-row:has(textarea),
.labeled-form .form-row:has(.messaging-richtext-editor) {
  align-items: start;
}

.labeled-form .form-row:has(textarea) > label,
.labeled-form .form-row:has(.messaging-richtext-editor) > label {
  align-self: start;
  padding-top: 0.55rem;
}

.labeled-form {
  --label-col-width: 180px;
  --label-col-gap: 0.6rem;
}

.labeled-form > button[type="submit"] {
  width: min(520px, calc(100% - var(--label-col-width) - var(--label-col-gap)));
  min-width: min(400px, calc(100% - var(--label-col-width) - var(--label-col-gap)));
  max-width: calc(100% - var(--label-col-width) - var(--label-col-gap));
  margin-top: 0.55rem;
  margin-left: calc(
    var(--label-col-width) + var(--label-col-gap) +
    (
      (
        100% - var(--label-col-width) - var(--label-col-gap) -
        min(520px, calc(100% - var(--label-col-width) - var(--label-col-gap)))
      ) / 2
    )
  );
  margin-right: 0;
  align-self: auto;
}

#campaignForm.labeled-form {
  --label-col-width: 150px;
  --label-col-gap: 0.75rem;
}

#campaignForm > .grid-form {
  align-items: start;
}

#campaignForm > .grid-form > .stack-form {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  margin: 0;
  padding-top: 0;
}

#campaignForm.labeled-form .form-row > label {
  margin: 0;
  justify-self: end;
  text-align: right;
  white-space: nowrap;
}

#campaignForm.labeled-form .form-row > input,
#campaignForm.labeled-form .form-row > select,
#campaignForm.labeled-form .form-row > textarea {
  width: 100%;
  min-width: 0;
}

#messagingCreateContentSuggestionsTable th:first-child,
#messagingCreateContentSuggestionsTable td:first-child {
  width: 44px;
  text-align: center;
}

.messaging-create-content-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 1rem;
  align-items: start;
}

.messaging-create-content-column {
  min-width: 0;
}

.messaging-create-content-results {
  border: 1px solid rgba(47, 108, 223, 0.18);
  border-radius: 12px;
  padding: 14px;
  background: #f8fbff;
}

#messagingCreateContentFeedbackWrap textarea {
  min-height: 120px;
}

#messagingCreateContentSuggestionsEmpty {
  color: #39516d;
  line-height: 1.45;
}

.messaging-richtext-toolbar {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  padding-bottom: 2px;
}

.messaging-richtext-toolbar button {
  min-width: 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 0.95rem;
  line-height: 1;
  flex: 0 0 auto;
}

.messaging-richtext-editor {
  min-height: 320px;
  border: 1px solid #b9caea;
  border-radius: 8px;
  background: #fff;
  padding: 12px;
  line-height: 1.5;
  box-shadow: inset 0 1px 2px rgba(19, 37, 68, 0.04);
}

.messaging-richtext-editor:focus {
  outline: 2px solid rgba(47, 108, 223, 0.22);
  outline-offset: 1px;
}

.messaging-content-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

#campaignForm > .grid-form > .stack-form > h3 {
  margin: 0 0 0.5rem 0 !important;
  line-height: 1.2;
}

#campaignContentChannelHint {
  margin: 0 0 0.35rem 0;
  min-height: 0;
}

.asset-edit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.asset-upload-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.asset-upload-progress {
  margin-top: 0.45rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.45rem 0.55rem;
  background: #f8fbff;
}

.asset-upload-progress-text {
  font-size: 0.86rem;
  color: #1f2937;
  margin-bottom: 0.35rem;
}

.asset-upload-progress progress {
  width: 100%;
  height: 12px;
}

.messaging-topics-ai-toolbar {
  display: flex;
  justify-content: center;
  margin: 1rem 0 0.6rem;
}

.messaging-topics-ai-toolbar button {
  width: auto;
  min-width: 260px;
}

.messaging-topics-suggestions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  align-items: start;
}

.messaging-topics-suggestion-card {
  border: 1px solid #c9def4;
  border-radius: 12px;
  padding: 0.9rem 1rem;
  background: #f8fbff;
}

.messaging-topics-suggestion-card h4 {
  margin: 0 0 0.75rem;
  color: #17324d;
}

.messaging-topics-suggestion-list {
  display: grid;
  gap: 0.45rem;
}

.messaging-topics-suggestion-list .checkbox-row {
  align-items: flex-start;
  padding: 0;
}

.messaging-topics-suggestion-list .checkbox-row span {
  line-height: 1.35;
}

.asset-edit-layout #assetForm {
  margin: 0;
}

.asset-preview-panel {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.7rem;
  background: #ffffff;
}

.asset-preview-panel h3 {
  margin: 0;
}

.asset-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  margin-bottom: 0.6rem;
}

.asset-preview-label {
  font-weight: 700;
  margin-right: 0.3rem;
}

.asset-preview-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  min-height: 460px;
  max-height: 70vh;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: #f8fbff;
}

.asset-preview-empty {
  color: var(--muted);
}

.asset-preview-media {
  width: 100%;
  max-width: 100%;
  max-height: calc(70vh - 120px);
  object-fit: contain;
}

.asset-preview-audio {
  width: 100%;
  max-width: 100%;
}

.asset-preview-frame {
  width: 100%;
  height: calc(70vh - 130px);
  max-height: calc(70vh - 130px);
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #ffffff;
}

.asset-preview-copy {
  width: 100%;
  white-space: pre-wrap;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.7rem;
  min-height: 120px;
}

.asset-preview-link {
  margin: 0;
}

.asset-preview-meta {
  margin-top: 0.55rem;
  width: 100%;
}

.asset-preview-meta-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.develop-template-canvas {
  --lp-primary: #0b82d4;
  --lp-background: #f5fbff;
  --lp-accent: #1a4f81;
  --lp-page-background-image: none;
  --lp-page-background-overlay: linear-gradient(135deg, rgba(238, 248, 255, 0.54) 0%, rgba(248, 252, 255, 0.62) 44%, rgba(237, 244, 255, 0.58) 100%);
  --lp-border-thickness: 1px;
  --lp-radius: 12px;
  --lp-blur: 0px;
  --lp-filter: none;
  --lp-border: rgba(15, 79, 143, 0.24);
  --lp-border-soft: rgba(15, 79, 143, 0.2);
  --lp-dash-border: rgba(94, 143, 189, 0.78);
  --lp-surface: rgba(255, 255, 255, 0.92);
  --lp-surface-strong: rgba(255, 255, 255, 0.94);
  --lp-surface-soft: rgba(255, 255, 255, 0.88);
  --lp-surface-alt: #f4f9ff;
  margin-top: 0.8rem;
  padding: 1rem;
  border: var(--lp-border-thickness, 1px) solid var(--lp-border, var(--border));
  border-radius: calc(var(--lp-radius, 12px) + 2px);
  background-color: var(--lp-background, #f5fbff);
  background-image:
    var(--lp-page-background-overlay),
    var(--lp-page-background-image),
    radial-gradient(circle at 20% 20%, rgba(71, 176, 255, 0.18), transparent 34%),
    radial-gradient(circle at 82% 18%, rgba(22, 84, 163, 0.22), transparent 26%);
  background-size: cover, cover, auto, auto;
  background-position: center center, center center, center, center;
  background-repeat: no-repeat, no-repeat, no-repeat, no-repeat;
  filter: var(--lp-filter, none);
}

.develop-template-library {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.85rem;
  margin-top: 0.8rem;
}

.develop-template-library-card {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) 168px;
  align-items: center;
  gap: 0.9rem;
  border: 1px solid rgba(15, 79, 143, 0.24);
  border-radius: 12px;
  padding: 0.85rem;
  background: linear-gradient(135deg, #ffffff 0%, #f4fbff 100%);
  text-align: left;
}

.develop-template-library-copy {
  min-width: 0;
}

.develop-template-library-media {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.develop-extensions-tree {
  display: grid;
  gap: 0;
  margin-top: 0.8rem;
}

.develop-extensions-header,
.develop-extension-table-row {
  display: grid;
  grid-template-columns: minmax(280px, 1.2fr) minmax(160px, 0.55fr) minmax(0, 1.7fr);
  gap: 0;
  align-items: start;
  width: 100%;
}

.develop-extensions-header {
  border-bottom: 1px solid rgba(16, 126, 208, 0.18);
  margin-bottom: 0.2rem;
}

.develop-extensions-header-cell,
.develop-extension-table-cell {
  padding: 0.35rem 0.6rem;
  text-align: left;
}

.develop-extensions-header-cell {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #5f7894;
}

.develop-extension-table-row {
  border-bottom: 1px solid rgba(16, 126, 208, 0.08);
}

.develop-extension-table-cell {
  font-size: 0.96rem;
  line-height: 1.35;
  color: #16324c;
}

.develop-extension-name-cell {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 0.45rem;
  align-items: center;
  min-width: 0;
  padding: 0.35rem 0.6rem;
  padding-left: calc(0.6rem + (var(--extension-depth, 0) * 40px));
  width: 100%;
}

.develop-extension-tree-toggle {
  min-width: 14px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #16324c;
  font-size: 0.82rem;
  font-weight: 800;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: none;
}

.develop-extension-tree-toggle.is-empty {
  opacity: 0.65;
}

.develop-extension-name-link {
  width: 100%;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  text-align: left;
  color: #16324c;
  cursor: pointer;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 0.96rem;
  font-weight: 600;
  line-height: 1.35;
}

.develop-extension-name-link:hover,
.develop-extension-name-link:focus-visible {
  color: #0b5f9a;
  background: transparent;
  box-shadow: none;
  text-decoration: underline;
}

.develop-extension-summary-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 980px) {
  .develop-extensions-header,
  .develop-extension-table-row {
    grid-template-columns: minmax(220px, 1fr) minmax(140px, 0.5fr) minmax(0, 1.2fr);
  }
}

.develop-template-library-card.is-selected {
  border-color: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
}

.develop-template-library-card h3 {
  margin: 0 0 0.35rem 0;
  font-size: 1.05rem;
}

.develop-template-library-card p {
  margin: 0 0 0.7rem 0;
  font-size: 0.92rem;
  line-height: 1.45;
  color: #26435c;
}

.develop-template-library-card button {
  width: auto;
  min-width: 160px;
}

.develop-template-card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.develop-template-card-actions button {
  min-width: 128px;
}

.develop-template-editor {
  border: 1px solid rgba(11, 130, 212, 0.28);
  border-radius: 12px;
  padding: 0;
  background: linear-gradient(135deg, #fcfeff 0%, #eef7ff 100%);
  margin-top: 0.7rem;
  margin-bottom: 1rem;
  overflow: hidden;
}

.develop-template-section {
  border: 1px solid rgba(11, 130, 212, 0.24);
  border-radius: 12px;
  background: linear-gradient(135deg, #fcfeff 0%, #eef7ff 100%);
  margin-top: 1rem;
  margin-bottom: 1rem;
  overflow: hidden;
}

.develop-template-section-header-row {
  display: flex;
  align-items: center;
  gap: 0;
  background: #000;
}

.develop-template-section-header-row > button:not(.develop-template-section-toggle) {
  flex: 0 0 auto;
  margin: 0.45rem;
  min-width: 0;
  width: auto;
  white-space: nowrap;
  margin-left: auto;
}

.develop-template-section-toggle {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1 1 auto;
  width: auto;
  min-width: 0;
  margin: 0;
  padding: 0.95rem 1.1rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #fff;
  font-size: 1.05rem;
  font-weight: 700;
  justify-content: flex-start;
  box-shadow: none;
}

.develop-template-section-title {
  flex: 1 1 auto;
  min-width: 0;
  white-space: nowrap;
}

.develop-template-editor .develop-template-section-header-row > button:not(.develop-template-section-toggle) {
  flex: 0 0 auto;
  width: auto;
  max-width: max-content;
  padding-left: 1rem;
  padding-right: 1rem;
}

.develop-template-section-toggle:hover,
.develop-template-section-toggle:focus {
  background: rgba(255, 255, 255, 0.08);
}

.develop-template-section-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  transition: transform 0.18s ease;
}

.develop-template-section-toggle[aria-expanded="false"] .develop-template-section-arrow {
  transform: rotate(-90deg);
}

.develop-template-section-body {
  padding: 1rem 0.95rem 1rem;
}

.develop-template-section-body.hidden {
  display: none;
}

.develop-template-editor--page-mode {
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  margin: 0;
  overflow: visible;
}

.develop-template-editor--page-mode .develop-template-section-header-row,
.develop-template-editor--page-mode #developPageTemplateEditorMeta {
  display: none;
}

.develop-template-editor--page-mode .develop-template-section-body {
  padding: 0;
}

#developLandingPagesPage.app-page {
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.develop-template-records-host {
  margin: 0.75rem 0 1rem;
}

.develop-template-records-card {
  border: 1px solid rgba(15, 79, 143, 0.18);
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
}

.develop-template-records-card h4 {
  margin: 0;
  padding: 0.8rem 0.95rem;
  background: #eef6ff;
  border-bottom: 1px solid rgba(15, 79, 143, 0.14);
  font-size: 0.98rem;
}

.develop-template-records-table {
  width: 100%;
  border-collapse: collapse;
}

.develop-template-records-table th,
.develop-template-records-table td {
  padding: 0.7rem 0.85rem;
  border-bottom: 1px solid rgba(15, 79, 143, 0.12);
  text-align: left;
  vertical-align: top;
  font-size: 0.94rem;
}

.develop-template-records-table th {
  background: #061018;
  color: #fff;
  font-weight: 700;
}

.develop-template-records-table tbody tr:last-child td {
  border-bottom: 0;
}

.develop-template-records-table td.actions-cell {
  white-space: nowrap;
}

.develop-template-records-empty {
  padding: 0.9rem 0.95rem;
  color: #3a5873;
}

.develop-template-picker-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  padding: 0.95rem 1rem;
  border-radius: 14px;
  border: 1px solid rgba(15, 79, 143, 0.14);
  background: rgba(255, 255, 255, 0.96);
  text-align: left;
}

.develop-template-picker-row__copy {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.develop-template-picker-row__title {
  font-weight: 800;
  color: #173c61;
}

.develop-template-picker-row__meta {
  color: #587592;
  font-size: 0.88rem;
}

.develop-template-picker-row__action {
  color: #0b82d4;
  font-weight: 800;
  white-space: nowrap;
}

.develop-template-module-list {
  display: grid;
  gap: 0.6rem;
}

.develop-template-module-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 0.6rem;
  align-items: start;
  border: 1px solid rgba(15, 79, 143, 0.2);
  border-radius: 10px;
  background: #fff;
  padding: 0.55rem 0.65rem;
}

.develop-template-module-item.is-drag-over {
  border-color: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
}

.develop-template-module-item.is-dragging {
  opacity: 0.65;
}

.develop-template-module-grip {
  width: 30px;
  min-height: 64px;
  border: 1px dashed rgba(15, 79, 143, 0.35);
  border-radius: 8px;
  background: #f3f9ff;
  color: #2f5a7c;
  font-size: 1rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.develop-template-module-grip:active {
  cursor: grabbing;
}

.develop-template-module-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
}

.develop-template-module-fields textarea,
.develop-template-module-fields input,
.develop-template-module-fields select {
  width: 100%;
}

.develop-template-module-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  justify-content: flex-end;
}

.develop-template-module-fields .develop-template-module-span {
  grid-column: 1 / -1;
}

.develop-template-module-fields textarea {
  min-height: 68px;
}

.develop-layout-toolbar {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 0.6rem;
}

.develop-layout-toolbar {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 1rem;
  padding: 0.9rem 1rem;
  margin: 0 0 0.9rem;
  border-top: 1px solid #000;
  border-bottom: 1px solid #000;
  background: #4f6f90;
}

.develop-layout-toolbar-heading {
  grid-column: 1 / -1;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: #fff;
}

.develop-layout-tile {
  display: grid;
  align-items: center;
  justify-items: center;
  min-height: 78px;
  padding: 0.45rem;
  border: 1px solid #444;
  border-radius: 12px;
  background: #f7fbff;
  cursor: grab;
  user-select: none;
}

.develop-layout-tile:focus-visible {
  outline: 2px solid #0b82d4;
  outline-offset: 2px;
}

.develop-layout-tile.is-dragging {
  opacity: 0.7;
}

.develop-layout-tile.is-selected {
  background: #d8e8f7;
  border-color: #173c61;
  box-shadow: inset 0 0 0 1px rgba(23, 60, 97, 0.15);
}

.develop-layout-toolbar-icon,
.develop-layout-picker-icon {
  display: grid;
  width: 100%;
  max-width: 112px;
  min-height: 30px;
  gap: 0.28rem;
}

.develop-layout-toolbar-icon span,
.develop-layout-picker-icon span {
  border-radius: 5px;
  border: 1px solid #444;
  background: rgba(15, 79, 143, 0.18);
  min-height: 30px;
}

.develop-row-layout-picker {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.65rem;
  margin-top: 0.45rem;
}

.develop-row-layout-picker__tile {
  min-height: 66px;
  padding: 0.35rem;
  justify-items: stretch;
}

.develop-row-layout-picker .develop-layout-picker-icon {
  display: block;
  width: 88%;
  max-width: none;
  min-height: 44px;
  justify-self: stretch;
}

.develop-row-layout-picker .develop-layout-picker-icon svg {
  display: block;
  width: 100%;
  height: 44px;
}

.develop-layout-toolbar .develop-layout-toolbar-icon {
  display: block;
  width: 88%;
  max-width: none;
  min-height: 44px;
  margin: 0 auto;
}

.develop-layout-toolbar .develop-layout-toolbar-icon svg {
  display: block;
  width: 100%;
  height: 44px;
}

.develop-layout-tile-ghost {
  position: fixed;
  z-index: 10000;
  width: 140px;
  pointer-events: none;
  opacity: 0.88;
  box-shadow: 0 12px 28px rgba(15, 79, 143, 0.18);
}

.develop-layout-toolbar-icon--1-5,
.develop-layout-picker-icon--1-5 {
  grid-template-columns: 1fr 5fr;
}

.develop-layout-toolbar-icon--2-4,
.develop-layout-picker-icon--2-4 {
  grid-template-columns: 2fr 4fr;
}

.develop-layout-toolbar-icon--2-2-2,
.develop-layout-picker-icon--2-2-2 {
  grid-template-columns: 1fr 1fr 1fr;
}

.develop-layout-toolbar-icon--3-3,
.develop-layout-picker-icon--3-3 {
  grid-template-columns: 1fr 1fr;
}

.develop-layout-toolbar-icon--4-2,
.develop-layout-picker-icon--4-2 {
  grid-template-columns: 4fr 2fr;
}

.develop-layout-toolbar-icon--5-1,
.develop-layout-picker-icon--5-1 {
  grid-template-columns: 5fr 1fr;
}

.develop-layout-toolbar-icon--1-4-1,
.develop-layout-picker-icon--1-4-1 {
  grid-template-columns: 1fr 4fr 1fr;
}

.develop-layout-toolbar-icon--6,
.develop-layout-picker-icon--6 {
  grid-template-columns: 1fr;
}

.develop-page-template-section-card {
  display: grid;
  gap: 0.75rem;
}

.develop-page-template-section-summary {
  display: grid;
  grid-template-columns: auto 1fr auto auto auto;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 12px;
  background: linear-gradient(180deg, #fbfdff 0%, #eef6fd 100%);
  text-align: left;
}

.develop-page-template-section-summary.is-collapsed {
  background: linear-gradient(180deg, #f7fbff 0%, #e7f2fb 100%);
}

.develop-page-template-section-summary-grip {
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #315879;
  cursor: grab;
}

.develop-page-template-section-summary-name {
  display: grid;
  gap: 0.15rem;
}

.develop-page-template-section-summary-title {
  font-weight: 700;
  color: #173c61;
}

.develop-page-template-section-summary-layout {
  min-width: 110px;
}

.develop-page-template-section-summary-toggle {
  font-size: 0.95rem;
  color: #173c61;
}

.develop-page-template-section-remove {
  justify-self: end;
  align-self: start;
  margin-bottom: -0.15rem;
  padding: 0.28rem 0.55rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 27, 74, 0.16);
  background: #fff5f8;
  color: #941b4a;
  font-size: 0.76rem;
  font-weight: 700;
}

.develop-page-template-section-body {
  display: grid;
  gap: 0.75rem;
  padding-left: 0.2rem;
}

.develop-page-template-row-config {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.55rem;
}

.develop-layout-picker-btn {
  display: grid;
  gap: 0.35rem;
  padding: 0.55rem 0.45rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 12px;
  background: #f7fbff;
  cursor: pointer;
}

.develop-layout-picker-btn.is-active {
  border-color: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
  background: #e9f4ff;
}

.develop-layout-picker-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-align: center;
  color: #214c71;
}

.develop-page-template-section-modules {
  display: grid;
  gap: 0;
}

.develop-page-template-workspace {
  display: grid;
  gap: 0.9rem;
  min-height: 260px;
  padding: 1rem;
  border: 1px solid #444;
  border-radius: 18px;
  background: linear-gradient(180deg, #eef4f9 0%, #e7eef5 100%);
}

.develop-page-template-workspace-heading {
  margin: 0.2rem 0 0.5rem;
  font-size: 1.45rem;
  font-weight: 800;
  color: #173c61;
  letter-spacing: 0.02em;
}

.develop-page-template-workspace.is-drag-over {
  border-color: #0b82d4;
  box-shadow: inset 0 0 0 3px rgba(11, 130, 212, 0.12);
  background: linear-gradient(180deg, rgba(233, 245, 255, 0.98) 0%, rgba(225, 241, 255, 0.98) 100%);
}

.develop-page-template-workspace-empty {
  display: grid;
  place-items: center;
  min-height: 220px;
  border: 1px dashed rgba(15, 79, 143, 0.22);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  text-align: center;
  padding: 1rem;
}

.develop-page-template-workspace-empty-title {
  font-size: 1.1rem;
  font-weight: 800;
  color: #173c61;
}

.develop-page-template-workspace-empty-copy {
  margin-top: 0.35rem;
  color: #587592;
  max-width: 520px;
}

.develop-page-template-workspace-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.8rem;
  padding: 20px;
  border: 1px solid #777;
  border-radius: 14px;
  background: #d7e1ea;
  overflow: visible;
  align-items: stretch;
}

.develop-page-template-row-actions {
  position: static;
  display: inline-flex;
  flex-direction: column;
  gap: 0.45rem;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  width: 54px;
  min-width: 54px;
  padding-left: 0.2rem;
}

.develop-page-template-row-action {
  width: 48px;
  height: 48px;
  min-width: 48px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid #8c939b;
  background: rgba(126, 134, 143, 0.96);
  color: #fff;
  display: inline-grid;
  place-items: center;
  font-size: 0.82rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(45, 55, 68, 0.16);
}

.develop-builder-inline-icon {
  display: inline-grid;
  place-items: center;
  width: 14px;
  height: 14px;
}

.develop-builder-inline-icon svg {
  width: 14px;
  height: 14px;
  display: block;
}

.develop-page-template-row-action:hover,
.develop-page-template-row-action:focus-visible {
  background: #69717a;
  border-color: #69717a;
}

.develop-page-template-row-action--delete {
  color: #f3e6e4;
}

.develop-page-template-workspace-row.is-dragging {
  opacity: 0.55;
}

.develop-page-template-workspace-row.is-drop-before::before,
.develop-page-template-workspace-row.is-drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  border-radius: 999px;
  background: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
  z-index: 8;
  pointer-events: none;
}

.develop-page-template-workspace-row.is-drop-before::before {
  top: -8px;
}

.develop-page-template-workspace-row.is-drop-after::after {
  bottom: -8px;
}

.develop-page-template-row-cells {
  display: grid;
  gap: 0.85rem;
}

.develop-page-template-row-cell {
  display: grid;
  min-height: 190px;
  border: 1px solid #999;
  border-radius: 14px;
  background: #c8d8e8;
  position: relative;
  place-items: center;
  padding: 1rem;
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
}

.develop-page-template-cell-settings {
  position: absolute;
  inset: 0.7rem 0.7rem auto auto;
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(15, 79, 143, 0.16);
  background: rgba(255, 255, 255, 0.96);
  color: #173c61;
  font-size: 0.9rem;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 8px 20px rgba(15, 79, 143, 0.12);
  z-index: 2;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}

.develop-page-template-cell-settings:hover,
.develop-page-template-cell-settings:focus-visible {
  background: #ffffff;
  border-color: rgba(15, 79, 143, 0.28);
}

.develop-page-template-cell-settings .develop-builder-inline-icon,
.develop-page-template-module-pill-action .develop-builder-inline-icon,
.develop-page-template-row-action .develop-builder-inline-icon {
  width: 13px;
  height: 13px;
}

.develop-page-template-cell-settings .develop-builder-inline-icon svg,
.develop-page-template-module-pill-action .develop-builder-inline-icon svg,
.develop-page-template-row-action .develop-builder-inline-icon svg {
  width: 13px;
  height: 13px;
}

.develop-page-template-row-action .develop-builder-inline-icon {
  width: 24px;
  height: 24px;
}

.develop-page-template-row-action .develop-builder-inline-icon svg {
  width: 24px;
  height: 24px;
}

.develop-page-template-cell-add .develop-builder-inline-icon {
  width: 22px;
  height: 22px;
}

.develop-page-template-cell-add .develop-builder-inline-icon svg {
  width: 22px;
  height: 22px;
}

.develop-page-template-row-cell.is-module-drop-target {
  border-color: #0b82d4;
  box-shadow: inset 0 0 0 3px rgba(11, 130, 212, 0.12);
  background: #c3d6e8;
}

.develop-page-template-row-cell-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  align-items: flex-start;
  justify-content: flex-start;
  width: 100%;
  min-height: 100%;
  padding: 0.5rem 2.8rem 0.5rem 0.5rem;
}

.develop-page-template-row-cell-stack.is-drop-append {
  outline: 3px dashed rgba(11, 130, 212, 0.35);
  outline-offset: 6px;
  border-radius: 18px;
}

.develop-page-template-cell-add {
  position: absolute;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  width: 54px;
  height: 54px;
  min-width: 54px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid rgba(15, 79, 143, 0.18);
  background: rgba(255, 255, 255, 0.96);
  color: #0f4f8f;
  display: inline-grid;
  place-items: center;
  box-shadow: 0 10px 24px rgba(15, 79, 143, 0.12);
}

.develop-page-template-cell-add:hover,
.develop-page-template-cell-add:focus-visible {
  transform: translate(-50%, -50%);
}

.develop-page-template-row-cell:has(.develop-page-template-module-pill) .develop-page-template-cell-add {
  inset: auto 0.8rem 0.8rem auto;
  transform: none;
  width: 38px;
  height: 38px;
  min-width: 38px;
}

.develop-page-template-row-cell:has(.develop-page-template-module-pill) .develop-page-template-cell-add:hover,
.develop-page-template-row-cell:has(.develop-page-template-module-pill) .develop-page-template-cell-add:focus-visible {
  transform: none;
}

.develop-page-template-module-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 2.35rem 0.5rem 0.7rem;
  min-width: 0;
  border-radius: 999px;
  border: 1px solid rgba(15, 79, 143, 0.16);
  background: #aebfd0;
  color: #173c61;
  font-weight: 700;
  cursor: pointer;
  text-align: left;
}

.develop-page-template-module-pill.is-dragging {
  opacity: 0.4;
}

.develop-page-template-module-pill.is-drop-before::before,
.develop-page-template-module-pill.is-drop-after::after {
  content: '';
  position: absolute;
  left: -8px;
  right: -8px;
  height: 4px;
  border-radius: 999px;
  background: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
  pointer-events: none;
}

.develop-page-template-module-pill.is-drop-before::before {
  top: -8px;
}

.develop-page-template-module-pill.is-drop-after::after {
  bottom: -8px;
}

.develop-page-template-module-pill:focus-visible {
  outline: 2px solid rgba(11, 130, 212, 0.45);
  outline-offset: 2px;
}

.develop-page-template-module-pill-icon {
  display: inline-grid;
  place-items: center;
  min-width: 24px;
  height: 24px;
  padding: 0 0.25rem;
  border-radius: 999px;
  background: rgba(23, 60, 97, 0.16);
  font-size: 0.78rem;
}

.develop-page-template-module-pill-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.develop-page-template-module-pill-label {
  font-size: 0.85rem;
}

.develop-page-template-module-pill-type {
  font-size: 0.72rem;
  font-weight: 600;
  color: #587592;
}

.develop-page-template-module-pill-preview {
  font-size: 0.72rem;
  font-weight: 500;
  color: #35516c;
}

.develop-page-template-module-pill-actions {
  position: absolute;
  top: 0.28rem;
  right: 0.38rem;
  display: inline-flex;
  flex-direction: column;
  gap: 0.18rem;
}

.develop-page-template-module-pill-action {
  width: 18px;
  height: 18px;
  min-width: 18px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid rgba(15, 79, 143, 0.14);
  background: #f7fbff;
  color: #0f4f8f;
  font-size: 0.65rem;
  line-height: 1;
  cursor: pointer;
}

.develop-page-template-module-pill-action:hover,
.develop-page-template-module-pill-action:focus-visible {
  background: #e9f4ff;
}

.develop-page-template-module-pill-action--delete {
  color: #b42318;
}

.develop-module-picker-panel {
  position: fixed;
  right: 1.2rem;
  bottom: 1.2rem;
  z-index: 10001;
  width: min(760px, calc(100vw - 2.4rem));
  max-height: min(72vh, 760px);
  overflow: auto;
  padding: 1rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 18px 48px rgba(15, 55, 90, 0.22);
  backdrop-filter: blur(10px);
}

.develop-module-editor-modal {
  position: fixed;
  inset: 0;
  z-index: 10020;
}

.develop-module-editor-modal__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(6, 16, 24, 0.46);
}

.develop-module-editor-modal__dialog {
  position: absolute;
  z-index: 1;
  left: 1.2rem;
  bottom: 1.2rem;
  width: min(860px, calc(100vw - 2.4rem));
  max-height: calc(100vh - 2.4rem);
  overflow: auto;
  margin: 0;
  padding: 1rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.99);
  box-shadow: 0 20px 56px rgba(15, 55, 90, 0.26);
}

.develop-module-editor-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.develop-module-editor-modal__header h3 {
  margin: 0;
}

.develop-module-editor-modal__header p {
  margin: 0.25rem 0 0;
  color: #587592;
}

.develop-module-editor-modal__body {
  display: grid;
  gap: 1rem;
}

.develop-module-editor-modal__footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
}

.develop-container-editor-preview {
  display: grid;
  gap: 0.5rem;
}

.develop-container-editor-preview__label {
  font-size: 0.82rem;
  font-weight: 700;
  color: #35516c;
}

.develop-container-editor-preview__box {
  min-height: 120px;
  border: 2px dashed rgba(15, 79, 143, 0.18);
  border-radius: 16px;
  background: rgba(240, 248, 255, 0.72);
  display: grid;
  place-items: center;
  color: #35516c;
  font-weight: 700;
  text-align: center;
  padding: 1rem;
}

.develop-module-picker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.develop-module-picker-title {
  font-size: 1.2rem;
  font-weight: 800;
  color: #173c61;
}

.develop-module-picker-subtitle {
  margin-top: 0.2rem;
  color: #587592;
}

.develop-module-picker-close {
  min-width: 0;
}

.develop-module-picker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.8rem;
}

.develop-module-picker-tile {
  display: grid;
  gap: 0.55rem;
  justify-items: center;
  min-width: 0;
  padding: 1rem 0.8rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 14px;
  background: #f7fbff;
  cursor: grab;
  user-select: none;
}

.develop-module-picker-tile.is-dragging {
  opacity: 0.7;
}

.develop-module-picker-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: rgba(15, 79, 143, 0.12);
  color: #173c61;
  font-size: 1rem;
  font-weight: 800;
}

.develop-module-picker-label {
  text-align: center;
  color: #173c61;
  font-weight: 700;
}

.develop-richtext-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.45rem;
}

.develop-richtext-tool {
  min-width: 0;
  padding: 0.35rem 0.6rem;
}

.develop-richtext-editor {
  min-height: 220px;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  color: #173c61;
  line-height: 1.6;
  outline: none;
}

.develop-richtext-editor:empty::before {
  content: attr(data-placeholder);
  color: #7b92aa;
}

.develop-richtext-editor p:first-child,
.develop-richtext-editor h2:first-child,
.develop-richtext-editor h3:first-child,
.develop-richtext-editor ul:first-child,
.develop-richtext-editor ol:first-child {
  margin-top: 0;
}

.develop-richtext-editor p:last-child,
.develop-richtext-editor h2:last-child,
.develop-richtext-editor h3:last-child,
.develop-richtext-editor ul:last-child,
.develop-richtext-editor ol:last-child {
  margin-bottom: 0;
}

.develop-richtext-editor ul,
.develop-richtext-editor ol {
  padding-left: 1.35rem;
}

.develop-richtext-editor a {
  color: #0f4f8f;
  text-decoration: underline;
}

.develop-page-template-module-card {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  padding: 0.7rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 10px;
  background: #f9fcff;
}

.develop-page-template-module-card.is-drag-over {
  border-color: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.12);
}

.develop-page-template-module-card.is-dragging {
  opacity: 0.6;
}

.develop-page-template-module-card-grip {
  grid-column: 1 / 2;
  align-self: start;
  justify-self: start;
  padding: 0.2rem 0.4rem;
  border: 1px dashed rgba(15, 79, 143, 0.28);
  border-radius: 8px;
  background: #eef7ff;
  color: #315879;
  font-size: 0.88rem;
  line-height: 1;
  cursor: grab;
  user-select: none;
}

.develop-page-template-module-summary-bar {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.5rem;
  grid-column: 1 / -1;
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgba(15, 79, 143, 0.12);
  border-radius: 10px;
  background: #fff;
  text-align: left;
}

.develop-page-template-module-icon {
  min-width: 36px;
  height: 30px;
  padding: 0 0.3rem;
  border-radius: 8px;
  background: #e9f4ff;
  color: #214c71;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.73rem;
  font-weight: 700;
}

.develop-page-template-module-summary-name {
  font-weight: 700;
  color: #173c61;
}

.develop-page-template-module-summary-type {
  font-size: 0.82rem;
  color: #587592;
  font-weight: 700;
}

.develop-page-template-module-toggle {
  font-size: 0.92rem;
  color: #173c61;
}

.develop-page-template-module-body {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.develop-page-template-module-body textarea,
.develop-page-template-module-body input,
.develop-page-template-module-body select {
  width: 100%;
}

.develop-page-template-add-module-row {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 0.45rem;
}

.develop-page-template-module-summary {
  grid-column: 1 / -1;
  color: #315879;
  font-size: 0.9rem;
}

.develop-page-template-module-add-btn {
  display: grid;
  gap: 0.2rem;
  justify-items: center;
  align-items: center;
  min-height: 58px;
  padding: 0.45rem 0.25rem;
  border-radius: 10px;
}

.develop-page-template-module-add-label {
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.1;
}

.develop-modular-page-preview {
  display: grid;
  gap: 1rem;
}

.develop-modular-page-section {
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.82);
  padding: 1rem;
}

.develop-modular-page-columns {
  display: grid;
  gap: 0.9rem;
}

.develop-modular-page-column {
  display: grid;
  gap: 0.7rem;
}

.develop-modular-page-column-empty {
  min-height: 96px;
  display: grid;
  place-items: center;
  border: 2px dashed rgba(15, 79, 143, 0.18);
  border-radius: 12px;
  background: rgba(240, 248, 255, 0.58);
  color: #587592;
  font-weight: 700;
  text-align: center;
  padding: 1rem;
}

@media (max-width: 900px) {
  .develop-template-module-fields {
    grid-template-columns: 1fr;
  }

  .develop-layout-toolbar,
  .develop-page-template-row-config,
  .develop-page-template-add-module-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .develop-page-template-column-groups,
  .develop-page-template-module-card,
  .develop-modular-page-columns,
  .develop-page-template-module-body {
    grid-template-columns: 1fr;
  }

  .develop-page-template-section-summary,
  .develop-page-template-module-summary-bar {
    grid-template-columns: auto 1fr auto;
  }

  .develop-page-template-section-remove {
    grid-column: 1 / -1;
    justify-self: start;
  }
}

.develop-template-preview-frame {
  width: 160px;
  height: 122px;
  overflow: hidden;
  border: 1px solid rgba(15, 79, 143, 0.22);
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.95) 0%, rgba(233, 246, 255, 0.96) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 8px 16px rgba(19, 65, 108, 0.08);
}

.develop-template-preview-scale {
  width: 720px;
  transform: scale(0.2222);
  transform-origin: top left;
  pointer-events: none;
}

.develop-template-preview-frame .develop-template-canvas {
  margin-top: 0;
  min-height: 0;
  padding: 1rem;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.develop-template-canvas-mini .develop-template-form-card {
  box-shadow: 0 8px 18px rgba(7, 33, 66, 0.06);
}

.develop-template-canvas-mini .develop-template-form-card input,
.develop-template-canvas-mini .develop-template-form-card textarea {
  pointer-events: none;
}

@media (max-width: 900px) {
  .develop-template-library-card {
    grid-template-columns: 1fr;
  }

  .develop-template-library-media {
    justify-content: flex-start;
  }

  .develop-template-preview-frame {
    width: 184px;
    height: 138px;
  }

  .develop-template-preview-scale {
    transform: scale(0.2556);
  }
}

.develop-template-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin-bottom: 1rem;
  border: var(--lp-border-thickness, 1px) dashed var(--lp-dash-border, #4c86bf);
  border-radius: calc(var(--lp-radius, 12px) * 0.9);
  background: linear-gradient(90deg, #0c1823 0%, #103b62 50%, #dff4ff 100%);
  color: #f3fbff;
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  overflow: hidden;
}

.develop-template-banner-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 5;
  object-fit: contain;
}

.develop-template-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(320px, 0.9fr);
  gap: 1rem;
  align-items: start;
  background: transparent;
  filter: var(--lp-filter, none);
  border-radius: calc(var(--lp-radius, 12px) * 0.95);
  padding: 0.2rem;
}

.develop-template-copy {
  padding: 1.2rem;
  border: var(--lp-border-thickness, 1px) solid var(--lp-border, rgba(15, 79, 143, 0.22));
  border-radius: var(--lp-radius, 14px);
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(var(--lp-blur, 2px));
}

.develop-template-eyebrow {
  margin-bottom: 0.5rem;
  color: var(--lp-accent, #0b5ea0);
  font-size: 0.86rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.develop-template-copy h3,
.develop-template-form-card h3,
.develop-template-body-copy h3 {
  margin: 0 0 0.65rem 0;
  font-size: 2rem;
  line-height: 1.1;
}

.develop-template-copy p,
.develop-template-form-card p,
.develop-template-body-copy p {
  margin: 0 0 0.9rem 0;
  color: #20313f;
  line-height: 1.6;
}

.develop-template-cta-row {
  display: flex;
  gap: 0.6rem;
  margin: 1rem 0 1.1rem;
}

.develop-template-cta-row button {
  width: auto;
  min-width: 180px;
}

.develop-template-secondary-btn {
  background: var(--lp-surface-alt, #f4f9ff);
  color: var(--lp-accent, #0b3760);
}

.develop-template-feature-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
}

.develop-template-feature-card,
.develop-template-body-copy,
.develop-template-side-image {
  border: var(--lp-border-thickness, 1px) solid var(--lp-border-soft, rgba(15, 79, 143, 0.2));
  border-radius: var(--lp-radius, 12px);
  background: var(--lp-surface, rgba(255, 255, 255, 0.92));
  backdrop-filter: blur(var(--lp-blur, 0px));
}

.develop-template-feature-card {
  padding: 0.8rem;
}

.develop-template-feature-card h4 {
  margin: 0 0 0.35rem 0;
  font-size: 1rem;
}

.develop-template-feature-card p {
  margin: 0;
  font-size: 0.92rem;
}

.develop-template-image-slot,
.develop-template-video-slot,
.develop-template-side-image,
.develop-template-logo-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  border: var(--lp-border-thickness, 1px) dashed var(--lp-dash-border, #5e8fbd);
  border-radius: calc(var(--lp-radius, 10px) * 0.8);
  background: linear-gradient(135deg, #edf6ff 0%, #d7edff 100%);
  color: var(--lp-accent, #214c71);
  font-weight: 700;
  text-align: center;
}

.develop-template-image-slot {
  min-height: 0;
  margin-bottom: 0.7rem;
  padding: 0.35rem;
}

.develop-template-video-slot {
  min-height: 0;
  margin-bottom: 0.7rem;
  padding: 0.35rem;
  overflow: hidden;
}

.develop-template-form-card {
  padding: 1.1rem;
  border: var(--lp-border-thickness, 1px) solid var(--lp-border, rgba(15, 79, 143, 0.24));
  border-radius: var(--lp-radius, 14px);
  background: rgba(255, 255, 255, 0.84);
  backdrop-filter: blur(var(--lp-blur, 0px));
  box-shadow: 0 12px 28px rgba(7, 33, 66, 0.08);
}

.develop-template-runtime-form {
  display: block;
}

.develop-template-runtime-form-disabled {
  cursor: default;
}

.develop-template-logo-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 88px;
  gap: 0.6rem;
  margin-bottom: 1rem;
}

.develop-template-logo-slot {
  min-height: 58px;
  padding: 0.35rem;
}

.develop-template-logo-square {
  min-height: 88px;
}

.develop-template-image-slot img,
.develop-template-side-image img,
.develop-template-logo-slot img {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  object-fit: contain;
}

.develop-template-video-slot video,
.develop-template-video-slot iframe,
.develop-table-video {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  object-fit: contain;
  border: 0;
}

.develop-template-form-card input,
.develop-template-form-card textarea {
  margin: 0 0 0.55rem 0;
}

.develop-template-form-status {
  min-height: 1.25rem;
  margin-top: 0.45rem;
  font-size: 0.88rem;
  color: #32587c;
}

.develop-template-form-status.is-success {
  color: #1f7a35;
}

.develop-template-form-status.is-error {
  color: #b42318;
}

.develop-thankyou-canvas {
  min-height: 440px;
}

.develop-thankyou-hero,
.develop-thankyou-hero-shell {
  min-height: 380px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(15, 79, 143, 0.2);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.65);
}

.develop-thankyou-center {
  width: min(760px, 94%);
  padding: 2rem 1.2rem;
  text-align: center;
  display: grid;
  gap: 1rem;
}

.develop-thankyou-center h3 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.1;
  color: #164b7f;
}

.develop-thankyou-center p {
  margin: 0 auto;
  max-width: 680px;
  font-size: 1.08rem;
  color: #214362;
  line-height: 1.6;
}

.develop-thankyou-download {
  width: 190px;
  min-height: 210px;
  margin: 0.55rem auto 0;
  border-radius: 18px;
  border: 2px solid rgba(11, 130, 212, 0.5);
  background: linear-gradient(180deg, rgba(229, 245, 255, 0.98) 0%, rgba(255, 255, 255, 0.98) 100%);
  color: #0e4f82;
  text-decoration: none;
  display: grid;
  place-items: center;
  gap: 0.15rem;
  box-shadow: 0 14px 28px rgba(11, 130, 212, 0.18);
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}

.develop-thankyou-download:hover,
.develop-thankyou-download:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(11, 130, 212, 0.78);
  box-shadow: 0 18px 32px rgba(11, 130, 212, 0.24);
}

.develop-thankyou-download.is-disabled {
  pointer-events: none;
  opacity: 0.58;
}

.develop-thankyou-download-icon {
  font-size: 2rem;
  line-height: 1;
}

.develop-thankyou-download-icon-wrap {
  width: 140px;
  height: 120px;
  display: grid;
  place-items: center;
}

.develop-thankyou-download-thumb {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid rgba(11, 130, 212, 0.25);
  background: #ffffff;
}

.develop-thankyou-download-label {
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.develop-template-content {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.develop-template-body-copy {
  padding: 1.1rem;
  min-height: 200px;
  background: rgba(255, 255, 255, 0.78);
}

.develop-template-body-copy h3 {
  font-size: 1.5rem;
}

.develop-template-side-image {
  min-height: 0;
  padding: 1rem;
}

.develop-landing-editable {
  cursor: pointer;
  transition: box-shadow 140ms ease, outline-color 140ms ease, transform 140ms ease;
  outline: 2px dashed transparent;
  outline-offset: 3px;
}

.develop-landing-editable:hover {
  outline-color: rgba(11, 130, 212, 0.55);
  box-shadow: 0 0 0 3px rgba(11, 130, 212, 0.12);
}

.develop-landing-editing-active {
  outline-color: rgba(11, 130, 212, 0.88);
  box-shadow: 0 0 0 4px rgba(11, 130, 212, 0.16);
}

.develop-inline-hidden-target {
  display: none !important;
}

.develop-inline-textarea-wrap {
  display: grid;
  gap: 0.45rem;
  margin: 0.15rem 0 0.5rem;
}

.develop-inline-text-controls {
  display: grid;
  gap: 0.45rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 12px;
  background: rgba(246, 251, 255, 0.96);
}

.develop-inline-text-controls-label {
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #31597d;
}

.develop-inline-fontsize-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.develop-inline-fontsize-row button {
  width: auto;
  min-width: 2.25rem;
  padding: 0.35rem 0.55rem;
  font-weight: 800;
}

.develop-inline-fontsize-label {
  min-width: 8rem;
  font-size: 0.9rem;
  font-weight: 700;
  color: #1f4d73;
  text-align: center;
}

.develop-inline-fontsize-hint {
  font-size: 0.74rem;
  line-height: 1.35;
  color: #5d7891;
}

.develop-inline-textarea {
  width: 100%;
  min-height: 56px;
  resize: vertical;
  padding: 0.75rem 0.85rem;
  border: 1px solid rgba(15, 79, 143, 0.22);
  border-radius: 12px;
  background: #ffffff;
  color: #183d60;
  font: inherit;
  line-height: 1.45;
}

.develop-inline-textarea-close {
  width: auto;
  justify-self: end;
}

.develop-inline-image-editor-target {
  padding: 0.8rem;
  gap: 0.55rem;
  display: grid;
  align-content: center;
}

.develop-inline-image-select {
  display: grid;
  gap: 0.45rem;
  width: 100%;
}

.develop-selector-filter-wrap {
  display: grid;
  gap: 0.45rem;
  margin-bottom: 0.45rem;
  padding: 0.55rem;
  border: 1px solid rgba(15, 79, 143, 0.12);
  border-radius: 12px;
  background: #f7fbff;
}

.develop-inline-image-select button {
  width: auto;
  justify-self: end;
}

.develop-inline-editor {
  margin: 0.6rem 0 0.8rem;
  padding: 0.8rem;
  border: 1px solid rgba(15, 79, 143, 0.22);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 28px rgba(7, 33, 66, 0.08);
  width: 100%;
  max-width: 420px;
  flex-basis: 100%;
  grid-column: 1 / -1;
}

.develop-inline-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}

.develop-inline-editor-header button {
  width: auto;
}

.develop-inline-editor-body {
  display: grid;
  gap: 0.65rem;
}

.develop-inline-editor-field {
  display: grid;
  gap: 0.35rem;
  margin: 0;
}

.develop-inline-editor-field-label {
  font-size: 0.86rem;
  font-weight: 700;
  color: #20496d;
}

.develop-inline-asset-nav {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 0.45rem;
  align-items: center;
}

.develop-inline-asset-nav button {
  width: auto;
  min-width: 0;
  padding: 0.45rem 0.65rem;
}

.develop-inline-asset-status {
  min-height: 2.25rem;
  padding: 0.45rem 0.65rem;
  border: 1px dashed rgba(15, 79, 143, 0.18);
  border-radius: 10px;
  background: rgba(247, 251, 255, 0.76);
  color: #3b5d7b;
  font-size: 0.9rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-self: stretch;
}

.develop-inline-asset-preview {
  min-height: 92px;
  padding: 0.45rem;
  border: 1px solid rgba(15, 79, 143, 0.14);
  border-radius: 10px;
  background: #f7fbff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #3a607f;
  text-align: center;
}

.develop-inline-asset-preview img {
  max-width: 100%;
  max-height: 120px;
  display: block;
  object-fit: contain;
}

.develop-modules-studio-form {
  --modules-label-col: 190px;
  --modules-row-gap: 0.9rem;
  gap: 0.9rem;
}

.develop-modules-studio-intro {
  display: grid;
  gap: 0.7rem;
}

.develop-modules-studio-row {
  display: grid;
  grid-template-columns: var(--modules-label-col) minmax(0, 1fr);
  gap: var(--modules-row-gap);
  align-items: center;
}

.develop-modules-studio-row > :not(span) {
  width: min(760px, 100%);
  max-width: 760px;
  justify-self: start;
}

.develop-modules-studio-row > span {
  font-weight: 700;
  color: #1f2f44;
  justify-self: end;
  text-align: right;
  white-space: nowrap;
}

.develop-modules-studio-row:has(textarea),
.develop-modules-studio-row:has(.develop-richtext-editor),
.develop-modules-studio-row:has(.develop-inline-asset-preview) {
  align-items: start;
}

.develop-modules-studio-row:has(textarea) > span,
.develop-modules-studio-row:has(.develop-richtext-editor) > span,
.develop-modules-studio-row:has(.develop-inline-asset-preview) > span {
  padding-top: 0.75rem;
}

#developModulesTypeHelp {
  margin-left: calc(var(--modules-label-col) + var(--modules-row-gap));
  color: #365271;
}

#developModulesSettingsFields {
  display: grid;
  gap: 0.7rem;
  grid-template-columns: 1fr;
}

#developModulesForm input[type="text"],
#developModulesForm input[type="number"],
#developModulesForm input[type="url"],
#developModulesForm input[type="color"],
#developModulesForm select,
#developModulesForm textarea,
#developModulesForm .develop-richtext-editor,
#developModulesForm .develop-inline-asset-status,
#developModulesForm .develop-inline-asset-preview {
  border: 1px solid #444;
  background: #fff;
  box-shadow: none;
}

#developModulesForm input[type="color"] {
  min-height: 46px;
  width: 84px;
  max-width: 84px;
}

#developModulesForm .develop-richtext-toolbar {
  margin-bottom: 0.35rem;
}

#developModulesForm .develop-inline-asset-status {
  border-style: solid;
  color: #243b55;
}

#developModulesForm .develop-inline-asset-preview {
  border-color: #999;
  background: #f7fbff;
}

#developModulesForm .develop-richtext-editor,
#developModulesForm textarea {
  max-width: 760px;
}

#developModulesForm .develop-inline-asset-nav,
#developModulesForm .develop-inline-asset-preview,
#developModulesForm .develop-inline-asset-status {
  max-width: 760px;
}

#developModulesForm .develop-inline-asset-nav button,
#developModulesForm .develop-richtext-tool {
  border: 1px solid #444;
}

.develop-modules-studio-actions {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  margin-left: calc(var(--modules-label-col) + var(--modules-row-gap));
  width: min(760px, 100%);
  max-width: 760px;
}

.develop-modules-studio-actions button {
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  white-space: nowrap;
}

.develop-modules-studio-actions button[type="submit"] {
  width: 100%;
  padding-left: 0.65rem;
  padding-right: 0.65rem;
}

@media (max-width: 900px) {
  .develop-modules-studio-row {
    grid-template-columns: 1fr;
  }

  .develop-modules-studio-row > span {
    justify-self: start;
    text-align: left;
    padding-top: 0;
  }

  #developModulesTypeHelp,
  .develop-modules-studio-actions {
    margin-left: 0;
  }
}

.develop-visual-editor-panel-wrap {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid rgba(15, 79, 143, 0.18);
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fcff 0%, #eef7ff 100%);
}

.develop-visual-editor-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}

.develop-visual-editor-card {
  padding: 0.9rem;
  border: 1px solid rgba(15, 79, 143, 0.18);
  border-radius: 12px;
  background: #ffffff;
}

.develop-visual-editor-card h4 {
  margin: 0;
}

.develop-form-config-list {
  display: grid;
  gap: 0.55rem;
  margin: 0.4rem 0 0.6rem;
}

.develop-form-builder-layout {
  display: grid;
  grid-template-columns: minmax(300px, 0.95fr) minmax(340px, 1.05fr);
  gap: 1rem;
  align-items: start;
}

.develop-form-editor-panel {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid rgba(16, 126, 208, 0.2);
  border-radius: 16px;
  background: rgba(247, 252, 255, 0.92);
}

.develop-form-config-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid rgba(15, 79, 143, 0.18);
  border-radius: 10px;
  background: #f7fbff;
}

.develop-form-config-label {
  font-weight: 700;
}

.develop-color-control {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid rgba(15, 79, 143, 0.18);
  border-radius: 10px;
  background: #f7fbff;
}

.develop-color-control-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
}

.develop-color-control input[type="color"] {
  width: 64px;
  min-width: 64px;
  height: 42px;
  padding: 0.2rem;
  margin: 0;
  cursor: pointer;
}

.develop-color-control-icon {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  border: 1px solid rgba(11, 55, 96, 0.35);
  background: conic-gradient(
    #ef4444 0deg,
    #f59e0b 60deg,
    #eab308 120deg,
    #22c55e 180deg,
    #06b6d4 240deg,
    #3b82f6 300deg,
    #ef4444 360deg
  );
  display: inline-block;
}

.develop-form-preview {
  margin-top: 0.8rem;
  margin-left: auto;
  margin-right: auto;
  max-width: 560px;
  padding: 1rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: linear-gradient(135deg, #ffffff 0%, #f5fbff 100%);
  box-shadow: 0 10px 22px rgba(7, 33, 66, 0.06);
}

.develop-form-preview h3 {
  margin: 0 0 0.8rem 0;
  font-size: 1.5rem;
}

.develop-email-template-modal {
  max-width: 760px;
}

.develop-email-template-modal-body {
  background: linear-gradient(180deg, #f4f9ff 0%, #ecf5ff 100%);
}

.develop-email-template-preview {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
  padding: 28px;
  border: 1px solid rgba(15, 79, 143, 0.14);
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 12px 30px rgba(7, 33, 66, 0.08);
  overflow: hidden;
  box-sizing: border-box;
}

.develop-email-template-preview-meta {
  margin: 0 0 1rem 0;
  font-size: 0.96rem;
  color: #26435c;
}

.develop-email-template-preview h3 {
  margin: 0 0 0.8rem 0;
  font-size: 1.7rem;
  line-height: 1.2;
}

.develop-email-template-preview p {
  margin: 0 0 1rem 0;
  line-height: 1.6;
  color: #1d3550;
  word-wrap: break-word;
}

.develop-email-template-preview button {
  width: auto;
  max-width: 100%;
}

.develop-email-template-image-wrap {
  margin: 0.9rem 0;
  width: 100%;
  max-width: 100%;
}

.develop-email-template-image {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  border-radius: 10px;
  border: 1px solid rgba(15, 79, 143, 0.16);
  box-sizing: border-box;
}

.develop-email-template-image-placeholder {
  width: 100%;
  min-height: 220px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0.9rem 0;
  border: 1px dashed rgba(15, 79, 143, 0.3);
  border-radius: 12px;
  background: linear-gradient(135deg, #f3f9ff 0%, #e3f0ff 100%);
  color: #36506a;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  box-sizing: border-box;
}

.develop-form-save-wrap {
  margin: 3.6rem auto 0;
  max-width: 560px;
}

.develop-visual-toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.5rem;
  margin: 0.4rem 0 0.7rem 0;
}

.develop-visual-toolbar label {
  font-weight: 600;
  margin: 0;
}

.develop-visual-toolbar select {
  width: auto;
  min-width: 170px;
}

.develop-themes-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f8fbff;
  padding: 0.8rem;
  margin-bottom: 1rem;
}

.develop-themes-card h3 {
  margin-top: 0;
}

.develop-themes-toolbar {
  display: grid;
  grid-template-columns: auto minmax(180px, 1fr) auto minmax(180px, 1fr) auto auto auto;
  gap: 0.55rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.develop-themes-toolbar label {
  margin: 0;
  white-space: nowrap;
}

.develop-themes-toolbar button {
  width: auto;
  min-width: 0;
}

.develop-themes-status {
  margin: 0 0 0.8rem 0;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #93c5fd;
  background: #eff6ff;
  color: #1e3a8a;
  font-weight: 600;
}

.develop-themes-builder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.develop-themes-builder-header h3 {
  margin: 0;
}

.develop-theme-table-thumb {
  vertical-align: middle;
  min-width: 88px;
  width: 88px;
}

.develop-theme-table-thumb img {
  display: block;
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid rgba(15, 79, 143, 0.16);
  margin: 0 auto;
}

.develop-theme-table-thumb-empty {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  margin: 0 auto;
  border-radius: 10px;
  border: 1px dashed rgba(15, 79, 143, 0.24);
  color: #6b7f94;
  font-size: 0.8rem;
  background: rgba(255, 255, 255, 0.75);
}

.develop-themes-columns {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.45fr);
  gap: 0.8rem;
}

.develop-themes-side-stack {
  display: grid;
  gap: 0.8rem;
  align-content: start;
}

.develop-themes-assets-card {
  min-height: 100%;
}

.develop-themes-stack {
  display: grid;
  gap: 0.65rem;
}

.develop-themes-stack .form-row {
  display: grid;
  grid-template-columns: 110px 1fr 48px;
  align-items: center;
  gap: 0.55rem;
}

.develop-themes-stack .form-row.develop-theme-asset-row {
  grid-template-columns: 110px minmax(0, 1fr);
}

.develop-themes-stack .form-row label {
  margin: 0;
}

.develop-theme-asset-field {
  display: grid;
  gap: 0.45rem;
}

.develop-theme-asset-picker-btn {
  width: 100%;
  justify-self: stretch;
  min-width: 0;
}

.develop-theme-asset-preview {
  min-height: 74px;
  border: 1px dashed rgba(15, 79, 143, 0.24);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
  padding: 0.55rem;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  color: #5a6f84;
}

.develop-theme-asset-preview img {
  width: 96px;
  height: 72px;
  object-fit: contain;
  border-radius: 10px;
  border: 1px solid rgba(15, 79, 143, 0.16);
  background: #fff;
}

.develop-theme-asset-preview-text {
  display: grid;
  gap: 0.15rem;
}

.develop-theme-asset-preview-text strong {
  color: #123d67;
}

.develop-themes-preview-host {
  margin-top: 0.2rem;
}

.develop-themes-preview-frame {
  padding: 1.2rem;
  border-radius: 18px;
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(15, 79, 143, 0.18);
}

.develop-themes-preview-card {
  border-radius: 16px;
  border: 1px solid var(--border);
  padding: 1.1rem;
  box-shadow: 0 14px 34px rgba(7, 33, 66, 0.14);
}

.develop-themes-preview-eyebrow {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.develop-themes-preview-card h4 {
  margin: 0.45rem 0;
  font-size: 2rem;
}

.develop-themes-preview-card p {
  margin: 0.35rem 0 0.85rem 0;
  font-size: 1rem;
}

.develop-themes-preview-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.develop-themes-preview-brand {
  display: grid;
  gap: 0.5rem;
}

.develop-themes-preview-logo-wide {
  max-width: min(340px, 100%);
  max-height: 72px;
  width: auto;
  height: auto;
  object-fit: contain;
}

.develop-themes-preview-logo-square {
  width: 72px;
  height: 72px;
  object-fit: contain;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(15, 79, 143, 0.16);
  padding: 0.35rem;
}

.develop-themes-preview-logo-fallback {
  font-size: 1.4rem;
  font-weight: 800;
  line-height: 1.1;
}

.develop-themes-preview-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 420px);
  gap: 1.2rem;
  align-items: center;
}

.develop-themes-preview-copy {
  display: grid;
  gap: 0.65rem;
}

.develop-themes-preview-kicker {
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.develop-themes-preview-feature {
  min-height: 280px;
  overflow: hidden;
  border: 1px solid rgba(15, 79, 143, 0.18);
  background: rgba(255, 255, 255, 0.72);
  display: grid;
  place-items: center;
}

.develop-themes-preview-feature img {
  width: 100%;
  height: 100%;
  min-height: 280px;
  object-fit: cover;
  display: block;
}

.develop-themes-preview-feature-placeholder {
  color: #5a6f84;
  font-weight: 700;
}

.develop-themes-preview-modules {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.develop-themes-preview-module {
  padding: 0.95rem;
  border: 1px solid rgba(15, 79, 143, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.72);
  display: grid;
  gap: 0.45rem;
}

.develop-themes-preview-module h5,
.develop-themes-preview-body-copy h5 {
  margin: 0;
  font-size: 1.15rem;
}

.develop-themes-preview-module p,
.develop-themes-preview-body-copy p {
  margin: 0;
}

.develop-themes-preview-module-subheading {
  color: #35597a;
  font-weight: 700;
}

.develop-themes-preview-body {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(180px, 0.6fr);
  gap: 1rem;
  margin-top: 1rem;
}

.develop-themes-preview-body-copy {
  padding: 1rem;
  border: 1px solid rgba(15, 79, 143, 0.14);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.78);
  display: grid;
  gap: 0.55rem;
}

.develop-themes-preview-body-side {
  min-height: 100%;
  background: rgba(255, 255, 255, 0.68);
  display: grid;
  place-items: center;
  padding: 1rem;
  text-align: center;
  font-weight: 800;
}

.develop-themes-preview-actions {
  display: flex;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.develop-themes-preview-actions button {
  width: auto;
  min-width: 120px;
}

@media (max-width: 980px) {
  .develop-themes-preview-hero,
  .develop-themes-preview-body,
  .develop-themes-preview-modules {
    grid-template-columns: minmax(0, 1fr);
  }
}

.develop-theme-palette-cell {
  display: grid;
  gap: 0.35rem;
}

.develop-theme-palette-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: #24415d;
  font-weight: 600;
}

.develop-theme-palette-dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 1px solid rgba(15, 79, 143, 0.24);
  display: inline-block;
}

.develop-theme-style-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  color: #24415d;
  font-weight: 600;
}

.develop-theme-style-glyph {
  width: 20px;
  height: 20px;
  border-style: solid;
  border-color: #24415d;
  background: rgba(255, 255, 255, 0.9);
  display: inline-block;
  flex: 0 0 auto;
}

.develop-themes-plan {
  margin: 0;
  padding-left: 1.1rem;
  display: grid;
  gap: 0.55rem;
}

.c-modal__dialog.develop-theme-picker-modal {
  width: min(1880px, 98vw);
  max-width: min(1880px, 98vw);
}

.c-modal__backdrop.develop-module-image-picker-backdrop {
  align-items: flex-start;
  justify-content: flex-end;
  padding: 1rem;
  background: transparent;
  z-index: 10040;
  pointer-events: none;
}

.c-modal__backdrop.develop-module-image-picker-backdrop .c-modal__dialog {
  pointer-events: auto;
}

.c-modal__dialog.develop-theme-picker-modal.develop-module-image-picker-modal {
  width: min(1120px, calc(100vw - 2.4rem));
  max-width: min(1120px, calc(100vw - 2.4rem));
  max-height: calc(100vh - 2.4rem);
  box-shadow: 0 24px 64px rgba(15, 55, 90, 0.28);
}

.c-modal__backdrop.develop-nested-modal-backdrop {
  z-index: 10040;
}

.c-modal__backdrop.develop-nested-modal-backdrop--transparent {
  background: transparent;
}

.c-modal__backdrop.develop-nested-modal-backdrop--upper-right {
  align-items: flex-start;
  justify-content: flex-end;
  padding: 1rem;
  pointer-events: none;
}

.c-modal__backdrop.develop-nested-modal-backdrop--upper-right .c-modal__dialog {
  pointer-events: auto;
}

.c-modal__dialog.develop-nested-modal-dialog--upper-right {
  width: min(1120px, calc(100vw - 2.4rem));
  max-width: min(1120px, calc(100vw - 2.4rem));
  max-height: calc(100vh - 2.4rem);
  box-shadow: 0 24px 64px rgba(15, 55, 90, 0.28);
}

.c-modal__dialog.develop-theme-picker-modal .c-modal__body {
  padding: 16px 18px 18px;
}

.develop-theme-picker-body {
  display: grid;
  gap: 0.9rem;
}

.develop-theme-picker-toolbar {
  display: grid;
  grid-template-columns: minmax(240px, 1.45fr) repeat(3, minmax(170px, 0.75fr)) auto auto;
  gap: 0.6rem;
  align-items: center;
  margin-bottom: 0.9rem;
}

.develop-theme-picker-toolbar input,
.develop-theme-picker-toolbar select {
  margin: 0;
}

.develop-theme-picker-result-count {
  min-width: 110px;
  text-align: center;
  font-size: 0.88rem;
  font-weight: 700;
  color: #3f5872;
}

.develop-theme-picker-upload {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.develop-theme-picker-grid {
  display: grid;
  gap: 0.8rem;
}

.develop-theme-picker-group {
  display: grid;
  gap: 0.6rem;
}

.develop-theme-picker-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  padding: 0 0.2rem;
  color: #27445f;
}

.develop-theme-picker-group-heading strong {
  color: #123d67;
}

.develop-theme-picker-grid--wide,
.develop-theme-picker-grid--square,
.develop-theme-picker-grid--tall,
.develop-theme-picker-grid--unknown {
  display: grid;
  gap: 0.8rem;
}

.develop-theme-picker-grid--wide {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.develop-theme-picker-grid--square {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.develop-theme-picker-grid--tall {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.develop-theme-picker-grid--unknown {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.develop-theme-picker-body .develop-theme-picker-grid {
  max-height: min(74vh, 980px);
  overflow: auto;
  padding-right: 0.35rem;
}

.develop-theme-picker-card {
  border: 1px solid rgba(15, 79, 143, 0.16);
  border-radius: 14px;
  background: #fff;
  padding: 0.65rem;
  display: grid;
  gap: 0.55rem;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}

.develop-theme-picker-card:hover,
.develop-theme-picker-card:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(11, 130, 212, 0.5);
  box-shadow: 0 10px 24px rgba(7, 33, 66, 0.08);
}

.develop-theme-picker-card.is-selected {
  border-color: #0b82d4;
  box-shadow: 0 0 0 2px rgba(11, 130, 212, 0.15);
}

.develop-theme-picker-card-image-btn {
  width: 100%;
  padding: 0.45rem;
  border: 1px solid rgba(15, 79, 143, 0.12);
  border-radius: 12px;
  background: #f7fbff;
  cursor: zoom-in;
  display: grid;
  place-items: center;
}

.develop-theme-picker-card-image-btn img {
  width: 100%;
  height: auto;
  max-height: 320px;
  object-fit: contain;
  border-radius: 10px;
  background: #f3f7fb;
  display: block;
}

.develop-theme-picker-card--wide .develop-theme-picker-card-image-btn {
  min-height: 150px;
}

.develop-theme-picker-card--square .develop-theme-picker-card-image-btn {
  min-height: 220px;
}

.develop-theme-picker-card--tall .develop-theme-picker-card-image-btn {
  min-height: 320px;
}

.develop-theme-picker-card--unknown .develop-theme-picker-card-image-btn {
  min-height: 200px;
}

.develop-theme-picker-card-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.55rem;
}

.develop-theme-picker-card-actions button {
  width: 100%;
  min-width: 0;
}

.develop-theme-picker-card-title {
  font-weight: 700;
  color: #123d67;
  font-size: 0.92rem;
  word-break: break-word;
}

.develop-theme-picker-card-meta {
  color: #5a6f84;
  font-size: 0.82rem;
  line-height: 1.35;
  word-break: break-word;
}

.c-modal__dialog.develop-theme-image-preview-modal {
  width: min(1480px, 96vw);
  max-width: min(1480px, 96vw);
}

.develop-theme-image-preview-modal-body {
  display: grid;
  gap: 0.8rem;
}

.develop-theme-image-preview-stage {
  display: grid;
  place-items: center;
  min-height: min(72vh, 920px);
  padding: 1rem;
  border: 1px solid rgba(15, 79, 143, 0.14);
  border-radius: 16px;
  background: linear-gradient(180deg, #fbfdff 0%, #eef6ff 100%);
}

.develop-theme-image-preview-stage img {
  max-width: 100%;
  max-height: min(68vh, 860px);
  width: auto;
  height: auto;
  object-fit: contain;
  display: block;
  border-radius: 12px;
}

.develop-theme-image-preview-meta {
  display: grid;
  gap: 0.2rem;
  color: #27445f;
}

.develop-theme-image-preview-meta strong {
  color: #123d67;
}

@media (max-width: 980px) {
  .develop-theme-picker-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .develop-theme-picker-result-count {
    text-align: left;
  }

  .develop-theme-picker-grid--wide,
  .develop-theme-picker-grid--square,
  .develop-theme-picker-grid--unknown {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .develop-theme-picker-grid--tall {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .develop-theme-picker-grid--wide,
  .develop-theme-picker-grid--square,
  .develop-theme-picker-grid--tall,
  .develop-theme-picker-grid--unknown {
    grid-template-columns: minmax(0, 1fr);
  }
}

.develop-save-notice {
  margin: 0.45rem 0 0.75rem 0;
  padding: 0.75rem 0.9rem;
  border-radius: 10px;
  border: 1px solid #84cc16;
  background: #ecfccb;
  color: #365314;
  font-weight: 700;
  box-shadow: 0 2px 10px rgba(54, 83, 20, 0.12);
}

.develop-form-required {
  color: #a61d24;
  font-weight: 700;
  margin-left: 0.25rem;
}

.asset-preview-meta-row:last-child {
  border-bottom: none;
}

.tiny-btn {
  width: auto;
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  min-width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 10px;
  vertical-align: middle;
  border: 1px solid #b9c9d8;
  background: rgba(255, 255, 255, 0.92);
  color: #24486b;
  box-shadow: 0 2px 8px rgba(19, 44, 68, 0.08);
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, color 120ms ease;
}

.icon-btn-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.icon-btn-glyph svg {
  display: block;
  width: 18px;
  height: 18px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.icon-btn:hover,
.icon-btn:focus-visible {
  background: #ffffff;
  border-color: #8fb0cd;
  color: #173c61;
  box-shadow: 0 4px 14px rgba(19, 44, 68, 0.12);
}

.icon-btn-primary {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #ffffff;
}

.icon-btn-danger {
  background: #9f1239;
  border-color: #9f1239;
  color: #ffffff;
}

.develop-pages-actions-heading {
  text-align: center;
}

.develop-pages-actions-cell {
  text-align: center;
  white-space: nowrap;
}

.develop-pages-actions-cell .icon-btn + .icon-btn {
  margin-left: 10px;
}

.contact-personas-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 150px;
  min-width: 150px;
}

.contact-personas-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 150px;
  min-width: 150px;
}

.contact-personas-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.messaging-topics-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.messaging-topics-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.messaging-topics-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.asset-categories-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.asset-categories-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.asset-categories-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.channels-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.channels-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.channels-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.contacts-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 170px;
  min-width: 170px;
}

.contacts-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 170px;
  min-width: 170px;
}

.contacts-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.contact-detail-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 0;
  border: 1px solid #d7e2f2;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
}

.contact-detail-row {
  display: contents;
}

.contact-detail-label,
.contact-detail-value {
  padding: 14px 16px;
  border-bottom: 1px solid #e3ebf7;
}

.contact-detail-label {
  font-weight: 700;
  background: #f5f9ff;
}

.contact-detail-value {
  background: #fff;
  word-break: break-word;
}

.settings-projects-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 180px;
  min-width: 180px;
}

.settings-projects-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 180px;
  min-width: 180px;
}

.settings-projects-actions-cell .tiny-btn + .tiny-btn {
  margin-left: 8px;
}

.settings-project-active-btn,
.settings-project-active-btn:disabled {
  background: #1fc04b;
  border-color: #149238;
  color: #ffffff;
  opacity: 1;
}

.develop-agents-actions-heading {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.develop-agents-actions-cell {
  text-align: center;
  white-space: nowrap;
  width: 120px;
  min-width: 120px;
}

.develop-agents-actions-cell .icon-btn + .icon-btn {
  margin-left: 8px;
}

.acquire-web-form .form-row label {
  font-weight: 700;
}

.acquire-web-hero-form {
  max-width: 1800px;
  margin: 0 auto 1.5rem;
  align-items: center;
}

.acquire-web-hero-row {
  width: 100%;
}

/* Convention: Labeled Hero Stack */
.labeled-hero-stack {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 1.25rem;
  width: 100%;
}

.labeled-hero-stack-label {
  font-size: 1.4rem;
  font-weight: 800;
  white-space: nowrap;
  margin-top: 1.05rem; /* Aligns visually with the padded input text baseline */
}

.labeled-hero-stack-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1; /* allow spreading */
  width: min(100%, 630px);
  max-width: 630px;
  gap: 1rem;
}

.labeled-hero-stack-body > input,
.labeled-hero-stack-body > button {
  width: 100%;
}

.labeled-hero-stack-body > .acquire-web-hero-options-row {
  width: 100%;
  display: flex;
  justify-content: flex-start; /* Aligns "Advanced" directly beneath the left edge of the input */
  gap: 0.9rem;
}

.acquire-web-hero-row input {
  font-size: 1.3rem;
  padding: 1.05rem 1.2rem;
  border-radius: 24px;
}
.hero-action-input {
  border: 1px solid var(--border);
  background-color: var(--field-bg);
  transition: all 180ms ease;
}

.hero-action-input:hover,
.hero-action-input:focus {
  border-color: #2aa7fa;
  box-shadow: 0 0 0 2px #2aa7fa inset, 0 0 16px rgba(42, 167, 250, 0.45);
  background-color: #f6fbff;
  outline: none;
}

.acquire-web-hero-options-row {
  width: min(100%, 1260px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  flex-wrap: wrap;
  margin: 50px 0;
}

/* Convention: Hanging Details Summary */
.hanging-details > summary {
  list-style: none;
  position: relative;
  cursor: pointer;
  font-weight: 700;
  display: flex;
  align-items: center;
}

.hanging-details > summary::-webkit-details-marker {
  display: none;
}

.hanging-details > summary::before {
  content: "";
  position: absolute;
  left: -1rem;
  top: 50%;
  margin-top: -4px;
  width: 0;
  height: 0;
  border-left: 5px solid var(--ink);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 150ms ease;
}

.hanging-details[open] > summary::before {
  transform: rotate(90deg);
}

.acquire-web-advanced-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(240px, 320px) minmax(260px, 1fr);
  gap: 2.5rem;
  align-items: start;
}

.acquire-web-advanced-acquire h4 {
  margin: 0 0 0.75rem;
}

.acquire-web-advanced-acquire .checkbox-row {
  margin: 0 0 0.45rem;
}

.acquire-web-advanced-fields {
  display: grid;
  gap: 0.9rem;
}

.acquire-web-advanced-fields-tertiary textarea {
  min-height: 132px;
}

.acquire-web-harvest-btn {
  width: min(100%, 1260px);
  margin: 0 auto;
  display: block;
}

#directAcquireProgressWrap {
  width: min(100%, 1260px);
  margin: 0 auto;
}

#acquireWebPage .page-heading-actions > label,
#acquireWebPage .page-heading-actions > .direct-acquire-inline-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.direct-acquire-inline-control {
  position: relative;
}

.direct-acquire-dropdown {
  position: relative;
}

.direct-acquire-dropdown summary {
  list-style: none;
  min-width: 220px;
  height: 42px;
  padding: 0 12px;
  border: 1px solid #8ab4f8;
  border-radius: 8px;
  background: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.direct-acquire-dropdown summary::after {
  content: "▾";
  margin-left: 10px;
  font-size: 0.9em;
}

.direct-acquire-dropdown summary::-webkit-details-marker {
  display: none;
}

.direct-acquire-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  min-width: 320px;
  max-width: 420px;
  max-height: 260px;
  overflow: auto;
  background: #fff;
  border: 1px solid #dbe7ff;
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.14);
  padding: 10px 12px;
}

.direct-acquire-dropdown-option {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  column-gap: 10px;
  row-gap: 0;
  margin-bottom: 6px;
  line-height: 1.25;
  white-space: normal;
}

.direct-acquire-dropdown-option input {
  margin: 2px 0 0;
}

.direct-acquire-dropdown-option:last-child {
  margin-bottom: 0;
}

.acquire-web-expandable-card {
  padding: 0;
  overflow: hidden;
}

.acquire-web-expandable-summary {
  list-style: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  font-weight: 700;
}

.acquire-web-expandable-summary::-webkit-details-marker {
  display: none;
}

.acquire-web-expandable-summary::after {
  content: "▾";
  font-size: 0.95rem;
  color: #1d4ed8;
}

.acquire-web-expandable-card[open] > .acquire-web-expandable-summary::after {
  transform: rotate(180deg);
}

.acquire-web-expandable-body {
  padding: 0 18px 18px;
  border-top: 1px solid #dbe7ff;
}

.acquire-web-results-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  align-items: start;
}

.direct-acquire-contact-label {
  font-weight: 700;
}

.direct-acquire-image-gallery {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-top: 0.75rem;
}

.direct-acquire-image-card {
  border: 1px solid #dbe7ff;
  border-radius: 10px;
  background: #f8fbff;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.direct-acquire-image-card-top {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 8px 10px 0;
}

.direct-acquire-image-link {
  display: block;
  aspect-ratio: 1 / 1;
  background: #eef4ff;
  margin: 8px 10px 0;
  border-radius: 8px;
  overflow: hidden;
}

.direct-acquire-image-link img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.direct-acquire-image-meta {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.direct-acquire-image-name {
  font-size: 0.83rem;
  line-height: 1.2;
  font-weight: 600;
  color: #10233f;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.direct-acquire-image-meta select {
  width: 100%;
}

@media (max-width: 1600px) {
  .direct-acquire-image-gallery {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 1024px) {
  .acquire-web-results-grid {
    grid-template-columns: 1fr;
  }

  .direct-acquire-image-gallery {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .direct-acquire-image-gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.tiny-btn-blue {
  background: #1a73e8;
  border-color: #1a73e8;
  color: #ffffff;
}

#youtubeMinerRepositoryBody .contacts-filter-row th {
  vertical-align: top;
}

.youtube-repository-bulk-actions-cell {
  min-width: 350px;
  max-width: 450px;
}

.youtube-repository-bulk-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
  width: 100%;
  margin-left: auto;
}

#youtubeMinerRepositoryBody .youtube-repository-bulk-actions > button {
  width: auto;
  background: #000;
  border-color: #000;
  color: #fff;
  border-radius: 15px;
  padding: 0.55rem 1rem;
  white-space: nowrap;
}

#youtubeMinerRepositoryBody .youtube-repository-bulk-actions > button:hover,
#youtubeMinerRepositoryBody .youtube-repository-bulk-actions > button:focus-visible {
  background: #020202;
  border-color: #2aa7fa;
}

#youtubeMinerRepositoryBody .youtube-repository-bulk-actions > button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.section-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 1rem;
}

.promote-email-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
  align-items: start;
}

.promote-email-panel {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  background: linear-gradient(180deg, #ffffff 0%, #f6fbff 100%);
}

.promote-email-preview-panel {
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
}

.promote-email-preview-meta {
  display: grid;
  gap: 0.25rem;
  margin: 0.4rem 0 0.8rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgba(99, 123, 158, 0.25);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.82);
}

.promote-email-preview-meta-row {
  display: grid;
  grid-template-columns: 66px minmax(0, 1fr);
  gap: 0.5rem;
  align-items: start;
  font-size: 0.9rem;
}

.promote-email-preview-meta-row strong {
  color: #1b3957;
}

.promote-email-preview-canvas {
  border: 1px solid rgba(99, 123, 158, 0.28);
  border-radius: 10px;
  background: linear-gradient(180deg, #edf4fb 0%, #e8f1fb 100%);
  padding: 0.85rem;
  min-height: 420px;
  overflow: auto;
}

.promote-email-preview-email {
  width: min(640px, 100%);
  margin: 0 auto;
  border: 1px solid rgba(31, 51, 72, 0.14);
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 10px 20px rgba(16, 38, 58, 0.08);
}

.promote-email-preview-image {
  width: 100%;
  max-height: 320px;
  object-fit: cover;
  display: block;
  border-bottom: 1px solid rgba(31, 51, 72, 0.12);
}

.promote-email-preview-body {
  padding: 1rem 1rem 1.15rem;
}

.promote-email-preview-template {
  margin: 0 0 0.7rem;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5a738f;
}

.promote-email-preview-empty {
  margin: 0;
  color: #4c6175;
  font-size: 0.95rem;
}

.promote-email-preview-block {
  margin: 0 0 0.8rem;
}

.promote-email-preview-heading {
  margin: 0 0 0.55rem;
  font-size: 1.4rem;
  line-height: 1.2;
  color: #13273a;
}

.promote-email-preview-subheading {
  margin: 0 0 0.55rem;
  font-size: 1.1rem;
  line-height: 1.25;
  color: #173752;
}

.promote-email-preview-copy {
  margin: 0 0 0.7rem;
  font-size: 0.96rem;
  line-height: 1.52;
  color: #233c56;
  white-space: pre-wrap;
}

.promote-email-preview-caption {
  margin: 0 0 0.32rem;
  font-size: 0.74rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: #6f869c;
}

.promote-email-preview-cta {
  display: inline-block;
  margin-top: 0.25rem;
  padding: 0.58rem 0.85rem;
  border-radius: 8px;
  background: #0a2741;
  color: #ffffff;
  font-size: 0.9rem;
  font-weight: 700;
}

.engage-social-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.9fr);
  gap: 1rem;
  margin-top: 1rem;
  align-items: start;
}

.engage-social-panel {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  background: linear-gradient(180deg, #ffffff 0%, #f6fbff 100%);
}

.engage-social-side-panel {
  background: linear-gradient(180deg, #f8fbff 0%, #eef5ff 100%);
}

.engage-social-channel-bar,
.engage-social-meta-row,
.engage-social-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.engage-social-meta-row {
  align-items: flex-end;
}

.engage-social-action-row {
  margin-top: 0.65rem;
}

.engage-social-action-row button {
  min-width: 180px;
  width: auto;
}

.engage-social-eyebrow {
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 0.2rem;
}

.engage-social-channel-name {
  font-size: 1.45rem;
  font-weight: 700;
}

.engage-social-schedule-field {
  flex: 1 1 auto;
}

.engage-social-counter-wrap {
  flex: 0 0 auto;
  min-width: 92px;
  text-align: right;
}

.engage-social-counter {
  display: inline-block;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  background: #eef4fa;
  font-size: 0.84rem;
  font-weight: 600;
}

.engage-social-counter-over {
  background: #ffeef3;
  color: #ab2a55;
}

.engage-social-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 0.8rem;
}

.engage-social-stat-card {
  padding: 0.8rem;
  border: 1px solid rgba(99, 123, 158, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.78);
}

.engage-social-stat-card strong {
  display: block;
  font-size: 1.25rem;
  margin-top: 0.25rem;
}

.engage-social-stat-label {
  font-size: 0.8rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.engage-social-note {
  margin: 1rem 0 0;
  font-size: 0.92rem;
  color: var(--muted);
  line-height: 1.45;
}

.engage-social-section-title {
  margin: 0.95rem 0 0.45rem;
  font-size: 1.35rem;
  font-weight: 800;
  color: #10263a;
}

.engage-social-section-divider {
  margin: 0.85rem 0 0.35rem;
  border: 0;
  border-top: 1px solid rgba(99, 123, 158, 0.35);
}

.engage-social-platform-option {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 1.9rem;
  font-weight: 700;
  line-height: 1.2;
}

.engage-social-platform-option input[type="checkbox"] {
  width: auto;
  margin: 0;
  transform: translateY(-1px);
}

.engage-social-platform-name {
  font-weight: 800;
  color: #10263a;
}

.engage-social-campaign-image {
  margin: 0 0 0.85rem;
  border: 1px solid rgba(99, 123, 158, 0.24);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.85);
  padding: 0;
  overflow: hidden;
}

.engage-social-campaign-image img {
  display: block;
  width: 100%;
  height: auto;
  margin: 0 auto;
  border-radius: 0;
  object-fit: cover;
}

.explore-filters-shell {
  margin: 1rem 0;
}

.explore-filters-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
}

.explore-filter-column {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1rem;
  background: linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
}

.explore-filter-column h4 {
  margin: 0 0 0.85rem;
  font-size: 1.25rem;
  line-height: 1.2;
}

#acquireAdvancedPanel {
  margin-top: 1rem;
}

#acquireAdvancedPanel > summary {
  cursor: pointer;
  font-weight: 600;
}

.tiny-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.status-pill {
  display: inline-block;
  padding: 0.2rem 0.45rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}

.status-ok {
  background: #e6f4ff;
  color: #13568a;
}

.status-warn {
  background: #f4f7fb;
  color: #f6c47f;
}

.status-bad {
  background: #ffeef3;
  color: #ff9bb2;
}

.meta {
  color: var(--muted);
  font-size: 0.9rem;
}

#message {
  position: sticky;
  bottom: 0;
  margin: 0;
  padding: 0.7rem 1rem;
  background: #ffffff;
  border-top: 1px solid var(--border);
  min-height: 2.5rem;
}

@media (max-width: 720px) {
  .menu-root {
    flex-direction: column;
  }
  .menu-item {
    border-right: none;
    border-bottom: 1px solid #ffffff;
  }
  .submenu {
    position: static;
    border: none;
    border-top: 1px solid #ffffff;
  }
  .grid-form {
    grid-template-columns: 1fr;
  }
  .contacts-top-grid {
    grid-template-columns: 1fr;
  }
  .social-grid-left {
    grid-template-columns: 1fr;
  }
  .filters.filters-contacts,
  .filters.filters-contacts-3x4 {
    grid-template-columns: 1fr;
  }
  .labeled-form .form-row {
    grid-template-columns: 1fr;
    gap: 0.25rem;
  }
  .labeled-form > button[type="submit"] {
    width: min(520px, 100%);
    min-width: min(400px, 100%);
    max-width: 100%;
    margin-left: auto;
    margin-right: auto;
  }
  .asset-edit-layout {
    grid-template-columns: 1fr;
  }
  .asset-upload-grid {
    grid-template-columns: 1fr;
  }
  .promote-email-layout {
    grid-template-columns: 1fr;
  }
  .develop-themes-columns {
    grid-template-columns: 1fr;
  }
  .develop-themes-toolbar {
    grid-template-columns: 1fr;
  }
  .develop-themes-stack .form-row {
    grid-template-columns: 1fr;
  }
  .develop-landing-pages-grid {
    grid-template-columns: 1fr;
  }
  .develop-visual-toolbar {
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .develop-template-hero,
  .develop-template-content,
  .develop-template-feature-grid {
    grid-template-columns: 1fr;
  }
  .develop-form-builder-layout {
    grid-template-columns: 1fr;
  }
  .develop-template-library {
    grid-template-columns: 1fr;
  }
  .develop-template-logo-row {
    grid-template-columns: 1fr;
  }
  .develop-template-cta-row {
    flex-direction: column;
  }
  .develop-template-cta-row button {
    width: 100%;
    min-width: 0;
  }
  .engage-social-layout {
    grid-template-columns: 1fr;
  }
  .explore-filters-grid {
    grid-template-columns: 1fr;
  }
  .docs-platform-selector,
  .docs-platform-detail-layout {
    grid-template-columns: 1fr;
  }
  .engage-social-meta-row,
  .engage-social-action-row,
  .engage-social-channel-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .engage-social-action-row button {
    width: 100%;
  }
  .engage-social-counter-wrap {
    text-align: left;
  }
  .engage-social-stats-grid {
    grid-template-columns: 1fr;
  }
  .asset-preview-wrap {
    min-height: 280px;
    max-height: 55vh;
  }
  .asset-preview-media {
    max-height: calc(55vh - 100px);
  }
  .asset-preview-frame {
    height: calc(55vh - 110px);
    max-height: calc(55vh - 110px);
  }
  #messagingPage .cards {
    grid-template-columns: 1fr;
  }
}
/* ──────────────────────────────────────────────────────────────────────────
   #7 — Formal Environment Configuration: CSS additions
   Append these rules to public/styles.css
   ────────────────────────────────────────────────────────────────────────── */

/* ── Env config table ─────────────────────────────────────────────────── */
.env-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.env-table th,
.env-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border, #e8eaed);
}

.env-th-status  { width: 32px; }
.env-th-key     { width: 40%; }
.env-th-value   { width: 40%; }
.env-th-action  { width: 120px; text-align: right; }

.env-group-row td.env-group-label {
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted, #5f6368);
  background: var(--bg-subtle, #f8f9fa);
  padding: 8px 12px;
}

.env-row:hover {
  background: var(--bg-hover, #f8f9fa);
}

.env-row--editing {
  background: var(--bg-subtle, #f8f9fa);
}

/* ── Status dot ───────────────────────────────────────────────────────── */
.env-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.env-dot--set     { background: #34a853; }
.env-dot--missing { background: #dadce0; border: 1px solid #bdc1c6; }

.env-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted, #5f6368);
}

/* ── Key / description ────────────────────────────────────────────────── */
.env-key {
  display: block;
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  color: var(--text-primary, #202124);
}

.env-desc {
  display: block;
  font-size: 11px;
  color: var(--text-muted, #5f6368);
  margin-top: 2px;
}

/* ── Values ───────────────────────────────────────────────────────────── */
.env-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  word-break: break-all;
}

.env-value--missing {
  color: var(--text-muted, #9aa0a6);
  font-style: italic;
}

.env-action-cell {
  text-align: right;
  white-space: nowrap;
}

/* ── Edit input ───────────────────────────────────────────────────────── */
.env-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid var(--border-focus, #1a73e8);
  border-radius: 4px;
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  outline: none;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.15);
}

.env-loading {
  text-align: center;
  color: var(--text-muted, #9aa0a6);
  padding: 24px;
}

.env-footer {
  font-size: 12px;
  color: var(--text-muted, #5f6368);
  padding: 12px 16px;
  border-top: 1px solid var(--border, #e8eaed);
  line-height: 1.8;
}

.env-footer code {
  background: var(--bg-subtle, #f8f9fa);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
}

/* =============================================================================
   #10 — Component Library CSS
   Append to public/styles.css
   ============================================================================= */

/* ---------------------------------------------------------------------------
   Shared component tokens (override in :root if you have a design system)
   --------------------------------------------------------------------------- */
:root {
  --c-border:       #e2e8f0;
  --c-radius:       6px;
  --c-shadow-sm:    0 1px 3px rgba(0,0,0,0.08);
  --c-shadow-md:    0 4px 16px rgba(0,0,0,0.14);
  --c-bg:           #ffffff;
  --c-bg-subtle:    #f8fafc;
  --c-text:         #1a202c;
  --c-text-muted:   #718096;
  --c-primary:      #1a73e8;
  --c-primary-dark: #1557b0;
  --c-error:        #e53e3e;
  --c-success:      #38a169;
}

.table-wrap {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}

table {
  width: 100%;
  border-collapse: collapse;
}

.crud-actions-cell {
  text-align: right;
  white-space: nowrap !important;
}

/* ---------------------------------------------------------------------------
   1. DataGrid
   --------------------------------------------------------------------------- */

.c-grid {
  width: 100%;
  overflow-x: auto;
}

.c-grid__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.c-grid__filter-input {
  flex: 1 1 120px;
  min-width: 80px;
  max-width: 200px;
  padding: 5px 9px;
  border: 1px solid var(--c-border);
  border-radius: var(--c-radius);
  font-size: 12px;
  background: var(--c-bg);
  color: var(--c-text);
  outline: none;
  transition: border-color 0.15s;
}
.c-grid__filter-input:focus {
  border-color: var(--c-primary);
  box-shadow: 0 0 0 2px rgba(26,115,232,0.15);
}

.c-grid__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  background: var(--c-bg);
}

.c-grid__th {
  padding: 9px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--c-text-muted);
  border-bottom: 2px solid var(--c-border);
  white-space: nowrap;
  user-select: none;
}

.c-grid__th--sortable {
  cursor: pointer;
}
.c-grid__th--sortable:hover {
  color: var(--c-primary);
}

.c-grid__td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-text);
  vertical-align: middle;
}

.c-grid__row:hover .c-grid__td {
  background: var(--c-bg-subtle);
}

.c-grid__row--clickable {
  cursor: pointer;
}

.c-grid__empty {
  padding: 32px 12px;
  text-align: center;
  color: var(--c-text-muted);
  font-size: 13px;
}

/* ---------------------------------------------------------------------------
   2. Modal
   --------------------------------------------------------------------------- */

.c-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 16px;
}

.c-modal__dialog {
  background: var(--c-bg);
  border-radius: calc(var(--c-radius) * 1.5);
  box-shadow: var(--c-shadow-md);
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.c-modal__header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.c-modal__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--c-text);
  margin: 0;
  flex: 1 1 auto;
  min-width: 0;
}

.c-modal__close {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--c-text-muted);
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: var(--c-radius);
  transition: background 0.15s;
  margin-left: auto;
  flex: 0 0 auto;
  align-self: flex-start;
}
.c-modal__close:hover {
  background: var(--c-bg-subtle);
  color: var(--c-text);
}

.c-modal__body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  font-size: 14px;
  color: var(--c-text);
  line-height: 1.6;
}

.c-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--c-border);
  flex-shrink: 0;
}

/* ---------------------------------------------------------------------------
   3. Card
   --------------------------------------------------------------------------- */

.c-card {
  background: var(--c-bg);
  border: 1px solid var(--c-border);
  border-radius: calc(var(--c-radius) * 1.5);
  box-shadow: var(--c-shadow-sm);
  overflow: hidden;
}

.c-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border);
  background: var(--c-bg-subtle);
}

.c-card__title-wrap {
  flex: 1;
  min-width: 0;
}

.c-card__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.c-card__subtitle {
  font-size: 12px;
  color: var(--c-text-muted);
  margin: 2px 0 0;
}

.c-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.c-card__body {
  padding: 16px 18px;
  font-size: 13px;
  color: var(--c-text);
}

/* Card grid layout — wrap multiple cards */
.c-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

/* ---------------------------------------------------------------------------
   4. Toast
   --------------------------------------------------------------------------- */

.c-toast__container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.c-toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 16px;
  border-radius: var(--c-radius);
  box-shadow: var(--c-shadow-md);
  font-size: 13px;
  font-weight: 500;
  width: 380px;
  max-width: calc(100vw - 48px);
  pointer-events: all;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.2s ease, transform 0.2s ease;
  color: #fff;
}

.c-toast--visible {
  opacity: 1;
  transform: translateY(0);
}

.c-toast--success { background: var(--c-success); }
.c-toast--error   { background: var(--c-error);   }
.c-toast--info    { background: var(--c-primary);  }

.c-toast__message {
  flex: 1;
  line-height: 1.4;
}

.c-toast__close {
  background: none;
  border: none;
  color: rgba(255,255,255,0.8);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 0 2px;
  flex-shrink: 0;
  transition: color 0.15s;
}
.c-toast__close:hover {
  color: #fff;
}

/* ---------------------------------------------------------------------------
   Shared button utilities (if not already in styles.css)
   --------------------------------------------------------------------------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 7px 14px;
  border: 1px solid transparent;
  border-radius: var(--c-radius);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
  white-space: nowrap;
  line-height: 1;
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary {
  background: var(--c-primary);
  color: #fff;
  border-color: var(--c-primary);
}
.btn-primary:hover:not(:disabled) { background: var(--c-primary-dark); border-color: var(--c-primary-dark); }

.btn-ghost {
  background: transparent;
  color: var(--c-text);
  border-color: var(--c-border);
}
.btn-ghost:hover:not(:disabled) { background: var(--c-bg-subtle); }

.btn-danger {
  background: var(--c-error);
  color: #fff;
  border-color: var(--c-error);
}
.btn-danger:hover:not(:disabled) { background: #c53030; border-color: #c53030; }

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
}

.api-actions-col {
  width: 150px;
  min-width: 150px;
}

.api-actions-cell {
  width: 150px;
  min-width: 150px;
  white-space: nowrap;
}

#apiConfigsTable tr.api-config-row-complete,
#apiChannelsTableBody tr.api-config-row-complete {
  background: #eaf8ec;
}

#apiConfigsTable tr.api-config-row-incomplete,
#apiChannelsTableBody tr.api-config-row-incomplete {
  background: #fdecef;
}

.api-stale-flags {
  margin-top: 8px;
  display: grid;
  gap: 4px;
}

.api-stale-flag {
  font-size: 12px;
  line-height: 1.35;
}

.api-stale-flag-warning {
  color: #7a4a00;
}

.api-stale-flag-error {
  color: #8a1d2b;
  font-weight: 600;
}

.api-settings-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.api-provider-help {
  border: 1px solid var(--c-border);
  border-radius: 10px;
  background: var(--c-bg-subtle);
  padding: 12px;
}

.api-provider-help h4 {
  margin: 0 0 8px;
  font-size: 14px;
}

.api-provider-help p {
  margin: 0 0 8px;
  color: var(--c-text-soft);
}

.api-provider-help ul {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 6px;
}

.api-provider-help .api-help-note {
  margin-top: 10px;
  font-size: 12px;
}

.api-provider-logo-link {
  display: inline-flex;
  width: 76px;
  height: 76px;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  background: #fff;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  margin: 6px 0 8px;
}

.api-provider-logo {
  width: 42px;
  height: 42px;
  object-fit: contain;
}

@media (max-width: 960px) {
  .api-settings-form-grid {
    grid-template-columns: 1fr;
  }
}

.connection-ops-level {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 12px;
}

.connection-ops-level-green {
  background: #e8f5ea;
  color: #17633a;
}

.connection-ops-level-yellow {
  background: #fff7dc;
  color: #8a6500;
}

.connection-ops-level-red {
  background: #fdecef;
  color: #8a1d2b;
}

.channel-gate-cell {
  text-align: center;
  width: 48px;
}

.channel-gate-icon {
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
}

.channel-gate-icon-done {
  background: #ecfff2;
  color: #00b83f;
  border: 1px solid #00b83f;
}

.channel-gate-icon-todo {
  background: #fff2f5;
  color: #8a1d2b;
  border: 1px solid #d7738b;
}

.connection-ops-accordion {
  display: grid;
  gap: 10px;
}

.connection-ops-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: #f7fbff;
}

.connection-ops-section-toggle {
  margin: 0;
  border-radius: 0;
  border: none;
  width: 100%;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: s
```

## public/js/acquire.js
```
/**
 * public/js/acquire.js
 * Acquire jobs table, direct web acquire, and OpenClaw job lifecycle actions.
 */

window.App = window.App || {};
App.acquire = (function () {
  const { state, els, api, notify, setPreview, prettyJson } = App;
  let redditHarvestProgressTimer = null;
  let lastRedditDiscoveryResult = null;
  let lastBlueskyDiscoveryResult = null;
  let blueskyDiscoverySelectedPostUrls = new Set();
  const BLUESKY_DISCOVERY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:discovery-feedback:';
  const BLUESKY_REPLY_FEEDBACK_KEY_PREFIX = 'alphire:bluesky:reply-feedback:';
  const YT_MINER_RESPONSE_CONTEXT_KEY = 'yt_miner_response_context_v1';
  const YT_MINER_RESPONSE_GUIDELINES_KEY = 'yt_miner_response_guidelines_v1';
  const DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY = 'alphire:direct-acquire:keyword-exclusions:v1';
  const DIRECT_ACQUIRE_KEYWORD_REASONS_KEY = 'alphire:direct-acquire:keyword-exclusion-reasons:v1';
  const DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY = 'alphire:direct-acquire:keyword-topics:v1';
  const ACQUIRE_SETTINGS_KEY = 'alphire:acquire:settings:v1';
  const DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS = [
    'Corporate',
    'Personal',
    'Not Serious',
    'Low Volume',
    'AI Slop',
  ];
  const DEFAULT_ACQUIRE_WEBSITE_DEFAULTS = {
    acquireSocial: true,
    acquireKeywords: true,
    acquireHashtags: true,
    acquireImages: true,
    acquirePages: true,
    acquirePeerSites: false,
    maxPages: 10,
    peerSitesLimit: 20,
    imagesLimit: 20,
    snippetLength: 600,
  };
  const DIRECT_ACQUIRE_KEYWORD_REASON_OPTIONS = [
    ['', 'No Exclusion'],
    ['brand', 'Brand'],
    ['generic', 'Generic'],
    ['navigational', 'Navigational'],
    ['boilerplate', 'Boilerplate'],
    ['location', 'Location'],
    ['legal', 'Legal'],
  ];
  let directAcquireImageCategories = [];
  let directAcquireSelectedImages = new Set();
  let directAcquireImageCategoryByUrl = new Map();
  let directAcquireImagesExpanded = false;
  let directAcquireSelectedHashtags = new Set();
  let directAcquireProgressTimer = null;
  let directAcquireTopics = [];
  let directAcquireWebsitePeers = [];
  let directAcquireWebsitePeerEditingId = '';
  const WEBSITE_PEER_MODELS = Array.isArray(App.WEBSITE_PEER_MODELS) ? App.WEBSITE_PEER_MODELS.slice() : [];
  const SECTION_SETTINGS_LINKS = [
    { label: 'Acquire Settings', pageId: 'acquireSettingsPage' },
    { label: 'Contacts Settings', pageId: 'contactsSettingsPage' },
    { label: 'Channels Settings', pageId: 'channelsSettingsPage' },
    { label: 'Messaging Settings', pageId: 'messagingSettingsPage' },
    { label: 'Assets Settings', pageId: 'assetsSettingsPage' },
    { label: 'Builder Settings', pageId: 'builderSettingsPage' },
    { label: 'Campaigns Settings', pageId: 'campaignSettingsPage' },
    { label: 'Promote Settings', pageId: 'promoteSettingsPage' },
    { label: 'Engage Settings', pageId: 'engageSettingsPage' },
    { label: 'Observe Settings', pageId: 'observeSettingsPage' },
    { label: 'Training Settings', pageId: 'trainingSettingsPage' },
  ];

  function normalizeAcquireSettingLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function readAcquireSettings() {
    try {
      const raw = window.localStorage.getItem(ACQUIRE_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const reasons = Array.isArray(parsed?.youtubeBanReasons) ? parsed.youtubeBanReasons : [];
      const merged = Array.from(new Set(DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS.concat(
        reasons.map((item) => normalizeAcquireSettingLabel(item)).filter(Boolean)
      )));
      return {
        youtubeBanReasons: merged,
        websiteDefaults: Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, parsed?.websiteDefaults || {}),
      };
    } catch (_) {
      return {
        youtubeBanReasons: DEFAULT_ACQUIRE_YOUTUBE_BAN_REASONS.slice(),
        websiteDefaults: Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS),
      };
    }
  }

  function writeAcquireSettings(nextSettings) {
    const current = readAcquireSettings();
    const settings = Object.assign({}, current, nextSettings || {});
    settings.youtubeBanReasons = Array.from(new Set(
      (Array.isArray(settings.youtubeBanReasons) ? settings.youtubeBanReasons : [])
        .map((item) => normalizeAcquireSettingLabel(item))
        .filter(Boolean)
    ));
    settings.websiteDefaults = Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, settings.websiteDefaults || {});
    try {
      window.localStorage.setItem(ACQUIRE_SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {
      // ignore local storage failures
    }
    return settings;
  }

  function getAcquireYoutubeBanReasons() {
    return readAcquireSettings().youtubeBanReasons.slice();
  }

  function getAcquireWebsiteDefaults() {
    return Object.assign({}, DEFAULT_ACQUIRE_WEBSITE_DEFAULTS, readAcquireSettings().websiteDefaults || {});
  }

  App.getAcquireYoutubeBanReasons = getAcquireYoutubeBanReasons;
  App.getAcquireWebsiteDefaults = getAcquireWebsiteDefaults;

  function normalizeDirectAcquireKeyword(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/&[a-z0-9#]+;/gi, ' ')
      .replace(/[^a-z0-9\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitDirectAcquireKeywordExclusions(value) {
    return String(value || '')
      .split(/\r?\n|,|;/g)
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  function readDirectAcquireKeywordReasons() {
    try {
      const raw = window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_REASONS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeDirectAcquireKeywordReasons(map) {
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_REASONS_KEY, JSON.stringify(map || {}));
    } catch (_) {
      // ignore local storage failures
    }
  }

  function readDirectAcquireKeywordTopics() {
    try {
      const raw = window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeDirectAcquireKeywordTopics(map) {
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_TOPICS_KEY, JSON.stringify(map || {}));
    } catch (_) {
      // ignore local storage failures
    }
  }

  async function refreshDirectAcquireTopics() {
    try {
      if (App.ui && App.ui.ensureMessagingTopicsLoaded) {
        const topics = await App.ui.ensureMessagingTopicsLoaded();
        directAcquireTopics = topics.slice();
      } else {
        const res = await api('/api/messaging/topics');
        const topics = Array.isArray(res?.topics) ? res.topics : Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        directAcquireTopics = topics
          .map((item) => String(item?.topic || item?.category || '').trim())
          .filter(Boolean)
          .filter((value, index, list) => list.indexOf(value) === index)
          .sort((a, b) => a.localeCompare(b));
      }
    } catch (_) {
      directAcquireTopics = [];
    }
  }

  async function saveSelectedKeywordsAsContent(keywordLabels, topics) {
    const labels = Array.from(keywordLabels || []).map((value) => String(value || '').trim()).filter(Boolean);
    const topicList = Array.from(topics || []).map((value) => String(value || '').trim()).filter(Boolean);
    if (!labels.length || !topicList.length) return 0;
    const existingRes = await api('/api/messaging/keywords?limit=5000');
    const existing = Array.isArray(existingRes?.keywords)
      ? existingRes.keywords
      : Array.isArray(existingRes?.data)
        ? existingRes.data
        : Array.isArray(existingRes)
          ? existingRes
          : [];
    const existingPairs = new Set(
      existing.map((item) => `${normalizeDirectAcquireKeyword(item?.keyword)}::${String(item?.topic || item?.category || '').trim().toLowerCase()}`)
    );
    let created = 0;
    for (const keyword of labels) {
      for (const topic of topicList) {
        const pairKey = `${normalizeDirectAcquireKeyword(keyword)}::${String(topic || '').trim().toLowerCase()}`;
        if (existingPairs.has(pairKey)) continue;
        await api('/api/messaging/keywords', {
          method: 'POST',
          body: JSON.stringify({ keyword, topic }),
        });
        existingPairs.add(pairKey);
        created += 1;
      }
    }
    return created;
  }

  function renderDirectAcquireKeywordTopicOptions() {
    const menu = document.getElementById('directAcquireKeywordTopicsMenu');
    const summary = document.getElementById('directAcquireKeywordTopicsSummary');
    if (!menu || !summary) return;
    const selectedValues = new Set(
      Array.from(menu.querySelectorAll('input[type="checkbox"][data-topic]:checked'))
        .map((input) => String(input.value || '').trim())
        .filter(Boolean)
    );
    menu.innerHTML = '';
    directAcquireTopics.forEach((topic) => {
      const label = document.createElement('label');
      label.className = 'direct-acquire-dropdown-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = topic;
      checkbox.dataset.topic = topic;
      checkbox.checked = selectedValues.has(topic);
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(topic));
      menu.appendChild(label);
    });
    const count = selectedValues.size;
    summary.textContent = count ? `${count} Topic${count === 1 ? '' : 's'} Selected` : 'Topics';
  }

  function syncDirectAcquireKeywordExclusionsFromTable() {
    const textarea = document.getElementById('directAcquireKeywordExclusionsInput');
    const tableBody = document.getElementById('directAcquireKeywordTable');
    if (!textarea || !tableBody) return;
    const currentRunKeywords = new Map(
      (Array.isArray(state.directAcquireCurrentRun?.keyword_labels) ? state.directAcquireCurrentRun.keyword_labels : [])
        .map(([keyword]) => [normalizeDirectAcquireKeyword(keyword), String(keyword || '').trim()])
        .filter(([normalized, label]) => normalized && label)
    );
    const existingEntries = splitDirectAcquireKeywordExclusions(textarea.value);
    const manualOnly = existingEntries.filter((entry) => !currentRunKeywords.has(normalizeDirectAcquireKeyword(entry)));
    const nextReasons = readDirectAcquireKeywordReasons();
    const selectedEntries = [];
    tableBody.querySelectorAll('tr').forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"][data-keyword]');
      const select = row.querySelector('select[data-keyword-reason]');
      if (!checkbox) return;
      const label = String(checkbox.dataset.keyword || '').trim();
      const normalized = normalizeDirectAcquireKeyword(label);
      if (!normalized || !label) return;
      if (checkbox.checked) {
        const reason = String(select && select.value || 'brand').trim() || 'brand';
        nextReasons[normalized] = reason;
        selectedEntries.push(label);
      } else {
        delete nextReasons[normalized];
      }
    });
    const merged = Array.from(new Set([...manualOnly, ...selectedEntries]));
    textarea.value = merged.join('\n');
    try {
      window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY, textarea.value);
    } catch (_) {
      // ignore local storage failures
    }
    writeDirectAcquireKeywordReasons(nextReasons);
  }

  function setDirectAcquireResultsVisible(visible) {
    const wrap = document.getElementById('directAcquireResultsWrap');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !visible);
  }

  function startDirectAcquireProgress() {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const submitBtn = document.getElementById('directAcquireSubmitBtn');
    if (wrap) wrap.classList.remove('hidden');
    if (bar) bar.value = 8;
    if (text) text.textContent = 'Harvesting website...';
    if (submitBtn) submitBtn.disabled = true;
    if (directAcquireProgressTimer) clearInterval(directAcquireProgressTimer);
    directAcquireProgressTimer = setInterval(() => {
      if (!bar) return;
      const current = Number(bar.value || 0) || 0;
      bar.value = Math.min(92, current + (current < 35 ? 5 : current < 65 ? 3 : 1.5));
    }, 650);
  }

  function finishDirectAcquireProgress(ok, message) {
    const wrap = document.getElementById('directAcquireProgressWrap');
    const bar = document.getElementById('directAcquireProgressBar');
    const text = document.getElementById('directAcquireProgressText');
    const submitBtn = document.getElementById('directAcquireSubmitBtn');
    if (directAcquireProgressTimer) {
      clearInterval(directAcquireProgressTimer);
      directAcquireProgressTimer = null;
    }
    if (bar) bar.value = ok ? 100 : Math.max(8, Number(bar.value || 0) || 0);
    if (text) text.textContent = String(message || (ok ? 'Harvest complete.' : 'Harvest failed.')).trim();
    if (submitBtn) submitBtn.disabled = false;
    if (wrap) {
      setTimeout(() => wrap.classList.add('hidden'), ok ? 900 : 1800);
    }
  }

  function renderSectionSettingsNav(activePageId) {
    const wrap = document.getElementById('sectionSettingsNavList');
    if (!wrap) return;
    wrap.innerHTML = '';
    SECTION_SETTINGS_LINKS.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.className = 'section-settings-nav-btn' + (item.pageId === activePageId ? ' is-active' : '');
      button.disabled = item.pageId === activePageId;
      button.addEventListener('click', function () {
        const target = String(item.pageId || '').trim();
        const page = document.getElementById(target);
        if (page && page.classList.contains('app-page')) {
          App.setActivePage(target);
        } else {
          notify(item.label + ' is not set up yet.');
        }
      });
      wrap.appendChild(button);
    });
  }

  function renderAcquireYoutubeBanReasons() {
    const tbody = document.getElementById('acquireYoutubeBanReasonsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    const reasons = getAcquireYoutubeBanReasons();
    if (!reasons.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 2;
      td.textContent = 'No ban reasons configured.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    reasons.forEach((reason) => {
      const tr = document.createElement('tr');
      const reasonTd = document.createElement('td');
      reasonTd.textContent = reason;
      const actionsTd = document.createElement('td');
      actionsTd.className = 'action-icons-cell';
      const deleteBtn = App.makeIconButton('delete', 'Delete Ban Reason', function () {
        const next = getAcquireYoutubeBanReasons().filter((item) => item !== reason);
        writeAcquireSettings({ youtubeBanReasons: next });
        renderAcquireYoutubeBanReasons();
        notify('Ban reason deleted');
      }, { danger: true });
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(reasonTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderAcquireWebsiteDefaults() {
    const defaults = getAcquireWebsiteDefaults();
    const checkboxMap = {
      acquireSettingsAcquireSocial: defaults.acquireSocial,
      acquireSettingsAcquireKeywords: defaults.acquireKeywords,
      acquireSettingsAcquireHashtags: defaults.acquireHashtags,
      acquireSettingsAcquireImages: defaults.acquireImages,
      acquireSettingsAcquirePages: defaults.acquirePages,
      acquireSettingsAcquirePeerSites: defaults.acquirePeerSites,
    };
    Object.keys(checkboxMap).forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.checked = checkboxMap[id] === true;
    });
    const valueMap = {
      acquireSettingsMaxPages: String(defaults.maxPages || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages),
      acquireSettingsPeerSitesLimit: String(defaults.peerSitesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit),
      acquireSettingsImagesLimit: String(defaults.imagesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit),
      acquireSettingsSnippetLength: String(defaults.snippetLength || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength),
    };
    Object.keys(valueMap).forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.value = valueMap[id];
    });
  }

  function applyAcquireWebsiteDefaultsToForm() {
    const form = els.directAcquireForm;
    if (!form) return;
    const defaults = getAcquireWebsiteDefaults();
    const checkboxFields = {
      acquire_social: defaults.acquireSocial,
      acquire_keywords: defaults.acquireKeywords,
      acquire_hashtags: defaults.acquireHashtags,
      acquire_images: defaults.acquireImages,
      acquire_pages: defaults.acquirePages,
      acquire_peer_sites: defaults.acquirePeerSites,
    };
    Object.keys(checkboxFields).forEach((name) => {
      const input = form.querySelector('[name="' + name + '"]');
      if (input) input.checked = checkboxFields[name] === true;
    });
    const valueFields = {
      max_pages: String(defaults.maxPages || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages),
      peer_sites_limit: String(defaults.peerSitesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit),
      images_limit: String(defaults.imagesLimit || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit),
      body_snippet_chars: String(defaults.snippetLength || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength),
    };
    Object.keys(valueFields).forEach((name) => {
      const input = form.querySelector('[name="' + name + '"]');
      if (input) input.value = valueFields[name];
    });
  }

  function renderAcquireSettingsPage() {
    renderAcquireYoutubeBanReasons();
    renderAcquireWebsiteDefaults();
    renderSectionSettingsNav('acquireSettingsPage');
  }

  function sanitizeImageNameFromUrl(url, index) {
    try {
      const parsed = new URL(String(url || '').trim());
      const last = String(parsed.pathname || '').split('/').filter(Boolean).pop() || '';
      const cleaned = decodeURIComponent(last).replace(/\.[a-z0-9]{2,8}$/i, '').replace(/[-_]+/g, ' ').trim();
      if (cleaned) return cleaned;
      return `Web Image ${index + 1}`;
    } catch {
      return `Web Image ${index + 1}`;
    }
  }

  function pruneDirectAcquireImageState() {
    const urls = new Set(
      (Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [])
        .map((item) => String(item?.url || '').trim())
        .filter(Boolean)
    );
    directAcquireSelectedImages = new Set(Array.from(directAcquireSelectedImages).filter((url) => urls.has(url)));
    const nextMap = new Map();
    directAcquireImageCategoryByUrl.forEach((value, key) => {
      if (urls.has(key)) nextMap.set(key, value);
    });
    directAcquireImageCategoryByUrl = nextMap;
  }

  async function refreshDirectAcquireImageCategories() {
    try {
      const res = await api('/api/asset-categories');
      const categories = Array.isArray(res?.categories)
        ? res.categories
        : Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
      directAcquireImageCategories = categories
        .filter((item) => String(item?.assetType || item?.asset_type || '').trim().toLowerCase() === 'image')
        .map((item) => String(item?.category || '').trim())
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .sort((a, b) => a.localeCompare(b));
    } catch (_) {
      directAcquireImageCategories = [];
    }
  }

  function fillDirectAcquireImageCategorySelect(select, selectedValue, placeholder = 'No Category') {
    if (!select) return;
    const selected = String(selectedValue || '').trim();
    select.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = placeholder;
    select.appendChild(emptyOption);
    directAcquireImageCategories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      if (category === selected) option.selected = true;
      select.appendChild(option);
    });
  }

  function renderDirectAcquireImageGallery() {
    const gallery = document.getElementById('directAcquireImageGallery');
    const emptyEl = document.getElementById('directAcquireImagesEmpty');
    const selectAll = document.getElementById('directAcquireImageSelectAll');
    const seeMoreBtn = document.getElementById('directAcquireImagesSeeMoreBtn');
    const saveBtn = document.getElementById('directAcquireSaveImagesBtn');
    const bulkCategory = document.getElementById('directAcquireImageBulkCategory');
    if (!gallery) return;
    gallery.innerHTML = '';
    if (bulkCategory) fillDirectAcquireImageCategorySelect(bulkCategory, bulkCategory.value, 'Select Image Category');
    const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
    pruneDirectAcquireImageState();
    if (!images.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (seeMoreBtn) seeMoreBtn.classList.add('hidden');
      if (saveBtn) saveBtn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    const visibleImages = directAcquireImagesExpanded ? images : images.slice(0, 24);
    visibleImages.forEach((item, index) => {
      const url = String(item?.url || '').trim();
      if (!url) return;
      const card = document.createElement('div');
      card.className = 'direct-acquire-image-card';

      const selectRow = document.createElement('div');
      selectRow.className = 'direct-acquire-image-card-top';
      const checkboxLabel = document.createElement('label');
      checkboxLabel.className = 'checkbox-row';
      checkboxLabel.style.margin = '0';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directAcquireSelectedImages.has(url);
      checkbox.dataset.imageUrl = url;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) directAcquireSelectedImages.add(url);
        else directAcquireSelectedImages.delete(url);
        renderDirectAcquireImageGallery();
      });
      checkboxLabel.appendChild(checkbox);
      checkboxLabel.appendChild(document.createTextNode(' Select'));
      selectRow.appendChild(checkboxLabel);
      card.appendChild(selectRow);

      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'direct-acquire-image-link';
      const img = document.createElement('img');
      img.src = url;
      img.alt = sanitizeImageNameFromUrl(url, index);
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      link.appendChild(img);
      card.appendChild(link);

      const meta = document.createElement('div');
      meta.className = 'direct-acquire-image-meta';
      const name = document.createElement('div');
      name.className = 'direct-acquire-image-name';
      name.textContent = sanitizeImageNameFromUrl(url, index);
      meta.appendChild(name);
      const categorySelect = document.createElement('select');
      categorySelect.dataset.imageCategory = url;
      fillDirectAcquireImageCategorySelect(categorySelect, directAcquireImageCategoryByUrl.get(url) || '', 'No Category');
      categorySelect.addEventListener('change', () => {
        const value = String(categorySelect.value || '').trim();
        if (value) directAcquireImageCategoryByUrl.set(url, value);
        else directAcquireImageCategoryByUrl.delete(url);
      });
      meta.appendChild(categorySelect);
      card.appendChild(meta);

      gallery.appendChild(card);
    });

    if (seeMoreBtn) {
      if (images.length > 24) {
        seeMoreBtn.classList.remove('hidden');
        seeMoreBtn.textContent = directAcquireImagesExpanded ? 'Show Less' : `See More (${images.length - 24} more)`;
      } else {
        seeMoreBtn.classList.add('hidden');
      }
    }
    if (saveBtn) saveBtn.disabled = directAcquireSelectedImages.size === 0;
    if (selectAll) {
      const visibleUrls = visibleImages.map((item) => String(item?.url || '').trim()).filter(Boolean);
      const checkedCount = visibleUrls.filter((url) => directAcquireSelectedImages.has(url)).length;
      selectAll.checked = !!visibleUrls.length && checkedCount === visibleUrls.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleUrls.length;
    }
  }

  async function saveDirectAcquireSelectedImages() {
    const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
    const selected = images.filter((item) => directAcquireSelectedImages.has(String(item?.url || '').trim()));
    if (!selected.length) throw new Error('No images selected.');
    const sourceUrl = String(state.directAcquireCurrentRun?.source_url || '').trim();
    let hostTag = '';
    try {
      hostTag = new URL(sourceUrl).hostname.replace(/^www\./, '');
    } catch {
      hostTag = '';
    }
    await Promise.all(selected.map((item, index) => {
      const url = String(item?.url || '').trim();
      const category = String(directAcquireImageCategoryByUrl.get(url) || '').trim();
      return api('/api/assets', {
        method: 'POST',
        body: JSON.stringify({
          assetName: sanitizeImageNameFromUrl(url, index),
          assetType: 'Image',
          category,
          location: url,
          tags: ['acquire.web', 'web-image'].concat(hostTag ? [hostTag] : []),
        }),
      });
    }));
    notify(`Saved ${selected.length} image asset${selected.length === 1 ? '' : 's'}`);
  }

  function blueskyDiscoveryFeedbackKey(itemOrUrl) {
    const postUrl = typeof itemOrUrl === 'string'
      ? itemOrUrl
      : String(itemOrUrl && itemOrUrl.post_url || '').trim();
    return postUrl ? `${BLUESKY_DISCOVERY_FEEDBACK_KEY_PREFIX}${postUrl}` : '';
  }

  function readBlueskyDiscoveryFeedback(itemOrUrl) {
    const key = blueskyDiscoveryFeedbackKey(itemOrUrl);
    const empty = {
      quality: 0,
      categories: [],
      category_explain: '',
      attributes: [],
      attributes_explain: '',
      approaches: [],
      approaches_explain: '',
      note: '',
      suggested_response: '',
      updated_at: '',
    };
    if (!key) return empty;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        quality: Number(parsed.quality || 0),
        categories: toList(parsed.categories).map((v) => String(v || '').trim()).filter(Boolean),
        category_explain: String(parsed.category_explain || '').trim(),
        attributes: toList(parsed.attributes).map((v) => String(v || '').trim()).filter(Boolean),
        attributes_explain: String(parsed.attributes_explain || '').trim(),
        approaches: toList(parsed.approaches).map((v) => String(v || '').trim()).filter(Boolean),
        approaches_explain: String(parsed.approaches_explain || '').trim(),
        note: String(parsed.note || ''),
        suggested_response: String(parsed.suggested_response || ''),
        updated_at: String(parsed.updated_at || ''),
      };
    } catch (_) {
      return empty;
    }
  }

  function saveBlueskyDiscoveryFeedback(itemOrUrl, patch) {
    const key = blueskyDiscoveryFeedbackKey(itemOrUrl);
    if (!key) return readBlueskyDiscoveryFeedback(itemOrUrl);
    const current = readBlueskyDiscoveryFeedback(itemOrUrl);
    const merged = { ...current, ...(patch || {}), updated_at: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  function blueskyDiscoveryHasReview(feedback) {
    return Boolean(
      Number(feedback && feedback.quality || 0) > 0
      || toList(feedback && feedback.categories).length
      || String(feedback && feedback.category_explain || '').trim()
      || toList(feedback && feedback.attributes).length
      || String(feedback && feedback.attributes_explain || '').trim()
      || toList(feedback && feedback.approaches).length
      || String(feedback && feedback.approaches_explain || '').trim()
      || String(feedback && feedback.note || '').trim()
      || String(feedback && feedback.suggested_response || '').trim()
    );
  }

  function makeQualityOptions(selectedValue) {
    const values = ['', '1', '2', '3', '4', '5'];
    return values.map((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value || 'Unrated';
      option.selected = String(selectedValue || '') === value;
      return option;
    });
  }

  function toList(value) {
    return Array.isArray(value) ? value : [];
  }

  function getTrainingConfigNames(tableId) {
    const tbody = document.getElementById(tableId);
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll('tr')).map((tr) => {
      const input = tr.querySelector('.yt-miner-config-name');
      if (input && String(input.value || '').trim()) return String(input.value || '').trim();
      const tds = tr.querySelectorAll('td');
      return String(tds[1] && tds[1].textContent || '').trim();
    }).filter(Boolean);
  }

  function blueskyReplyFeedbackKey(result, item) {
    const target = String(result && result.target || result?.post?.post_url || '').trim();
    const text = String(item && item.text || '').trim();
    return target && text ? `${BLUESKY_REPLY_FEEDBACK_KEY_PREFIX}${target}::${text}` : '';
  }

  function readBlueskyReplyFeedback(result, item) {
    const key = blueskyReplyFeedbackKey(result, item);
    const empty = {
      quality: 0,
      categories: [],
      category_explain: '',
      attributes: [],
      attributes_explain: '',
      approaches: [],
      approaches_explain: '',
      note: '',
      suggested_response: '',
      updated_at: '',
    };
    if (!key) return empty;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) || {};
      return {
        quality: Number(parsed.quality || 0),
        categories: toList(parsed.categories).map((v) => String(v || '').trim()).filter(Boolean),
        category_explain: String(parsed.category_explain || '').trim(),
        attributes: toList(parsed.attributes).map((v) => String(v || '').trim()).filter(Boolean),
        attributes_explain: String(parsed.attributes_explain || '').trim(),
        approaches: toList(parsed.approaches).map((v) => String(v || '').trim()).filter(Boolean),
        approaches_explain: String(parsed.approaches_explain || '').trim(),
        note: String(parsed.note || ''),
        suggested_response: String(parsed.suggested_response || ''),
        updated_at: String(parsed.updated_at || ''),
      };
    } catch (_) {
      return empty;
    }
  }

  function saveBlueskyReplyFeedback(result, item, patch) {
    const key = blueskyReplyFeedbackKey(result, item);
    if (!key) return readBlueskyReplyFeedback(result, item);
    const current = readBlueskyReplyFeedback(result, item);
    const merged = {
      ...current,
      ...(patch || {}),
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(merged));
    return merged;
  }

  function blueskyReplyHasReview(feedback) {
    return Boolean(
      Number(feedback && feedback.quality || 0) > 0
      || toList(feedback && feedback.categories).length
      || String(feedback && feedback.category_explain || '').trim()
      || toList(feedback && feedback.attributes).length
      || String(feedback && feedback.attributes_explain || '').trim()
      || toList(feedback && feedback.approaches).length
      || String(feedback && feedback.approaches_explain || '').trim()
      || String(feedback && feedback.note || '').trim()
      || String(feedback && feedback.suggested_response || '').trim()
    );
  }

  function renderBlueskyDiscoveryBulkActions() {
    const rows = Array.isArray(lastBlueskyDiscoveryResult?.candidates) ? lastBlueskyDiscoveryResult.candidates : [];
    const selectedCount = rows.reduce((count, item) => {
      const postUrl = String(item && item.post_url || '').trim();
      return count + (postUrl && blueskyDiscoverySelectedPostUrls.has(postUrl) ? 1 : 0);
    }, 0);
    const wrap = document.getElementById('blueskyDiscoveryBulkActions');
    const applyBtn = document.getElementById('blueskyDiscoveryApplyBulkQualityBtn');
    const bulkSelect = document.getElementById('blueskyDiscoveryBulkQuality');
    const selectAll = document.getElementById('blueskyDiscoverySelectAllVisible');
    if (wrap) wrap.classList.toggle('hidden', !rows.length);
    if (applyBtn) {
      applyBtn.disabled = !selectedCount;
      applyBtn.textContent = selectedCount ? `Apply To Selected (${selectedCount})` : 'Apply To Selected';
    }
    if (bulkSelect) bulkSelect.disabled = !selectedCount;
    if (selectAll) {
      const visibleUrls = rows.map((item) => String(item && item.post_url || '').trim()).filter(Boolean);
      selectAll.checked = !!visibleUrls.length && visibleUrls.every((url) => blueskyDiscoverySelectedPostUrls.has(url));
      selectAll.indeterminate = !selectAll.checked && visibleUrls.some((url) => blueskyDiscoverySelectedPostUrls.has(url));
    }
  }

  let blueskyDiscoveryPostOverlayEl = null;
  let blueskyDiscoveryPostOverlayBodyEl = null;
  let blueskyDiscoveryPostOverlayEditBtn = null;
  let blueskyDiscoveryPostOverlayHideTimer = null;
  let blueskyDiscoveryPostOverlayEditAction = null;

  function ensureBlueskyDiscoveryPostOverlay() {
    if (blueskyDiscoveryPostOverlayEl && document.body.contains(blueskyDiscoveryPostOverlayEl)) {
      return blueskyDiscoveryPostOverlayEl;
    }
    const overlay = document.createElement('div');
    overlay.className = 'bluesky-discovery-post-overlay hidden';
    const header = document.createElement('div');
    header.className = 'bluesky-discovery-post-overlay-header';
    const title = document.createElement('strong');
    title.textContent = 'Full Post';
    const editBtn = App.makeIconButton('edit', 'Review Training Feedback', () => {
      hideBlueskyDiscoveryPostOverlay(false);
      if (typeof blueskyDiscoveryPostOverlayEditAction === 'function') blueskyDiscoveryPostOverlayEditAction();
    }, { primary: true });
    editBtn.classList.add('youtube-miner-feedback-icon');
    header.appendChild(title);
    header.appendChild(editBtn);
    const body = document.createElement('div');
    body.className = 'bluesky-discovery-post-overlay-body';
    overlay.appendChild(header);
    overlay.appendChild(body);
    overlay.addEventListener('mouseenter', () => {
      if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    });
    overlay.addEventListener('mouseleave', () => {
      hideBlueskyDiscoveryPostOverlay(true);
    });
    document.body.appendChild(overlay);
    blueskyDiscoveryPostOverlayEl = overlay;
    blueskyDiscoveryPostOverlayBodyEl = body;
    blueskyDiscoveryPostOverlayEditBtn = editBtn;
    return overlay;
  }

  function positionBlueskyDiscoveryPostOverlay(anchorEl, overlayEl) {
    if (!anchorEl || !overlayEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const margin = 16;
    const overlayWidth = Math.min(760, Math.max(420, Math.floor(window.innerWidth * 0.52)));
    overlayEl.style.width = `${overlayWidth}px`;
    overlayEl.style.maxHeight = `${Math.floor(window.innerHeight * 0.62)}px`;
    const overlayRect = overlayEl.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 10;
    if (left + overlayRect.width > window.innerWidth - margin) {
      left = window.innerWidth - overlayRect.width - margin;
    }
    if (left < margin) left = margin;
    if (top + overlayRect.height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - overlayRect.height - 10);
    }
    overlayEl.style.left = `${left}px`;
    overlayEl.style.top = `${top}px`;
  }

  function showBlueskyDiscoveryPostOverlay(text, anchorEl, editAction, hasFeedback) {
    const overlay = ensureBlueskyDiscoveryPostOverlay();
    if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    blueskyDiscoveryPostOverlayEditAction = typeof editAction === 'function' ? editAction : null;
    if (blueskyDiscoveryPostOverlayBodyEl) {
      blueskyDiscoveryPostOverlayBodyEl.textContent = String(text || '').trim() || '-';
    }
    if (blueskyDiscoveryPostOverlayEditBtn) {
      blueskyDiscoveryPostOverlayEditBtn.classList.toggle('has-feedback', !!hasFeedback);
    }
    overlay.classList.remove('hidden');
    positionBlueskyDiscoveryPostOverlay(anchorEl, overlay);
  }

  function hideBlueskyDiscoveryPostOverlay(withDelay) {
    const overlay = ensureBlueskyDiscoveryPostOverlay();
    if (blueskyDiscoveryPostOverlayHideTimer) clearTimeout(blueskyDiscoveryPostOverlayHideTimer);
    const applyHide = () => overlay.classList.add('hidden');
    if (withDelay) {
      blueskyDiscoveryPostOverlayHideTimer = setTimeout(applyHide, 180);
      return;
    }
    applyHide();
  }

  function openBlueskyDiscoveryFeedbackPop(feedbackPop) {
    if (!feedbackPop) return;
    document.querySelectorAll('.bluesky-discovery-feedback-pop').forEach((node) => {
      if (node !== feedbackPop) node.classList.add('hidden');
    });
    if (!document.body.contains(feedbackPop)) {
      document.body.appendChild(feedbackPop);
    }
    feedbackPop.classList.remove('hidden');
    feedbackPop.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }

  async function getSharedTrainingPromptPayload() {
    const trainingContextInput = document.getElementById('youtubeMinerResponseContext');
    const trainingGuidelinesInput = document.getElementById('youtubeMinerGuidelines');

    let trainingContext = String(trainingContextInput && trainingContextInput.value || '').trim();
    let trainingGuidelines = String(trainingGuidelinesInput && trainingGuidelinesInput.value || '').trim();

    if (!trainingContext) {
      try { trainingContext = String(window.localStorage.getItem(YT_MINER_RESPONSE_CONTEXT_KEY) || '').trim(); } catch (_) { /* ignore */ }
    }
    if (!trainingGuidelines) {
      try { trainingGuidelines = String(window.localStorage.getItem(YT_MINER_RESPONSE_GUIDELINES_KEY) || '').trim(); } catch (_) { /* ignore */ }
    }

    if (!trainingContext || !trainingGuidelines) {
      try {
        const res = await api('/api/settings/training/context', { method: 'GET' });
        const loadedContext = String(res?.training_context || res?.data?.training_context || res?.youtube_response_context || res?.data?.youtube_response_context || '').trim();
        const loadedGuidelines = String(res?.training_guidelines || res?.data?.training_guidelines || res?.youtube_response_guidelines || res?.data?.youtube_response_guidelines || '').trim();
        if (!trainingContext && loadedContext) trainingContext = loadedContext;
        if (!trainingGuidelines && loadedGuidelines) trainingGuidelines = loadedGuidelines;
        if (trainingContextInput && !String(trainingContextInput.value || '').trim() && loadedContext) trainingContextInput.value = loadedContext;
        if (trainingGuidelinesInput && !String(trainingGuidelinesInput.value || '').trim() && loadedGuidelines) trainingGuidelinesInput.value = loadedGuidelines;
        if (loadedContext) {
          try { window.localStorage.setItem(YT_MINER_RESPONSE_CONTEXT_KEY, loadedContext); } catch (_) { /* ignore */ }
        }
        if (loadedGuidelines) {
          try { window.localStorage.setItem(YT_MINER_RESPONSE_GUIDELINES_KEY, loadedGuidelines); } catch (_) { /* ignore */ }
        }
      } catch (_) {
        // Keep best-effort local values; diagnostics will show if still missing.
      }
    }

    return {
      training_context: trainingContext,
      training_guidelines: trainingGuidelines,
    };
  }

  // -------------------------------------------------------------------------
  // Stage helpers
  // -------------------------------------------------------------------------

  function stageClass(stage, isBusy = false) {
    if (isBusy || stage === 'RUNNING') return 'status-warn';
    if (stage === 'COMPLETED') return 'status-ok';
    if (stage === 'REJECTED') return 'status-bad';
    return 'status-warn';
  }

  function isActionAllowed(stage, action) {
    const s = String(stage || '').toUpperCase();
    if (!s) return true;
    if (action === 'run')         return s === 'PENDING_PREVIEW' || s === 'PENDING_APPROVAL' || s === 'APPROVED';
    if (action === 'preview_job') return s === 'PENDING_PREVIEW';
    if (action === 'approve_job') return s === 'PENDING_APPROVAL';
    if (action === 'execute_job') return s === 'APPROVED';
    return true;
  }

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  function upsertHarvestJobState(job) {
    if (!job || !job.id) return;
    const idx = state.acquireJobs.findIndex((j) => String(j.id) === String(job.id));
    if (idx >= 0) {
      state.acquireJobs[idx] = { ...state.acquireJobs[idx], ...job };
    } else {
      state.acquireJobs.unshift(job);
    }
    state.acquireJobs.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }

  function deriveHarvestJobFromResponse(built, response) {
    const result = response?.result || {};
    const id = result?.job?.id || result?.job_id || built?.request?.job_id;
    if (!id) return null;
    const stage = result?.job?.status || result?.status || '';
    const urls = built?.request?.payload && Array.isArray(built.request.payload.source_urls)
      ? built.request.payload.source_urls : [];
    return {
      id: String(id),
      stage: String(stage || ''),
      url: String(urls[0] || ''),
      workspace_id: String(built?.request?.workspace_id || ''),
      type: String(built?.request?.type || ''),
      updated_at: new Date().toISOString()
    };
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  function renderHarvestJobsTable() {
    if (!els.acquireJobsTable) return;
    els.acquireJobsTable.innerHTML = '';

    if (!state.acquireJobs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No jobs yet. Create one above to populate this list.';
      tr.appendChild(td);
      els.acquireJobsTable.appendChild(tr);
      return;
    }

    state.acquireJobs.forEach((job) => {
      const tr = document.createElement('tr');
      const stageValue = String(job.stage || '').toUpperCase();
      const isBusy = Boolean(state.acquireBusyByJob[job.id]);

      const idTd = document.createElement('td');
      idTd.textContent = job.id || '-';
      tr.appendChild(idTd);

      const stageTd = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = `status-pill ${stageClass(stageValue, isBusy)}`;
      pill.textContent = isBusy ? 'RUNNING...' : (stageValue || '-');
      stageTd.appendChild(pill);
      tr.appendChild(stageTd);

      const urlTd = document.createElement('td');
      urlTd.textContent = job.url || '-';
      tr.appendChild(urlTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = job.updated_at || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');

      const mkBtn = (label, onClick, enabled = true) => {
        const iconMap = {
          Load: 'load',
          Run: 'run',
          Status: 'status',
          Preview: 'preview',
          Approve: 'approve',
        };
        const btn = App.makeIconButton(iconMap[label] || 'view', label, onClick, { disabled: !enabled, marginRight: '6px' });
        return btn;
      };

      actionsTd.appendChild(mkBtn('Load', () => {
        if (job.id && els.acquireJobIdInput) els.acquireJobIdInput.value = job.id;
        if (job.url) {
          const src = els.acquireForm?.querySelector('textarea[name="source_urls"]');
          if (src) src.value = job.url;
        }
        notify(`Loaded ${job.id}`);
      }, !isBusy));

      actionsTd.appendChild(mkBtn('Run', () => runHarvestRowSequence(job), !isBusy && isActionAllowed(stageValue, 'run')));
      actionsTd.appendChild(mkBtn('Status',  () => runHarvestRowAction('job_status',  job), !isBusy));
      actionsTd.appendChild(mkBtn('Preview', () => runHarvestRowAction('preview_job', job), !isBusy && isActionAllowed(stageValue, 'preview_job')));
      actionsTd.appendChild(mkBtn('Approve', () => runHarvestRowAction('approve_job', job), !isBusy && isActionAllowed(stageValue, 'approve_job')));
      actionsTd.appendChild(mkBtn('Execute', () => runHarvestRowAction('execute_job', job), !isBusy && isActionAllowed(stageValue, 'execute_job')));
      actionsTd.appendChild(mkBtn('Delete', async () => {
        if (!confirm(`Delete ${job.id} from jobs list?`)) return;
        try {
          await api(`/api/acquire/jobs/${encodeURIComponent(job.id)}`, { method: 'DELETE' });
          state.acquireJobs = state.acquireJobs.filter((j) => String(j.id) !== String(job.id));
          renderHarvestJobsTable();
          notify(`Deleted ${job.id}`);
        } catch (err) { notify(err.message, true); }
      }, !isBusy));

      tr.appendChild(actionsTd);
      els.acquireJobsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestRunsTable() {
    if (!els.directAcquireRunsTable) return;
    els.directAcquireRunsTable.innerHTML = '';
    if (!state.directAcquireRuns.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No direct runs yet.';
      tr.appendChild(td); els.directAcquireRunsTable.appendChild(tr); return;
    }
    state.directAcquireRuns.forEach((run) => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => loadDirectHarvestRun(run.run_id).catch((e) => notify(e.message, true)));
      [run.run_id||'-', run.source_url||'-', String(run.pages_succeeded??'-'), String(run.pages_failed??'-'), run.finished_at||'-']
        .forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
      els.directAcquireRunsTable.appendChild(tr);
    });
  }

  function renderDirectHarvestPagesTable() {
    if (!els.directAcquirePagesTable) return;
    els.directAcquirePagesTable.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const pages = Array.isArray(run?.pages) ? run.pages : [];
    if (!pages.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td'); td.colSpan = 5; td.textContent = 'No website pages loaded yet.';
      tr.appendChild(td); els.directAcquirePagesTable.appendChild(tr);
    } else {
      pages.forEach((page) => {
        const tr = document.createElement('tr');
        [page.url||'-', page.title||'-',
         Array.isArray(page.emails)?page.emails.join(', ')||'-':'-',
         Array.isArray(page.phones)?page.phones.join(', ')||'-':'-',
         page.body_snippet||'-'
        ].forEach((text) => { const td = document.createElement('td'); td.textContent = text; tr.appendChild(td); });
        els.directAcquirePagesTable.appendChild(tr);
      });
    }
    if (els.directAcquireErrorsPreview) {
      const errors = Array.isArray(run?.errors) ? run.errors : [];
      els.directAcquireErrorsPreview.textContent = errors.length ? prettyJson({ errors }) : '{}';
      els.directAcquireErrorsPreview.classList.toggle('hidden', !errors.length);
    }
    setDirectAcquireResultsVisible(Boolean(run));
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireHashtagTable();
    renderDirectAcquirePeerSitesTable();
    renderDirectAcquireImageGallery();
  }

  function renderDirectAcquireContactTable() {
    const tableBody = document.getElementById('directAcquireContactTable');
    const emptyEl = document.getElementById('directAcquireContactEmpty');
    const saveBtn = document.getElementById('directAcquireSaveContactBtn');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.contact_labels) ? run.contact_labels : [];
    if (!labels.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (saveBtn) saveBtn.disabled = true;
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    if (saveBtn) saveBtn.disabled = false;
    labels.forEach(([label, value]) => {
      const tr = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.className = 'direct-acquire-contact-label';
      labelTd.textContent = String(label || '');
      const valueTd = document.createElement('td');
      const text = String(value || '').trim();
      if (/^https?:\/\//i.test(text)) {
        const link = document.createElement('a');
        link.href = text;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text;
        valueTd.appendChild(link);
      } else {
        valueTd.textContent = text;
      }
      tr.appendChild(labelTd);
      tr.appendChild(valueTd);
      tableBody.appendChild(tr);
    });
  }

  function renderDirectAcquireKeywordTable() {
    const tableBody = document.getElementById('directAcquireKeywordTable');
    const emptyEl = document.getElementById('directAcquireKeywordEmpty');
    const selectAll = document.getElementById('directAcquireKeywordSelectAll');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.keyword_labels) ? run.keyword_labels : [];
    const exclusionSet = new Set(
      splitDirectAcquireKeywordExclusions(document.getElementById('directAcquireKeywordExclusionsInput')?.value)
        .map((value) => normalizeDirectAcquireKeyword(value))
        .filter(Boolean)
    );
    const reasonMap = readDirectAcquireKeywordReasons();
    const topicMap = readDirectAcquireKeywordTopics();
    if (!labels.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    labels.forEach(([keyword, score]) => {
      const tr = document.createElement('tr');
      const normalized = normalizeDirectAcquireKeyword(keyword);
      const selected = exclusionSet.has(normalized);
      const assignedTopics = Array.isArray(topicMap[normalized]) ? topicMap[normalized].filter(Boolean) : [];
      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected;
      checkbox.dataset.keyword = String(keyword || '').trim();
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          const reasonSelect = tr.querySelector('select[data-keyword-reason]');
          if (reasonSelect && !String(reasonSelect.value || '').trim()) reasonSelect.value = 'brand';
        }
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);
      const keywordTd = document.createElement('td');
      keywordTd.className = 'direct-acquire-contact-label';
      keywordTd.textContent = String(keyword || '');
      const scoreTd = document.createElement('td');
      const numericScore = Number(score || 0) || 0;
      scoreTd.textContent = numericScore ? numericScore.toFixed(1) : '0.0';
      const topicsTd = document.createElement('td');
      topicsTd.textContent = assignedTopics.length ? assignedTopics.join(', ') : 'No Topics';
      const reasonTd = document.createElement('td');
      const reasonSelect = document.createElement('select');
      reasonSelect.dataset.keywordReason = 'true';
      reasonSelect.dataset.keyword = String(keyword || '').trim();
      DIRECT_ACQUIRE_KEYWORD_REASON_OPTIONS.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (String(value) === String(reasonMap[normalized] || (selected ? 'brand' : ''))) {
          option.selected = true;
        }
        reasonSelect.appendChild(option);
      });
      reasonSelect.addEventListener('change', () => {
        if (String(reasonSelect.value || '').trim()) {
          checkbox.checked = true;
        }
        if (!String(reasonSelect.value || '').trim()) {
          checkbox.checked = false;
        }
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
      reasonTd.appendChild(reasonSelect);
      tr.appendChild(keywordTd);
      tr.appendChild(scoreTd);
      tr.appendChild(topicsTd);
      tr.appendChild(reasonTd);
      tableBody.appendChild(tr);
    });
    if (selectAll) {
      const checkboxes = Array.from(tableBody.querySelectorAll('input[type="checkbox"][data-keyword]'));
      const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
      selectAll.checked = !!checkboxes.length && checkedCount === checkboxes.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }
  }

  function renderDirectAcquireHashtagTable() {
    const tableBody = document.getElementById('directAcquireHashtagTable');
    const emptyEl = document.getElementById('directAcquireHashtagEmpty');
    const selectAll = document.getElementById('directAcquireHashtagSelectAll');
    const saveBtn = document.getElementById('directAcquireSaveHashtagsBtn');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hashtags = Array.isArray(state.directAcquireCurrentRun?.hashtag_summary?.hashtags)
      ? state.directAcquireCurrentRun.hashtag_summary.hashtags
      : [];
    const valid = new Set(hashtags.map((item) => String(item?.hashtag || '').trim()).filter(Boolean));
    directAcquireSelectedHashtags = new Set(Array.from(directAcquireSelectedHashtags).filter((tag) => valid.has(tag)));
    if (!hashtags.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (saveBtn) saveBtn.disabled = true;
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    hashtags.forEach((item) => {
      const hashtag = String(item?.hashtag || '').trim();
      if (!hashtag) return;
      const tr = document.createElement('tr');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = directAcquireSelectedHashtags.has(hashtag);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) directAcquireSelectedHashtags.add(hashtag);
        else directAcquireSelectedHashtags.delete(hashtag);
        renderDirectAcquireHashtagTable();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const hashtagTd = document.createElement('td');
      hashtagTd.className = 'direct-acquire-contact-label';
      hashtagTd.textContent = hashtag;
      tr.appendChild(hashtagTd);

      const scoreTd = document.createElement('td');
      scoreTd.textContent = (Number(item?.evidence_score || 0) || 0).toFixed(1);
      tr.appendChild(scoreTd);

      const postsTd = document.createElement('td');
      postsTd.textContent = String(Number(item?.posts_count || 0) || 0);
      tr.appendChild(postsTd);

      const sampleTd = document.createElement('td');
      sampleTd.textContent = String(item?.sample_usage || '').trim() || '-';
      tr.appendChild(sampleTd);

      tableBody.appendChild(tr);
    });
    if (saveBtn) saveBtn.disabled = directAcquireSelectedHashtags.size === 0;
    if (selectAll) {
      const checkedCount = hashtags.filter((item) => directAcquireSelectedHashtags.has(String(item?.hashtag || '').trim())).length;
      selectAll.checked = !!hashtags.length && checkedCount === hashtags.length;
      selectAll.indeterminate = checkedCount > 0 && checkedCount < hashtags.length;
    }
  }

  function renderDirectAcquirePeerSitesTable() {
    const tableBody = document.getElementById('directAcquirePeerSitesTable');
    const metaEl = document.getElementById('directAcquirePeerSitesMeta');
    const diagnosticsEl = document.getElementById('directAcquirePeerSitesDiagnostics');
    const suggestedWrap = document.getElementById('directAcquirePeerSitesSuggestedWrap');
    const suggestedEl = document.getElementById('directAcquirePeerSitesSuggested');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const summary = state.directAcquireCurrentRun?.peer_summary || {};
    const peers = Array.isArray(summary.peers) ? summary.peers : [];
    const suggestions = Array.isArray(summary.suggested_models) ? summary.suggested_models : [];
    const searchedKeywords = Array.isArray(summary.searched_keywords) ? summary.searched_keywords.filter(Boolean) : [];
    if (diagnosticsEl) {
      const diagnosticParts = [];
      diagnosticParts.push(`Provider: ${String(summary.provider || 'google_custom_search')}`);
      diagnosticParts.push(`Configured: ${summary.configured ? 'Yes' : 'No'}`);
      diagnosticParts.push(`Requested: ${summary.enabled === false ? 'No' : 'Yes'}`);
      diagnosticParts.push(`Keywords: ${searchedKeywords.length}`);
      diagnosticParts.push(`Results: ${Number(summary.raw_results_count || 0) || 0}`);
      diagnosticParts.push(`Unique Domains: ${Number(summary.unique_domains_count || 0) || 0}`);
      if (Array.isArray(summary.errors) && summary.errors.length) {
        diagnosticParts.push(`Errors: ${summary.errors.join(' | ')}`);
      } else if (String(summary.error || '').trim()) {
        diagnosticParts.push(`Error: ${String(summary.error || '').trim()}`);
      }
      diagnosticsEl.textContent = diagnosticParts.join(' | ');
    }
    if (!peers.length) {
      if (metaEl) {
        metaEl.textContent = String(summary.error || '').trim()
          || (summary.enabled === false
            ? 'Peer sites not searched.'
            : summary.configured === false
              ? 'Peer site discovery is not configured yet.'
              : 'No peer sites discovered yet.');
      }
      if (suggestedWrap) suggestedWrap.classList.add('hidden');
      return;
    }
    if (metaEl) {
      const uniqueCount = Number(summary.unique_domains_count || peers.length) || peers.length;
      const rawCount = Number(summary.raw_results_count || 0) || 0;
      metaEl.textContent = `${uniqueCount} unique domains identified from ${rawCount} search results.`;
    }
    if (suggestedWrap && suggestedEl) {
      if (suggestions.length) {
        suggestedEl.textContent = suggestions
          .map((item) => `${item.model} (${item.count})`)
          .join(', ');
        suggestedWrap.classList.remove('hidden');
      } else {
        suggestedWrap.classList.add('hidden');
      }
    }
    peers.forEach((peer) => {
      const tr = document.createElement('tr');

      const modelTd = document.createElement('td');
      modelTd.textContent = String(peer?.model || '').trim() || '-';
      tr.appendChild(modelTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      const url = String(peer?.url || '').trim();
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.title || '').trim() || url;
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(peer?.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length
        ? peer.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const snippetTd = document.createElement('td');
      snippetTd.textContent = String(peer?.snippet || '').trim() || '-';
      tr.appendChild(snippetTd);

      tableBody.appendChild(tr);
    });
  }

  function resetDirectAcquireWebsitePeerForm() {
    directAcquireWebsitePeerEditingId = '';
    const form = document.getElementById('directAcquireWebsitePeerForm');
    if (!form) return;
    form.reset();
    const idInput = document.getElementById('directAcquireWebsitePeerId');
    if (idInput) idInput.value = '';
    const typeInput = document.getElementById('directAcquireWebsitePeerType');
    if (typeInput) typeInput.value = WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || '');
    const sourceUrlInput = document.getElementById('directAcquireWebsitePeerSourceUrl');
    if (sourceUrlInput && state.directAcquireCurrentRun?.source_url) {
      sourceUrlInput.value = String(state.directAcquireCurrentRun.source_url || '').trim();
    }
    const scopeInput = document.getElementById('directAcquireWebsitePeerModel');
    if (scopeInput) scopeInput.value = 'Peer / Source is inferred automatically';
  }

  function populateWebsitePeerModelSelect(selectEl) {
    if (!selectEl) return;
    const current = String(selectEl.value || '').trim();
    selectEl.innerHTML = '';
    WEBSITE_PEER_MODELS.forEach((label) => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      selectEl.appendChild(option);
    });
    if (current && WEBSITE_PEER_MODELS.includes(current)) selectEl.value = current;
  }

  function deriveWebsitePeerScope(payload, existingPeer) {
    const sourceUrl = String(payload?.source_url || existingPeer?.source_url || '').trim();
    const siteUrl = String(payload?.site_url || existingPeer?.site_url || '').trim();
    if (!sourceUrl || !siteUrl) return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    try {
      const source = new URL(sourceUrl);
      const site = new URL(siteUrl);
      const sourceHost = String(source.hostname || '').toLowerCase().replace(/^www\./, '');
      const siteHost = String(site.hostname || '').toLowerCase().replace(/^www\./, '');
      return sourceHost === siteHost ? 'source' : 'peer';
    } catch (_) {
      return String(existingPeer?.site_type || 'peer').trim() || 'peer';
    }
  }

  function fillDirectAcquireWebsitePeerForm(peer) {
    directAcquireWebsitePeerEditingId = String(peer?.id || '').trim();
    const idInput = document.getElementById('directAcquireWebsitePeerId');
    const typeInput = document.getElementById('directAcquireWebsitePeerType');
    const sourceUrlInput = document.getElementById('directAcquireWebsitePeerSourceUrl');
    const siteUrlInput = document.getElementById('directAcquireWebsitePeerSiteUrl');
    const titleInput = document.getElementById('directAcquireWebsitePeerTitle');
    const modelInput = document.getElementById('directAcquireWebsitePeerModel');
    const keywordsInput = document.getElementById('directAcquireWebsitePeerKeywords');
    const snippetInput = document.getElementById('directAcquireWebsitePeerSnippet');
    const notesInput = document.getElementById('directAcquireWebsitePeerNotes');
    if (idInput) idInput.value = directAcquireWebsitePeerEditingId;
    if (typeInput) typeInput.value = String(peer?.website_model || '').trim() || (WEBSITE_PEER_MODELS.includes('Direct Competitors') ? 'Direct Competitors' : (WEBSITE_PEER_MODELS[0] || ''));
    if (sourceUrlInput) sourceUrlInput.value = String(peer?.source_url || '').trim();
    if (siteUrlInput) siteUrlInput.value = String(peer?.site_url || '').trim();
    if (titleInput) titleInput.value = String(peer?.title || '').trim();
    if (modelInput) modelInput.value = String(peer?.site_type || '').trim() === 'source' ? 'Source Website' : 'Peer Website';
    if (keywordsInput) keywordsInput.value = Array.isArray(peer?.matched_keywords) ? peer.matched_keywords.join(', ') : '';
    if (snippetInput) snippetInput.value = String(peer?.snippet || '').trim();
    if (notesInput) notesInput.value = String(peer?.notes || '').trim();
  }

  function renderDirectAcquireWebsitePeersTable() {
    const tableBody = document.getElementById('directAcquireWebsitePeersTable');
    const metaEl = document.getElementById('directAcquireWebsitePeersMeta');
    const countEl = document.getElementById('directAcquireWebsitePeersCount');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const peers = Array.isArray(directAcquireWebsitePeers) ? directAcquireWebsitePeers : [];
    state.directAcquireWebsitePeers = peers.slice();
    if (countEl) countEl.textContent = `${peers.length} saved`;
    if (!peers.length) {
      if (metaEl) metaEl.textContent = 'No website peers saved yet.';
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.textContent = 'No website peers saved yet.';
      tr.appendChild(td);
      tableBody.appendChild(tr);
      return;
    }
    if (metaEl) metaEl.textContent = `${peers.length} website record${peers.length === 1 ? '' : 's'} available for this project.`;
    peers.forEach((peer) => {
      const tr = document.createElement('tr');

      const typeTd = document.createElement('td');
      typeTd.textContent = String(peer?.site_type || 'peer').trim() === 'source' ? 'Source' : 'Peer';
      tr.appendChild(typeTd);

      const modelTd = document.createElement('td');
      modelTd.textContent = String(peer?.website_model || '').trim() || '-';
      tr.appendChild(modelTd);

      const domainTd = document.createElement('td');
      domainTd.className = 'direct-acquire-contact-label';
      domainTd.textContent = String(peer?.domain || '').trim() || '-';
      tr.appendChild(domainTd);

      const siteTd = document.createElement('td');
      if (String(peer?.site_url || '').trim()) {
        const link = document.createElement('a');
        link.href = String(peer.site_url).trim();
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(peer?.title || peer?.site_url || '').trim();
        siteTd.appendChild(link);
      } else {
        siteTd.textContent = String(peer?.title || '').trim() || '-';
      }
      tr.appendChild(siteTd);

      const keywordsTd = document.createElement('td');
      keywordsTd.textContent = Array.isArray(peer?.matched_keywords) && peer.matched_keywords.length
        ? peer.matched_keywords.join(', ')
        : '-';
      tr.appendChild(keywordsTd);

      const sourceTd = document.createElement('td');
      sourceTd.textContent = String(peer?.source_domain || peer?.source_url || '').trim() || '-';
      tr.appendChild(sourceTd);

      const updatedTd = document.createElement('td');
      updatedTd.textContent = String(peer?.updated_at || peer?.last_harvested_at || '').trim() || '-';
      tr.appendChild(updatedTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'crud-actions-cell';

      const viewBtn = App.makeIconButton('view', 'View', () => {
        if (String(peer?.site_url || '').trim()) window.open(String(peer.site_url).trim(), '_blank', 'noopener');
      });
      actionsTd.appendChild(viewBtn);

      const editBtn = App.makeIconButton('edit', 'Edit', () => {
        fillDirectAcquireWebsitePeerForm(peer);
        const panel = document.getElementById('directAcquireWebsitePeersPanel');
        if (panel) panel.open = true;
      });
      actionsTd.appendChild(editBtn);

      const deleteBtn = App.makeIconButton('trash', 'Delete', async () => {
        if (!confirm(`Delete ${String(peer?.domain || peer?.site_url || 'this website').trim()}?`)) return;
        try {
          await api(`/api/acquire/website-peers/${encodeURIComponent(peer.id)}`, { method: 'DELETE' });
          directAcquireWebsitePeers = directAcquireWebsitePeers.filter((item) => String(item?.id || '') !== String(peer.id));
          renderDirectAcquireWebsitePeersTable();
          if (String(directAcquireWebsitePeerEditingId || '') === String(peer.id)) resetDirectAcquireWebsitePeerForm();
          notify('Website peer deleted');
        } catch (err) {
          notify(err.message || 'Could not delete website peer', true);
        }
      }, { danger: true });
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(actionsTd);
      tableBody.appendChild(tr);
    });
  }

  async function refreshDirectAcquireWebsitePeers() {
    const res = await api('/api/acquire/website-peers?limit=500');
    directAcquireWebsitePeers = Array.isArray(res?.websitePeers)
      ? res.websitePeers
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
          ? res
          : [];
    state.directAcquireWebsitePeers = directAcquireWebsitePeers.slice();
    renderDirectAcquireWebsitePeersTable();
  }

  async function saveDirectAcquireSelectedHashtags() {
    const hashtags = Array.from(directAcquireSelectedHashtags).filter(Boolean);
    if (!hashtags.length) throw new Error('No hashtags selected.');
    await Promise.all(hashtags.map((hashtag) => api('/api/messaging/hashtags', {
      method: 'POST',
      body: JSON.stringify({ hashtag }),
    })));
    notify(`Saved ${hashtags.length} hashtag${hashtags.length === 1 ? '' : 's'}`);
  }

  function buildContactPayloadFromDirectRun(run) {
    const summary = run?.contact_summary || {};
    const domain = (() => {
      try { return new URL(String(summary.website || run?.source_url || '')).hostname.replace(/^www\./, ''); }
      catch { return ''; }
    })();
    const tags = ['web-acquire'];
    if (run?.capture_contact_data) tags.push('contact-capture');
    const extraNotes = [];
    const appendList = (label, key) => {
      const values = Array.isArray(summary?.[key]) ? summary[key].filter(Boolean) : [];
      if (values.length > 1) extraNotes.push(`${label}: ${values.join(', ')}`);
      return values;
    };
    const emails = appendList('Emails', 'emails');
    const phones = appendList('Phones', 'phones');
    const youtube = appendList('YouTube', 'youtube');
    const instagram = appendList('Instagram', 'instagram');
    const tiktok = appendList('TikTok', 'tiktok');
    const facebook = appendList('Facebook', 'facebook');
    const x = appendList('X', 'x');
    const bluesky = appendList('Bluesky', 'bluesky');
    const linkedin = appendList('LinkedIn', 'linkedin');
    const patreon = appendList('Patreon', 'patreon');
    const substack = appendList('Substack', 'substack');
    const medium = appendList('Medium', 'medium');
    const telegram = appendList('Telegram', 'telegram');
    const discord = appendList('Discord', 'discord');
    const whatsapp = appendList('WhatsApp', 'whatsapp');
    if (telegram.length) extraNotes.push(`Telegram: ${telegram.join(', ')}`);
    if (discord.length) extraNotes.push(`Discord: ${discord.join(', ')}`);
    if (whatsapp.length) extraNotes.push(`WhatsApp: ${whatsapp.join(', ')}`);
    return {
      contactType: 'lead',
      company: domain,
      email: emails[0] || '',
      phone: phones[0] || '',
      website: String(summary.website || run?.source_url || '').trim(),
      youtube: youtube[0] || '',
      instagram: instagram[0] || '',
      tiktok: tiktok[0] || '',
      facebook: facebook[0] || '',
      x: x[0] || '',
      bluesky: bluesky[0] || '',
      patreon: patreon[0] || '',
      linkedin: linkedin[0] || '',
      source: 'acquire.web',
      status: 'captured',
      tags,
      notes: extraNotes.join('\n'),
    };
  }

  async function saveDirectAcquireContact() {
    const run = state.directAcquireCurrentRun;
    const labels = Array.isArray(run?.contact_labels) ? run.contact_labels : [];
    if (!labels.length) throw new Error('No captured contact data to save.');
    const payload = buildContactPayloadFromDirectRun(run);
    await api('/api/contacts', { method: 'POST', body: JSON.stringify(payload) });
    notify('Captured contact saved');
  }

  function buildUserIndex(users) {
    const map = new Map();
    (Array.isArray(users) ? users : []).forEach((user) => {
      const id = String(user && user.id || '').trim();
      if (!id) return;
      map.set(id, user);
    });
    return map;
  }

  function toIsoFromLocal(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  function estimateRedditHarvestSeconds(payload) {
    const mode = String(payload?.mode || 'auto');
    const maxPosts = Number(payload?.max_posts || 0);
    const maxComments = Number(payload?.max_comments || 0);
    const includeReplies = !!payload?.include_replies;
    let estimate = 18;
    if (mode === 'post') {
      estimate += Math.ceil(maxComments * 0.18);
    } else {
      estimate += Math.ceil(maxPosts * 0.9);
      estimate += Math.ceil(maxComments * 0.12);
    }
    if (includeReplies) estimate += 24;
    return Math.max(30, Math.min(900, estimate));
  }

  function setRedditHarvestProgress(percent, text) {
    const wrap = document.getElementById('redditHarvestProgressWrap');
    const bar = document.getElementById('redditHarvestProgressBar');
    const label = document.getElementById('redditHarvestProgressText');
    if (!wrap || !bar || !label) return;
    wrap.classList.remove('hidden');
    bar.value = Math.max(0, Math.min(100, Number(percent) || 0));
    label.textContent = String(text || '').trim() || 'Running…';
  }

  function clearRedditHarvestProgress() {
    if (redditHarvestProgressTimer) {
      clearInterval(redditHarvestProgressTimer);
      redditHarvestProgressTimer = null;
    }
  }

  function beginRedditHarvestProgress(payload) {
    clearRedditHarvestProgress();
    const startedAt = Date.now();
    const estimateSeconds = estimateRedditHarvestSeconds(payload);
    setRedditHarvestProgress(4, 'Queued request (phase 1 of 3)…');
    setRedditHarvestProgress(12, `Running OpenClaw harvest (phase 2 of 3)… ~${estimateSeconds}s remaining (estimated)`);
    redditHarvestProgressTimer = setInterval(() => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const remainingSeconds = Math.max(0, estimateSeconds - elapsedSeconds);
      const ratio = estimateSeconds > 0 ? Math.min(1, elapsedSeconds / estimateSeconds) : 0;
      const pct = Math.min(92, 12 + Math.round(ratio * 80));
      const eta = remainingSeconds > 0 ? `~${remainingSeconds}s remaining (estimated)` : 'finalizing…';
      setRedditHarvestProgress(pct, `Running OpenClaw harvest (phase 2 of 3)… ${eta}`);
    }, 1000);
    return {
      finishSuccess() {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Completed in ${elapsedSeconds}s.`);
      },
      finishError(message) {
        clearRedditHarvestProgress();
        setRedditHarvestProgress(100, `Stopped: ${safeText(message) || 'request failed'}`);
      },
    };
  }

  function renderXHarvestItemsTable() {
    if (!els.xHarvestItemsTable) return;
    els.xHarvestItemsTable.innerHTML = '';
    const run = state.xHarvestCurrentRun;
    const result = run && run.result ? run.result : null;
    const tweets = Array.isArray(result && result.tweets) ? result.tweets : [];
    const replies = Array.isArray(result && result.replies) ? result.replies : [];
    const usersById = buildUserIndex(result && result.users);
    const rows = []
      .concat(tweets.map((item) => ({ type: 'tweet', item })))
      .concat(replies.map((item) => ({ type: 'reply', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No tweets/replies loaded yet.';
      tr.appendChild(td);
      els.xHarvestItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const tweet = row.item || {};
        const tr = document.createElement('tr');
        const author = usersById.get(String(tweet.author_id || '').trim()) || {};
        const cells = [
          row.type,
          String(tweet.id || ''),
          String(author.username || author.name || tweet.author_id || '-'),
          String(tweet.created_at || '-'),
          String(tweet.text || '').trim(),
        ];
        cells.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.xHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.xHarvestRawPreview) {
      els.xHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function renderRedditHarvestItemsTable() {
    if (!els.redditHarvestItemsTable) return;
    els.redditHarvestItemsTable.innerHTML = '';
    const run = state.redditHarvestCurrentRun;
    const result = run && run.result ? run.result : null;
    const posts = Array.isArray(result && result.posts) ? result.posts : [];
    const primaryPost = (result && result.post) ? result.post : (posts[0] || null);
    App.setKeyValueRows(els.redditHarvestPostDetailsBody, primaryPost ? [
      ['Title', String(primaryPost.title || '').trim() || '-'],
      ['Subreddit', String(primaryPost.subreddit || run?.subreddit || '-')],
      ['Author', String(primaryPost.author || '-')],
      ['Score', String(primaryPost.score != null ? primaryPost.score : '-')],
      ['Created', String(primaryPost.created_utc ? new Date(Number(primaryPost.created_utc) * 1000).toISOString() : '-')],
      ['Permalink', String(primaryPost.permalink ? `https://www.reddit.com${primaryPost.permalink}` : '-')],
    ] : [
      ['Post', 'No post details loaded yet.'],
    ]);
    const comments = Array.isArray(result && result.comments) ? result.comments : [];
    const rows = []
      .concat(posts.map((item) => ({ type: 'post', item })))
      .concat(comments.map((item) => ({ type: 'comment', item })));

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No posts/comments loaded yet.';
      tr.appendChild(td);
      els.redditHarvestItemsTable.appendChild(tr);
    } else {
      rows.forEach((row) => {
        const item = row.item || {};
        const tr = document.createElement('tr');
        const cols = [
          row.type,
          String(item.id || item.name || ''),
          String(item.author || '-'),
          String(item.score != null ? item.score : '-'),
          row.type === 'post' ? String(item.title || item.selftext || '').trim() : String(item.body || '').trim(),
        ];
        cols.forEach((value) => {
          const td = document.createElement('td');
          td.textContent = value || '-';
          tr.appendChild(td);
        });
        els.redditHarvestItemsTable.appendChild(tr);
      });
    }

    if (els.redditHarvestRawPreview) {
      els.redditHarvestRawPreview.textContent = run ? prettyJson(run) : '{}';
    }
  }

  function setRedditDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('redditDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setRedditReplyStatus(message, isError = false) {
    const el = document.getElementById('redditReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Reddit reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyDiscoveryStatus(message, isError = false) {
    const el = document.getElementById('blueskyDiscoveryStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky discovery is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyReplyStatus(message, isError = false) {
    const el = document.getElementById('blueskyReplyStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky reply generation is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function setBlueskyPostingStatus(message, isError = false) {
    const el = document.getElementById('blueskyPostingStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'BlueSky posting operator is idle.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function renderBlueskyDiscoveryTable(result) {
    const tbody = document.getElementById('blueskyDiscoveryTable');
    const repliesTbody = document.getElementById('blueskyDiscoveryRepliesTable');
    const preview = document.getElementById('blueskyDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    if (repliesTbody) repliesTbody.innerHTML = '';
    lastBlueskyDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    const threadReplies = Array.isArray(result?.thread_replies) ? result.thread_replies : [];
    const categoryNames = getTrainingConfigNames('youtubeMinerCategoryConfigTable');
    const attributeNames = getTrainingConfigNames('youtubeMinerAttributeConfigTable');
    const approachNames = getTrainingConfigNames('youtubeMinerApproachConfigTable');
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.textContent = 'No BlueSky post candidates loaded yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (repliesTbody) {
        const replyTr = document.createElement('tr');
        const replyTd = document.createElement('td');
        replyTd.colSpan = 5;
        replyTd.textContent = 'No BlueSky thread replies loaded yet.';
        replyTr.appendChild(replyTd);
        repliesTbody.appendChild(replyTr);
      }
      renderBlueskyDiscoveryBulkActions();
      return;
    }

    const populateBlueskyTargets = (postUrl) => {
      const nextValue = String(postUrl || '').trim();
      const replyTarget = document.getElementById('blueskyReplyTarget');
      const postingTarget = document.getElementById('blueskyPostingTarget');
      if (replyTarget) replyTarget.value = nextValue;
      if (postingTarget) postingTarget.value = nextValue;
      return nextValue;
    };

    rows.forEach((item) => {
      const postUrl = String(item && item.post_url || '').trim();
      const feedback = readBlueskyDiscoveryFeedback(item);
      const tr = document.createElement('tr');
      if (blueskyDiscoveryHasReview(feedback)) tr.classList.add('youtube-miner-row-reviewed');

      const selectTd = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = postUrl ? blueskyDiscoverySelectedPostUrls.has(postUrl) : false;
      checkbox.disabled = !postUrl;
      checkbox.setAttribute('aria-label', 'Select BlueSky post ' + (postUrl || ''));
      checkbox.addEventListener('change', () => {
        if (!postUrl) return;
        if (checkbox.checked) blueskyDiscoverySelectedPostUrls.add(postUrl);
        else blueskyDiscoverySelectedPostUrls.delete(postUrl);
        renderBlueskyDiscoveryBulkActions();
      });
      selectTd.appendChild(checkbox);
      tr.appendChild(selectTd);

      const cols = [
        String(item.discovery_score != null ? item.discovery_score : item.reply_opportunity || '-'),
        String(item.author_handle || item.author_display_name || '-'),
        String(item.text || item.post_url || '-'),
        String(item.like_count != null ? item.like_count : '-'),
        String(item.reply_count != null ? item.reply_count : '-'),
        String(item.repost_count != null ? item.repost_count : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 0) td.className = 'bluesky-discovery-metric-cell bluesky-discovery-score-cell';
        if (idx === 3 || idx === 4 || idx === 5) td.className = 'bluesky-discovery-metric-cell';
        if (idx === 2 && item.post_url) {
          td.className = 'bluesky-discovery-post-cell';
          const previewWrap = document.createElement('div');
          previewWrap.className = 'bluesky-discovery-post-preview-wrap';
          const a = document.createElement('a');
          a.href = item.post_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          a.className = 'bluesky-discovery-post-link';
          a.addEventListener('mouseenter', () => showBlueskyDiscoveryPostOverlay(value || '-', a, () => {
            openBlueskyDiscoveryFeedbackPop(feedbackPop);
          }, blueskyDiscoveryHasReview(feedback)));
          a.addEventListener('focus', () => showBlueskyDiscoveryPostOverlay(value || '-', a, () => {
            openBlueskyDiscoveryFeedbackPop(feedbackPop);
          }, blueskyDiscoveryHasReview(feedback)));
          a.addEventListener('mouseleave', () => hideBlueskyDiscoveryPostOverlay(true));
          a.addEventListener('blur', () => hideBlueskyDiscoveryPostOverlay(true));
          previewWrap.appendChild(a);
          td.appendChild(previewWrap);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const qualityTd = document.createElement('td');
      const qualitySelect = document.createElement('select');
      qualitySelect.className = 'bluesky-discovery-quality-select';
      makeQualityOptions(feedback.quality).forEach((option) => qualitySelect.appendChild(option));
      qualitySelect.addEventListener('change', () => {
        const updated = saveBlueskyDiscoveryFeedback(item, { quality: String(qualitySelect.value || '').trim(), updated_at: new Date().toISOString() });
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyDiscoveryHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyDiscoveryHasReview(updated));
      });
      qualityTd.appendChild(qualitySelect);
      tr.appendChild(qualityTd);

      const whyTd = document.createElement('td');
      whyTd.textContent = String(item.why_relevant || '-');
      tr.appendChild(whyTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'bluesky-discovery-actions-cell';
      const copyBtn = App.makeIconButton('copy', 'Copy Post URL Into Forms', () => {
        const nextValue = populateBlueskyTargets(item.post_url);
        notify(nextValue ? 'Copied BlueSky post URL into reply and posting forms' : 'No BlueSky post URL available', !nextValue);
      }, { primary: true });
      const generateBtn = App.makeIconButton('run', 'Generate Reply Candidates', async () => {
        const nextValue = populateBlueskyTargets(item.post_url);
        if (!nextValue) {
          notify('No BlueSky post URL available', true);
          return;
        }
        try {
          generateBtn.disabled = true;
          await runBlueskyReplyCandidates(nextValue);
          const replySection = document.getElementById('blueskyReplyCandidatesTable');
          if (replySection) replySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          notify('Generated BlueSky reply candidates from selected post');
        } catch (err) {
          setBlueskyReplyStatus(err.message || 'Could not generate BlueSky reply candidates', true);
          notify(err.message, true);
        } finally {
          generateBtn.disabled = false;
        }
      }, { primary: true, marginLeft: '0.35rem' });
      const feedbackWrap = document.createElement('div');
      feedbackWrap.className = 'youtube-miner-feedback-wrap';
      feedbackWrap.style.display = 'inline-flex';
      feedbackWrap.style.marginLeft = '0.35rem';
      const feedbackBtn = App.makeIconButton('edit', 'Review Training Feedback', () => {
        if (feedbackPop.classList.contains('hidden')) openBlueskyDiscoveryFeedbackPop(feedbackPop);
        else feedbackPop.classList.add('hidden');
      }, { primary: true });
      feedbackBtn.classList.add('youtube-miner-feedback-icon');
      if (blueskyDiscoveryHasReview(feedback)) feedbackBtn.classList.add('has-feedback');
      const feedbackPop = document.createElement('div');
      feedbackPop.className = 'youtube-miner-feedback-pop bluesky-discovery-feedback-pop hidden';
      const title = document.createElement('h4');
      title.textContent = 'Training Feedback';
      feedbackPop.appendChild(title);
      const excerpt = document.createElement('div');
      excerpt.className = 'bluesky-training-feedback-comment';
      excerpt.textContent = String(item.text || item.post_url || '');
      feedbackPop.appendChild(excerpt);

      const popQualityRow = document.createElement('div');
      popQualityRow.className = 'form-row';
      const popQualityLabel = document.createElement('label');
      popQualityLabel.textContent = 'Quality (1-5)';
      const popQualitySelect = document.createElement('select');
      popQualitySelect.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
      popQualitySelect.value = String(Number(feedback.quality || 0));
      popQualityRow.appendChild(popQualityLabel);
      popQualityRow.appendChild(popQualitySelect);
      feedbackPop.appendChild(popQualityRow);

      const catRow = document.createElement('div');
      catRow.className = 'form-row youtube-miner-feedback-factor-row';
      const catLabel = document.createElement('label');
      catLabel.textContent = 'Category (multi-select)';
      const catInput = document.createElement('select');
      catInput.multiple = true;
      catInput.size = 5;
      categoryNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.categories.indexOf(name) !== -1;
        catInput.appendChild(option);
      });
      const catExplain = document.createElement('input');
      catExplain.type = 'text';
      catExplain.placeholder = 'Explain';
      catExplain.value = String(feedback.category_explain || '');
      catRow.appendChild(catLabel);
      catRow.appendChild(catInput);
      catRow.appendChild(catExplain);
      feedbackPop.appendChild(catRow);

      const attrRow = document.createElement('div');
      attrRow.className = 'form-row youtube-miner-feedback-factor-row';
      const attrLabel = document.createElement('label');
      attrLabel.textContent = 'Attributes (multi-select)';
      const attrInput = document.createElement('select');
      attrInput.multiple = true;
      attrInput.size = 5;
      attributeNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.attributes.indexOf(name) !== -1;
        attrInput.appendChild(option);
      });
      const attrExplain = document.createElement('input');
      attrExplain.type = 'text';
      attrExplain.placeholder = 'Explain';
      attrExplain.value = String(feedback.attributes_explain || '');
      attrRow.appendChild(attrLabel);
      attrRow.appendChild(attrInput);
      attrRow.appendChild(attrExplain);
      feedbackPop.appendChild(attrRow);

      const approachRow = document.createElement('div');
      approachRow.className = 'form-row youtube-miner-feedback-factor-row';
      const approachLabel = document.createElement('label');
      approachLabel.textContent = 'Approach (multi-select)';
      const approachInput = document.createElement('select');
      approachInput.multiple = true;
      approachInput.size = 5;
      approachNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.approaches.indexOf(name) !== -1;
        approachInput.appendChild(option);
      });
      const approachExplain = document.createElement('input');
      approachExplain.type = 'text';
      approachExplain.placeholder = 'Explain';
      approachExplain.value = String(feedback.approaches_explain || '');
      approachRow.appendChild(approachLabel);
      approachRow.appendChild(approachInput);
      approachRow.appendChild(approachExplain);
      feedbackPop.appendChild(approachRow);

      const noteRow = document.createElement('div');
      noteRow.className = 'form-row';
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'What do you like about this comment?';
      const noteInput = document.createElement('textarea');
      noteInput.rows = 8;
      noteInput.placeholder = 'Explain what makes this comment valuable, what signals matter, and what reply style would fit.';
      noteInput.value = String(feedback.note || '');
      noteRow.appendChild(noteLabel);
      noteRow.appendChild(noteInput);
      feedbackPop.appendChild(noteRow);

      const suggestedRow = document.createElement('div');
      suggestedRow.className = 'form-row';
      const suggestedLabel = document.createElement('label');
      suggestedLabel.textContent = 'Suggested Response';
      const suggestedInput = document.createElement('textarea');
      suggestedInput.rows = 4;
      suggestedInput.placeholder = 'Optional: write the exact style or sample response you would want here.';
      suggestedInput.value = String(feedback.suggested_response || '');
      suggestedRow.appendChild(suggestedLabel);
      suggestedRow.appendChild(suggestedInput);
      feedbackPop.appendChild(suggestedRow);

      const actionRow = document.createElement('div');
      actionRow.className = 'youtube-miner-feedback-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.textContent = 'Close';
      cancelBtn.addEventListener('click', () => feedbackPop.classList.add('hidden'));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save Feedback';
      saveBtn.addEventListener('click', () => {
        const selectedCategories = Array.from(catInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedAttributes = Array.from(attrInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedApproaches = Array.from(approachInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const updated = saveBlueskyDiscoveryFeedback(item, {
          quality: Number(popQualitySelect.value || 0),
          categories: selectedCategories,
          category_explain: String(catExplain.value || ''),
          attributes: selectedAttributes,
          attributes_explain: String(attrExplain.value || ''),
          approaches: selectedApproaches,
          approaches_explain: String(approachExplain.value || ''),
          note: String(noteInput.value || ''),
          suggested_response: String(suggestedInput.value || ''),
        });
        qualitySelect.value = String(updated.quality || '');
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyDiscoveryHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyDiscoveryHasReview(updated));
        feedbackPop.classList.add('hidden');
        notify('Saved BlueSky training feedback');
      });
      actionRow.appendChild(cancelBtn);
      actionRow.appendChild(saveBtn);
      feedbackPop.appendChild(actionRow);
      feedbackWrap.appendChild(feedbackBtn);
      actionsTd.appendChild(copyBtn);
      actionsTd.appendChild(generateBtn);
      actionsTd.appendChild(feedbackWrap);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
      if (!document.body.contains(feedbackPop)) {
        document.body.appendChild(feedbackPop);
      }
    });

    if (repliesTbody) {
      if (!threadReplies.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 5;
        td.textContent = 'No thread replies loaded for the current target.';
        tr.appendChild(td);
        repliesTbody.appendChild(tr);
      } else {
        threadReplies.forEach((item) => {
          const tr = document.createElement('tr');
          [
            String(item.author_handle || item.author_display_name || '-'),
            String(item.text || '-'),
            String(item.like_count != null ? item.like_count : '-'),
            String(item.reply_count != null ? item.reply_count : '-'),
            String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
          ].forEach((value) => {
            const td = document.createElement('td');
            td.textContent = value || '-';
            tr.appendChild(td);
          });
          repliesTbody.appendChild(tr);
        });
      }
    }
    renderBlueskyDiscoveryBulkActions();
  }

  function renderBlueskyReplyCandidates(result) {
    const tbody = document.getElementById('blueskyReplyCandidatesTable');
    const preview = document.getElementById('blueskyReplyCandidatesPreview');
    const promptSummary = document.getElementById('blueskyReplyPromptSummary');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    const sourcePost = result?.post || null;
    const sourceText = String(sourcePost && sourcePost.text || '').trim();
    const trainingContext = String(result?.training_context || '').trim();
    const trainingGuidelines = String(result?.training_guidelines || '').trim();
    if (promptSummary) {
      const contextLoaded = Boolean(trainingContext);
      const guidelinesLoaded = Boolean(trainingGuidelines);
      const contextExcerpt = contextLoaded ? trainingContext.slice(0, 260) : 'No shared training context loaded.';
      const guidelinesExcerpt = guidelinesLoaded ? trainingGuidelines.slice(0, 220) : 'No shared guidelines loaded.';
      promptSummary.innerHTML =
        `<strong>Training Context:</strong> ${contextLoaded ? 'Loaded' : 'Missing'}<br>` +
        `<span>${contextExcerpt}</span><br><br>` +
        `<strong>Guidelines:</strong> ${guidelinesLoaded ? 'Loaded' : 'Missing'}<br>` +
        `<span>${guidelinesExcerpt}</span>`;
      promptSummary.classList.toggle('is-missing', !contextLoaded && !guidelinesLoaded);
    }
    const categoryNames = getTrainingConfigNames('youtubeMinerCategoryConfigTable');
    const attributeNames = getTrainingConfigNames('youtubeMinerAttributeConfigTable');
    const approachNames = getTrainingConfigNames('youtubeMinerApproachConfigTable');
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No BlueSky reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      if (promptSummary && !result) {
        promptSummary.textContent = 'BlueSky reply prompt diagnostics will appear here after generation.';
        promptSummary.classList.remove('is-missing');
      }
      return;
    }
    if (sourceText) {
      const sourceTr = document.createElement('tr');
      sourceTr.className = 'bluesky-reply-source-row';
      const sourceTd = document.createElement('td');
      sourceTd.colSpan = 5;
      const sourceWrap = document.createElement('div');
      sourceWrap.className = 'bluesky-reply-source-card';
      const sourceLabel = document.createElement('div');
      sourceLabel.className = 'bluesky-reply-source-label';
      sourceLabel.textContent = 'Replying To';
      const sourceBody = document.createElement('div');
      sourceBody.className = 'bluesky-reply-source-text';
      sourceBody.textContent = sourceText;
      sourceWrap.appendChild(sourceLabel);
      sourceWrap.appendChild(sourceBody);
      sourceTd.appendChild(sourceWrap);
      sourceTr.appendChild(sourceTd);
      tbody.appendChild(sourceTr);
    }
    rows.forEach((item) => {
      const feedback = readBlueskyReplyFeedback(result, item);
      const tr = document.createElement('tr');
      if (blueskyReplyHasReview(feedback)) tr.classList.add('youtube-miner-row-reviewed');

      const replyTd = document.createElement('td');
      replyTd.textContent = String(item && item.text || '-');
      tr.appendChild(replyTd);

      const toneTd = document.createElement('td');
      toneTd.textContent = String(item && item.tone || '-');
      tr.appendChild(toneTd);

      const whyTd = document.createElement('td');
      whyTd.textContent = String(item && item.why || '-');
      tr.appendChild(whyTd);

      const qualityTd = document.createElement('td');
      const qualitySelect = document.createElement('select');
      qualitySelect.className = 'bluesky-discovery-quality-select';
      makeQualityOptions(feedback.quality).forEach((option) => qualitySelect.appendChild(option));
      qualitySelect.addEventListener('change', () => {
        const updated = saveBlueskyReplyFeedback(result, item, { quality: Number(qualitySelect.value || 0) });
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyReplyHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyReplyHasReview(updated));
      });
      qualityTd.appendChild(qualitySelect);
      tr.appendChild(qualityTd);

      const actionsTd = document.createElement('td');
      actionsTd.className = 'bluesky-discovery-actions-cell';
      const feedbackWrap = document.createElement('div');
      feedbackWrap.className = 'youtube-miner-feedback-wrap';
      feedbackWrap.style.display = 'inline-flex';
      const feedbackBtn = App.makeIconButton('edit', 'Review Reply Feedback', () => {
        document.querySelectorAll('.bluesky-reply-feedback-pop').forEach((node) => {
          if (node !== feedbackPop) node.classList.add('hidden');
        });
        feedbackPop.classList.toggle('hidden');
      }, { primary: true });
      feedbackBtn.classList.add('youtube-miner-feedback-icon');
      if (blueskyReplyHasReview(feedback)) feedbackBtn.classList.add('has-feedback');

      const feedbackPop = document.createElement('div');
      feedbackPop.className = 'youtube-miner-feedback-pop bluesky-reply-feedback-pop hidden';
      const heading = document.createElement('h4');
      heading.textContent = 'Reply Feedback';
      feedbackPop.appendChild(heading);

      const qualityRow = document.createElement('div');
      qualityRow.className = 'form-row';
      const qualityLabel = document.createElement('label');
      qualityLabel.textContent = 'Quality (1-5)';
      const popQuality = document.createElement('select');
      popQuality.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
      popQuality.value = String(feedback.quality || 0);
      qualityRow.appendChild(qualityLabel);
      qualityRow.appendChild(popQuality);
      feedbackPop.appendChild(qualityRow);

      const catRow = document.createElement('div');
      catRow.className = 'form-row youtube-miner-feedback-factor-row';
      const catLabel = document.createElement('label');
      catLabel.textContent = 'Category (multi-select)';
      const catInput = document.createElement('select');
      catInput.multiple = true;
      catInput.size = 5;
      categoryNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.categories.indexOf(name) !== -1;
        catInput.appendChild(option);
      });
      const catExplain = document.createElement('input');
      catExplain.type = 'text';
      catExplain.placeholder = 'Explain';
      catExplain.value = String(feedback.category_explain || '');
      catRow.appendChild(catLabel);
      catRow.appendChild(catInput);
      catRow.appendChild(catExplain);
      feedbackPop.appendChild(catRow);

      const attrRow = document.createElement('div');
      attrRow.className = 'form-row youtube-miner-feedback-factor-row';
      const attrLabel = document.createElement('label');
      attrLabel.textContent = 'Attributes (multi-select)';
      const attrInput = document.createElement('select');
      attrInput.multiple = true;
      attrInput.size = 5;
      attributeNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.attributes.indexOf(name) !== -1;
        attrInput.appendChild(option);
      });
      const attrExplain = document.createElement('input');
      attrExplain.type = 'text';
      attrExplain.placeholder = 'Explain';
      attrExplain.value = String(feedback.attributes_explain || '');
      attrRow.appendChild(attrLabel);
      attrRow.appendChild(attrInput);
      attrRow.appendChild(attrExplain);
      feedbackPop.appendChild(attrRow);

      const approachRow = document.createElement('div');
      approachRow.className = 'form-row youtube-miner-feedback-factor-row';
      const approachLabel = document.createElement('label');
      approachLabel.textContent = 'Approach (multi-select)';
      const approachInput = document.createElement('select');
      approachInput.multiple = true;
      approachInput.size = 5;
      approachNames.forEach((name) => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.approaches.indexOf(name) !== -1;
        approachInput.appendChild(option);
      });
      const approachExplain = document.createElement('input');
      approachExplain.type = 'text';
      approachExplain.placeholder = 'Explain';
      approachExplain.value = String(feedback.approaches_explain || '');
      approachRow.appendChild(approachLabel);
      approachRow.appendChild(approachInput);
      approachRow.appendChild(approachExplain);
      feedbackPop.appendChild(approachRow);

      const noteRow = document.createElement('div');
      noteRow.className = 'form-row';
      const noteLabel = document.createElement('label');
      noteLabel.textContent = 'What do you like about this comment?';
      const noteInput = document.createElement('textarea');
      noteInput.rows = 8;
      noteInput.placeholder = 'Explain what makes this reply valuable, what signals matter, and what style should be reinforced.';
      noteInput.value = String(feedback.note || '');
      noteRow.appendChild(noteLabel);
      noteRow.appendChild(noteInput);
      feedbackPop.appendChild(noteRow);

      const suggestedRow = document.createElement('div');
      suggestedRow.className = 'form-row';
      const suggestedLabel = document.createElement('label');
      suggestedLabel.textContent = 'Suggested Response';
      const suggestedInput = document.createElement('textarea');
      suggestedInput.rows = 4;
      suggestedInput.placeholder = 'Optional: refine the ideal version of this reply.';
      suggestedInput.value = String(feedback.suggested_response || '');
      suggestedRow.appendChild(suggestedLabel);
      suggestedRow.appendChild(suggestedInput);
      feedbackPop.appendChild(suggestedRow);

      const actionRow = document.createElement('div');
      actionRow.className = 'youtube-miner-feedback-actions';
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => feedbackPop.classList.add('hidden'));
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save Feedback';
      saveBtn.addEventListener('click', () => {
        const selectedCategories = Array.from(catInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedAttributes = Array.from(attrInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const selectedApproaches = Array.from(approachInput.options || []).filter((option) => option.selected).map((option) => String(option.value || '').trim()).filter(Boolean);
        const updated = saveBlueskyReplyFeedback(result, item, {
          quality: Number(popQuality.value || 0),
          categories: selectedCategories,
          category_explain: String(catExplain.value || ''),
          attributes: selectedAttributes,
          attributes_explain: String(attrExplain.value || ''),
          approaches: selectedApproaches,
          approaches_explain: String(approachExplain.value || ''),
          note: String(noteInput.value || ''),
          suggested_response: String(suggestedInput.value || ''),
        });
        qualitySelect.value = String(updated.quality || '');
        tr.classList.toggle('youtube-miner-row-reviewed', blueskyReplyHasReview(updated));
        feedbackBtn.classList.toggle('has-feedback', blueskyReplyHasReview(updated));
        feedbackPop.classList.add('hidden');
        notify('BlueSky reply feedback saved');
      });
      actionRow.appendChild(closeBtn);
      actionRow.appendChild(saveBtn);
      feedbackPop.appendChild(actionRow);

      feedbackWrap.appendChild(feedbackBtn);
      feedbackWrap.appendChild(feedbackPop);
      actionsTd.appendChild(feedbackWrap);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderRedditDiscoveryTable(result) {
    const tbody = document.getElementById('redditDiscoveryTable');
    const preview = document.getElementById('redditDiscoveryPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';

    lastRedditDiscoveryResult = result || null;
    const rows = Array.isArray(result?.candidates) ? result.candidates : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 9;
      td.textContent = 'No Reddit thread candidates found for the current filters.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach((item) => {
      const tr = document.createElement('tr');
      const cols = [
        String(item.discovery_score != null ? item.discovery_score : '-'),
        String(item.subreddit || '-'),
        String(item.title || item.discussion_url || '-'),
        String(item.author || '-'),
        String(item.score != null ? item.score : '-'),
        String(item.num_comments != null ? item.num_comments : '-'),
        String(item.created_at ? new Date(item.created_at).toLocaleString() : '-'),
        Array.isArray(item.reasons) ? item.reasons.join(', ') : '-',
      ];
      cols.forEach((value, idx) => {
        const td = document.createElement('td');
        if (idx === 2 && item.discussion_url) {
          const a = document.createElement('a');
          a.href = item.discussion_url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = value || '-';
          td.appendChild(a);
        } else {
          td.textContent = value || '-';
        }
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const harvestBtn = App.makeIconButton('copy', 'Use In Harvest', () => {
        const harvestTarget = document.getElementById('redditHarvestTarget');
        const discoveryTarget = document.getElementById('redditDiscoveryTarget');
        const replyTarget = document.getElementById('redditReplyTarget');
        const nextValue = String(item.discussion_url || '').trim() || String(item.subreddit ? `https://www.reddit.com/r/${item.subreddit}` : '').trim();
        if (harvestTarget) harvestTarget.value = nextValue;
        if (discoveryTarget && !discoveryTarget.value) discoveryTarget.value = nextValue;
        if (replyTarget) replyTarget.value = nextValue;
        notify('Copied Reddit thread target into harvest form');
      }, { primary: true });
      const replyBtn = App.makeIconButton('messages', 'Generate Replies', async () => {
        const replyTarget = document.getElementById('redditReplyTarget');
        if (replyTarget) replyTarget.value = String(item.discussion_url || '').trim();
        try {
          await runRedditReplyCandidates(String(item.discussion_url || '').trim());
          notify('Reddit reply candidates generated');
        } catch (err) {
          setRedditReplyStatus(err.message || 'Could not generate Reddit replies', true);
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      actionsTd.appendChild(harvestBtn);
      actionsTd.appendChild(replyBtn);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function renderRedditReplyCandidates(result) {
    const tbody = document.getElementById('redditReplyCandidatesTable');
    const preview = document.getElementById('redditReplyCandidatesPreview');
    if (preview) preview.textContent = prettyJson(result || {});
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = Array.isArray(result?.replies) ? result.replies : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No Reddit reply candidates generated yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    rows.forEach((item) => {
      const tr = document.createElement('tr');
      [
        String(item && item.text || '-'),
        String(item && item.tone || '-'),
        String(item && item.why || '-'),
      ].forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  function renderXHarvestRunsTable() {
    if (!els.xHarvestRunsTable) return;
    els.xHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.xHarvestRuns) ? state.xHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No X harvest runs yet.';
      tr.appendChild(td);
      els.xHarvestRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.query || '').trim() || (Array.isArray(run.hashtags) ? run.hashtags.map((tag) => `#${tag}`).join(' ') : '-'),
        String(run.total_tweets != null ? run.total_tweets : '-'),
        String(run.total_replies != null ? run.total_replies : '-'),
        String(run.errors != null ? run.errors : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });
      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadXHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete X run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/x-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.xHarvestRuns = state.xHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.xHarvestCurrentRun && state.xHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.xHarvestCurrentRun = null;
            renderXHarvestItemsTable();
          }
          renderXHarvestRunsTable();
          notify('X harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.xHarvestRunsTable.appendChild(tr);
    });
  }

  function renderRedditHarvestRunsTable() {
    if (!els.redditHarvestRunsTable) return;
    els.redditHarvestRunsTable.innerHTML = '';
    const runs = Array.isArray(state.redditHarvestRuns) ? state.redditHarvestRuns : [];
    if (!runs.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'No Reddit harvest runs yet.';
      tr.appendChild(td);
      els.redditHarvestRunsTable.appendChild(tr);
      return;
    }

    runs.forEach((run) => {
      const tr = document.createElement('tr');
      const cols = [
        String(run.run_id || ''),
        String(run.created_at || ''),
        String(run.mode || ''),
        String(run.subreddit || run.target || ''),
        String(run.total_posts != null ? run.total_posts : '-'),
        String(run.total_comments != null ? run.total_comments : '-'),
      ];
      cols.forEach((value) => {
        const td = document.createElement('td');
        td.textContent = value || '-';
        tr.appendChild(td);
      });

      const actionsTd = document.createElement('td');
      const viewBtn = App.makeIconButton('view', 'Load', () => {
        loadRedditHarvestRun(run.run_id).catch((err) => notify(err.message, true));
      }, { marginRight: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete', async () => {
        if (!confirm(`Delete Reddit run ${run.run_id}?`)) return;
        try {
          await api(`/api/acquire/reddit-runs/${encodeURIComponent(run.run_id)}`, { method: 'DELETE' });
          state.redditHarvestRuns = state.redditHarvestRuns.filter((item) => String(item.run_id) !== String(run.run_id));
          if (String(state.redditHarvestCurrentRun && state.redditHarvestCurrentRun.run_id || '') === String(run.run_id)) {
            state.redditHarvestCurrentRun = null;
            renderRedditHarvestItemsTable();
          }
          renderRedditHarvestRunsTable();
          notify('Reddit harvest run deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true });
      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(deleteBtn);
      tr.appendChild(actionsTd);
      els.redditHarvestRunsTable.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  async function refreshHarvestJobs() {
    if (!els.acquireJobsTable) return;
    const res = await api('/api/acquire/jobs?limit=200');
    const fetched = Array.isArray(res.jobs) ? res.jobs : [];
    const byId = new Map();
    state.acquireJobs.forEach((j) => { if (j?.id) byId.set(String(j.id), j); });
    fetched.forEach((j) => {
      if (!j?.id) return;
      byId.set(String(j.id), { ...(byId.get(String(j.id)) || {}), ...j });
    });
    state.acquireJobs = Array.from(byId.values())
      .sort((a, b) => String(b.updated_at||'').localeCompare(String(a.updated_at||'')))
      .slice(0, 200);
    renderHarvestJobsTable();
  }

  async function refreshDirectHarvestRuns() {
    if (!els.directAcquireRunsTable) return;
    const res = await api('/api/acquire/direct-runs?limit=20');
    state.directAcquireRuns = Array.isArray(res.runs) ? res.runs : [];
    renderDirectHarvestRunsTable();
  }

  async function refreshXHarvestRuns() {
    if (!els.xHarvestRunsTable) return;
    const res = await api('/api/acquire/x-runs?limit=50');
    state.xHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderXHarvestRunsTable();
  }

  async function refreshRedditHarvestRuns() {
    if (!els.redditHarvestRunsTable) return;
    const res = await api('/api/acquire/reddit-runs?limit=50');
    state.redditHarvestRuns = Array.isArray(res.runs) ? res.runs : [];
    renderRedditHarvestRunsTable();
  }

  async function runRedditDiscovery() {
    const form = document.getElementById('redditDiscoveryForm');
    if (!form) return;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_score: Number(formData.get('min_score') || 0) || 0,
      min_comments: Number(formData.get('min_comments') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Subreddit or post URL is required.');
    setRedditDiscoveryStatus('Discovering Reddit threads...');
    const res = await api('/api/engage/reddit/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setRedditDiscoveryStatus(`Loaded ${count} Reddit thread candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runRedditReplyCandidates(explicitTarget) {
    const form = document.getElementById('redditReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      comment_limit: Number(formData.get('comment_limit') || 8) || 8,
    };
    if (!payload.target) throw new Error('Reddit thread URL is required.');
    setRedditReplyStatus('Generating Reddit reply candidates...');
    const res = await api('/api/engage/reddit/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderRedditReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setRedditReplyStatus(`Generated ${count} Reddit reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyDiscovery() {
    const form = document.getElementById('blueskyDiscoveryForm');
    if (!form) return null;
    const formData = new FormData(form);
    const payload = {
      target: String(formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      sort: String(formData.get('sort') || 'new').trim().toLowerCase(),
      max_posts: Number(formData.get('max_posts') || 20) || 20,
      keyword: String(formData.get('keyword') || '').trim(),
      min_likes: Number(formData.get('min_likes') || 0) || 0,
      min_replies: Number(formData.get('min_replies') || 0) || 0,
      start_time: String(formData.get('start_time') || '').trim(),
      end_time: String(formData.get('end_time') || '').trim(),
    };
    if (!payload.target) throw new Error('Handle, feed, or BlueSky post URL is required.');
    setBlueskyDiscoveryStatus('Discovering BlueSky posts...');
    const res = await api('/api/engage/bluesky/discovery', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyDiscoveryTable(res);
    const count = Array.isArray(res.candidates) ? res.candidates.length : 0;
    setBlueskyDiscoveryStatus(`Loaded ${count} BlueSky post candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function runBlueskyReplyCandidates(explicitTarget) {
    const form = document.getElementById('blueskyReplyCandidatesForm');
    if (!form) return null;
    const formData = new FormData(form);
    const trainingPayload = await getSharedTrainingPromptPayload();
    const payload = {
      target: String(explicitTarget || formData.get('target') || '').trim(),
      source_mode: String(formData.get('source_mode') || 'auto').trim().toLowerCase(),
      context_limit: Number(formData.get('context_limit') || 8) || 8,
      training_context: String(trainingPayload.training_context || '').trim(),
      training_guidelines: String(trainingPayload.training_guidelines || '').trim(),
    };
    if (!payload.target) throw new Error('BlueSky post URL is required.');
    setBlueskyReplyStatus('Generating BlueSky reply candidates...');
    const res = await api('/api/engage/bluesky/reply-candidates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    renderBlueskyReplyCandidates(res);
    const count = Array.isArray(res.replies) ? res.replies.length : 0;
    setBlueskyReplyStatus(`Generated ${count} BlueSky reply candidate${count === 1 ? '' : 's'}.`);
    return res;
  }

  async function loadDirectHarvestRun(runId) {
    const res = await api(`/api/acquire/direct-runs/${encodeURIComponent(runId)}`);
    state.directAcquireCurrentRun = res.run || null;
    directAcquireSelectedImages = new Set();
    directAcquireImageCategoryByUrl = new Map();
    directAcquireImagesExpanded = false;
    directAcquireSelectedHashtags = new Set();
    renderDirectHarvestPagesTable();
  }

  async function loadXHarvestRun(runId) {
    const res = await api(`/api/acquire/x-runs/${encodeURIComponent(runId)}`);
    state.xHarvestCurrentRun = res.run || null;
    renderXHarvestItemsTable();
  }

  async function loadRedditHarvestRun(runId) {
    const res = await api(`/api/acquire/reddit-runs/${encodeURIComponent(runId)}`);
    state.redditHarvestCurrentRun = res.run || null;
    renderRedditHarvestItemsTable();
  }

  // -------------------------------------------------------------------------
  // OpenClaw actions
  // -------------------------------------------------------------------------

  async function runHarvestRowAction(action, job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();
      const request = {
        manual_confirmed: true,
        job_id: jobId,
        role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
            : action === 'preview_job' ? 'marketer' : 'operator'
      };
      if (action === 'approve_job') request.decision = 'APPROVE';
      if (action === 'execute_job') {
        let token = String(els.acquireApprovalTokenInput?.value || '').trim();
        if (!token) token = String(prompt('Enter approval token for execute_job') || '').trim();
        if (!token) throw new Error('approval_token is required for execute_job');
        request.approval_token = token;
        if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = token;
      }
      const response = await api(`/api/openclaw/${action}`, { method: 'POST', body: JSON.stringify(request) });
      setPreview(els.acquireRequestPreview, { action, request });
      setPreview(els.acquireResponsePreview, response);
      const derived = deriveHarvestJobFromResponse({ action, request }, response);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      const approvalToken = response?.result?.approval?.approval_token;
      if (approvalToken && els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;
      notify(`Acquire ${action} request sent`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  async function runHarvestRowSequence(job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) { notify('job_id is required', true); return; }
    try {
      state.acquireBusyByJob[jobId] = true;
      renderHarvestJobsTable();

      const previewReq = { manual_confirmed: true, job_id: jobId, role: 'marketer' };
      const previewRes = await api('/api/openclaw/preview_job', { method: 'POST', body: JSON.stringify(previewReq) });
      setPreview(els.acquireRequestPreview, { action: 'preview_job', request: previewReq });
      setPreview(els.acquireResponsePreview, previewRes);

      const approveReq = { manual_confirmed: true, job_id: jobId, decision: 'APPROVE', role: 'approver' };
      const approveRes = await api('/api/openclaw/approve_job', { method: 'POST', body: JSON.stringify(approveReq) });
      setPreview(els.acquireRequestPreview, { action: 'approve_job', request: approveReq });
      setPreview(els.acquireResponsePreview, approveRes);

      const approvalToken = String(approveRes?.result?.approval?.approval_token || '').trim();
      if (!approvalToken) throw new Error('No approval token returned from approve_job');
      if (els.acquireApprovalTokenInput) els.acquireApprovalTokenInput.value = approvalToken;

      const executeReq = { manual_confirmed: true, job_id: jobId, approval_token: approvalToken, role: 'approver' };
      const executeRes = await api('/api/openclaw/execute_job', { method: 'POST', body: JSON.stringify(executeReq) });
      setPreview(els.acquireRequestPreview, { action: 'execute_job', request: executeReq });
      setPreview(els.acquireResponsePreview, executeRes);

      const derived = deriveHarvestJobFromResponse({ action: 'execute_job', request: executeReq }, executeRes);
      if (derived) upsertHarvestJobState(derived);
      renderHarvestJobsTable();
      await refreshHarvestJobs();
      notify(`Acquire run completed for ${jobId}`);
    } catch (err) {
      notify(err.message, true);
    } finally {
      delete state.acquireBusyByJob[jobId];
      renderHarvestJobsTable();
    }
  }

  // -------------------------------------------------------------------------
  // Request builders
  // -------------------------------------------------------------------------

  function parseSourceUrls(raw) {
    return String(raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  }

  function buildHarvestRequest(formData) {
    const action = String(formData.get('action') || 'create_job');
    if (formData.get('manual_confirmed') !== 'on') throw new Error('Manual confirmation is required');
    const jobId = String(formData.get('job_id') || '').trim();
    const request = {
      manual_confirmed: true,
      role: (action === 'approve_job' || action === 'execute_job') ? 'approver'
          : action === 'preview_job' ? 'marketer' : 'operator'
    };
    if (action === 'create_job') {
      request.type = String(formData.get('type') || '').trim() || 'acquire.web';
      request.workspace_id = String(formData.get('workspace_id') || '').trim() || 'alphire-main';
      request.requested_by = {
        user_id: String(formData.get('requested_by_user_id') || '').trim() || 'alphire-ui',
        email: String(formData.get('requested_by_email') || '').trim() || 'ops@alphire.ai'
      };
      request.payload = {
        source_urls: parseSourceUrls(formData.get('source_urls')),
        max_pages: Number(formData.get('max_pages') || 5),
        body_snippet_chars: Number(formData.get('body_snippet_chars') || 500)
      };
      request.policy = { requires_manual_approval: true, approval_ttl_minutes: 30 };
      return { action, request };
    }
    if (!jobId) throw new Error('job_id is required for this action');
    request.job_id = jobId;
    if (action === 'preview_job') return { action, request };
    if (action === 'approve_job') {
      request.decision = String(formData.get('approval_decision') || 'APPROVE').trim() || 'APPROVE';
      return { action, request };
    }
    if (action === 'execute_job') {
      const token = String(formData.get('approval_token') || '').trim();
      if (!token) throw new Error('approval_token is required for execute_job');
      request.approval_token = token;
      return { action, request };
    }
    if (action === 'job_status') return { action, request };
    throw new Error('Unsupported action');
  }

  // -------------------------------------------------------------------------
  // Event binding
  // -------------------------------------------------------------------------

  function init() {
    setDirectAcquireResultsVisible(false);
    
    // Begin: Theme Builder DOM Projection Pattern
    if (App.develop && typeof App.develop.buildModularPageTemplatePreviewMarkup === 'function') {
      const STORAGE_KEY = 'alphire:acquire-hub:layout';
      let payload;
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) payload = JSON.parse(saved);
      } catch (err) {}
      if (!payload || !payload.layoutSections) {
        payload = {
          layoutSections: [
            { layout: '12', title: 'Acquire Hub', collapsed: false, modules: [{ type: 'system-app', systemId: 'acquire-hub-panel', column: 'col1' }] }
          ]
        };
      }
      
      const targetWrap = document.getElementById('acquirePage');
      if (targetWrap && !targetWrap.dataset.builderHydrated) {
        const heading = targetWrap.querySelector('.page-heading-row');
        const hubBody = targetWrap.querySelector('#acquireHubBody');
        
        targetWrap.innerHTML = App.develop.buildModularPageTemplatePreviewMarkup(payload);
        
        if (heading) {
          const actionRow = heading.querySelector('.page-heading-actions');
          if (actionRow) {
            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'tiny-btn';
            editBtn.innerHTML = '<i data-lucide="layout-template"></i> Edit Hub UI';
            editBtn.addEventListener('click', () => {
              App.develop.openModularPageTemplateEditor(payload, {
                mode: 'template',
                onSave: (newPayload) => {
                  try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(newPayload));
                    App.notify('Acquire Hub layout saved locally. Refreshed required.', false);
                    setTimeout(() => window.location.reload(), 800);
                  } catch (e) {
                    App.notify('Could not save local config', true);
                  }
                }
              });
            });
            actionRow.appendChild(editBtn);
            if (window.lucide) window.lucide.createIcons({ root: editBtn });
          }
          targetWrap.insertBefore(heading, targetWrap.firstChild);
        }
        
        const mHub = targetWrap.querySelector('#mount-acquire-hub-panel');
        if (mHub && hubBody) mHub.appendChild(hubBody);
        
        targetWrap.dataset.builderHydrated = 'true';
      }
    }
    // End Theme Builder Integration

    const acquirePageActions = document.getElementById('acquirePageActions');
    if (acquirePageActions && !acquirePageActions.dataset.bound) {
      acquirePageActions.dataset.bound = 'true';
      acquirePageActions.innerHTML = '';
      const settingsBtn = App.makeIconButton('settings', 'Acquire Settings', function () {
        App.setActivePage('acquireSettingsPage');
      });
      settingsBtn.classList.add('section-settings-gear-btn');
      acquirePageActions.appendChild(settingsBtn);
    }
    const acquireSettingsBackBtn = document.getElementById('acquireSettingsBackBtn');
    if (acquireSettingsBackBtn && !acquireSettingsBackBtn.dataset.bound) {
      acquireSettingsBackBtn.dataset.bound = 'true';
      acquireSettingsBackBtn.addEventListener('click', function () {
        App.setActivePage('acquirePage');
      });
    }
    const acquireYoutubeBanReasonForm = document.getElementById('acquireYoutubeBanReasonForm');
    if (acquireYoutubeBanReasonForm && !acquireYoutubeBanReasonForm.dataset.bound) {
      acquireYoutubeBanReasonForm.dataset.bound = 'true';
      acquireYoutubeBanReasonForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const input = document.getElementById('acquireYoutubeBanReasonInput');
        const value = normalizeAcquireSettingLabel(input && input.value);
        if (!value) {
          notify('Enter a ban reason first.', true);
          return;
        }
        const current = getAcquireYoutubeBanReasons();
        if (current.some((item) => item.toLowerCase() === value.toLowerCase())) {
          notify('That ban reason already exists.', true);
          return;
        }
        writeAcquireSettings({ youtubeBanReasons: current.concat(value) });
        if (input) input.value = '';
        renderAcquireSettingsPage();
        notify('Ban reason added');
      });
    }
    const acquireWebsiteDefaultsForm = document.getElementById('acquireWebsiteDefaultsForm');
    if (acquireWebsiteDefaultsForm && !acquireWebsiteDefaultsForm.dataset.bound) {
      acquireWebsiteDefaultsForm.dataset.bound = 'true';
      acquireWebsiteDefaultsForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const nextDefaults = {
          acquireSocial: Boolean(document.getElementById('acquireSettingsAcquireSocial')?.checked),
          acquireKeywords: Boolean(document.getElementById('acquireSettingsAcquireKeywords')?.checked),
          acquireHashtags: Boolean(document.getElementById('acquireSettingsAcquireHashtags')?.checked),
          acquireImages: Boolean(document.getElementById('acquireSettingsAcquireImages')?.checked),
          acquirePages: Boolean(document.getElementById('acquireSettingsAcquirePages')?.checked),
          acquirePeerSites: Boolean(document.getElementById('acquireSettingsAcquirePeerSites')?.checked),
          maxPages: Number(document.getElementById('acquireSettingsMaxPages')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.maxPages,
          peerSitesLimit: Number(document.getElementById('acquireSettingsPeerSitesLimit')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.peerSitesLimit,
          imagesLimit: Number(document.getElementById('acquireSettingsImagesLimit')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.imagesLimit,
          snippetLength: Number(document.getElementById('acquireSettingsSnippetLength')?.value || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength) || DEFAULT_ACQUIRE_WEBSITE_DEFAULTS.snippetLength,
        };
        writeAcquireSettings({ websiteDefaults: nextDefaults });
        renderAcquireSettingsPage();
        applyAcquireWebsiteDefaultsToForm();
        notify('Website defaults saved');
      });
    }
    renderAcquireSettingsPage();
    applyAcquireWebsiteDefaultsToForm();
    renderDirectAcquireContactTable();
    renderDirectAcquireKeywordTable();
    renderDirectAcquireHashtagTable();
    renderDirectAcquirePeerSitesTable();
    renderDirectAcquireImageGallery();
    renderDirectAcquireWebsitePeersTable();
    resetDirectAcquireWebsitePeerForm();
    refreshDirectAcquireTopics().then(() => renderDirectAcquireKeywordTopicOptions()).catch(() => {});
    refreshDirectAcquireImageCategories().then(() => renderDirectAcquireImageGallery()).catch(() => {});
    refreshDirectAcquireWebsitePeers().catch(() => {});
    const directAcquireKeywordExclusionsInput = document.getElementById('directAcquireKeywordExclusionsInput');
    if (directAcquireKeywordExclusionsInput) {
      try {
        directAcquireKeywordExclusionsInput.value = String(window.localStorage.getItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY) || '').trim();
      } catch (_) {
        // ignore local storage failures
      }
      directAcquireKeywordExclusionsInput.addEventListener('change', function () {
        try {
          window.localStorage.setItem(DIRECT_ACQUIRE_KEYWORD_EXCLUSIONS_KEY, String(directAcquireKeywordExclusionsInput.value || '').trim());
        } catch (_) {
          // ignore local storage failures
        }
        renderDirectAcquireKeywordTable();
      });
    }
    const directAcquireKeywordSelectAll = document.getElementById('directAcquireKeywordSelectAll');
    if (directAcquireKeywordSelectAll) {
      directAcquireKeywordSelectAll.addEventListener('change', function () {
        document.querySelectorAll('#directAcquireKeywordTable input[type="checkbox"][data-keyword]').forEach((checkbox) => {
          checkbox.checked = directAcquireKeywordSelectAll.checked;
          if (directAcquireKeywordSelectAll.checked) {
            const row = checkbox.closest('tr');
            const reasonSelect = row ? row.querySelector('select[data-keyword-reason]') : null;
            if (reasonSelect && !String(reasonSelect.value || '').trim()) reasonSelect.value = 'brand';
          }
        });
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
      });
    }
    const directAcquireKeywordBulkTopics = document.getElementById('directAcquireKeywordTopicsDropdown');
    const directAcquireKeywordBulkReason = document.getElementById('directAcquireKeywordBulkReason');
    if (directAcquireKeywordBulkTopics) {
      directAcquireKeywordBulkTopics.addEventListener('change', async function (event) {
        const changedInput = event.target;
        if (!changedInput || changedInput.type !== 'checkbox' || !changedInput.dataset.topic) return;
        const selected = Array.from(document.querySelectorAll('#directAcquireKeywordTable input[type="checkbox"][data-keyword]:checked'));
        if (!selected.length) {
          notify('Check at least one keyword first', true);
          changedInput.checked = !changedInput.checked;
          return;
        }
        const chosenTopics = Array.from(directAcquireKeywordBulkTopics.querySelectorAll('input[type="checkbox"][data-topic]:checked'))
          .map((input) => String(input.value || '').trim())
          .filter(Boolean);
        const topicMap = readDirectAcquireKeywordTopics();
        selected.forEach((checkbox) => {
          const keyword = normalizeDirectAcquireKeyword(checkbox.dataset.keyword || '');
          if (!keyword) return;
          topicMap[keyword] = chosenTopics;
        });
        writeDirectAcquireKeywordTopics(topicMap);
        const selectedLabels = selected
          .map((checkbox) => String(checkbox.dataset.keyword || '').trim())
          .filter(Boolean);
        let createdCount = 0;
        if (chosenTopics.length) {
          try {
            createdCount = await saveSelectedKeywordsAsContent(selectedLabels, chosenTopics);
          } catch (err) {
            notify(err.message || 'Could not save selected keywords as content', true);
          }
        }
        renderDirectAcquireKeywordTopicOptions();
        renderDirectAcquireKeywordTable();
        const noun = selected.length === 1 ? 'keyword' : 'keywords';
        const createdText = createdCount ? ` and added ${createdCount} keyword content record${createdCount === 1 ? '' : 's'}` : '';
        notify(`Updated topics for ${selected.length} ${noun}${createdText}`);
        directAcquireKeywordBulkTopics.removeAttribute('open');
      });
    }
    if (directAcquireKeywordBulkReason) {
      directAcquireKeywordBulkReason.addEventListener('change', function () {
        const reason = String(directAcquireKeywordBulkReason.value || '').trim();
        if (!reason) return;
        const selected = Array.from(document.querySelectorAll('#directAcquireKeywordTable input[type="checkbox"][data-keyword]:checked'));
        if (!selected.length) {
          notify('Check at least one keyword first', true);
          directAcquireKeywordBulkReason.value = '';
          return;
        }
        selected.forEach((checkbox) => {
          const row = checkbox.closest('tr');
          const reasonSelect = row ? row.querySelector('select[data-keyword-reason]') : null;
          if (reasonSelect) reasonSelect.value = reason;
        });
        syncDirectAcquireKeywordExclusionsFromTable();
        renderDirectAcquireKeywordTable();
        directAcquireKeywordBulkReason.value = '';
      });
    }
    const directAcquireHashtagSelectAll = document.getElementById('directAcquireHashtagSelectAll');
    if (directAcquireHashtagSelectAll) {
      directAcquireHashtagSelectAll.addEventListener('change', function () {
        const hashtags = Array.isArray(state.directAcquireCurrentRun?.hashtag_summary?.hashtags)
          ? state.directAcquireCurrentRun.hashtag_summary.hashtags
          : [];
        hashtags.forEach((item) => {
          const hashtag = String(item?.hashtag || '').trim();
          if (!hashtag) return;
          if (directAcquireHashtagSelectAll.checked) directAcquireSelectedHashtags.add(hashtag);
          else directAcquireSelectedHashtags.delete(hashtag);
        });
        renderDirectAcquireHashtagTable();
      });
    }
    const directAcquireSaveHashtagsBtn = document.getElementById('directAcquireSaveHashtagsBtn');
    if (directAcquireSaveHashtagsBtn) {
      directAcquireSaveHashtagsBtn.addEventListener('click', async () => {
        try {
          await saveDirectAcquireSelectedHashtags();
        } catch (err) {
          notify(err.message || 'Could not save selected hashtags', true);
        }
      });
    }
    const directAcquireImageSelectAll = document.getElementById('directAcquireImageSelectAll');
    if (directAcquireImageSelectAll) {
      directAcquireImageSelectAll.addEventListener('change', function () {
        const images = Array.isArray(state.directAcquireCurrentRun?.image_summary?.images) ? state.directAcquireCurrentRun.image_summary.images : [];
        const visible = (directAcquireImagesExpanded ? images : images.slice(0, 24))
          .map((item) => String(item?.url || '').trim())
          .filter(Boolean);
        visible.forEach((url) => {
          if (directAcquireImageSelectAll.checked) directAcquireSelectedImages.add(url);
          else directAcquireSelectedImages.delete(url);
        });
        renderDirectAcquireImageGallery();
      });
    }
    const directAcquireImagesSeeMoreBtn = document.getElementById('directAcquireImagesSeeMoreBtn');
    if (directAcquireImagesSeeMoreBtn) {
      directAcquireImagesSeeMoreBtn.addEventListener('click', function () {
        directAcquireImagesExpanded = !directAcquireImagesExpanded;
        renderDirectAcquireImageGallery();
      });
    }
    const directAcquireApplyImageCategoryBtn = document.getElementById('directAcquireApplyImageCategoryBtn');
    const directAcquireImageBulkCategory = document.getElementById('directAcquireImageBulkCategory');
    if (directAcquireApplyImageCategoryBtn && directAcquireImageBulkCategory) {
      directAcquireApplyImageCategoryBtn.addEventListener('click', function () {
        const category = String(directAcquireImageBulkCategory.value || '').trim();
        if (!category) {
          notify('Select an image category first', true);
          return;
        }
        if (!directAcquireSelectedImages.size) {
          notify('Check at least one image first', true);
          return;
        }
        Array.from(directAcquireSelectedImages).forEach((url) => {
          directAcquireImageCategoryByUrl.set(url, category);
        });
        renderDirectAcquireImageGall
```

## public/js/develop.js
```
/**
 * public/js/develop.js
 * Develop menu: Agents, Templates, and Extensions forms for OpenClaw job control.
 */

window.App = window.App || {};
App.develop = (function () {
  const { state, els, api, notify, parseJsonInput, setPreview } = App;
  const LANDING_TEMPLATES = [
    {
      id: 'standard-right-form',
      name: 'Standard Right-Form',
      summary: 'Classic conversion layout with message left, form right, and a clean supporting body section.',
      eyebrow: 'Standard Page Template',
      headline: 'Build a clean, conversion-focused offer page with a form on the right.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
      primaryCta: 'Primary CTA',
      secondaryCta: 'Secondary CTA',
      featureOneTitle: 'Feature One',
      featureOneCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod.',
      featureTwoTitle: 'Feature Two',
      featureTwoCopy: 'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi.',
      formTitle: 'Request More Information',
      formCopy: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      bodyTitle: 'Lorem Ipsum Content Block',
    },
    {
      id: 'founder-story',
      name: 'Founder Story',
      summary: 'A warm narrative-first template that leads with origin story and trust-building copy.',
      eyebrow: 'Founder-Led Story',
      headline: 'Lead with the founder story, then convert with a focused inquiry form.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      primaryCta: 'Work With Us',
      secondaryCta: 'Read The Story',
      featureOneTitle: 'Origin Story',
      featureOneCopy: 'Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.',
      featureTwoTitle: 'Credibility Layer',
      featureTwoCopy: 'Totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto.',
      formTitle: 'Start The Conversation',
      formCopy: 'Tell us what you are building and what support you need.',
      bodyTitle: 'Founder-Led Narrative',
    },
    {
      id: 'lead-magnet-download',
      name: 'PDF Download',
      summary: 'Optimized for giving away a guide, checklist, or PDF in exchange for lead capture.',
      eyebrow: 'PDF Focus',
      headline: 'Offer a downloadable resource and keep the call-to-action simple.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Excepteur sint occaecat cupidatat non proident.',
      primaryCta: 'Download Now',
      secondaryCta: 'See What’s Inside',
      featureOneTitle: 'Quick Value',
      featureOneCopy: 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
      featureTwoTitle: 'Fast Conversion',
      featureTwoCopy: 'Sunt in culpa qui officia deserunt mollit anim id est laborum.',
      formTitle: 'Get The PDF',
      formCopy: 'Enter your details and we will send the resource instantly.',
      bodyTitle: 'Resource Overview',
    },
    {
      id: 'webinar-registration',
      name: 'Webinar Registration',
      summary: 'Event-driven template that highlights urgency, speaker value, and a registration form.',
      eyebrow: 'Event Registration',
      headline: 'Promote a webinar, training, or live session with urgency and clarity.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.',
      primaryCta: 'Reserve My Spot',
      secondaryCta: 'View Agenda',
      featureOneTitle: 'What You’ll Learn',
      featureOneCopy: 'Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet, consectetur.',
      featureTwoTitle: 'Why Attend Live',
      featureTwoCopy: 'Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse quam nihil molestiae.',
      formTitle: 'Register For The Session',
      formCopy: 'Save your seat and we will send event details to your inbox.',
      bodyTitle: 'Session Details',
    },
    {
      id: 'case-study-showcase',
      name: 'Case Study Showcase',
      summary: 'A proof-oriented template built around outcomes, transformation, and inquiry.',
      eyebrow: 'Results-Driven',
      headline: 'Use a case-study-style page to prove the offer before asking for the lead.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam.',
      primaryCta: 'See The Results',
      secondaryCta: 'Request A Strategy Call',
      featureOneTitle: 'Before / After',
      featureOneCopy: 'Eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.',
      featureTwoTitle: 'Measured Outcome',
      featureTwoCopy: 'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur.',
      formTitle: 'Ask About Your Project',
      formCopy: 'Share a few details and we will outline what this could look like for you.',
      bodyTitle: 'Case Study Breakdown',
    },
    {
      id: 'newsletter-signup',
      name: 'Newsletter Signup',
      summary: 'A lighter, editorial-style layout for list building, content subscriptions, and updates.',
      eyebrow: 'Audience Building',
      headline: 'Grow a newsletter or content list with a cleaner, lower-friction signup page.',
      lead: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. At vero eos et accusamus et iusto odio dignissimos ducimus.',
      primaryCta: 'Join The List',
      secondaryCta: 'Read A Sample',
      featureOneTitle: 'Editorial Promise',
      featureOneCopy: 'Et harum quidem rerum facilis est et expedita distinctio nam libero tempore.',
      featureTwoTitle: 'Reader Benefit',
      featureTwoCopy: 'Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus saepe eveniet.',
      formTitle: 'Subscribe For Updates',
      formCopy: 'Add your email to receive ongoing content, offers, and updates.',
      bodyTitle: 'What Subscribers Get',
    },
  ];
  const FORM_TEMPLATES = [
    {
      id: 'squeeze-form',
      name: 'Squeeze Form',
      defaultHeading: 'Get Instant Access',
      defaultSubmitLabel: 'Submit',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
      ],
    },
    {
      id: 'short-form',
      name: 'Short Form',
      defaultHeading: 'Tell Us About Yourself',
      defaultSubmitLabel: 'Send Request',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
      ],
    },
    {
      id: 'long-form',
      name: 'Long Form',
      defaultHeading: 'Complete The Form',
      defaultSubmitLabel: 'Submit Form',
      fields: [
        { key: 'first_name', label: 'First Name', type: 'text', required: true },
        { key: 'last_name', label: 'Last Name', type: 'text', required: false },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone Number', type: 'tel', required: false },
        { key: 'city', label: 'City', type: 'text', required: false },
        { key: 'state', label: 'State', type: 'text', required: false },
        { key: 'country', label: 'Country', type: 'text', required: false },
      ],
    },
  ];
  const CONTACT_TYPE_OPTIONS = [
    { value: 'lead', label: 'Lead' },
    { value: 'prospect', label: 'Prospect' },
    { value: 'subscriber', label: 'Subscriber' },
    { value: 'member', label: 'Member' },
    { value: 'partner', label: 'Partner' },
    { value: 'other', label: 'Other' },
  ];
  const FORM_LEAD_MAGNET_TYPES = [
    { value: 'White Paper', label: 'White Paper' },
    { value: 'Report', label: 'Report' },
    { value: 'Video', label: 'Video' },
    { value: 'Infographic', label: 'Infographic' },
  ];
  const MODULE_TYPE_DEFINITIONS = [
    {
      value: 'header',
      label: 'Header',
      description: 'A reusable heading block for page titles, section headers, and callout headlines.',
      starterName: 'Header',
      defaults: {
        text: 'Section Heading',
        headlineId: '',
        headingLevel: 'H2',
        textColor: '#173c61',
        align: 'left',
      },
      fields: [
        { key: 'text', label: 'Text', control: 'textarea', rows: 3, placeholder: 'Header text', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'headingLevel', label: 'Heading Level', control: 'select', options: ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'] },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'align', label: 'Alignment', control: 'select', options: ['left', 'center', 'right'] },
      ],
    },
    {
      value: 'button',
      label: 'Button',
      description: 'A clickable CTA button with label, link, style, sizing, and alignment controls.',
      starterName: 'Button',
      defaults: {
        label: 'Learn More',
        ctaId: '',
        linkUrl: '',
        style: 'solid',
        size: 'medium',
        align: 'left',
        backgroundColor: '#0b82d4',
        textColor: '#ffffff',
        borderRadius: 20,
        fullWidth: false,
        openInNewTab: false,
      },
      fields: [
        { key: 'label', label: 'Label', control: 'text', placeholder: 'Button label', contentSource: 'cta', contentSettingKey: 'ctaId', contentLabel: 'Incentive' },
        { key: 'linkUrl', label: 'Link URL', control: 'text', placeholder: 'https://...' },
        { key: 'style', label: 'Style', control: 'select', options: ['solid', 'outline', 'ghost', 'link'] },
        { key: 'size', label: 'Size', control: 'select', options: ['small', 'medium', 'large'] },
        { key: 'align', label: 'Alignment', control: 'select', options: ['left', 'center', 'right'] },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'borderRadius', label: 'Border Radius', control: 'number', min: 0, max: 40, step: 1 },
        { key: 'fullWidth', label: 'Full Width', control: 'checkbox' },
        { key: 'openInNewTab', label: 'Open In New Tab', control: 'checkbox' },
      ],
    },
    {
      value: 'form',
      label: 'Form',
      description: 'Embed or style a lead-capture form module with form selection and CTA settings.',
      starterName: 'Form',
      defaults: {
        title: 'Request More Information',
        headlineId: '',
        formId: '',
        submitLabel: 'Submit Form',
        width: 'standard',
        backgroundColor: '#f5fbff',
      },
      fields: [
        { key: 'title', label: 'Title', control: 'text', placeholder: 'Form title', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'formId', label: 'Saved Form', control: 'saved-form-picker' },
        { key: 'submitLabel', label: 'Submit Label', control: 'text', placeholder: 'Submit Form' },
        { key: 'width', label: 'Width', control: 'select', options: ['compact', 'standard', 'wide', 'full'] },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
      ],
    },
    {
      value: 'image',
      label: 'Image',
      description: 'A flexible image block with linking, sizing, and overlay treatment controls.',
      starterName: 'Image',
      defaults: {
        imageAssetId: '',
        imageUrl: '',
        altText: 'Image',
        linkUrl: '',
        maxWidth: 100,
        overlayOpacity: 0,
        aspectRatio: 'auto',
      },
      fields: [
        { key: 'imageAssetId', label: 'Gallery Image', control: 'image-asset-picker', pickerTitle: 'Module Image' },
        { key: 'imageUrl', label: 'Manual Image URL', control: 'text', placeholder: 'https://...' },
        { key: 'altText', label: 'Alt Text', control: 'text', placeholder: 'Describe the image' },
        { key: 'linkUrl', label: 'Link URL', control: 'text', placeholder: 'https://...' },
        { key: 'maxWidth', label: 'Max Width %', control: 'number', min: 10, max: 100, step: 5 },
        { key: 'overlayOpacity', label: 'Overlay Opacity', control: 'number', min: 0, max: 100, step: 5 },
        { key: 'aspectRatio', label: 'Aspect Ratio', control: 'select', options: ['auto', '16:9', '4:3', '3:2', '1:1', '9:16'] },
      ],
    },
    {
      value: 'video',
      label: 'Video',
      description: 'A video block with source, poster, playback, and aspect-ratio controls.',
      starterName: 'Video',
      defaults: {
        videoAssetId: '',
        videoUrl: '',
        posterAssetId: '',
        posterUrl: '',
        aspectRatio: '16:9',
        autoplay: false,
        muted: true,
        controls: true,
      },
      fields: [
        { key: 'videoAssetId', label: 'Gallery Video', control: 'video-asset-picker', pickerTitle: 'Module Video' },
        { key: 'videoUrl', label: 'Video URL', control: 'text', placeholder: 'https://...' },
        { key: 'posterAssetId', label: 'Poster Image', control: 'image-asset-picker', pickerTitle: 'Video Poster' },
        { key: 'posterUrl', label: 'Poster URL', control: 'text', placeholder: 'https://...' },
        { key: 'aspectRatio', label: 'Aspect Ratio', control: 'select', options: ['16:9', '4:3', '1:1', '9:16'] },
        { key: 'autoplay', label: 'Autoplay', control: 'checkbox' },
        { key: 'muted', label: 'Muted', control: 'checkbox' },
        { key: 'controls', label: 'Show Controls', control: 'checkbox' },
      ],
    },
    {
      value: 'table',
      label: 'Table',
      description: 'A presentation-ready table block for charts, pricing grids, and structured tabular data.',
      starterName: 'Table',
      defaults: {
        caption: 'Data Table',
        headlineId: '',
        columnsCount: 3,
        rowsCount: 4,
        tableContents: '[]',
        headerColor: '#173c61',
        headerTextColor: '#ffffff',
        borderColor: '#d6e6f5',
        borderThickness: 1,
        cellPadding: 14,
        striped: true,
        compact: false,
        style: 'clean',
      },
      fields: [
        { key: 'caption', label: 'Caption', control: 'text', placeholder: 'Table caption', contentSource: 'headline', contentSettingKey: 'headlineId', contentLabel: 'Saved Headline' },
        { key: 'columnsCount', label: 'Columns', control: 'number', min: 1, max: 8, step: 1 },
        { key: 'rowsCount', label: 'Rows', control: 'number', min: 1, max: 20, step: 1 },
        { key: 'tableContents', label: 'Contents', control: 'table-contents-editor' },
        { key: 'headerColor', label: 'Header Color', control: 'color' },
        { key: 'headerTextColor', label: 'Header Text Color', control: 'color' },
        { key: 'borderColor', label: 'Border Color', control: 'color' },
        { key: 'borderThickness', label: 'Border Thickness', control: 'number', min: 0, max: 8, step: 1 },
        { key: 'cellPadding', label: 'Cell Padding', control: 'number', min: 4, max: 40, step: 1 },
        { key: 'style', label: 'Style', control: 'select', options: ['clean', 'boxed', 'minimal', 'editorial'] },
        { key: 'striped', label: 'Striped Rows', control: 'checkbox' },
        { key: 'compact', label: 'Compact', control: 'checkbox' },
      ],
    },
    {
      value: 'textarea',
      label: 'Text Block',
      description: 'A rich text content block for body copy, commentary, and formatted editorial content.',
      starterName: 'Text Block',
      defaults: {
        content: '<p>Write your content here.</p>',
        pitchId: '',
        textAlign: 'left',
        textColor: '#173c61',
        backgroundColor: '#ffffff',
        maxWidth: 'full',
      },
      fields: [
        { key: 'content', label: 'Content', control: 'richtext', rows: 8, placeholder: '<p>Write your content here.</p>', contentSource: 'pitch', contentSettingKey: 'pitchId', contentLabel: 'Saved Pitch' },
        { key: 'textAlign', label: 'Text Alignment', control: 'select', options: ['left', 'center', 'right'] },
        { key: 'textColor', label: 'Text Color', control: 'color' },
        { key: 'backgroundColor', label: 'Background Color', control: 'color' },
        { key: 'maxWidth', label: 'Width', control: 'select', options: ['compact', 'standard', 'wide', 'full'] },
      ],
    },
  ];
  let selectedTemplateId = LANDING_TEMPLATES[0].id;
  let selectedFormTemplateId = FORM_TEMPLATES[0].id;
  let selectedEmailTemplateId = '';
  let savedThemes = [];
  let selectedThemeId = '';
  let formBuilderState = null;
  const DEFAULT_FORM_ACCENT = '#0b82d4';
  const MATCH_LANDING_GREY = '#6b7280';
  const DEFAULT_LANDING_PRIMARY = '#0b82d4';
  const DEFAULT_LANDING_BACKGROUND = '#f5fbff';
  const DEFAULT_LANDING_ACCENT = '#1a4f81';
  let landingPageColors = {
    primary: DEFAULT_LANDING_PRIMARY,
    background: DEFAULT_LANDING_BACKGROUND,
    accent: DEFAULT_LANDING_ACCENT,
  };
  let savedForms = [];
  let savedModules = [];
  let savedLandingPages = [];
  let savedPageTemplates = [];
  let modularPageTemplateDraft = null;
  let draggedNewPageSectionLayout = '';
  let draggedNewPageSectionLayoutClearTimer = null;
  let activePageLayoutPointerDrag = null;
  let suppressLayoutTileClickUntil = 0;
  let activePageModulePointerDrag = null;
  let activePlacedPageModulePointerDrag = null;
  let activeModularPageModulePicker = null;
  let activeModularPageModuleEditor = null;
  let activeModularContainerEditor = null;
  let activeModularRowEditor = null;
  let modularPageEditorMode = 'template';
  let modularPageEditorSourceTemplateId = '';
  let modularPageEditorOptions = null;
  let savedExtensions = [];
  let savedEmailTemplates = [];
  let savedAgents = [];
  let emailTemplateBlocksDraft = [];
  let landingPageHeadlines = [];
  let landingPageSubheadings = [];
  let landingPagePitches = [];
  let landingPageCtas = [];
  const landingPageSelectorFilterState = {};
  let pendingLandingPageFormRecord = null;
  let selectedLandingPageIds = new Set();
  let activeLandingPagePreviewRecord = null;
  let activeLandingPagePreviewMode = 'page';
  let activeLandingPageVisualRecord = null;
  let activeLandingPageVisualMode = 'page';
  let landingPageVisualEditMode = true;
  let landingPageVisualDraft = {};
  let landingPageThankYouState = null;
  const activeLandingPageVisualEditors = new Set();
  const collapsedExtensionIds = new Set();
  const formTableState = {
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };

  function getEmailTemplatesByKind(kind) {
    const normalized = safeText(kind).toLowerCase();
    return savedEmailTemplates.filter((template) => {
      const templateKind = safeText(template?.templateKind).toLowerCase() || 'text';
      return normalized ? templateKind === normalized : true;
    });
  }

  function getThemeById(themeId) {
    const id = safeText(themeId);
    return savedThemes.find((item) => String(item.id) === id) || null;
  }
  const landingPageTableState = {
    filters: {
      name: '',
      templateId: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const EXTENSION_TYPE_OPTIONS = [
    { value: 'manager', label: 'Manager' },
    { value: 'utility', label: 'Utility' },
    { value: 'generator', label: 'Generator' },
    { value: 'connector', label: 'Connector' },
    { value: 'workflow', label: 'Workflow' },
    { value: 'automation', label: 'Automation' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'catalog', label: 'Catalog' },
    { value: 'custom', label: 'Custom' },
  ];
  const extensionTableState = {
    filters: {
      name: '',
      extensionType: '',
      status: '',
      tags: '',
    },
    sort: {
      key: 'updatedAt',
      dir: 'desc',
    },
  };
  const LANDING_THANK_YOU_STATE_KEY = 'develop_landing_thank_you_state_v1';
  const SAVED_AGENTS_STORAGE_KEY = 'develop_saved_agents_v1';
  let extensionManagerConfig = {
    defaultFilters: {},
    defaultSortKey: 'updatedAt',
    defaultSortDir: 'desc',
  };

  function safeText(value) {
    return String(value || '').trim();
  }

  function escapeHtml(value) {
    return safeText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHtml(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function setThemesBuilderVisible(visible) {
    const panel = byId('developThemesBuilderPanel');
    const toggle = byId('developThemesBuilderToggleBtn');
    if (panel) panel.classList.toggle('hidden', !visible);
    if (toggle) {
      toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
      toggle.textContent = visible ? '▾' : '▸';
    }
  }

  function openThemesPage() {
    setThemesBuilderVisible(false);
    App.setActivePage('developThemesPage');
    refresh().catch((err) => notify(err.message || 'Unable to load themes', true));
  }

  function openThemesBuilder() {
    App.setActivePage('developThemesPage');
    setThemesBuilderVisible(true);
    const panel = byId('developThemesBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function openAgentsPage() {
    setAgentsBuilderVisible(false);
    App.setActivePage('developAgentsPage');
    refresh().catch((err) => notify(err.message || 'Unable to load agents page', true));
  }

  function setAgentsBuilderVisible(visible) {
    const panel = byId('developAgentsBuilderPanel');
    if (panel) panel.classList.toggle('hidden', !visible);
  }

  function nextLocalId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadSavedAgents() {
    try {
      const raw = String(window.localStorage.getItem(SAVED_AGENTS_STORAGE_KEY) || '').trim();
      if (!raw) {
        savedAgents = [];
        return;
      }
      const parsed = JSON.parse(raw);
      savedAgents = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      savedAgents = [];
    }
  }

  function persistSavedAgents() {
    try {
      window.localStorage.setItem(SAVED_AGENTS_STORAGE_KEY, JSON.stringify(savedAgents));
    } catch (_) {}
  }

  function getAgentFormPayload() {
    const form = els.developAgentsForm;
    const formData = new FormData(form);
    return {
      id: safeText(formData.get('agent_preset_id')),
      name: safeText(formData.get('agent_name')),
      action: safeText(formData.get('action')) || 'create_job',
      job_id: safeText(formData.get('job_id')),
      workspace_id: safeText(formData.get('workspace_id')) || 'alphire-main',
      type: safeText(formData.get('type')) || 'acquire.web',
      requested_by_user_id: safeText(formData.get('requested_by_user_id')) || 'alphire-ui',
      requested_by_email: safeText(formData.get('requested_by_email')) || 'ops@alphire.ai',
      payload_json: String(formData.get('payload_json') || '').trim() || '{"source_urls":[],"max_pages":20}',
      approval_decision: safeText(formData.get('approval_decision')) || 'APPROVE',
      approval_token: safeText(formData.get('approval_token')),
      approval_comment: safeText(formData.get('approval_comment')),
      manual_confirmed: formData.get('manual_confirmed') === 'on',
    };
  }

  function populateAgentForm(record) {
    const form = els.developAgentsForm;
    if (!form || !record) return;
    const setValue = (name, value) => {
      const field = form.elements.namedItem(name);
      if (!field) return;
      if (field.type === 'checkbox') {
        field.checked = Boolean(value);
      } else {
        field.value = String(value || '');
      }
    };
    setValue('agent_preset_id', record.id);
    setValue('agent_name', record.name);
    setValue('action', record.action);
    setValue('job_id', record.job_id);
    setValue('workspace_id', record.workspace_id);
    setValue('type', record.type);
    setValue('requested_by_user_id', record.requested_by_user_id);
    setValue('requested_by_email', record.requested_by_email);
    setValue('payload_json', record.payload_json);
    setValue('approval_decision', record.approval_decision);
    setValue('approval_token', record.approval_token);
    setValue('approval_comment', record.approval_comment);
    setValue('manual_confirmed', record.manual_confirmed);
  }

  function resetAgentsForm() {
    if (els.developAgentsForm) els.developAgentsForm.reset();
    const presetId = byId('developAgentPresetIdInput');
    const nameInput = byId('developAgentNameInput');
    if (presetId) presetId.value = '';
    if (nameInput) nameInput.value = '';
    const actionSelect = byId('agentsActionSelect');
    if (actionSelect) actionSelect.value = 'agent_api_setup_orchestrator';
    const workspaceField = els.developAgentsForm?.elements?.namedItem('workspace_id');
    const typeField = els.developAgentsForm?.elements?.namedItem('type');
    const requestedById = els.developAgentsForm?.elements?.namedItem('requested_by_user_id');
    const requestedByEmail = els.developAgentsForm?.elements?.namedItem('requested_by_email');
    const payload = els.developAgentsForm?.elements?.namedItem('payload_json');
    if (workspaceField) workspaceField.value = 'alphire-main';
    if (typeField) typeField.value = 'acquire.web';
    if (requestedById) requestedById.value = 'alphire-ui';
    if (requestedByEmail) requestedByEmail.value = 'ops@alphire.ai';
    if (payload) payload.value = '{"source_urls":[],"max_pages":20}';
  }

  function renderSavedAgentsTable() {
    const body = byId('developAgentsTableBody');
    if (!body) return;
    if (!savedAgents.length) {
      body.innerHTML = '<tr><td colspan="6" class="meta">No saved agents yet.</td></tr>';
      return;
    }
    body.innerHTML = '';
    savedAgents
      .slice()
      .sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')))
      .forEach((item) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${safeText(item.name) || 'Untitled Agent'}</td>
          <td>${safeText(item.action) || '-'}</td>
          <td>${safeText(item.workspace_id) || '-'}</td>
          <td>${safeText(item.type) || '-'}</td>
          <td>${safeText(item.updatedAt) || '-'}</td>
          <td class="develop-agents-actions-cell"></td>
        `;
        const actions = row.querySelector('.develop-agents-actions-cell');
        if (actions) {
          actions.appendChild(App.makeIconButton('edit', 'Edit Agent', () => {
            populateAgentForm(item);
            setAgentsBuilderVisible(true);
            const panel = byId('developAgentsBuilderPanel');
            if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }));
          actions.appendChild(App.makeIconButton('copy', 'Clone Agent', () => {
            const clone = { ...item, id: '', name: `${safeText(item.name) || 'Agent'} Copy` };
            populateAgentForm(clone);
            const presetId = byId('developAgentPresetIdInput');
            if (presetId) presetId.value = '';
            setAgentsBuilderVisible(true);
          }));
          actions.appendChild(App.makeIconButton('delete', 'Delete Agent', () => {
            if (!window.confirm(`Delete agent "${safeText(item.name) || 'Untitled Agent'}"?`)) return;
            savedAgents = savedAgents.filter((entry) => safeText(entry.id) !== safeText(item.id));
            persistSavedAgents();
            renderSavedAgentsTable();
            notify('Agent deleted');
          }));
        }
        body.appendChild(row);
      });
  }

  function saveAgentPresetFromForm({ clone = false } = {}) {
    const payload = getAgentFormPayload();
    if (!payload.name) throw new Error('Agent name is required');
    const now = new Date().toISOString();
    const nextIdValue = clone || !payload.id ? nextLocalId('agent') : payload.id;
    const record = {
      ...payload,
      id: nextIdValue,
      updatedAt: now,
      createdAt: clone || !payload.id
        ? now
        : (savedAgents.find((entry) => safeText(entry.id) === safeText(payload.id))?.createdAt || now),
    };
    const existingIndex = savedAgents.findIndex((entry) => safeText(entry.id) === safeText(payload.id));
    if (!clone && existingIndex >= 0) savedAgents.splice(existingIndex, 1, record);
    else savedAgents.unshift(record);
    persistSavedAgents();
    renderSavedAgentsTable();
    populateAgentForm(record);
    const presetId = byId('developAgentPresetIdInput');
    if (presetId) presetId.value = record.id;
    notify(clone ? 'Agent cloned' : (existingIndex >= 0 ? 'Agent updated' : 'Agent saved'));
  }

  function openAgentsCreate() {
    App.setActivePage('developAgentsPage');
    resetAgentsForm();
    setAgentsBuilderVisible(true);
    const panel = byId('developAgentsBuilderPanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function slugify(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
  }

  function setSelectOptions(select, options, placeholder, currentValue) {
    if (!select) return;
    const desired = String(currentValue || '');
    select.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);

    (Array.isArray(options) ? options : []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.value);
      option.textContent = item.label;
      select.appendChild(option);
    });

    if (desired && Array.from(select.options).some((option) => option.value === desired)) {
      select.value = desired;
    }
  }

  function assetLabel(asset, fallbackLabel) {
    return safeText(asset?.assetName) || fallbackLabel;
  }

  function isValidUrl(value) {
    const text = safeText(value);
    if (!text) return false;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function extractDriveId(url) {
    const text = safeText(url);
    if (!text) return '';
    const byProxyPath = text.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPath) return byProxyPath[1];
    const byProxyPathNoLeadingSlash = text.match(/^api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
    if (byProxyPathNoLeadingSlash) return byProxyPathNoLeadingSlash[1];
    const byPath = text.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (byPath) return byPath[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
    try {
      const parsed = new URL(text);
      const byParam = parsed.searchParams.get('id');
      if (byParam) return byParam;
      const byPathInUrl = parsed.pathname.match(/\/api\/assets\/drive-file\/([a-zA-Z0-9_-]{10,})/);
      if (byPathInUrl) return byPathInUrl[1];
      return '';
    } catch {
      return '';
    }
  }

  function toDirectAssetUrl(url) {
    const text = safeText(url);
    if (!text) return '';
    if (text.startsWith('/api/assets/drive-file/')) return text;
    if (text.startsWith('api/assets/drive-file/')) return `/${text}`;
    const driveId = extractDriveId(text);
    if (driveId) return `/api/assets/drive-file/${encodeURIComponent(driveId)}`;
    if (isValidUrl(text)) return text;
    if (text.startsWith('/')) return text;
    return text;
  }

  function isDirectVideoMediaUrl(url) {
    const text = safeText(url);
    if (!text) return false;
    if (text.startsWith('/api/assets/drive-file/')) return true;
    if (text.includes('.public.blob.vercel-storage.com/')) return true;
    return /(\.mp4|\.webm|\.ogg|\.mov|\.m4v)(\?|#|$)/i.test(text);
  }

  function getEmbeddableVideoUrl(url) {
    const text = safeText(url);
    if (!text) return '';
    try {
      const parsed = new URL(text, window.location.origin);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'youtube.com' || host === 'm.youtube.com') {
        const id = parsed.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
      }
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts[0] === 'embed' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
        if (parts[0] === 'shorts' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
        if (parts[0] === 'live' && parts[1]) return `https://www.youtube.com/embed/${encodeURIComponent(parts[1])}`;
      }
      if (host === 'youtu.be') {
        const id = parsed.pathname.replace(/^\/+/, '').split('/')[0];
        return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : '';
      }
      if (host === 'youtube-nocookie.com') {
        return text;
      }
      if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const id = parts.pop();
        return id ? `https://player.vimeo.com/video/${encodeURIComponent(id)}` : '';
      }
    } catch {
      return '';
    }
    return '';
  }

  function buildResponsiveVideoMarkup(content, options = {}) {
    const assetUrl = safeText(content?.assetUrl);
    const posterAttr = content?.posterUrl ? ` poster="${escapeHtml(content.posterUrl)}"` : '';
    const autoplayAttr = content?.autoplay ? ' autoplay' : '';
    const mutedAttr = content?.muted ? ' muted' : '';
    const controlsAttr = content?.controls ? ' controls' : '';
    const className = safeText(options.className);
    const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
    const embedUrl = getEmbeddableVideoUrl(assetUrl);
    if (embedUrl) {
      return `<iframe${classAttr} src="${escapeHtml(embedUrl)}" title="${escapeHtml(content?.assetName || 'Video')}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    }
    if (isDirectVideoMediaUrl(assetUrl)) {
      return `<video${classAttr} src="${escapeHtml(assetUrl)}"${posterAttr}${autoplayAttr}${mutedAttr}${controlsAttr}></video>`;
    }
    return `<div class="develop-template-empty-slot">${escapeHtml(content?.assetName || 'No video selected')}</div>`;
  }

  function getAssetsByType(assetType) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.assetType) === safeText(assetType)
    );
  }

  function getFormLeadMagnetTypeDisplayLabel(type) {
    const value = safeText(type);
    const match = FORM_LEAD_MAGNET_TYPES.find((item) => safeText(item.value) === value);
    return match ? match.label : getAssetTypeDisplayLabel(value);
  }

  function getFormLeadMagnetTypeOptions(currentType) {
    const rows = FORM_LEAD_MAGNET_TYPES.map((item) => ({ value: item.value, label: item.label }));
    const legacy = safeText(currentType);
    if (legacy && !rows.some((item) => safeText(item.value) === legacy)) {
      rows.push({ value: legacy, label: getFormLeadMagnetTypeDisplayLabel(legacy) });
    }
    return rows;
  }

  function assetMatchesFormLeadMagnetType(asset, leadMagnetType) {
    const type = safeText(leadMagnetType);
    const assetType = safeText(asset?.assetType);
    const category = safeText(asset?.category);
    if (!type) return true;
    if (type === 'White Paper') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'White Paper';
    }
    if (type === 'Report') {
      return (assetType === 'Lead Magnet' || assetType === 'File') && category === 'Report';
    }
    if (type === 'Video') {
      return assetType === 'Video';
    }
    if (type === 'Infographic') {
      return assetType === 'Image' && category === 'Infographic';
    }
    return assetType === type || category === type;
  }

  function getAssetTypeDisplayLabel(assetType) {
    return safeText(assetType) === 'Lead Magnet' ? 'PDF' : safeText(assetType);
  }

  function setThemeStatus(message, isError = false) {
    const node = byId('developThemesStatusMsg');
    if (!node) return;
    const text = safeText(message, 500);
    node.textContent = text;
    node.classList.toggle('hidden', !text);
    node.classList.toggle('error', Boolean(text && isError));
  }

  function getThemeImageAssets() {
    return getAssetsByType('Image');
  }

  const THEME_ASSET_PICKERS = {
    developThemesLogoWideSelect: {
      selectId: 'developThemesLogoWideSelect',
      buttonId: 'developThemesLogoWidePickerBtn',
      previewId: 'developThemesLogoWidePreview',
      title: 'Logo - Wide',
      category: 'Logo - Wide',
      categories: ['Logo - Wide'],
      tags: ['theme', 'logo-wide', 'builder'],
    },
    developThemesLogoSquareSelect: {
      selectId: 'developThemesLogoSquareSelect',
      buttonId: 'developThemesLogoSquarePickerBtn',
      previewId: 'developThemesLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['theme', 'logo-square', 'builder'],
    },
    developThemesFeatureImageSelect: {
      selectId: 'developThemesFeatureImageSelect',
      buttonId: 'developThemesFeatureImagePickerBtn',
      previewId: 'developThemesFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['theme', 'feature-image', 'builder'],
    },
    developThemesBackgroundImageSelect: {
      selectId: 'developThemesBackgroundImageSelect',
      buttonId: 'developThemesBackgroundImagePickerBtn',
      previewId: 'developThemesBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['theme', 'background-image', 'builder'],
    },
  };

  const LANDING_IMAGE_PICKERS = {
    developLandingBannerImageSelect: {
      selectId: 'developLandingBannerImageSelect',
      fieldKey: 'websiteBannerImageId',
      buttonId: 'developLandingBannerImagePickerBtn',
      previewId: 'developLandingBannerImagePreview',
      title: 'Website Banner Image',
      category: 'Banner Image',
      categories: ['Banner Image', 'Website Banner', 'Website Banner Image', 'Hero Banner', 'Article Banner'],
      tags: ['landing-page', 'website-banner', 'builder'],
    },
    developLandingBackgroundImageSelect: {
      selectId: 'developLandingBackgroundImageSelect',
      fieldKey: 'backgroundImageId',
      buttonId: 'developLandingBackgroundImagePickerBtn',
      previewId: 'developLandingBackgroundImagePreview',
      title: 'Background Image',
      category: 'Background Image',
      categories: ['Background Image'],
      tags: ['landing-page', 'background-image', 'builder'],
    },
    developLandingFeatureImageSelect: {
      selectId: 'developLandingFeatureImageSelect',
      fieldKey: 'featureImageId',
      buttonId: 'developLandingFeatureImagePickerBtn',
      previewId: 'developLandingFeatureImagePreview',
      title: 'Feature Image',
      category: 'Feature Image',
      categories: ['Feature Image', 'Feature', 'Feature Graphic', 'Featured Image'],
      tags: ['landing-page', 'feature-image', 'builder'],
    },
    developLandingHighlightImageSelect: {
      selectId: 'developLandingHighlightImageSelect',
      fieldKey: 'highlightImageId',
      buttonId: 'developLandingHighlightImagePickerBtn',
      previewId: 'developLandingHighlightImagePreview',
      title: 'Highlight Image',
      category: 'Highlight Image',
      categories: ['Highlight Image', 'Highlight'],
      tags: ['landing-page', 'highlight-image', 'builder'],
    },
    developLandingLogoSquareSelect: {
      selectId: 'developLandingLogoSquareSelect',
      fieldKey: 'logoSquareId',
      buttonId: 'developLandingLogoSquarePickerBtn',
      previewId: 'developLandingLogoSquarePreview',
      title: 'Logo - Square',
      category: 'Logo - Square',
      categories: ['Logo - Square', 'Square Logo'],
      tags: ['landing-page', 'logo-square', 'builder'],
    },
    developLandingLogoWideSelect: {
      selectId: 'developLandingLogoWideSelect',
      fieldKey: 'logoWideId',
      buttonId: 'developLandingLogoWidePickerBtn',
      previewId: 'developLandingLogoWidePreview',
      title: 'Logo - Wide',
      category: 'Logo - Wide',
      categories: ['Logo - Wide', 'Wide Logo'],
      tags: ['landing-page', 'logo-wide', 'builder'],
    },
  };

  function isLandingImageFieldKey(fieldKey) {
    return [
      'websiteBannerImageId',
      'backgroundImageId',
      'featureImageId',
      'highlightImageId',
      'logoSquareId',
      'logoWideId',
    ].includes(safeText(fieldKey));
  }

  function isLandingImageSelectId(selectId) {
    return Boolean(LANDING_IMAGE_PICKERS[safeText(selectId)]);
  }

  function getImagePickerConfig(selectId) {
    const key = String(selectId || '').trim();
    return THEME_ASSET_PICKERS[key] || LANDING_IMAGE_PICKERS[key] || null;
  }

  function resolveImagePickerConfig(target) {
    if (!target) return null;
    if (typeof target === 'string') return getImagePickerConfig(target);
    if (typeof target === 'object' && !Array.isArray(target)) return target;
    return null;
  }

  function getThemePickerConfig(selectId) {
    return THEME_ASSET_PICKERS[String(selectId || '').trim()] || null;
  }

  function normalizeAssetFilterToken(value) {
    return safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function getAssetTagText(asset) {
    return Array.isArray(asset?.tags)
      ? asset.tags.map((item) => safeText(item)).filter(Boolean).join(' ')
      : safeText(asset?.tags).replace(/[;,]+/g, ' ');
  }

  function assetMatchesPickerContext(asset, config) {
    if (!asset || !config) return false;
    const category = normalizeAssetFilterToken(asset?.category);
    const haystack = [
      category,
      normalizeAssetFilterToken(asset?.assetName),
      normalizeAssetFilterToken(asset?.location),
      normalizeAssetFilterToken(getAssetTagText(asset)),
    ].join(' ').trim();
    const allowedCategories = (config?.categories || []).map((item) => normalizeAssetFilterToken(item)).filter(Boolean);
    const contextTags = (config?.tags || []).map((item) => normalizeAssetFilterToken(item)).filter(Boolean);
    if (allowedCategories.some((value) => value && (category === value || haystack.includes(value)))) {
      return true;
    }
    if (contextTags.some((value) => value && haystack.includes(value))) {
      return true;
    }
    return false;
  }

  function getImagePickerAssets(selectId, currentValue = '') {
    const config = getImagePickerConfig(selectId);
    const currentId = safeText(currentValue);
    const rows = getThemeImageAssets().filter((asset) => {
      if (!config) return true;
      return assetMatchesPickerContext(asset, config);
    });
    if (currentId && !rows.some((asset) => String(asset.id) === currentId)) {
      const currentAsset = (Array.isArray(state.assets) ? state.assets : []).find((asset) => String(asset.id) === currentId);
      if (currentAsset && safeText(currentAsset.assetType) === 'Image') rows.unshift(currentAsset);
    }
    return rows;
  }

  function getThemePickerAssets(selectId, currentValue = '') {
    return getImagePickerAssets(selectId, currentValue);
  }

  function renderThemeAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.innerHTML = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.innerHTML = `
      ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(asset.assetName) || config.title}" />` : ''}
      <div class="develop-theme-asset-preview-text">
        <strong>${safeText(assetLabel(asset, config.title))}</strong>
        <span>${safeText(asset.category) || 'Image'}</span>
      </div>
    `;
  }

  function renderLandingAssetPickerDisplay(selectId) {
    const config = getImagePickerConfig(selectId);
    if (!config) return;
    const select = byId(config.selectId);
    const button = byId(config.buttonId);
    const preview = byId(config.previewId);
    const selectedId = safeText(select?.value);
    const asset = selectedId
      ? (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === selectedId)
      : null;
    if (button) button.textContent = asset ? `Change ${config.title}` : `Choose ${config.title}`;
    if (!preview) return;
    if (!asset) {
      preview.innerHTML = 'No image selected';
      return;
    }
    const imageUrl = toDirectAssetUrl(asset.location);
    preview.innerHTML = `
      ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(asset.assetName) || config.title}" />` : ''}
      <div class="develop-theme-asset-preview-text">
        <strong>${safeText(assetLabel(asset, config.title))}</strong>
        <span>${safeText(asset.category) || 'Image'}</span>
      </div>
    `;
  }

  function renderThemeAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getThemePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderThemeAssetPickerDisplay(selectId);
  }

  function renderLandingAssetSelect(selectId, currentValue, placeholderLabel) {
    const select = byId(selectId);
    if (!select) return;
    setSelectOptions(
      select,
      getImagePickerAssets(selectId, currentValue).map((asset) => ({
        value: String(asset.id),
        label: assetLabel(asset, `Asset ${asset.id}`),
      })),
      placeholderLabel || 'None',
      currentValue
    );
    renderLandingAssetPickerDisplay(selectId);
  }

  async function uploadThemeAssetFile(file, selectId) {
    const config = getImagePickerConfig(selectId);
    if (!file || !config) return null;
    if (!String(file.type || '').startsWith('image/')) {
      throw new Error('Please choose an image file');
    }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const result = await api('/api/assets/upload-google-drive', {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileBase64: btoa(binary),
        fileSize: Number(file.size || 0),
        assetType: 'Image',
        assetName: file.name.replace(/\.[^.]+$/, '') || file.name,
        category: config.category,
        tags: config.tags,
      }),
    });
    const asset = result?.asset || result?.data?.asset || null;
    if (!asset?.id) throw new Error('Image upload did not return an asset');
    state.assets = [asset].concat(Array.isArray(state.assets) ? state.assets.filter((item) => String(item.id) !== String(asset.id)) : []);
    return asset;
  }

  async function uploadLandingAssetFile(file, selectId) {
    const asset = await uploadThemeAssetFile(file, selectId);
    renderLandingAssetSelect(selectId, String(asset.id), 'None');
    updateLandingPageFieldOutlines();
    return asset;
  }

  function openImageAssetPicker(target, options = {}) {
    const config = resolveImagePickerConfig(target);
    const selectId = safeText(config?.selectId) || safeText(target);
    const select = selectId ? byId(selectId) : null;
    if (!config || !App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => safeText(select.value));
    const setValue = typeof options.setValue === 'function'
      ? options.setValue
      : ((value) => {
        if (select) select.value = safeText(value);
      });
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const uploadHandler = typeof options.uploadHandler === 'function'
      ? options.uploadHandler
      : ((file) => uploadThemeAssetFile(file, selectId));
    const extraDialogClass = safeText(options.dialogClass);
    const backdropClass = safeText(options.backdropClass);
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const toolbar = document.createElement('div');
    toolbar.className = 'develop-theme-picker-toolbar';

    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search images by name, category, or tag';

    const categoryFilter = document.createElement('select');
    const orientationFilter = document.createElement('select');
    const tagFilter = document.createElement('select');

    const resultCount = document.createElement('div');
    resultCount.className = 'develop-theme-picker-result-count';
    resultCount.textContent = '0 images';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = 'Clear Selection';

    const uploadWrap = document.createElement('div');
    uploadWrap.className = 'develop-theme-picker-upload';
    const uploadInput = document.createElement('input');
    uploadInput.type = 'file';
    uploadInput.accept = 'image/*';
    const uploadBtn = document.createElement('button');
    uploadBtn.type = 'button';
    uploadBtn.textContent = 'Upload Image';
    uploadWrap.appendChild(uploadInput);
    uploadWrap.appendChild(uploadBtn);

    toolbar.appendChild(filterInput);
    toolbar.appendChild(categoryFilter);
    toolbar.appendChild(orientationFilter);
    toolbar.appendChild(tagFilter);
    toolbar.appendChild(resultCount);
    toolbar.appendChild(clearBtn);
    toolbar.appendChild(uploadWrap);

    const grid = document.createElement('div');
    grid.className = 'develop-theme-picker-grid';
    body.appendChild(toolbar);
    body.appendChild(grid);

    let modal = null;
    let previewModal = null;

    function getAssetDimensions(asset) {
      const width = Number(asset?.width || asset?.imageWidth || asset?.assetWidth || 0);
      const height = Number(asset?.height || asset?.imageHeight || asset?.assetHeight || 0);
      return {
        width: Number.isFinite(width) && width > 0 ? width : 0,
        height: Number.isFinite(height) && height > 0 ? height : 0,
      };
    }

    function getAssetOrientation(asset) {
      const { width, height } = getAssetDimensions(asset);
      if (!width || !height) return 'unknown';
      const ratio = width / height;
      if (ratio >= 1.2) return 'wide';
      if (ratio <= 0.82) return 'tall';
      return 'square';
    }

    function getAssetDimensionLabel(asset) {
      const { width, height } = getAssetDimensions(asset);
      return width && height ? `${width} x ${height}` : '';
    }

    function getScopedAssets() {
      return getImagePickerAssets(selectId, getValue());
    }

    function syncPickerFilters() {
      const scopedAssets = getScopedAssets();
      const categoryValues = Array.from(new Set(scopedAssets.map((asset) => safeText(asset?.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      const tagValues = Array.from(new Set(
        scopedAssets.flatMap((asset) => {
          const tags = Array.isArray(asset?.tags)
            ? asset.tags
            : safeText(asset?.tags).split(/[;,]+/g);
          return tags.map((item) => safeText(item)).filter(Boolean);
        })
      )).sort((a, b) => a.localeCompare(b));

      setSelectOptions(
        categoryFilter,
        categoryValues.map((value) => ({ value, label: value })),
        'All Relevant Categories',
        safeText(categoryFilter.value)
      );
      setSelectOptions(
        orientationFilter,
        [
          { value: 'wide', label: 'Wide' },
          { value: 'square', label: 'Square' },
          { value: 'tall', label: 'Tall' },
          { value: 'unknown', label: 'Other' },
        ],
        'All Shapes',
        safeText(orientationFilter.value)
      );
      setSelectOptions(
        tagFilter,
        tagValues.map((value) => ({ value, label: value })),
        'All Relevant Tags',
        safeText(tagFilter.value)
      );
    }

    function openImagePreview(asset) {
      if (!asset || !App.components || typeof App.components.Modal !== 'function') return;
      const imageUrl = toDirectAssetUrl(asset.location);
      if (!imageUrl) return;
      const previewBody = document.createElement('div');
      previewBody.className = 'develop-theme-image-preview-modal-body';
      previewBody.innerHTML = `
        <div class="develop-theme-image-preview-stage">
          <img src="${imageUrl}" alt="${safeText(assetLabel(asset, config.title))}" />
        </div>
        <div class="develop-theme-image-preview-meta">
          <strong>${safeText(assetLabel(asset, config.title))}</strong>
          <span>${safeText(asset.category) || 'Image'}</span>
        </div>
      `;
      previewModal = App.components.Modal({
        title: safeText(assetLabel(asset, config.title)) || config.title,
        body: previewBody,
        dialogClass: 'develop-theme-image-preview-modal',
      });
      previewModal.open();
    }

    function renderGrid() {
      syncPickerFilters();
      const filter = safeText(filterInput.value).toLowerCase();
      const categoryValue = safeText(categoryFilter.value);
      const orientationValue = safeText(orientationFilter.value);
      const tagValue = safeText(tagFilter.value).toLowerCase();
      const assets = getScopedAssets().filter((asset) => {
        if (categoryValue && safeText(asset?.category) !== categoryValue) return false;
        if (orientationValue && getAssetOrientation(asset) !== orientationValue) return false;
        const tagText = getAssetTagText(asset).toLowerCase();
        if (tagValue && !tagText.includes(tagValue)) return false;
        if (!filter) return true;
        const haystack = [
          assetLabel(asset, ''),
          safeText(asset.category),
          safeText(asset.assetName),
          safeText(asset.location),
          tagText,
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      resultCount.textContent = `${assets.length} image${assets.length === 1 ? '' : 's'}`;
      grid.innerHTML = '';
      if (!assets.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No matching images found.';
        grid.appendChild(empty);
        return;
      }
      const grouped = {
        wide: [],
        square: [],
        tall: [],
        unknown: [],
      };
      assets.forEach((asset) => {
        grouped[getAssetOrientation(asset)].push(asset);
      });

      [
        ['wide', 'Wide Images'],
        ['square', 'Square Images'],
        ['tall', 'Tall Images'],
        ['unknown', 'Other Images'],
      ].forEach(([groupKey, label]) => {
        const rows = grouped[groupKey];
        if (!rows.length) return;
        const section = document.createElement('section');
        section.className = 'develop-theme-picker-group';

        const heading = document.createElement('div');
        heading.className = 'develop-theme-picker-group-heading';
        heading.innerHTML = `<strong>${label}</strong><span>${rows.length}</span>`;
        section.appendChild(heading);

        const sectionGrid = document.createElement('div');
        sectionGrid.className = `develop-theme-picker-grid develop-theme-picker-grid--${groupKey}`;

        rows.forEach((asset) => {
          const card = document.createElement('div');
          card.className = `develop-theme-picker-card develop-theme-picker-card--${groupKey}${String(asset.id) === getValue() ? ' is-selected' : ''}`;
          const imageUrl = toDirectAssetUrl(asset.location);
          const dimensionLabel = getAssetDimensionLabel(asset);
          card.innerHTML = `
            <button type="button" class="develop-theme-picker-card-image-btn">
              ${imageUrl ? `<img src="${imageUrl}" alt="${safeText(assetLabel(asset, config.title))}" />` : '<div class="develop-theme-table-thumb-empty">No Image</div>'}
            </button>
            <div class="develop-theme-picker-card-title">${safeText(assetLabel(asset, config.title))}</div>
            <div class="develop-theme-picker-card-meta">${safeText(asset.category) || 'Image'}${dimensionLabel ? ` • ${dimensionLabel}` : ''}</div>
            <div class="develop-theme-picker-card-actions">
              <button type="button" class="tiny-btn develop-theme-picker-preview-btn">Preview</button>
              <button type="button" class="tiny-btn develop-theme-picker-select-btn">Use Image</button>
            </div>
          `;
          const imageBtn = card.querySelector('.develop-theme-picker-card-image-btn');
          const previewBtn = card.querySelector('.develop-theme-picker-preview-btn');
          const selectBtn = card.querySelector('.develop-theme-picker-select-btn');
          const choose = () => {
            setValue(String(asset.id));
            afterChange(asset);
            if (modal) modal.close();
          };
          if (imageBtn) {
            imageBtn.addEventListener('click', () => {
              openImagePreview(asset);
            });
          }
          if (previewBtn) {
            previewBtn.addEventListener('click', () => {
              openImagePreview(asset);
            });
          }
          if (selectBtn) {
            selectBtn.addEventListener('click', choose);
          }
          sectionGrid.appendChild(card);
        });

        section.appendChild(sectionGrid);
        grid.appendChild(section);
      });
    }

    filterInput.addEventListener('input', renderGrid);
    categoryFilter.addEventListener('change', renderGrid);
    orientationFilter.addEventListener('change', renderGrid);
    tagFilter.addEventListener('change', renderGrid);
    clearBtn.addEventListener('click', () => {
      setValue('');
      afterChange(null);
      if (modal) modal.close();
    });
    uploadBtn.addEventListener('click', async () => {
      const file = uploadInput.files && uploadInput.files[0];
      if (!file) {
        notify('Choose an image file first', true);
        return;
      }
      try {
        uploadBtn.disabled = true;
        const asset = await uploadHandler(file);
        notify('Image uploaded');
        if (asset?.id) {
          setValue(String(asset.id));
          afterChange(asset);
        }
        renderGrid();
        if (modal) modal.close();
      } catch (err) {
        notify(err.message || 'Could not upload image', true);
      } finally {
        uploadBtn.disabled = false;
      }
    });

    modal = App.components.Modal({
      title: `Choose ${config.title}`,
      body,
      dialogClass: ['develop-theme-picker-modal', extraDialogClass].filter(Boolean).join(' '),
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: options.anchor || 'upper-right',
      transparentBackdrop: options.transparentBackdrop !== false,
    });
    if (backdropClass && modal?.el) {
      modal.el.classList.add(backdropClass);
    }
    renderGrid();
    modal.open();
    return modal;
  }

  function applyDevelopNestedModalPresentation(modal, options = {}) {
    if (!modal?.el) return modal;
    const anchor = safeText(options.anchor) || 'upper-right';
    const transparentBackdrop = options.transparentBackdrop !== false;
    modal.el.classList.add('develop-nested-modal-backdrop');
    if (transparentBackdrop) {
      modal.el.classList.add('develop-nested-modal-backdrop--transparent');
    }
    if (anchor === 'upper-right') {
      modal.el.classList.add('develop-nested-modal-backdrop--upper-right');
    }
    const dialog = modal.el.querySelector('.c-modal__dialog');
    if (dialog) {
      dialog.classList.add('develop-nested-modal-dialog');
      if (anchor === 'upper-right') {
        dialog.classList.add('develop-nested-modal-dialog--upper-right');
      }
    }
    return modal;
  }

  function openThemeAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderThemeAssetPickerDisplay(selectId);
        renderThemesPreview();
      },
      uploadHandler: (file) => uploadThemeAssetFile(file, selectId).then((asset) => {
        renderThemeAssetSelect(selectId, String(asset.id), 'None');
        renderThemesTable();
        renderThemesPreview();
        return asset;
      }),
    });
  }

  function openLandingAssetPicker(selectId) {
    openImageAssetPicker(selectId, {
      afterChange: () => {
        renderLandingAssetPickerDisplay(selectId);
        updateLandingPageFieldOutlines();
      },
      uploadHandler: (file) => uploadLandingAssetFile(file, selectId),
    });
  }

  function getVideoAssets() {
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => safeText(asset?.assetType) === 'Video');
  }

  function openSavedFormPicker(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const title = safeText(options.title) || 'Saved Form';
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const list = document.createElement('div');
    list.className = 'develop-theme-picker-grid develop-theme-picker-grid--unknown';
    body.appendChild(list);
    let modal = null;

    const renderList = () => {
      list.innerHTML = '';
      const forms = Array.isArray(savedForms) ? savedForms.slice() : [];
      if (!forms.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No saved forms available.';
        list.appendChild(empty);
        return;
      }
      forms.forEach((form) => {
        const card = document.createElement('div');
        card.className = `develop-theme-picker-card${safeText(getValue()) === safeText(form.id) ? ' is-selected' : ''}`;
        const fieldCount = Array.isArray(form?.fields) ? form.fields.length : 0;
        card.innerHTML = `
          <div class="develop-theme-picker-card-title">${escapeHtml(safeText(form?.name) || safeText(form?.id) || 'Saved Form')}</div>
          <div class="develop-theme-picker-card-meta">${escapeHtml(safeText(form?.formType) || 'Form')} · ${fieldCount} fields</div>
          <div class="develop-theme-picker-card-actions">
            <button type="button" class="tiny-btn develop-theme-picker-select-btn">Use Form</button>
          </div>
        `;
        card.querySelector('.develop-theme-picker-select-btn')?.addEventListener('click', () => {
          setValue(safeText(form.id));
          afterChange(form);
          modal?.close();
        });
        list.appendChild(card);
      });
    };

    modal = App.components.Modal({
      title: `Choose ${title}`,
      body,
      dialogClass: 'develop-theme-picker-modal develop-module-image-picker-modal',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderList();
    modal.open();
    return modal;
  }

  function openVideoAssetPicker(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const title = safeText(options.title) || 'Video';
    const body = document.createElement('div');
    body.className = 'develop-theme-picker-body';
    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Search videos by name, category, or tag';
    const list = document.createElement('div');
    list.className = 'develop-theme-picker-grid develop-theme-picker-grid--wide';
    body.appendChild(filterInput);
    body.appendChild(list);
    let modal = null;

    const renderList = () => {
      const filter = safeText(filterInput.value).toLowerCase();
      const videos = getVideoAssets().filter((asset) => {
        if (!filter) return true;
        const haystack = [
          safeText(assetLabel(asset, 'Video')),
          safeText(asset?.category),
          safeText(asset?.assetName),
          safeText(asset?.location),
          getAssetTagText(asset),
        ].join(' ').toLowerCase();
        return haystack.includes(filter);
      });
      list.innerHTML = '';
      if (!videos.length) {
        const empty = document.createElement('div');
        empty.className = 'meta';
        empty.textContent = 'No matching videos found.';
        list.appendChild(empty);
        return;
      }
      videos.forEach((asset) => {
        const card = document.createElement('div');
        card.className = `develop-theme-picker-card${safeText(getValue()) === safeText(asset.id) ? ' is-selected' : ''}`;
        card.innerHTML = `
          <div class="develop-theme-picker-card-title">${escapeHtml(assetLabel(asset, title))}</div>
          <div class="develop-theme-picker-card-meta">${escapeHtml(safeText(asset.category) || 'Video')}</div>
          <div class="develop-theme-picker-card-actions">
            <button type="button" class="tiny-btn develop-theme-picker-select-btn">Use Video</button>
          </div>
        `;
        card.querySelector('.develop-theme-picker-select-btn')?.addEventListener('click', () => {
          setValue(safeText(asset.id));
          afterChange(asset);
          modal?.close();
        });
        list.appendChild(card);
      });
    };

    filterInput.addEventListener('input', renderList);
    modal = App.components.Modal({
      title: `Choose ${title}`,
      body,
      dialogClass: 'develop-theme-picker-modal develop-module-image-picker-modal',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderList();
    modal.open();
    return modal;
  }

  function normalizeDevelopTableContents(rawValue, columnsCount = 3, rowsCount = 4) {
    const cols = Math.max(1, Math.min(8, Number(columnsCount) || 1));
    const rows = Math.max(1, Math.min(20, Number(rowsCount) || 1));
    let parsed = rawValue;
    if (typeof parsed === 'string') {
      try {
        parsed = parsed ? JSON.parse(parsed) : [];
      } catch (_) {
        parsed = [];
      }
    }
    const source = Array.isArray(parsed) ? parsed : [];
    const byKey = new Map();
    source.forEach((cell) => {
      const row = Number(cell?.row);
      const column = Number(cell?.column);
      if (row >= 0 && column >= 0) {
        byKey.set(`${row}:${column}`, {
          row,
          column,
          cellType: ['empty', 'heading', 'text', 'image', 'video'].includes(safeText(cell?.cellType)) ? safeText(cell.cellType) : 'empty',
          headingLevel: safeText(cell?.headingLevel) || 'H3',
          text: safeText(cell?.text, 20000),
          imageAssetId: safeText(cell?.imageAssetId),
          videoAssetId: safeText(cell?.videoAssetId),
        });
      }
    });
    const cells = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < cols; column += 1) {
        const key = `${row}:${column}`;
        cells.push(byKey.get(key) || {
          row,
          column,
          cellType: 'empty',
          headingLevel: 'H3',
          text: '',
          imageAssetId: '',
          videoAssetId: '',
        });
      }
    }
    return cells;
  }

  function getDevelopTableContentsSummary(rawValue, columnsCount = 3, rowsCount = 4) {
    const cells = normalizeDevelopTableContents(rawValue, columnsCount, rowsCount);
    const configuredCount = cells.filter((cell) => safeText(cell?.cellType) !== 'empty').length;
    return `${rowsCount} x ${columnsCount} table · ${configuredCount} configured cell${configuredCount === 1 ? '' : 's'}`;
  }

  function openDevelopTableContentsEditor(options = {}) {
    if (!App.components || typeof App.components.Modal !== 'function') return false;
    const getValue = typeof options.getValue === 'function' ? options.getValue : (() => '[]');
    const setValue = typeof options.setValue === 'function' ? options.setValue : (() => {});
    const afterChange = typeof options.afterChange === 'function' ? options.afterChange : (() => {});
    const getDimensions = typeof options.getDimensions === 'function'
      ? options.getDimensions
      : (() => ({ columnsCount: 3, rowsCount: 4 }));
    const title = safeText(options.title) || 'Table Contents';
    const body = document.createElement('div');
    body.className = 'stack-form';
    const summary = document.createElement('div');
    summary.className = 'meta';
    const grid = document.createElement('div');
    grid.className = 'grid-form';
    body.appendChild(summary);
    body.appendChild(grid);
    let modal = null;
    let cells = [];

    const buildImageChooser = (targetCell, host) => {
      const controls = document.createElement('div');
      controls.className = 'develop-inline-asset-nav';
      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      const status = document.createElement('span');
      status.className = 'develop-inline-asset-status';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Clear';
      const updateState = () => {
        const asset = getAssetById(targetCell.imageAssetId);
        chooseBtn.textContent = asset ? 'Change Image' : 'Choose Image';
        status.textContent = asset ? assetLabel(asset, 'Image') : 'No image selected';
      };
      chooseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openImageAssetPicker(
          { selectId: '', title: 'Table Cell Image' },
          {
            dialogClass: 'develop-module-image-picker-modal',
            backdropClass: 'develop-module-image-picker-backdrop',
            getValue: () => safeText(targetCell.imageAssetId),
            setValue: (nextValue) => {
              targetCell.imageAssetId = safeText(nextValue);
            },
            afterChange: () => {
              updateState();
            },
          }
        );
      });
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        targetCell.imageAssetId = '';
        updateState();
      });
      controls.appendChild(chooseBtn);
      controls.appendChild(status);
      controls.appendChild(clearBtn);
      host.appendChild(controls);
      updateState();
    };

    const buildVideoChooser = (targetCell, host) => {
      const controls = document.createElement('div');
      controls.className = 'develop-inline-asset-nav';
      const chooseBtn = document.createElement('button');
      chooseBtn.type = 'button';
      const status = document.createElement('span');
      status.className = 'develop-inline-asset-status';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = 'Clear';
      const updateState = () => {
        const asset = getAssetById(targetCell.videoAssetId);
        chooseBtn.textContent = asset ? 'Change Video' : 'Choose Video';
        status.textContent = asset ? assetLabel(asset, 'Video') : 'No video selected';
      };
      chooseBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openVideoAssetPicker({
          title: 'Table Cell Video',
          getValue: () => safeText(targetCell.videoAssetId),
          setValue: (nextValue) => {
            targetCell.videoAssetId = safeText(nextValue);
          },
          afterChange: () => {
            updateState();
          },
        });
      });
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        targetCell.videoAssetId = '';
        updateState();
      });
      controls.appendChild(chooseBtn);
      controls.appendChild(status);
      controls.appendChild(clearBtn);
      host.appendChild(controls);
      updateState();
    };

    const renderGrid = () => {
      const { columnsCount, rowsCount } = getDimensions();
      cells = normalizeDevelopTableContents(getValue(), columnsCount, rowsCount);
      summary.textContent = getDevelopTableContentsSummary(cells, columnsCount, rowsCount);
      grid.innerHTML = '';
      cells.forEach((cell) => {
        const card = document.createElement('div');
        card.className = 'stack-form';
        card.style.padding = '0.85rem';
        card.style.border = '1px solid #c7d8eb';
        card.style.borderRadius = '14px';
        card.style.background = '#f8fbff';
        const titleNode = document.createElement('strong');
        titleNode.textContent = `Cell ${cell.row + 1}, ${cell.column + 1}`;
        card.appendChild(titleNode);

        const typeWrap = document.createElement('label');
        typeWrap.className = 'stack-form';
        typeWrap.innerHTML = '<span>Content Type</span>';
        const typeSelect = document.createElement('select');
        [
          ['empty', 'Empty'],
          ['heading', 'Heading'],
          ['text', 'Text'],
          ['image', 'Image'],
          ['video', 'Video'],
        ].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          typeSelect.appendChild(option);
        });
        typeSelect.value = safeText(cell.cellType) || 'empty';
        typeWrap.appendChild(typeSelect);
        card.appendChild(typeWrap);

        const detailHost = document.createElement('div');
        detailHost.className = 'stack-form';
        card.appendChild(detailHost);

        const renderDetails = () => {
          detailHost.innerHTML = '';
          cell.cellType = safeText(typeSelect.value) || 'empty';
          if (cell.cellType === 'heading') {
            const levelWrap = document.createElement('label');
            levelWrap.className = 'stack-form';
            levelWrap.innerHTML = '<span>Heading Level</span>';
            const levelSelect = document.createElement('select');
            ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'].forEach((item) => {
              const option = document.createElement('option');
              option.value = item;
              option.textContent = item;
              levelSelect.appendChild(option);
            });
            levelSelect.value = safeText(cell.headingLevel) || 'H3';
            levelSelect.addEventListener('change', () => {
              cell.headingLevel = safeText(levelSelect.value) || 'H3';
            });
            levelWrap.appendChild(levelSelect);
            const textWrap = document.createElement('label');
            textWrap.className = 'stack-form';
            textWrap.innerHTML = '<span>Text</span>';
            const input = document.createElement('input');
            input.type = 'text';
            input.value = safeText(cell.text, 2000);
            input.placeholder = 'Heading text';
            input.addEventListener('input', () => {
              cell.text = safeText(input.value, 2000);
            });
            textWrap.appendChild(input);
            detailHost.appendChild(levelWrap);
            detailHost.appendChild(textWrap);
            return;
          }
          if (cell.cellType === 'text') {
            const textWrap = document.createElement('label');
            textWrap.className = 'stack-form';
            textWrap.innerHTML = '<span>Text</span>';
            const input = document.createElement('textarea');
            input.rows = 4;
            input.value = safeText(cell.text, 10000);
            input.placeholder = 'Cell text';
            input.addEventListener('input', () => {
              cell.text = safeText(input.value, 10000);
            });
            textWrap.appendChild(input);
            detailHost.appendChild(textWrap);
            return;
          }
          if (cell.cellType === 'image') {
            buildImageChooser(cell, detailHost);
            return;
          }
          if (cell.cellType === 'video') {
            buildVideoChooser(cell, detailHost);
          }
        };

        typeSelect.addEventListener('change', renderDetails);
        renderDetails();
        grid.appendChild(card);
      });
    };

    modal = App.components.Modal({
      title,
      body,
      actions: [
        { label: 'Cancel', onClick: () => modal.close() },
        {
          label: 'Save Contents',
          onClick: () => {
            setValue(JSON.stringify(cells));
            afterChange(cells);
            modal.close();
          },
        },
      ],
      dialogClass: 'develop-module-image-picker-modal develop-table-contents-modal',
      bodyClass: 'develop-email-template-modal-body',
    });
    applyDevelopNestedModalPresentation(modal, {
      anchor: 'upper-right',
      transparentBackdrop: true,
    });
    renderGrid();
    modal.open();
    return modal;
  }

  function buildThemePayload() {
    return {
      name: safeText(byId('developThemesNameInput')?.value),
      primaryColor: safeText(byId('developThemesPrimaryColorInput')?.value) || DEFAULT_LANDING_PRIMARY,
      backgroundColor: safeText(byId('developThemesBackgroundColorInput')?.value) || DEFAULT_LANDING_BACKGROUND,
      accentColor: safeText(byId('developThemesAccentColorInput')?.value) || DEFAULT_LANDING_ACCENT,
      borderThickness: Number(byId('developThemesBorderThicknessInput')?.value || 1) || 1,
      borderRadius: Number(byId('developThemesBorderRadiusInput')?.value || 12) || 12,
      containerBlur: Number(byId('developThemesContainerBlurInput')?.value || 0) || 0,
      contrastLevel: Number(byId('developThemesContrastLevelInput')?.value || 0) || 0,
      logoWideId: safeText(byId('developThemesLogoWideSelect')?.value),
      logoSquareId: safeText(byId('developThemesLogoSquareSelect')?.value),
      featureImageId: safeText(byId('developThemesFeatureImageSelect')?.value),
      backgroundImageId: safeText(byId('developThemesBackgroundImageSelect')?.value),
    };
  }

  function syncThemeRangeLabels() {
    const pairs = [
      ['developThemesBorderThicknessInput', 'developThemesBorderThicknessValue'],
      ['developThemesBorderRadiusInput', 'developThemesBorderRadiusValue'],
      ['developThemesContainerBlurInput', 'developThemesContainerBlurValue'],
      ['developThemesContrastLevelInput', 'developThemesContrastLevelValue'],
    ];
    pairs.forEach(([inputId, outputId]) => {
      const input = byId(inputId);
      const output = byId(outputId);
      if (!input || !output) return;
      output.textContent = String(input.value || '0');
    });
  }

  function resetThemeBuilder() {
    selectedThemeId = '';
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = '';
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = '';
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = '1';
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = '12';
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = '0';
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = '0';
    renderThemeAssetSelect('developThemesLogoWideSelect', '', 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', '', 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', '', 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', '', 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function applyThemeToBuilder(theme) {
    if (!theme) {
      resetThemeBuilder();
      return;
    }
    selectedThemeId = String(theme.id || '');
    if (byId('developThemesThemeSelect')) byId('developThemesThemeSelect').value = selectedThemeId;
    if (byId('developThemesNameInput')) byId('developThemesNameInput').value = safeText(theme.name);
    if (byId('developThemesPrimaryColorInput')) byId('developThemesPrimaryColorInput').value = safeText(theme.primaryColor) || DEFAULT_LANDING_PRIMARY;
    if (byId('developThemesBackgroundColorInput')) byId('developThemesBackgroundColorInput').value = safeText(theme.backgroundColor) || DEFAULT_LANDING_BACKGROUND;
    if (byId('developThemesAccentColorInput')) byId('developThemesAccentColorInput').value = safeText(theme.accentColor) || DEFAULT_LANDING_ACCENT;
    if (byId('developThemesBorderThicknessInput')) byId('developThemesBorderThicknessInput').value = String(theme.borderThickness ?? 1);
    if (byId('developThemesBorderRadiusInput')) byId('developThemesBorderRadiusInput').value = String(theme.borderRadius ?? 12);
    if (byId('developThemesContainerBlurInput')) byId('developThemesContainerBlurInput').value = String(theme.containerBlur ?? 0);
    if (byId('developThemesContrastLevelInput')) byId('developThemesContrastLevelInput').value = String(theme.contrastLevel ?? 0);
    renderThemeAssetSelect('developThemesLogoWideSelect', safeText(theme.logoWideId), 'None');
    renderThemeAssetSelect('developThemesLogoSquareSelect', safeText(theme.logoSquareId), 'None');
    renderThemeAssetSelect('developThemesFeatureImageSelect', safeText(theme.featureImageId), 'None');
    renderThemeAssetSelect('developThemesBackgroundImageSelect', safeText(theme.backgroundImageId), 'None');
    syncThemeRangeLabels();
    setThemeStatus('');
    renderThemesPreview();
  }

  function syncThemesBuilder() {
    setSelectOptions(
      byId('developThemesThemeSelect'),
      savedThemes.map((theme) => ({ value: String(theme.id), label: safeText(theme.name) || `Theme ${theme.id}` })),
      'Select Theme',
      selectedThemeId
    );
    const current = getThemeById(selectedThemeId);
    if (current) applyThemeToBuilder(current);
    else resetThemeBuilder();
  }

  function getThemeAssetLabel(id, fallback = '-') {
    const cleanId = safeText(id);
    if (!cleanId) return fallback;
    const asset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === cleanId);
    return assetLabel(asset, fallback);
  }

  function renderThemePaletteSwatches(theme) {
    const colors = [
      { label: 'Primary', value: safeText(theme?.primaryColor) },
      { label: 'Background', value: safeText(theme?.backgroundColor) },
      { label: 'Accent', value: safeText(theme?.accentColor) },
    ].filter((item) => item.value);
    if (!colors.length) return '-';
    return `
      <div class="develop-theme-palette-cell">
        ${colors.map((item) => `
          <span class="develop-theme-palette-chip" title="${item.label}: ${item.value}">
            <span class="develop-theme-palette-dot" style="background:${item.value};"></span>
            <span>${item.value}</span>
          </span>
        `).join('')}
      </div>
    `;
  }

  function renderThemeStyleGlyph(theme) {
    const borderThickness = Math.max(0, Number(theme?.borderThickness || 0) || 0);
    const borderRadius = Math.max(0, Number(theme?.borderRadius || 0) || 0);
    const scaledRadius = Math.min(14, Math.round(borderRadius / 4));
    const borderWidth = borderThickness > 0 ? 1 : 0;
    return `
      <div class="develop-theme-style-cell">
        <span class="develop-theme-style-glyph" style="border-width:${borderWidth}px;border-radius:${scaledRadius}px;"></span>
        <span>B:${borderThickness} R:${borderRadius} Blur:${theme?.containerBlur ?? 0} C:${theme?.contrastLevel ?? 0}</span>
      </div>
    `;
  }

  function getThemePreviewMessagingContent() {
    const headlineRows = Array.isArray(landingPageHeadlines) ? landingPageHeadlines : [];
    const subheadingRows = Array.isArray(landingPageSubheadings) ? landingPageSubheadings : [];
    const pitchRows = Array.isArray(landingPagePitches) ? landingPagePitches : [];
    const ctaRows = Array.isArray(landingPageCtas) ? landingPageCtas : [];
    return {
      heroHeadline: safeText(headlineRows[0]?.headline) || 'Messaging headline preview',
      heroPitch: safeText(pitchRows[0]?.pitch) || 'Use real Headlines, Pitches, and Calls to Action from this project to preview a landing page theme in context.',
      primaryCta: safeText(ctaRows[0]?.cta) || 'Primary CTA',
      secondaryCta: safeText(ctaRows[1]?.cta || ctaRows[0]?.cta) || 'Secondary CTA',
      featureHeadline: safeText(headlineRows[1]?.headline || headlineRows[0]?.headline) || 'Feature headline',
      featureSubheading: safeText(subheadingRows[0]?.subheading) || 'Feature sub-heading from Messaging',
      highlightHeadline: safeText(headlineRows[2]?.headline || headlineRows[0]?.headline) || 'Highlight headline',
      highlightPitch: safeText(pitchRows[1]?.pitch || pitchRows[0]?.pitch) || 'Highlight support copy from Messaging Pitches.',
      bodyHeadline: safeText(headlineRows[3]?.headline || headlineRows[0]?.headline) || 'Body headline',
      bodySubheading: safeText(subheadingRows[1]?.subheading || subheadingRows[0]?.subheading) || 'Body sub-heading',
      bodyPitch: safeText(pitchRows[2]?.pitch || pitchRows[0]?.pitch) || 'Body pitch content appears here using project-scoped Messaging records.',
    };
  }

  function renderThemesPreview() {
    const host = byId('developThemesPreviewHost');
    if (!host) return;
    const payload = buildThemePayload();
    const content = getThemePreviewMessagingContent();
    const logoWideAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoWideId));
    const logoSquareAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.logoSquareId));
    const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.featureImageId));
    const backgroundAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(payload.backgroundImageId));
    const logoWideUrl = logoWideAsset ? toDirectAssetUrl(logoWideAsset.location) : '';
    const logoSquareUrl = logoSquareAsset ? toDirectAssetUrl(logoSquareAsset.location) : '';
    const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
    const backgroundUrl = backgroundAsset ? toDirectAssetUrl(backgroundAsset.location) : '';
    host.innerHTML = `
      <div class="develop-themes-preview-frame" style="${backgroundUrl ? `background-image:linear-gradient(rgba(7,33,66,0.18), rgba(7,33,66,0.18)), url('${backgroundUrl}');` : `background:${payload.backgroundColor};`}">
        <div class="develop-themes-preview-card" style="background:${payload.backgroundColor}; border:${payload.borderThickness}px solid ${payload.accentColor}; border-radius:${payload.borderRadius}px; backdrop-filter:blur(${payload.containerBlur}px);">
          <div class="develop-themes-preview-header">
            <div class="develop-themes-preview-brand">
              ${logoWideUrl ? `<img class="develop-themes-preview-logo-wide" src="${logoWideUrl}" alt="Wide logo" />` : `<div class="develop-themes-preview-logo-fallback" style="color:${payload.primaryColor};">${safeText(payload.name) || 'Theme Brand'}</div>`}
              <div class="develop-themes-preview-eyebrow" style="color:${payload.accentColor};">Landing Page Theme</div>
            </div>
            ${logoSquareUrl ? `<img class="develop-themes-preview-logo-square" src="${logoSquareUrl}" alt="Square logo" />` : ''}
          </div>
          <div class="develop-themes-preview-hero">
            <div class="develop-themes-preview-copy">
              <div class="develop-themes-preview-kicker" style="color:${payload.accentColor};">${safeText(payload.name) || 'Untitled Theme'}</div>
              <h4 style="color:${payload.primaryColor};">${content.heroHeadline}</h4>
              <p>${content.heroPitch}</p>
              <div class="develop-themes-preview-actions">
                <button type="button" style="background:${payload.primaryColor}; border-color:${payload.primaryColor};">${content.primaryCta}</button>
                <button type="button" style="border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor}; color:${payload.accentColor}; background:transparent;">${content.secondaryCta}</button>
              </div>
            </div>
            <div class="develop-themes-preview-feature" style="border-radius:${payload.borderRadius}px;">
              ${featureUrl ? `<img src="${featureUrl}" alt="Feature" />` : '<div class="develop-themes-preview-feature-placeholder">Feature Image</div>'}
            </div>
          </div>
          <div class="develop-themes-preview-modules">
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.featureHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.featureSubheading}</p>
            </article>
            <article class="develop-themes-preview-module">
              <h5 style="color:${payload.primaryColor};">${content.highlightHeadline}</h5>
              <p>${content.highlightPitch}</p>
            </article>
          </div>
          <div class="develop-themes-preview-body">
            <div class="develop-themes-preview-body-copy">
              <h5 style="color:${payload.primaryColor};">${content.bodyHeadline}</h5>
              <p class="develop-themes-preview-module-subheading">${content.bodySubheading}</p>
              <p>${content.bodyPitch}</p>
            </div>
            <div class="develop-themes-preview-body-side" style="border-radius:${payload.borderRadius}px; border:${Math.max(1, payload.borderThickness)}px solid ${payload.accentColor};">
              <span style="color:${payload.accentColor};">${content.secondaryCta}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderThemesInventory() {
    const tbody = byId('developThemesInventoryBody');
    const list = byId('developThemesConsolidationList');
    if (tbody) {
      tbody.innerHTML = `
        <tr><td>Palette</td><td>Primary / Background / Accent</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Container Styles</td><td>Border, Radius, Blur, Contrast</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
        <tr><td>Image Assets</td><td>Logo Wide, Logo Square, Feature, Background</td><td>Supabase Theme Record</td><td>Shared theme builder</td></tr>
      `;
    }
    if (list) {
      list.innerHTML = `
        <li>Use Builder: Themes as the shared visual source of truth for campaigns and pages.</li>
        <li>Keep asset-driven visual references attached to each theme record.</li>
      `;
    }
  }

  function buildThemeActions(theme) {
    const wrap = document.createElement('div');
    wrap.className = 'page-heading-actions';
    wrap.style.justifyContent = 'flex-start';
    wrap.appendChild(App.makeIconButton('edit', 'Edit Theme', () => {
      setThemesBuilderVisible(true);
      applyThemeToBuilder(theme);
      const panel = byId('developThemesBuilderPanel');
      if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    wrap.appendChild(App.makeIconButton('delete', 'Delete Theme', async () => {
      if (!window.confirm(`Delete theme "${safeText(theme.name) || theme.id}"?`)) return;
      try {
        await api(`/api/develop/themes/${encodeURIComponent(theme.id)}`, { method: 'DELETE' });
        if (String(selectedThemeId) === String(theme.id)) selectedThemeId = '';
        await refresh();
        notify('Theme deleted');
      } catch (err) {
        notify(err.message || 'Could not delete theme', true);
      }
    }, { danger: true, marginLeft: '8px' }));
    return wrap;
  }

  function renderThemesTable() {
    const tbody = byId('developThemesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!savedThemes.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 6;
      cell.textContent = 'No saved themes yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }
    savedThemes.forEach((theme) => {
      const tr = document.createElement('tr');
      const featureTd = document.createElement('td');
      featureTd.className = 'develop-theme-table-thumb';
      const featureAsset = (Array.isArray(state.assets) ? state.assets : []).find((item) => String(item.id) === safeText(theme.featureImageId));
      const featureUrl = featureAsset ? toDirectAssetUrl(featureAsset.location) : '';
      featureTd.innerHTML = featureUrl ? `<img src="${featureUrl}" alt="Feature image" />` : '<div class="develop-theme-table-thumb-empty">None</div>';
      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(theme.name) || '-';
      const paletteTd = document.createElement('td');
      paletteTd.innerHTML = renderThemePaletteSwatches(theme);
      const stylesTd = document.createElement('td');
      stylesTd.innerHTML = renderThemeStyleGlyph(theme);
      const updatedTd = document.createElement('td');
      updatedTd.textContent = theme.updatedAt ? new Date(theme.updatedAt).toLocaleString() : '-';
      const actionsTd = document.createElement('td');
      actionsTd.appendChild(buildThemeActions(theme));
      tr.appendChild(featureTd);
      tr.appendChild(nameTd);
      tr.appendChild(paletteTd);
      tr.appendChild(stylesTd);
      tr.appendChild(updatedTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
  }

  function getAssetsByCategory(category) {
    return (Array.isArray(state.assets) ? state.assets : []).filter(
      (asset) => safeText(asset?.category) === safeText(category)
    );
  }

  function getAssetsByCategoryAliases(categories, assetType) {
    const allowedCategories = new Set(
      (Array.isArray(categories) ? categories : [])
        .map((item) => safeText(item))
        .filter(Boolean)
    );
    const normalizedType = safeText(assetType);
    return (Array.isArray(state.assets) ? state.assets : []).filter((asset) => {
      if (normalizedType && safeText(asset?.assetType) !== normalizedType) return false;
      return allowedCategories.has(safeText(asset?.category));
    });
  }

  async function submitToolJob(toolName, input, workspaceId, requestPreviewEl, responsePreviewEl, successMessage) {
    const request = {
      manual_confirmed: true,
      type:             'tool.run',
      workspace_id:     safeText(workspaceId) || 'alphire-main',
      requested_by:     { user_id: 'alphire-ui', email: 'ops@alphire.ai' },
      payload:          { tool_name: safeText(toolName), input },
      policy:           { requires_manual_approval: true }
    };
    setPreview(requestPreviewEl, { action: 'create_job', request });
    const result = await api('/api/openclaw/create_job', { method: 'POST', body: JSON.stringify(request) });
    setPreview(responsePreviewEl, result);
    notify(successMessage);
    return result;
  }

  function renderIconBuilderResult(icon) {
    if (!els.iconBuilderResultCard || !els.iconBuilderResultImage) return;
    const hasIcon = Boolean(icon?.dataUrl);
    els.iconBuilderResultCard.classList.toggle('hidden', !hasIcon);
    if (!hasIcon) {
      els.iconBuilderResultImage.removeAttribute('src');
      if (els.iconBuilderResultTitle) els.iconBuilderResultTitle.textContent = 'Generated Icon';
      if (els.iconBuilderResultCaption) els.iconBuilderResultCaption.textContent = '';
      return;
    }
    els.iconBuilderResultImage.src = String(icon.dataUrl);
    if (els.iconBuilderResultTitle) {
      els.iconBuilderResultTitle.textContent = safeText(icon.objectName) || 'Generated Icon';
    }
    if (els.iconBuilderResultCaption) {
      const bits = [safeText(icon.objectType), safeText(icon.visualStyle), safeText(icon.size)].filter(Boolean);
      els.iconBuilderResultCaption.textContent = bits.join(' | ');
    }
  }

  function renderScreenshotResult(asset) {
    const card = byId('developScreenshotResultCard');
    const image = byId('developScreenshotResultImage');
    const title = byId('developScreenshotResultTitle');
    const caption = byId('developScreenshotResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Captured Screenshot';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Captured Screenshot';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailResult(asset) {
    const card = byId('developThumbnailResultCard');
    const image = byId('developThumbnailResultImage');
    const title = byId('developThumbnailResultTitle');
    const caption = byId('developThumbnailResultCaption');
    const hasAsset = Boolean(asset && safeText(asset.location));
    if (card) card.classList.toggle('hidden', !hasAsset);
    if (!image) return;
    if (!hasAsset) {
      image.removeAttribute('src');
      if (title) title.textContent = 'Generated Thumbnail';
      if (caption) caption.textContent = '';
      return;
    }
    image.src = safeText(asset.location);
    if (title) title.textContent = safeText(asset.assetName) || 'Generated Thumbnail';
    if (caption) {
      const bits = [safeText(asset.assetType), safeText(asset.category), asset.imageWidth && asset.imageHeight ? `${asset.imageWidth}x${asset.imageHeight}` : '']
        .filter(Boolean);
      caption.textContent = bits.join(' | ');
    }
  }

  function renderThumbnailSourceAssetOptions() {
    const select = byId('developThumbnailSourceAssetSelect');
    if (!select) return;
    const items = (Array.isArray(state.assets) ? state.assets : [])
      .slice()
      .sort((a, b) => safeText(a?.assetName).localeCompare(safeText(b?.assetName)))
      .map((asset) => ({
        value: safeText(asset.id),
        label: `${assetLabel(asset, 'Asset')} (${safeText(asset.assetType) || 'Unknown'})`,
      }));
    setSelectOptions(select, items, 'Source Asset (Optional)');
  }

  function getBaseLandingTemplateById(templateId) {
    const id = safeText(templateId);
    return LANDING_TEMPLATES.find((item) => item.id === id) || LANDING_TEMPLATES[0];
  }

  function createStarterHeaderModule(column, text, headingLevel = 'H2') {
    const module = createModularPageModule('header', column);
    module.name = safeText(text) || module.name;
    module.settings.text = safeText(text);
    module.settings.headingLevel = safeText(headingLevel) || 'H2';
    return module;
  }

  function createStarterTextBlockModule(column, content) {
    const module = createModularPageModule('textarea', column);
    module.name = safeText(content, 80) || module.name;
    module.settings.content = safeText(content)
      ? `<p>${escapeHtml(safeText(content)).replace(/\n/g, '<br />')}</p>`
      : '<p></p>';
    return module;
  }

  function createStarterFormModule(column, title) {
    const module = createModularPageModule('form', column);
    module.name = safeText(title) || module.name;
    module.settings.title = safeText(title) || module.settings.title;
    return module;
  }

  function buildStarterModularLayoutSections(baseTemplate) {
    const template = baseTemplate || LANDING_TEMPLATES[0];
    const hero = createModularPageSection('4-2');
    hero.title = safeText(template.eyebrow);
    hero.modules = [
      createStarterHeaderModule('col1', safeText(template.headline), 'H1'),
      createStarterTextBlockModule('col1', safeText(template.lead)),
      createStarterFormModule('col2', safeText(template.formTitle)),
    ];

    const features = createModularPageSection('3-3');
    features.modules = [
      createStarterHeaderModule('col1', safeText(template.featureOneTitle), 'H3'),
      createStarterTextBlockModule('col1', safeText(template.featureOneCopy)),
      createStarterHeaderModule('col2', safeText(template.featureTwoTitle), 'H3'),
      createStarterTextBlockModule('col2', safeText(template.featureTwoCopy)),
    ];

    const body = createModularPageSection('6');
    body.modules = [
      createStarterHeaderModule('col1', safeText(template.bodyTitle), 'H2'),
      createStarterTextBlockModule('col1', safeText(template.summary || template.formCopy || template.lead)),
    ];

    return [hero, features, body];
  }

  function getStarterModularPageTemplates() {
    return LANDING_TEMPLATES.map((template) => ({
      id: `starter::${safeText(template.id)}`,
      name: safeText(template.name) || 'Starter Template',
      templateKind: 'modular',
      templateId: safeText(template.id),
      isSystemTemplate: true,
      summary: safeText(template.summary),
      layoutSections: buildStarterModularLayoutSections(template),
      createdAt: '',
      updatedAt: '',
    }));
  }

  function getStarterModularPageTemplateById(templateId) {
    const id = safeText(templateId);
    return getStarterModularPageTemplates().find((item) => safeText(item.id) === id) || null;
  }

  function getSavedPageTemplateById(templateId) {
    const id = safeText(templateId);
    return savedPageTemplates.find((item) => String(item?.id) === id) || null;
  }

  function getUnifiedModularPageTemplates() {
    const saved = savedPageTemplates
      .filter((item) => normalizePageTemplateKind(item.templateKind) === 'modular')
      .map((item) => ({
        ...item,
        isSystemTemplate: false,
      }))
      .sort((a, b) => {
        const aTime = new Date(a?.updatedAt || a?.createdAt || 0).getTime() || 0;
        const bTime = new Date(b?.updatedAt || b?.createdAt || 0).getTime() || 0;
        return bTime - aTime;
      });
    return {
      saved,
      starters: getStarterModularPageTemplates(),
      all: saved.concat(getStarterModularPageTemplates()),
    };
  }

  function getUnifiedModularPageTemplateSelectOptions() {
    return getUnifiedModularPageTemplates().all.map((template) => ({
      value: String(template.id),
      label: `${template.isSystemTemplate ? 'Starter' : 'Template'}: ${safeText(template.name) || 'Untitled Template'}`,
    }));
  }

  function getTemplateById(templateId) {
    const saved = getSavedPageTemplateById(templateId);
    if (saved) return saved;
    const starter = getStarterModularPageTemplateById(templateId);
    if (starter) return starter;
    return getBaseLandingTemplateById(templateId);
  }

  function getPageTemplateSelectOptions() {
    const saved = savedPageTemplates.map((template) => ({
      value: String(template.id),
      label: `${normalizePageTemplateKind(template.templateKind) === 'modular' ? 'Modular' : 'Template'}: ${safeText(template.name) || `Template ${template.id}`}`,
    }));
    const starters = getStarterModularPageTemplates().map((template) => ({
      value: String(template.id),
      label: `Starter: ${safeText(template.name) || 'Starter Template'}`,
    }));
    const base = LANDING_TEMPLATES.map((template) => ({
      value: template.id,
      label: `Base: ${template.name}`,
    }));
    return [...saved, ...starters, ...base];
  }

  function getFormTemplateById(templateId) {
    const id = safeText(templateId);
    return FORM_TEMPLATES.find((item) => item.id === id) || FORM_TEMPLATES[0];
  }

  function buildDefaultFormState(templateId) {
    const template = getFormTemplateById(templateId);
    return {
      id: '',
      name: '',
      formType: template.id,
      contactType: 'lead',
      leadMagnetType: '',
      leadMagnetId: '',
      ctaId: '',
      heading: template.defaultHeading,
      submitLabel: template.defaultSubmitLabel,
      successMessage: 'Thanks. Your request has been received.',
      errorMessage: 'Something went wrong. Please try again.',
      accentColor: DEFAULT_FORM_ACCENT,
      matchLandingColor: false,
      landingColorMode: 'primary',
      useLandingBackground: false,
      required: Object.fromEntries(template.fields.map((field) => [field.key, Boolean(field.required)])),
    };
  }

  function ensureFormBuilderState(templateId) {
    const requestedTemplate = getFormTemplateById(templateId);
    if (!formBuilderState || formBuilderState.formType !== requestedTemplate.id) {
      formBuilderState = buildDefaultFormState(requestedTemplate.id);
    }
    return formBuilderState;
  }

  function renderFormBuilderFieldConfig() {
    const host = byId('developFormFieldsConfig');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    host.innerHTML = '';

    template.fields.forEach((field) => {
      const row = document.createElement('div');
      row.className = 'develop-form-config-row';

      const label = document.createElement('div');
      label.className = 'develop-form-config-label';
      label.textContent = field.label;

      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'checkbox-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = Boolean(current.required[field.key]);
      checkbox.addEventListener('change', () => {
        current.required[field.key] = checkbox.checked;
        renderFormBuilderPreview();
      });
      toggleWrap.appendChild(checkbox);
      toggleWrap.appendChild(document.createTextNode('Required'));

      row.appendChild(label);
      row.appendChild(toggleWrap);
      host.appendChild(row);
    });
  }

  function renderFormBuilderPreview() {
    const host = byId('developFormPreviewHost');
    if (!host) return;

    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const accentColor = current.matchLandingColor
      ? MATCH_LANDING_GREY
      : (safeText(current.accentColor) || DEFAULT_FORM_ACCENT);
    const previewBackground = current.matchLandingColor && current.useLandingBackground
      ? landingPageColors.background
      : '';

    host.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'develop-form-preview';
    card.style.borderColor = accentColor;
    card.style.boxShadow = `0 10px 22px ${accentColor}22`;
    card.style.background = previewBackground || 'linear-gradient(135deg, #ffffff 0%, #f5fbff 100%)';

    const heading = document.createElement('h3');
    heading.textContent = current.heading || template.defaultHeading;
    heading.style.color = accentColor;
    card.appendChild(heading);

    template.fields.forEach((field) => {
      const input = document.createElement('input');
      input.type = field.type;
      input.placeholder = field.label;
      if (current.required[field.key]) input.required = true;
      card.appendChild(input);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.textContent = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    submitBtn.style.background = accentColor;
    submitBtn.style.borderColor = accentColor;
    submitBtn.style.color = '#ffffff';
    card.appendChild(submitBtn);

    if (current.leadMagnetId) {
      const helper = document.createElement('p');
      helper.style.margin = '0.75rem 0 0 0';
      helper.style.fontSize = '0.84rem';
      helper.style.color = '#36516a';
      helper.textContent = `Lead Magnet: ${getLandingPageAssetName(current.leadMagnetId, 'Selected Asset')}`;
      card.appendChild(helper);
    }

    host.appendChild(card);
  }

  function buildCurrentFormPayload(nameOverride) {
    const current = ensureFormBuilderState(byId('developFormTypeSelect')?.value || FORM_TEMPLATES[0].id);
    const template = getFormTemplateById(current.formType);
    const ctaLabel = getLandingPageCtaLabel(current.ctaId) || current.submitLabel || template.defaultSubmitLabel;
    return {
      id: safeText(current.id),
      name: safeText(nameOverride || byId('developFormNameInput')?.value),
      formType: template.id,
      contactType: safeText(current.contactType) || 'lead',
      leadMagnetType: safeText(current.leadMagnetType),
      leadMagnetId: safeText(current.leadMagnetId),
      ctaId: safeText(current.ctaId),
      heading: current.heading || template.defaultHeading,
      submitLabel: ctaLabel,
      successMessage: safeText(current.successMessage),
      errorMessage: safeText(current.errorMessage),
      accentColor: safeText(current.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(current.matchLandingColor),
      landingColorMode: current.matchLandingColor ? (safeText(current.landingColorMode) || 'primary') : '',
      useLandingBackground: Boolean(current.matchLandingColor && current.useLandingBackground),
      fields: template.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: Boolean(current.required[field.key]),
      })),
    };
  }

  function formatRequiredFieldsSummary(form) {
    const requiredLabels = (Array.isArray(form?.fields) ? form.fields : [])
      .filter((field) => Boolean(field?.required))
      .map((field) => safeText(field?.label))
      .filter(Boolean);
    return requiredLabels.length ? requiredLabels.join(', ') : 'None';
  }

  function getFilteredSortedForms() {
    const rows = savedForms.slice();
    const direction = formTableState.sort.dir === 'asc' ? 1 : -1;
    const getValue = (row, key) => {
      switch (key) {
        case 'name':
          return safeText(row?.name).toLowerCase();
        case 'formType':
          return safeText(getFormTemplateById(row?.formType).name).toLowerCase();
        case 'leadMagnetType':
          return safeText(getFormLeadMagnetTypeDisplayLabel(row?.leadMagnetType)).toLowerCase();
        case 'leadMagnetId':
          return safeText(getLandingPageAssetName(row?.leadMagnetId, '')).toLowerCase();
        case 'ctaId':
          return safeText(getLandingPageCtaLabel(row?.ctaId)).toLowerCase();
        case 'contactType':
          return safeText(row?.contactType).toLowerCase();
        case 'updatedAt':
        default:
          return new Date(row?.updatedAt || row?.createdAt || 0).getTime();
      }
    };
    rows.sort((a, b) => {
      const left = getValue(a, formTableState.sort.key);
      const right = getValue(b, formTableState.sort.key);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
      return String(left).localeCompare(String(right)) * direction;
    });
    return rows;
  }

  function applySavedFormToBuilder(form) {
    const template = getFormTemplateById(form?.formType);
    const required = Object.fromEntries(template.fields.map((field) => [field.key, false]));
    (Array.isArray(form?.fields) ? form.fields : []).forEach((field) => {
      const key = safeText(field?.key);
      if (key && Object.prototype.hasOwnProperty.call(required, key)) {
        required[key] = Boolean(field?.required);
      }
    });

    formBuilderState = {
      id: safeText(form?.id),
      name: safeText(form?.name),
      formType: template.id,
      contactType: safeText(form?.contactType) || 'lead',
      leadMagnetType: safeText(form?.leadMagnetType),
      leadMagnetId: safeText(form?.leadMagnetId),
      ctaId: safeText(form?.ctaId),
      heading: safeText(form?.heading) || template.defaultHeading,
      submitLabel: safeText(form?.submitLabel) || template.defaultSubmitLabel,
      successMessage: safeText(form?.successMessage) || 'Thanks. Your request has been received.',
      errorMessage: safeText(form?.errorMessage) || 'Something went wrong. Please try again.',
      accentColor: safeText(form?.accentColor) || DEFAULT_FORM_ACCENT,
      matchLandingColor: Boolean(form?.matchLandingColor),
      landingColorMode: safeText(form?.landingColorMode) || 'primary',
      useLandingBackground: Boolean(form?.useLandingBackground),
      required,
    };

    const nameInput = byId('developFormNameInput');
    if (nameInput) nameInput.value = safeText(form?.name);
    const editorTitle = byId('developFormsEditorTitle');
    if (editorTitle) editorTitle.textContent = 'Edit Form';
    byId('developFormEditorPanel')?.classList.remove('hidden');
    syncFormBuilderInputs();
    renderFormBuilderFieldConfig();
    renderFormBuilderPreview();
  }

  function renderSavedForms() {
    const tbody = byId('developFormsTableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    if (!savedForms.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'No saved forms yet.';
      row.appendChild(cell);
      tbody.appendChild(row);
      return;
    }

    getFilteredSortedForms().forEach((form) => {
      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = safeText(form.name) || '-';

      const typeTd = document.createElement('td');
      typeTd.textContent = getFormTemplateById(form.formType).name;

      const leadMagnetTypeTd = document.createElement('td');
      leadMagnetTypeTd.textContent = getFormLeadMagnetTypeDisplayLabel(form.leadMagnetType) || '-';

      const leadMagnetTd = document.createElement('td');
      leadMagnetTd.textContent = getLandingPageAssetName(form.leadMagnetId, '-') || '-';

      const ctaTd = document.createElement('td');
      ctaTd.textContent = getLandingPageCtaLabel(form.ctaId) || '-';

      const contactTypeTd = document.createElement('td');
      contactTypeTd.textContent = CONTACT_TYPE_OPTIONS.find((item) => item.value === safeText(form.contactType))?.label || safeText(form.contactType) || '-';

      const updatedTd = document.createElement('td');
      updatedTd.textContent = form.updatedAt ? new Date(form.updatedAt).toLocaleString() : '-';

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Form', () => {
        applySavedFormToBuilder(form);
        notify(`Editing form: ${safeText(form.name) || form.id}`);
      });
      const cloneBtn = App.makeIconButton('clone', 'Clone Form', async () => {
        try {
          const payload = {
            name: safeText(form.name),
            formType: safeText(form.formType),
            contactType: safeText(form.contactType),
            leadMagnetType: safeText(form.leadMagnetType),
            leadMagnetId: safeText(form.leadMagnetId),
            ctaId: safeText(form.ctaId),
            heading: safeText(form.heading),
            submitLabel: safeText(form.submitLabel),
            successMessage: safeText(form.successMessage),
            errorMessage: safeText(form.errorMessage),
            accentColor: safeText(form.accentColor),
            matchLandingColor: Boolean(form.matchLandingColor),
            landingColorMode: safeText(form.landingColorMode),
            useLandingBackground: Boolean(form.useLandingBackground),
            fields: Array.isArray(form.fields)
              ? form.fields.map((field) => ({
                  key: safeText(field?.key),
                  label: safeText(field?.label),
                  type: safeText(field?.type),
                  required: Boolean(field?.required),
                }))
              : [],
          };
          await api('/api/develop/forms', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          await refresh();
          notify('Form cloned');
        } catch (err) {
          notify(err.message, true);
        }
      }, { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Form', async () => {
        if (!window.confirm(`Delete form "${safeText(form.name) || form.id}"?`)) return;
        try {
          await api(`/api/develop/forms/${encodeURIComponent(form.id)}`, { method: 'DELETE' });
          await refresh();
          notify('Form deleted');
        } catch (err) {
          notify(err.message, true);
        }
      }, { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);

      row.appendChild(nameTd);
      row.appendChild(typeTd);
      row.appendChild(leadMagnetTypeTd);
      row.appendChild(leadMagnetTd);
      row.appendChild(ctaTd);
      row.appendChild(contactTypeTd);
      row.appendChild(updatedTd);
      row.appendChild(actionsTd);
      tbody.appendChild(row);
    });
  }

  function resetDevelopModuleForm() {
    const idInput = byId('developModulesIdInput');
    const nameInput = byId('developModulesNameInput');
    const typeSelect = byId('developModulesTypeSelect');
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (typeSelect) typeSelect.value = 'header';
    updateDevelopModuleTypeFields();
    if (nameInput) nameInput.focus();
  }

  function getDevelopModuleTypeDefinition(type) {
    const normalized = safeText(type);
    if (normalized === 'izzy') return null;
    return MODULE_TYPE_DEFINITIONS.find((item) => item.value === normalized) || MODULE_TYPE_DEFINITIONS[0];
  }

  function getDevelopModuleStarterBlueprints() {
    return MODULE_TYPE_DEFINITIONS.map((definition) => ({
      name: definition.starterName,
      moduleType: definition.value,
      settings: { ...(definition.defaults || {}) },
    }));
  }

  function getCanonicalSavedModules(modulesInput = savedModules) {
    const seen = new Map();
    (Array.isArray(modulesInput) ? modulesInput : []).forEach((module) => {
      const typeKey = safeText(module?.moduleType).toLowerCase();
      let nameKey = safeText(module?.name).toLowerCase();
      if (typeKey === 'textarea' && nameKey === 'textarea') {
        nameKey = 'text block';
      }
      const key = `${typeKey}::${nameKey}`;
      if (!key || key === '::') return;
      const nextTime = new Date(module?.updatedAt || module?.createdAt || 0).getTime();
      const existing = seen.get(key);
      const existingTime = existing ? new Date(existing.updatedAt || existing.createdAt || 0).getTime() : -1;
      if (!existing || nextTime >= existingTime) {
        seen.set(key, module);
      }
    });
    return Array.from(seen.values()).sort((a, b) => {
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }

  function getDevelopModuleContentSourceOptions(kind) {
    const normalized = safeText(kind).toLowerCase();
    if (normalized === 'headline') {
      return landingPageHeadlines.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.headline) || safeText(item?.id) || 'Untitled headline',
        content: safeText(item?.headline, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'pitch') {
      return landingPagePitches.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.pitch) || safeText(item?.id) || 'Untitled pitch',
        content: safeText(item?.pitch, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'subheading') {
      return landingPageSubheadings.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.subheading) || safeText(item?.id) || 'Untitled sub-heading',
        content: safeText(item?.subheading, 10000),
      })).filter((item) => item.value);
    }
    if (normalized === 'cta') {
      return landingPageCtas.map((item) => ({
        value: safeText(item?.id),
        label: safeText(item?.cta) || safeText(item?.id) || 'Untitled CTA',
        content: safeText(item?.cta, 10000),
      })).filter((item) => item.value);
    }
    return [];
  }

  function applyDevelopModuleContentSelection(control, field, selectedOption) {
    if (!control || !field || !selectedOption) return;
    const nextContent = safeText(selectedOption.content, 20000);
    if (field.control === 'richtext') {
      control.innerHTML = nextContent
        ? `<p>${escapeHtml(nextContent).replace(/\n/g, '<br />')}</p>`
        : '<p></p>';
      return;
    }
    if ('value' in control) {
      control.value = nextContent;
    }
  }

  function populateDevelopModuleTypeOptions() {
    const select = byId('developModulesTypeSelect');
    if (!select) return;
    select.innerHTML = '';
    MODULE_TYPE_DEFINITIONS.forEach((definition) => {
      const option = document.createElement('option');
      option.value = definition.value;
      option.textContent = definition.label;
      select.appendChild(option);
    });
  }

  function renderDevelopModuleSettingsFieldsInto(host, type, settings = {}, options = {}) {
    if (!host) return;
    const help = options.helpNode || null;
    const prefix = safeText(options.prefix) || 'developModuleField';
    const definition = getDevelopModuleTypeDefinition(type) || MODULE_TYPE_DEFINITIONS[0];
    host.innerHTML = '';
    host.className = 'grid-form';
    if (help) {
      help.textContent = safeText(definition.description, 500);
    }

    definition.fields.forEach((field) => {
      const wrap = document.createElement('label');
      wrap.className = field.control === 'textarea' ? 'stack-form' : 'stack-form';
      if (prefix === 'developModuleField') {
        wrap.classList.add('develop-modules-studio-row');
      }
      const label = document.createElement('span');
      label.textContent = field.label;
      wrap.appendChild(label);

      const value = Object.prototype.hasOwnProperty.call(settings || {}, field.key)
        ? settings[field.key]
        : definition.defaults?.[field.key];

      let control = null;
      const contentSettingKey = safeText(field.contentSettingKey) || `${field.key}SourceId`;
      if (field.contentSource) {
        const pickerWrap = document.createElement('label');
        pickerWrap.className = 'stack-form';
        if (prefix === 'developModuleField') {
          pickerWrap.classList.add('develop-modules-studio-row');
        }
        const pickerLabel = document.createElement('span');
        pickerLabel.textContent = safeText(field.contentLabel) || 'Saved Content';
        pickerWrap.appendChild(pickerLabel);
        const picker = document.createElement('select');
        picker.id = `${prefix}_${field.key}_source`;
        picker.setAttribute('data-module-field-source-key', contentSettingKey);
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'None';
        picker.appendChild(empty);
        const contentOptions = getDevelopModuleContentSourceOptions(field.contentSource);
        contentOptions.forEach((item) => {
          const option = document.createElement('option');
          option.value = item.value;
          option.textContent = item.label;
          picker.appendChild(option);
        });
        picker.value = safeText(settings?.[contentSettingKey]);
        picker.addEventListener('change', () => {
          const selectedOption = contentOptions.find((item) => item.value === safeText(picker.value));
          if (selectedOption && control) {
            applyDevelopModuleContentSelection(control, field, selectedOption);
          }
        });
        pickerWrap.appendChild(picker);
        host.appendChild(pickerWrap);
      }

      if (field.control === 'image-asset-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const pickerConfig = {
          selectId: pickerId,
          title: safeText(field.pickerTitle) || safeText(field.label) || 'Image',
        };
        const currentAssetId = safeText(value);
        const currentAsset = getAssetById(currentAssetId);
        const currentImageUrl = currentAsset
          ? toDirectAssetUrl(currentAsset.location)
          : '';

        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentAssetId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.textContent = currentAsset ? `Change ${pickerConfig.title}` : `Choose ${pickerConfig.title}`;

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const asset = getAssetById(selectedId);
          const imageUrl = asset ? toDirectAssetUrl(asset.location) : '';
          chooseBtn.textContent = asset ? `Change ${pickerConfig.title}` : `Choose ${pickerConfig.title}`;
          status.textContent = asset ? assetLabel(asset, pickerConfig.title) : 'No image selected';
          preview.innerHTML = '';
          if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = safeText(assetLabel(asset, pickerConfig.title));
            preview.appendChild(img);
          } else {
            const empty = document.createElement('span');
            empty.textContent = 'No image selected';
            preview.appendChild(empty);
          }
        };

        chooseBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const modal = openImageAssetPicker(pickerConfig, {
            dialogClass: 'develop-module-image-picker-modal',
            backdropClass: 'develop-module-image-picker-backdrop',
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
            uploadHandler: async (file) => {
              if (!file) return null;
              if (!String(file.type || '').startsWith('image/')) {
                throw new Error('Please choose an image file');
              }
              const buffer = await file.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              const chunkSize = 0x8000;
              for (let index = 0; index < bytes.length; index += chunkSize) {
                binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
              }
              const result = await api('/api/assets/upload-google-drive', {
                method: 'POST',
                body: JSON.stringify({
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  fileBase64: btoa(binary),
                  fileSize: Number(file.size || 0),
                  assetType: 'Image',
                  assetName: file.name.replace(/\.[^.]+$/, '') || file.name,
                  category: 'Image',
                  tags: ['module', 'gallery'],
                }),
              });
              const asset = result?.asset || result?.data?.asset || null;
              if (!asset?.id) throw new Error('Image upload did not return an asset');
              state.assets = [asset].concat(Array.isArray(state.assets) ? state.assets.filter((item) => String(item.id) !== String(asset.id)) : []);
              return asset;
            },
          });
          if (!modal) {
            notify(`Could not open the image picker for ${pickerConfig.title}`, true);
          }
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'video-asset-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const currentAssetId = safeText(value);
        const currentAsset = getAssetById(currentAssetId);
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentAssetId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';
        chooseBtn.textContent = currentAsset ? `Change ${safeText(field.pickerTitle) || safeText(field.label) || 'Video'}` : `Choose ${safeText(field.pickerTitle) || safeText(field.label) || 'Video'}`;

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const asset = getAssetById(selectedId);
          chooseBtn.textContent = asset ? `Change ${safeText(field.pickerTitle) || safeText(field.label) || 'Video'}` : `Choose ${safeText(field.pickerTitle) || safeText(field.label) || 'Video'}`;
          status.textContent = asset ? assetLabel(asset, safeText(field.pickerTitle) || safeText(field.label) || 'Video') : 'No video selected';
          preview.innerHTML = '';
          const meta = document.createElement('span');
          meta.textContent = asset ? (safeText(asset.category) || 'Video asset') : 'No video selected';
          preview.appendChild(meta);
        };

        chooseBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openVideoAssetPicker({
            title: safeText(field.pickerTitle) || safeText(field.label) || 'Video',
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'saved-form-picker') {
        const pickerId = `${prefix}_${field.key}`;
        const currentFormId = safeText(value);
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = pickerId;
        control.value = currentFormId;
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const chooseBtn = document.createElement('button');
        chooseBtn.type = 'button';

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const updatePickerState = () => {
          const selectedId = safeText(control.value);
          const form = savedForms.find((item) => safeText(item.id) === selectedId) || null;
          chooseBtn.textContent = form ? `Change ${field.label}` : `Choose ${field.label}`;
          status.textContent = form ? (safeText(form.name) || safeText(form.id)) : 'No form selected';
          preview.innerHTML = '';
          const meta = document.createElement('span');
          meta.textContent = form
            ? `${safeText(form.formType) || 'Form'} · ${Array.isArray(form.fields) ? form.fields.length : 0} fields`
            : 'No form selected';
          preview.appendChild(meta);
        };

        chooseBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSavedFormPicker({
            title: field.label,
            getValue: () => safeText(control.value),
            setValue: (nextValue) => {
              control.value = safeText(nextValue);
            },
            afterChange: () => {
              updatePickerState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '';
          updatePickerState();
        });

        pickerControls.appendChild(chooseBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updatePickerState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'table-contents-editor') {
        const editorId = `${prefix}_${field.key}`;
        wrap.className = 'stack-form develop-module-image-field';

        control = document.createElement('input');
        control.type = 'hidden';
        control.id = editorId;
        control.value = typeof value === 'string' ? value : JSON.stringify(normalizeDevelopTableContents(value));
        control.setAttribute('data-module-field-key', field.key);
        control.setAttribute('data-module-field-control', field.control);

        const pickerControls = document.createElement('div');
        pickerControls.className = 'develop-inline-asset-nav';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'Edit Contents';

        const status = document.createElement('span');
        status.className = 'develop-inline-asset-status';

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';

        const preview = document.createElement('div');
        preview.className = 'develop-inline-asset-preview';

        const getDimensions = () => ({
          columnsCount: Number(byId(`${prefix}_columnsCount`)?.value) || Number(settings?.columnsCount) || 3,
          rowsCount: Number(byId(`${prefix}_rowsCount`)?.value) || Number(settings?.rowsCount) || 4,
        });

        const updateTableState = () => {
          const { columnsCount, rowsCount } = getDimensions();
          const normalized = normalizeDevelopTableContents(control.value, columnsCount, rowsCount);
          control.value = JSON.stringify(normalized);
          status.textContent = getDevelopTableContentsSummary(normalized, columnsCount, rowsCount);
          preview.innerHTML = '';
          const meta = document.createElement('span');
          const configured = normalized.filter((cell) => safeText(cell?.cellType) !== 'empty').length;
          meta.textContent = configured
            ? `${configured} cell${configured === 1 ? '' : 's'} configured`
            : 'No cell content configured yet';
          preview.appendChild(meta);
        };

        editBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openDevelopTableContentsEditor({
            title: field.label,
            getValue: () => control.value,
            setValue: (nextValue) => {
              control.value = safeText(nextValue, 500000);
            },
            getDimensions,
            afterChange: () => {
              updateTableState();
            },
          });
        });

        clearBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          control.value = '[]';
          updateTableState();
        });

        pickerControls.appendChild(editBtn);
        pickerControls.appendChild(status);
        pickerControls.appendChild(clearBtn);
        wrap.appendChild(pickerControls);
        wrap.appendChild(preview);
        wrap.appendChild(control);
        updateTableState();
        host.appendChild(wrap);
        return;
      }

      if (field.control === 'textarea') {
        control = document.createElement('textarea');
        control.rows = Number(field.rows) || 3;
        control.value = safeText(value, 10000);
      } else if (field.control === 'richtext') {
        wrap.className = 'stack-form';
        const toolbar = document.createElement('div');
        toolbar.className = 'develop-richtext-toolbar';
        const editor = document.createElement('div');
        editor.id = `${prefix}_${field.key}`;
        editor.className = 'develop-richtext-editor';
        editor.contentEditable = 'true';
        editor.setAttribute('data-module-field-key', field.key);
        editor.setAttribute('data-module-field-control', field.control);
        editor.setAttribute('data-placeholder', field.placeholder || '');
        editor.innerHTML = safeHtml(value) || '<p></p>';

        [
          { label: 'B', command: 'bold' },
          { label: 'I', command: 'italic' },
          { label: 'U', command: 'underline' },
          { label: 'UL', command: 'insertUnorderedList' },
          { label: 'OL', command: 'insertOrderedList' },
        ].forEach((tool) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'develop-richtext-tool';
          button.textContent = tool.label;
          button.addEventListener('click', (event) => {
            event.preventDefault();
            editor.focus();
            document.execCommand(tool.command, false, null);
          });
          toolbar.appendChild(button);
        });

        const linkButton = document.createElement('button');
        linkButton.type = 'button';
        linkButton.className = 'develop-richtext-tool';
        linkButton.textContent = 'Link';
        linkButton.addEventListener('click', (event) => {
          event.preventDefault();
          const href = window.prompt('Enter link URL');
          if (!href) return;
          editor.focus();
          document.execCommand('createLink', false, href);
        });
        toolbar.appendChild(linkButton);

        wrap.appendChild(toolbar);
        wrap.appendChild(editor);
        if (App.richText && typeof App.richText.createRichTextEditor === 'function') {
          App.richText.createRichTextEditor({
            element: editor,
            toolbar,
            content: safeHtml(value),
            placeholder: field.placeholder || '',
          }).catch((err) => {
            console.warn('TipTap editor failed to initialize; using fallback editor instead.', err);
          });
        }
        host.appendChild(wrap);
        return;
      } else if (field.control === 'select') {
        control = document.createElement('select');
        (field.options || []).forEach((optionValue) => {
          const option = document.createElement('option');
          option.value = String(optionValue);
          option.textContent = String(optionValue);
          control.appendChild(option);
        });
        control.value = safeText(value) || String(field.options?.[0] || '');
      } else if (field.control === 'saved-form-select') {
        control = document.createElement('select');
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = savedForms.length ? 'Choose a form' : 'No forms available yet';
        control.appendChild(empty);
        savedForms.forEach((form) => {
          const option = document.createElement('option');
          option.value = safeText(form.id);
          option.textContent = safeText(form.name) || safeText(form.id);
          control.appendChild(option);
        });
        control.value = safeText(value);
      } else if (field.control === 'color') {
        control = document.createElement('input');
        control.type = 'color';
        control.value = safeText(value) || '#173c61';
      } else if (field.control === 'number') {
        control = document.createElement('input');
        control.type = 'number';
        control.value = value === null || value === undefined || value === '' ? '' : String(value);
        if (field.min !== undefined) control.min = String(field.min);
        if (field.max !== undefined) control.max = String(field.max);
        if (field.step !== undefined) control.step = String(field.step);
      } else if (field.control === 'checkbox') {
        wrap.className = 'checkbox-row';
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = Boolean(value);
        wrap.innerHTML = '';
        wrap.appendChild(control);
        wrap.appendChild(label);
      } else {
        control = document.createElement('input');
        control.type = 'text';
        control.value = safeText(value, 10000);
      }

      control.id = `${prefix}_${field.key}`;
      control.setAttribute('data-module-field-key', field.key);
      control.setAttribute('data-module-field-control', field.control);
      if (field.placeholder && 'placeholder' in control) {
        control.placeholder = field.placeholder;
      }
      if (field.control !== 'checkbox') {
        wrap.appendChild(control);
      }
      host.appendChild(wrap);
    });
  }

  function renderDevelopModuleSettingsFields(type, settings = {}) {
    const host = byId('developModulesSettingsFields');
    const help = byId('developModulesTypeHelp');
    renderDevelopModuleSettingsFieldsInto(host, type, settings, { helpNode: help, prefix: 'developModuleField' });
  }

  function getDevelopModuleSettingsFromHost(type, options = {}) {
    const definition = getDevelopModuleTypeDefinition(type) || MODULE_TYPE_DEFINITIONS[0];
    const prefix = safeText(options.prefix) || 'developModuleField';
    const settings = {};
    definition.fields.forEach((field) => {
      const input = byId(`${prefix}_${field.key}`);
      if (!input) return;
      if (field.contentSource) {
        const contentSettingKey = safeText(field.contentSettingKey) || `${field.key}SourceId`;
        const sourceInput = byId(`${prefix}_${field.key}_source`);
        settings[contentSettingKey] = safeText(sourceInput?.value);
      }
      if (field.control === 'checkbox') {
        settings[field.key] = Boolean(input.checked);
      } else if (field.control === 'richtext') {
        settings[field.key] = App.richText && typeof App.richText.getHtml === 'function'
          ? App.richText.getHtml(input)
          : String(input.innerHTML || '').trim();
      } else if (field.control === 'number') {
        const raw = safeText(input.value);
        settings[field.key] = raw ? Number(raw) : '';
      } else {
        settings[field.key] = safeText(input.value, 10000);
      }
    });
    return settings;
  }

  function getDevelopModuleSettingsFromForm(type) {
    return getDevelopModuleSettingsFromHost(type, { prefix: 'developModuleField' });
  }

  function getDevelopModulePayloadFromForm() {
    const moduleType = safeText(byId('developModulesTypeSelect')?.value) || 'header';
    return {
      id: safeText(byId('developModulesIdInput')?.value),
      name: safeText(byId('developModulesNameInput')?.value),
      moduleType,
      settings: getDevelopModuleSettingsFromForm(moduleType),
    };
  }

  function getDevelopModulePreview(module) {
    const type = safeText(module?.moduleType);
    const settings = module?.settings || {};
    if (type === 'header') {
      return `${safeText(settings.headingLevel) || 'H1'}: ${safeText(settings.text) || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(settings.headlineId))?.label || 'No text set'}`;
    }
    if (type === 'form') {
      return `${safeText(settings.title) || getDevelopModuleContentSourceOptions('headline').find((item) => item.value === safeText(settings.headlineId))?.label || 'Form'} · ${safeText(getSavedFormName(settings.formId)) || 'No form linked'}`;
    }
    if (type === 'button') {
      const ctaLabel = getDevelopModuleContentSourceOptions('cta').find((item) => item.value === safeText(settings.ctaId))?.label || '';
      return `${safeText(settings.label) || ctaLabel || 'Button'} · ${safeText(settings.style) || 'solid'} · ${safeText(settings.linkUrl) || 'No link set'}`;
    }
    if (type === 'image') {
      const imageAsset = getAssetById(settings.imageAssetId);
      const imageLabel = imageAsset
        ? assetLabel(imageAsset, 'Image')
        : (safeText(settings.altText) || 'Image');
      return `${imageLabel} · ${safeText(settings.aspectRatio) || 'auto'} · ${safeT
```

## docs/channels_add_type_contact.sql
```sql
-- =============================================================================
-- Migration: Add `channel_type` and `contact_id` to `channels`
-- Purpose: Supports separating Organic vs Virtual channels, mapping Virtuals to VPs.
-- Date: 2026-04-19
-- =============================================================================

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS channel_type text NOT NULL DEFAULT 'organic' CHECK (channel_type IN ('organic', 'virtual')),
  ADD COLUMN IF NOT EXISTS contact_id text NULL REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_channels_contact_id ON public.channels(contact_id);

-- Down migration (optional record)
-- ALTER TABLE public.channels DROP COLUMN contact_id;
-- ALTER TABLE public.channels DROP COLUMN channel_type;

-- Failsafe to ensure all existing records lock into the default category:
UPDATE public.channels SET channel_type = 'organic' WHERE channel_type IS NULL;

```

## docs/contacts_add_contact_class.sql
```sql
-- docs/contacts_add_contact_class.sql
-- Add the new architectural dimension isolating systemic roles from pipeline stages

ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS contact_class text DEFAULT 'persona';

CREATE INDEX IF NOT EXISTS idx_contacts_contact_class 
  ON public.contacts(contact_class);

```

## docs/contacts_backfill_personality_class.sql
```sql
-- Backfill the entire contacts table to 'personality' per your request
UPDATE public.contacts 
SET contact_class = 'personality';

```

## docs/app_tables_setup.sql
```sql
-- =============================================================================
-- APP Core Tables — run this in your Supabase SQL editor
-- Replaces store.json with proper persistent Supabase tables.
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- contacts
-- The legacy MVP contact store, now in Supabase.
-- NOTE: New lead capture should use promo_leads. This table supports the
-- legacy Contacts/Segments/Campaigns pages until those are migrated (#2b).
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id          text        not null primary key,  -- keeps format "contact_<ts>_<rand>"
  email       text        not null,
  first_name  text        not null default '',
  last_name   text        not null default '',
  city        text        not null default '',
  tags        text[]      not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_contacts_email on public.contacts (email);

-- ---------------------------------------------------------------------------
-- segments
-- Saved filter definitions. Each segment stores its rules as JSONB so we
-- can add new rule types without schema changes.
-- ---------------------------------------------------------------------------
create table if not exists public.segments (
  id          text        not null primary key,
  name        text        not null,
  rules       jsonb       not null default '[]'::jsonb,
  definition  jsonb       null,                  -- social/advanced filter state
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- campaigns
-- Email campaign drafts and sent records.
-- ---------------------------------------------------------------------------
create table if not exists public.campaigns (
  id           text        not null primary key,
  name         text        not null,
  subject      text        not null,
  content      text        not null,
  segment_id   text        null references public.segments(id) on delete set null,
  status       text        not null default 'draft',
  sent_count   integer     not null default 0,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz null
);

-- ---------------------------------------------------------------------------
-- campaign_events
-- Open/click tracking per campaign per contact. Replaces store.events[].
-- ---------------------------------------------------------------------------
create table if not exists public.campaign_events (
  id          text        not null primary key,
  campaign_id text        not null references public.campaigns(id) on delete cascade,
  contact_id  text        not null,
  type        text        not null,              -- 'open' | 'click'
  created_at  timestamptz not null default now()
);

create index if not exists idx_campaign_events_campaign_id
  on public.campaign_events (campaign_id);

-- ---------------------------------------------------------------------------
-- assets
-- Reusable asset records for image/video/audio/lead magnet/screenshot.
-- ---------------------------------------------------------------------------
create table if not exists public.assets (
  id         bigint generated by default as identity primary key,
  asset_name text   not null,
  asset_type text   not null check (asset_type in ('Image', 'Video', 'Audio', 'Lead Magnet', 'File')),
  category   text   not null default '',
  location   text   not null default '',
  tags       text[] not null default '{}',
  size       bigint not null default 0,
  image_width integer null,
  image_height integer null
);

create table if not exists public.asset_categories (
  id         bigint generated by default as identity primary key,
  asset_type text        not null check (asset_type in ('Image', 'Video', 'Audio', 'Lead Magnet', 'File')),
  category   text        not null,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_asset_categories_project_type_category
  on public.asset_categories (project_id, asset_type, lower(category));

create table if not exists public.channels (
  id         bigint generated by default as identity primary key,
  channel    text        not null,
  user_name  text        not null,
  email      text        not null default '',
  password   text        not null default '',
  password_enc text      null,
  password_iv  text      null,
  password_tag text      null,
  key_version  text      null,
  channel_type text      not null default 'organic' check (channel_type in ('organic', 'virtual')),
  contact_id   text      null references public.contacts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.website_peers (
  id bigint generated by default as identity primary key,
  site_type text not null default 'peer' check (site_type in ('source', 'peer')),
  source_url text not null default '',
  source_domain text not null default '',
  site_url text not null default '',
  domain text not null default '',
  title text not null default '',
  website_model text not null default '',
  matched_keywords text[] not null default '{}',
  snippet text not null default '',
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  project_id text null,
  owner_user_id text null,
  last_harvested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_website_peers_project_id
  on public.website_peers(project_id);

create unique index if not exists idx_website_peers_project_site_scope
  on public.website_peers(project_id, site_type, source_domain, domain);

alter table public.assets
  add column if not exists size bigint not null default 0;
alter table public.assets
  add column if not exists category text not null default '';
alter table public.assets
  add column if not exists image_width integer null;
alter table public.assets
  add column if not exists image_height integer null;
alter table public.assets
  add column if not exists id bigint generated by default as identity;
alter table public.asset_categories
  disable row level security;
alter table public.channels
  add column if not exists email text not null default '';
alter table public.channels
  add column if not exists password_enc text null;
alter table public.channels
  add column if not exists password_iv text null;
alter table public.channels
  add column if not exists password_tag text null;
alter table public.channels
  add column if not exists key_version text null;
alter table public.channels
  add column if not exists channel_type text not null default 'organic' check (channel_type in ('organic', 'virtual'));
alter table public.channels
  add column if not exists contact_id text null references public.contacts(id) on delete set null;
alter table public.channels
  alter column password set default '';
alter table public.channels
  disable row level security;
  
create index if not exists idx_channels_contact_id on public.channels(contact_id);

update public.assets
set id = default
where id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assets'::regclass
      and contype = 'p'
  ) then
    alter table public.assets add primary key (id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security — disable for service role key usage (app uses service key)
-- ---------------------------------------------------------------------------
alter table public.contacts       disable row level security;
alter table public.segments       disable row level security;
alter table public.campaigns      disable row level security;
alter table public.campaign_events disable row level security;
alter table public.assets         disable row level security;

```

## docs/contact_personas_type_migration.sql
```sql
-- Migration to add robust polymorphic 'type' routing to the global custom trait schema

ALTER TABLE public.contact_personas 
ADD COLUMN type varchar(50) NOT NULL DEFAULT 'persona';

-- Create an index to optimize rapid filtered UI queries 
CREATE INDEX IF NOT EXISTS contact_personas_type_idx
  ON public.contact_personas (type);

```

