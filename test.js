const t = { id: '123' };
const parserSvg = new DOMParser();
const docBtns = parserSvg.parseFromString(`
    <button class="icon-btn" onclick="App.devAgent.openTaskEditor('${t.id}')" title="Edit Task">
      <svg></svg>
    </button>
`, 'text/html');
