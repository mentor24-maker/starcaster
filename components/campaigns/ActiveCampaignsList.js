// components/campaigns/ActiveCampaignsList.js
import React from 'react';

export default function ActiveCampaignsList() {
  // Hardcoded mock data as per directive
  const activeCampaigns = [
    {
      id: 101,
      name: "Q4 Holiday Promo",
      description: "Standard end-of-year discount push targeting returning customers."
    },
    {
      id: 102,
      name: "Spring Reactivation",
      description: "Emails targeted to users who have been inactive for over 90 days."
    }
  ];

  return (
    <div>
      <h2>Active Campaigns</h2>
      <ul>
        {activeCampaigns.map((campaign) => (
          <li key={campaign.id}>
            <strong>{campaign.name}</strong>
            <p>{campaign.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
