// Test server.js with REAL DATABASE_URL
process.env.DATABASE_URL = "postgresql://postgres.ksnqvngdnbhkwzdeyzdw:wHpXzP0jDdIkhWVu@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
process.argv[1] = 'server';
process.env.NODE_ENV = 'production';

console.log('=== Loading server.js with REAL DATABASE_URL ===');
try {
  const app = require('../server.js');
  console.log('server.js loaded OK');
  
  const http = require('http');
  const PORT = 54322;
  const server = app.listen(PORT, '127.0.0.1', async () => {
    console.log(`Server started on port ${PORT}`);
    
    await new Promise(r => setTimeout(r, 3000)); // Wait for initDb to complete
    
    try {
      // Test 1: GET / (homepage)
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/?debug=1`, resolve).on('error', reject);
      });
      let body = '';
      res.on('data', chunk => body += chunk);
      await new Promise(r => res.on('end', r));
      console.log(`\nGET /: HTTP ${res.statusCode}, Content-Length: ${res.headers['content-length'] || body.length}`);
      
      // Test 2: GET /login
      const res2 = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/login`, resolve).on('error', reject);
      });
      let body2 = '';
      res2.on('data', chunk => body2 += chunk);
      await new Promise(r => res2.on('end', r));
      console.log(`GET /login: HTTP ${res2.statusCode}, Content-Length: ${res2.headers['content-length'] || body2.length}`);
      
      // Test 3: GET /profile (without auth - should redirect)
      const res3 = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${PORT}/profile`, resolve).on('error', reject);
      });
      let body3 = '';
      res3.on('data', chunk => body3 += chunk);
      await new Promise(r => res3.on('end', r));
      console.log(`GET /profile (no auth): HTTP ${res3.statusCode}`);
      
    } catch(e) {
      console.log('HTTP test error:', e.message);
    } finally {
      server.close();
      setTimeout(() => process.exit(0), 2000);
    }
  });
  
} catch(e) {
  console.log('MODULE CRASH:', e.message);
  console.log(e.stack);
  process.exit(1);
}
