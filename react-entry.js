import React from 'react';
import { createRoot } from 'react-dom/client';
import ActiveCampaignsList from './components/campaigns/ActiveCampaignsList';

// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  const campaignsRootHost = document.getElementById('campaignsReactRoot');
  
  if (campaignsRootHost) {
    const root = createRoot(campaignsRootHost);
    root.render(<ActiveCampaignsList />);
  }
});
