import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import ActiveCampaignsList from './components/campaigns/ActiveCampaignsList';
// Main application component
function App() {
  const [currentPage, setCurrentPage] = useState('home');
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#page=', '');
      setCurrentPage(hash || 'home');
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Initial page load
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);
  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage />;
      case 'campaignsPage':
        return <ActiveCampaignsList />;
      // Add other cases for different pages
      default:
        return <HomePage />;
    }
  };
  return (
    <div>
      <nav>
        {/* Navigation links can be added here */}
      </nav>
      <main>
        {renderPage()}
      </main>
    </div>
  );
}
// Placeholder for HomePage component
function HomePage() {
  return <h1>Welcome to the Dashboard</h1>;
}
/*
 * ========================================================================
 * ARCHIVED: Legacy Campaigns CRUD Table
 * ========================================================================
*/
// Render the App to the DOM
const root = document.getElementById('root');
if (root) {
  ReactDOM.render(<App />, root);
}
