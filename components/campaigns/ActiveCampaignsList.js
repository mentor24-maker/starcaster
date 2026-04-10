// components/campaigns/ActiveCampaignsList.js
import React, { useState, useEffect } from 'react';

export default function ActiveCampaignsList() {
  const [activeCampaigns, setActiveCampaigns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const response = await fetch('/api/campaigns/active');
        if (!response.ok) {
          throw new Error('Failed to fetch campaigns from server.');
        }
        
        const data = await response.json();
        setActiveCampaigns(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    }

    fetchCampaigns();
  }, []);

  if (isLoading) {
    return <div><p>Loading active campaigns...</p></div>;
  }

  if (error) {
    return <div><p>Error: {error}</p></div>;
  }

  return (
    <div>
      <h2>Active Campaigns</h2>
      {activeCampaigns.length === 0 ? (
        <p>No active campaigns found.</p>
      ) : (
        <ul>
          {activeCampaigns.map((campaign) => (
            <li key={campaign.id}>
              <strong>{campaign.name}</strong>
              <p>{campaign.description}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
