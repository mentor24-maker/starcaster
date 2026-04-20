const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="acquireYoutubePage"></div></body></html>');
global.document = dom.window.document;

function escapeHtml(str) { return String(str); }
function safeText(str) { return String(str||''); }
function getModularModuleContentLabel(module) { return module.systemId || 'content'; }
function getModularPageLayoutMeta(layout) { return { value: layout, columns: [{id:'col1'}, {id:'col2'}] }; }
function styleObjectToCssText(obj) { return ''; }
function buildContainerStyle() { return {}; }
function buildRowStyle() { return {}; }
function buildModularPageGridTemplate() { return ''; }
function getSectionRowSettings() { return {}; }
function getSectionContainerSettings() { return {}; }
function normalizePageTemplateLayoutSections(val) { return Array.isArray(val) ? val : []; }

function buildModularPageTemplatePreviewMarkup(template) {
    const sections = normalizePageTemplateLayoutSections(template?.layoutSections);
    const renderModule = (module) => {
      const type = safeText(module.type);
      const contentLabel = escapeHtml(getModularModuleContentLabel(module));
      if (type === 'system-app') {
        const mountId = safeText(module.content || module.systemId);
        const liveMountId = `mount-${mountId}`;
        
        let projection = '';
        const liveNode = document.getElementById(liveMountId);
        if (liveNode) {
          projection = `<div class="system-app-preview-wrap">inner</div>`;
        }
        
        return `<div id="${liveMountId}">${projection}</div>`;
      }
      return `<div class="meta">${contentLabel}</div>`;
    };
    const renderColumn = (modules, className, settings) => {
      const body = modules.length
        ? modules.map(renderModule).join('')
        : '';
      return `<div class="${className}">${body}</div>`;
    };
    const markup = sections.map((section) => {
      const layout = getModularPageLayoutMeta(section.layout);
      const columnMarkup = layout.columns.map((column) => {
        const columnId = safeText(column.id) || 'col1';
        const modules = section.modules.filter((module) => safeText(module.column) === columnId);
      return renderColumn(modules, `develop-col-${columnId}`, {});
      }).join('');
      const innerBody = `<div class="develop-modular-page-columns">${columnMarkup}</div>`;
      if (section.title) {
        return `<section class="develop-sec">
          <details class="develop-template-accordion" ${!section.collapsed ? 'open' : ''}>
            <summary class="develop-template-accordion-summary">${escapeHtml(section.title)}</summary>
            <div class="develop-template-accordion-body">${innerBody}</div>
          </details>
        </section>`;
      }
      return innerBody;
    }).join('');
    return `<div class="develop-template-canvas">${markup}</div>`;
}

const payload = {
    layoutSections: [
        { layout: '1-5', title: "Research", collapsed: false, modules: [{ type: 'system-app', systemId: 'youtube-research-panel', column: 'col2' }] }
    ]
};
console.log(buildModularPageTemplatePreviewMarkup(payload));
