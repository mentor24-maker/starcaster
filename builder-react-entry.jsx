import React from 'react';
import { createRoot } from 'react-dom/client';
import BuilderWorkspace from './components/builder/BuilderWorkspace';

let activeRoot = null;
let activeHost = null;

function clearHost(host) {
  if (!host) return;
  host.classList.add('hidden');
  host.setAttribute('aria-hidden', 'true');
}

function showHost(host) {
  if (!host) return;
  host.classList.remove('hidden');
  host.setAttribute('aria-hidden', 'false');
}

export function mountBuilderReact(host, props) {
  if (!host) return false;
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeHost && activeHost !== host) {
    clearHost(activeHost);
  }
  activeHost = host;
  showHost(host);
  activeRoot = createRoot(host);
  activeRoot.render(<BuilderWorkspace {...props} />);
  return true;
}

export function unmountBuilderReact() {
  if (activeRoot) {
    activeRoot.unmount();
    activeRoot = null;
  }
  if (activeHost) {
    clearHost(activeHost);
    activeHost = null;
  }
}

window.BuilderReact = {
  mount: mountBuilderReact,
  unmount: unmountBuilderReact,
};
