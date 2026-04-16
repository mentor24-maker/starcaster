# Standardize Topics Dropdown

There are currently multiple disorganized implementations across the app for fetching and populating the Topics dropdown menu. `acquire.js`, `messaging.js`, and `assetsVideo.js` all manually fetch `/api/messaging/topics` and loop over the DOM to insert options.

## Proposed Changes

### `public/js/core.js`
- Create a globally accessible cached helper method: `App.populateTopicsDropdown(selectId, defaultLabel, defaultOptionValue)`.
- It will hit the `/api/messaging/topics` endpoint once, cache the array in `App.state.cachedTopics` for the session, and seamlessly construct native `Option` elements for any target select box.

### `public/js/assetsVideo.js`
- Gut the redundant `loadTopicDropdowns` fetch loop.
- Replace with a clean call to `App.populateTopicsDropdown('videoCurationTopic', 'Any', '')`.

### `public/js/messaging.js`
- Refactor `renderCreateContentTopicOptions` and other scattered topic-fetchers to utilize the new centralized `App.populateTopicsDropdown()`.

### `public/js/acquire.js`
- Apply the standardized `App.populateTopicsDropdown()` anywhere the user needs to select a topic from the `messaging_topics` pool.

## Verification
1. Open the "Create Video" curation studio and hit the Topics filter to verify it binds instantly.
2. Navigate to Messaging > Create Content and ensure the global Topics dropdown is fully intact.
