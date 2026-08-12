import React from 'react';
import { createRoot } from 'react-dom/client';
import ActiveCampaignsList from './components/campaigns/ActiveCampaignsList';
import AssociationsPanelHost from './components/associations/associations-panel';
import AssetRenditionsPanel from './components/assets/asset-renditions-panel';

// Host ids that should receive an Associations panel. The vanilla screen names
// the open object by dispatching starcaster:associations-target at the panel.
const ASSOCIATION_PANEL_HOSTS = [
  'messagingTweetAssociationsRoot',
  'messagingPostAssociationsRoot',
];

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  const campaignsRootHost = document.getElementById('campaignsReactRoot');

  if (campaignsRootHost) {
    const root = createRoot(campaignsRootHost);
    root.render(<ActiveCampaignsList />);
  }

  const assetRenditionsHost = document.getElementById('assetRenditionsRoot');

  if (assetRenditionsHost) {
    createRoot(assetRenditionsHost).render(<AssetRenditionsPanel />);
  }

  ASSOCIATION_PANEL_HOSTS.forEach((hostId) => {
    const host = document.getElementById(hostId);
    if (!host) return;
    createRoot(host).render(<AssociationsPanelHost hostId={hostId} />);
  });
});
