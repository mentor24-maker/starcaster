<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js"></script>

// Find your button
const button = document.getElementById('celebrateBtn');

// Trigger confetti on click
button.addEventListener('click', () => {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 } // Launches from slightly below the middle of the screen
  });
}); 