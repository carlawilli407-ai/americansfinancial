// Test if server.js loads correctly with real DATABASE_URL
process.env.DATABASE_URL = "postgresql://postgres.ksnqvngdnbhkwzdeyzdw:***@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
process.argv[1] = 'server';
process.env.NODE_ENV = 'production';

console.log('=== Loading server.js ===');
try {
  const app = require('../server.js');
  console.log('server.js loaded OK');
  console.log('app is function:', typeof app === 'function');
  console.log('app.get is function:', typeof app.get === 'function');
  console.log('app.use is function:', typeof app.use === 'function');
  
  // Check ensureDbReady
  console.log('\n=== Testing ensureDbReady ===');
  
  // Access the ensureDbReady function indirectly
  // It's a local variable, not exported. Let's test by making an HTTP request.
  const http = require('http');
  const PORT = 54321;
  const server = app.listen(PORT, '127.0.0.1', async () => {
    console.log(`Server started on port ${PORT}`);
    
    try {
      // Test 1: GET / (homepage)
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/?debug=1`, resolve).on('error', reject);
      });
      let body = '';
      res.on('data', chunk => body += chunk);
      await new Promise(r => res.on('end', r));
      console.log(`\nGET /?debug=1: HTTP ${res.statusCode}`);
      if (res.statusCode !== 200) {
        console.log('Body:', body.substring(0, 500));
      }
      
      // Test 2: GET /login
      const res2 = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/login?debug=1`, resolve).on('error', reject);
      });
      let body2 = '';
      res2.on('data', chunk => body2 += chunk);
      await new Promise(r => res2.on('end', r));
      console.log(`\nGET /login?debug=1: HTTP ${res2.statusCode}`);
      if (res2.statusCode !== 200) {
        console.log('Body:', body2.substring(0, 500));
      }
      
    } catch(e) {
      console.log('HTTP test error:', e.message);
    } finally {
      server.close();
      // Wait a bit for connections to close
      setTimeout(() => process.exit(0), 2000);
    }
  });
  
} catch(e) {
  console.log('MODULE CRASH:', e.message);
  console.log(e.stack);
  process.exit(1);
}
