import { createRoot, type Root } from 'react-dom/client';
import BuilderWorkspace from './components/builder/BuilderWorkspace';
import { BuilderPreviewPage } from './components/builder-preview-page';
import { BuilderThemesPage } from './components/builder/builder-themes-page';
import { BuilderFormsPage } from './components/builder/builder-forms-page';
import { BuilderModuleClassesPanel } from './components/builder/builder-module-classes-panel';
import { BuilderExtensionsPage } from './components/builder/builder-extensions-page';
import { BuilderAgentsPage } from './components/builder/builder-agents-page';

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

let themesRoot: Root | null = null;
let formsRoot: Root | null = null;
let moduleClassesRoot: Root | null = null;
let extensionsRoot: Root | null = null;
let extensionsOpenItemFn: ((item: unknown) => void) | null = null;
let pendingExtensionItem: unknown = null;
let agentsRoot: Root | null = null;
let agentsSetViewFn: ((view: "list" | "builder") => void) | null = null;

export function mountThemesReact(host: HTMLElement | null) {
  if (!host) return;
  if (themesRoot) {
    themesRoot.unmount();
  }
  themesRoot = createRoot(host);
  themesRoot.render(<BuilderThemesPage />);
}

export function unmountThemesReact() {
  if (themesRoot) {
    themesRoot.unmount();
    themesRoot = null;
  }
}

export function mountFormsReact(host: HTMLElement | null) {
  if (!host) return;
  if (formsRoot) formsRoot.unmount();
  formsRoot = createRoot(host);
  formsRoot.render(<BuilderFormsPage />);
}

export function unmountFormsReact() {
  if (formsRoot) {
    formsRoot.unmount();
    formsRoot = null;
  }
}

export function mountModuleClassesReact(host: HTMLElement | null) {
  if (!host) return;
  if (moduleClassesRoot) moduleClassesRoot.unmount();
  moduleClassesRoot = createRoot(host);
  moduleClassesRoot.render(<BuilderModuleClassesPanel />);
}

export function unmountModuleClassesReact() {
  if (moduleClassesRoot) {
    moduleClassesRoot.unmount();
    moduleClassesRoot = null;
  }
}

export function mountExtensionsReact(host: HTMLElement | null) {
  if (!host) return;
  if (extensionsRoot) return; // keep existing mount; use openExtensionItemReact to push items
  extensionsRoot = createRoot(host);
  extensionsRoot.render(
    <BuilderExtensionsPage
      onRegisterOpenItem={(fn) => {
        extensionsOpenItemFn = fn as (item: unknown) => void;
        if (pendingExtensionItem) {
          fn(pendingExtensionItem as Parameters<typeof fn>[0]);
          pendingExtensionItem = null;
        }
      }}
    />
  );
}

export function unmountExtensionsReact() {
  if (extensionsRoot) {
    extensionsRoot.unmount();
    extensionsRoot = null;
  }
  extensionsOpenItemFn = null;
  pendingExtensionItem = null;
}

export function openExtensionItemReact(item: unknown) {
  if (extensionsOpenItemFn) {
    extensionsOpenItemFn(item);
  } else {
    pendingExtensionItem = item;
  }
}

export function mountAgentsReact(host: HTMLElement | null, initialView: "list" | "builder" = "list") {
  if (!host) return;
  if (agentsRoot) {
    agentsSetViewFn?.(initialView);
    return;
  }
  agentsRoot = createRoot(host);
  agentsRoot.render(
    <BuilderAgentsPage
      initialView={initialView}
      onRegisterSetView={(fn) => { agentsSetViewFn = fn; }}
    />
  );
}

export function unmountAgentsReact() {
  if (agentsRoot) {
    agentsRoot.unmount();
    agentsRoot = null;
  }
  agentsSetViewFn = null;
}

declare global {
  interface Window {
    BuilderReact: {
      mount: typeof mountBuilderReact;
      unmount: typeof unmountBuilderReact;
      mountPreview: typeof mountBuilderPreview;
    };
    ThemesReact: {
      mount: typeof mountThemesReact;
      unmount: typeof unmountThemesReact;
    };
    FormsReact: {
      mount: typeof mountFormsReact;
      unmount: typeof unmountFormsReact;
    };
    ModuleClassesReact: {
      mount: typeof mountModuleClassesReact;
      unmount: typeof unmountModuleClassesReact;
    };
    ExtensionsReact: {
      mount: typeof mountExtensionsReact;
      unmount: typeof unmountExtensionsReact;
      openItem: typeof openExtensionItemReact;
    };
    AgentsReact: {
      mount: typeof mountAgentsReact;
      unmount: typeof unmountAgentsReact;
    };
  }
}

window.BuilderReact = {
  mount: mountBuilderReact,
  unmount: unmountBuilderReact,
  mountPreview: mountBuilderPreview,
};

window.ThemesReact = {
  mount: mountThemesReact,
  unmount: unmountThemesReact,
};

window.FormsReact = {
  mount: mountFormsReact,
  unmount: unmountFormsReact,
};

window.ModuleClassesReact = {
  mount: mountModuleClassesReact,
  unmount: unmountModuleClassesReact,
};

window.ExtensionsReact = {
  mount: mountExtensionsReact,
  unmount: unmountExtensionsReact,
  openItem: openExtensionItemReact,
};

window.AgentsReact = {
  mount: mountAgentsReact,
  unmount: unmountAgentsReact,
};
