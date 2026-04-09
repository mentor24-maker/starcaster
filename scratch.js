const fs = require('fs');
let code = fs.readFileSync('public/js/auth.js', 'utf8');

code = code.replace(
  "  App.auth._showLanding('login');\n  App.auth._setMessage('Checking session...');",
  "  // Delay showing the login screen until we definitively know auth failed.\n  // This prevents the login screen from brutally flashing on every page reload.\n  // App.auth._showLanding('login');\n  // App.auth._setMessage('Checking session...');"
);

fs.writeFileSync('public/js/auth.js', code);
