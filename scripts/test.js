const fs = require('fs');
const builderJs = fs.readFileSync('public/js/builder.js', 'utf8');

global.window = { App: {} };
global.App = global.window.App;
global.document = {
  createElement: () => ({ style: {} }),
  getElementById: () => null
};

eval(builderJs);

const payload = {
  layoutSections: [
    {
      layout: '3-3', title: 'Row 1', collapsed: false,
      modules: [
        { type: 'pod', column: 'col1', settings: { title: 'Web Domain' } }
      ]
    }
  ]
};

console.log(window.App.builder.buildModularPageTemplatePreviewMarkup(payload));
