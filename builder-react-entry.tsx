import { createRoot, type Root } from 'react-dom/client';
import BuilderWorkspace from './components/builder/BuilderWorkspace';
import { BuilderPreviewPage } from './components/builder-preview-page';

let activeRoot: Root | null = null;
let activeHost: HTMLElement | null = null;

function clearHost(host: HTMLElement | null) {
  if (!host) return;
  host.classList.add('hidden');
  host.setAttribute('aria-hidden', 'true');
}

function showHost(host: HTMLElement | null) {
  if (!host) return;
  host.classList.remove('hidden');
  host.setAttribute('aria-hidden', 'false');
}

export function mountBuilderReact(host: HTMLElement | null, props: Record<string, unknown>) {
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

export function mountBuilderPreview(host: HTMLElement | null) {
  if (!host) return false;
  createRoot(host).render(
    <div className="builder-react-root">
      <BuilderPreviewPage />
    </div>
  );
  return true;
}

declare global {
  interface Window {
    BuilderReact: {
      mount: typeof mountBuilderReact;
      unmount: typeof unmountBuilderReact;
      mountPreview: typeof mountBuilderPreview;
    };
  }
}

window.BuilderReact = {
  mount: mountBuilderReact,
  unmount: unmountBuilderReact,
  mountPreview: mountBuilderPreview,
};
