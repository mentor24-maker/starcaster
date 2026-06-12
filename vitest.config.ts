import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: 'next/image', replacement: path.join(root, 'components/builder/compat/next-image.tsx') },
      { find: 'next/link', replacement: path.join(root, 'components/builder/compat/next-link.tsx') },
      { find: 'next/navigation', replacement: path.join(root, 'components/builder/compat/next-navigation.ts') },
      { find: 'next/dynamic', replacement: path.join(root, 'components/builder/compat/next-dynamic.tsx') },
      { find: '@/lib/admin-fetch', replacement: path.join(root, 'lib/builder-client/adapters/admin-fetch.ts') },
      { find: '@/lib/builder-admin-fetch', replacement: path.join(root, 'lib/builder-client/adapters/builder-admin-fetch.ts') },
      { find: '@/lib/capabilities', replacement: path.join(root, 'lib/builder-client/adapters/capabilities.ts') },
      { find: '@/lib/admin-media', replacement: path.join(root, 'lib/builder-client/adapters/admin-media.ts') },
      { find: '@/lib/use-gallery-media-library', replacement: path.join(root, 'lib/builder-client/adapters/use-gallery-media-library.ts') },
      { find: '@/lib/gallery-media-thumbnail', replacement: path.join(root, 'lib/builder-client/adapters/gallery-media-thumbnail.ts') },
      { find: '@/lib/site-url', replacement: path.join(root, 'lib/builder-client/adapters/site-url.ts') },
      { find: '@/lib/poll-test-mode', replacement: path.join(root, 'lib/builder-client/adapters/poll-test-mode.ts') },
      { find: '@/lib/player-portal', replacement: path.join(root, 'lib/builder-client/adapters/player-portal.ts') },
      { find: '@/lib/player-game-reminders', replacement: path.join(root, 'lib/builder-client/adapters/player-game-reminders.ts') },
      { find: '@/lib/poll-deep-dive', replacement: path.join(root, 'lib/builder-client/adapters/poll-deep-dive.ts') },
      { find: '@/lib/load-poll-category-catalog', replacement: path.join(root, 'lib/builder-client/adapters/load-poll-category-catalog.ts') },
      { find: '@/src/site/home/types', replacement: path.join(root, 'lib/builder-client/site-home/types.ts') },
      { find: /^@\/src\/site\/home\/partials\/(.*)$/, replacement: path.join(root, 'components/site-home/$1') },
      { find: /^@\/lib\/(.*)$/, replacement: path.join(root, 'lib/builder-client/$1') },
      { find: '@/components/player-portal-auth-form', replacement: path.join(root, 'components/builder/stubs/player-portal-auth-form.tsx') },
      { find: '@/components/admin-legacy-reminders-import-panel', replacement: path.join(root, 'components/builder/stubs/admin-legacy-reminders-import-panel.tsx') },
      { find: '@/components/gallery-poll-associate-menu', replacement: path.join(root, 'components/builder/stubs/gallery-poll-associate-menu.tsx') },
      { find: '@/components/player-game-reminder-diagnostics-gate', replacement: path.join(root, 'components/builder/stubs/player-game-reminder-diagnostics-gate.tsx') },
      { find: '@/components/use-site-player-registration', replacement: path.join(root, 'components/builder/stubs/use-site-player-registration.ts') },
      { find: '@/components/poll-deep-dive-content', replacement: path.join(root, 'components/builder/stubs/poll-deep-dive-content.tsx') },
      { find: /^@\/components\/builder\/(.*)$/, replacement: path.join(root, 'components/builder/$1') },
      { find: /^@\/components\/(.*)$/, replacement: path.join(root, 'components/$1') },
    ],
  },
  test: {
    include: [
      'lib/builder-client/**/*.test.ts',
      'components/builder/**/*.test.ts',
      'components/builder/**/*.test.tsx',
    ],
    environment: 'node',
    passWithNoTests: true,
  },
});
