const http = require('http');
const { URL } = require('url');

// Cookie jar for session persistence
let cookies = {};

function parseCookies(setCookieHeader) {
  const parsed = {};
  if (setCookieHeader) {
    const cookieList = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const c of cookieList) {
      const match = c.match(/^([^=]+)=([^;]*)/);
      if (match) parsed[match[1].trim()] = match[2].trim();
    }
  }
  return parsed;
}

function buildCookieHeader() {
  return Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join('; ');
}

function getcsrfToken(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

async function request(method, path, postData, opts = {}) {
  const cookieHeader = buildCookieHeader();
  const headers = { 'Cookie': cookieHeader, ...opts.headers };
  if (postData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }
  
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 54323,
      path: path,
      method: method,
      headers: headers
    }, (res) => {
      // Capture cookies
      const setCookies = res.headers['set-cookie'];
      if (setCookies) {
        const newCookies = parseCookies(setCookies);
        Object.assign(cookies, newCookies);
      }
      
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body,
          statusCode: res.statusCode
        });
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  // Start server
  process.env.DATABASE_URL = "postgresql://postgres.ksnqvngdnbhkwzdeyzdw:***@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
  process.env.NODE_ENV = 'production';
  process.argv[1] = 'test';
  
  const app = require('../server.js');
  const server = app.listen(54323, '127.0.0.1', async () => {
    console.log('Server started on port 54323\n');
    
    await new Promise(r => setTimeout(r, 3000)); // Wait for DB init
    
    try {
      // Test 1: GET / (homepage)
      console.log('=== Test 1: Homepage ===');
      const r1 = await request('GET', '/?debug=1');
      console.log(`GET /: ${r1.status} (len=${r1.body.length})`);
      
      // Test 2: GET /login (get CSRF token)
      console.log('\n=== Test 2: Login page (get CSRF) ===');
      const r2 = await request('GET', '/login');
      const csrfToken = getcsrfToken(r2.body);
      console.log(`GET /login: ${r2.status} (len=${r2.body.length})`);
      console.log(`CSRF token: ${csrfToken ? 'found' : 'NOT FOUND'}`);
      
      if (!csrfToken) {
        console.log('ERROR: No CSRF token found!');
        return;
      }
      
      // Test 3: POST /login as admin
      console.log('\n=== Test 3: POST /login as admin ===');
      const adminData = `_csrf=${encodeURIComponent(csrfToken)}&username=admin&password=admin123`;
      const r3 = await request('POST', '/login', adminData);
      console.log(`POST /login: ${r3.status}`);
      console.log(`  Location: ${r3.headers.location || 'none'}`);
      
      if (r3.status !== 302) {
        console.log('  ERROR: Expected 302 redirect!');
        console.log('  Body:', r3.body.substring(0, 500));
        return;
      }
      
      // Test 4: GET /profile (with admin session)
      console.log('\n=== Test 4: GET /profile (admin) ===');
      const r4 = await request('GET', '/profile?debug=1');
      console.log(`GET /profile: ${r4.status} (len=${r4.body.length})`);
      if (r4.status !== 200) {
        console.log('  Body:', r4.body.substring(0, 500));
      } else {
        console.log('  Profile page OK!');
      }
      
      // Test 5: GET /dashboard (with admin session)
      console.log('\n=== Test 5: GET /dashboard (admin) ===');
      const r5 = await request('GET', '/dashboard');
      console.log(`GET /dashboard: ${r5.status} (len=${r5.body.length})`);
      
      // Test 6: GET /admin (with admin session)
      console.log('\n=== Test 6: GET /admin (admin) ===');
      const r6 = await request('GET', '/admin');
      console.log(`GET /admin: ${r6.status} (len=${r6.body.length})`);
      if (r6.status !== 200) {
        console.log('  Body:', r6.body.substring(0, 300));
      }
      
      // Test 7: Logout
      console.log('\n=== Test 7: GET /logout ===');
      const r7 = await request('GET', '/logout');
      console.log(`GET /logout: ${r7.status}`);
      
      // Test 8: GET /login again for jdoe
      console.log('\n=== Test 8: Login as jdoe ===');
      const r8 = await request('GET', '/login');
      const csrfToken2 = getcsrfToken(r8.body);
      const jdoeData = `_csrf=${encodeURIComponent(csrfToken2)}&username=jdoe&password=password`;
      const r9 = await request('POST', '/login', jdoeData);
      console.log(`POST /login (jdoe): ${r9.status}`);
      console.log(`  Location: ${r9.headers.location || 'none'}`);
      
      if (r9.status === 302) {
        console.log('\n=== Test 9: GET /profile (jdoe) ===');
        const r10 = await request('GET', '/profile?debug=1');
        console.log(`GET /profile: ${r10.status} (len=${r10.body.length})`);
        if (r10.status !== 200) {
          console.log('  Body:', r10.body.substring(0, 500));
        } else {
          console.log('  Profile page OK!');
        }
        
        console.log('\n=== Test 10: GET /dashboard (jdoe) ===');
        const r11 = await request('GET', '/dashboard');
        console.log(`GET /dashboard: ${r11.status} (len=${r11.body.length})`);
      }
      
      // Test 11: GET /signup (should show "account opening unavailable")
      console.log('\n=== Test 11: GET /signup ===');
      const r12 = await request('GET', '/signup');
      console.log(`GET /signup: ${r12.status} (len=${r12.body.length})`);
      const hasUnavailable = r12.body.includes('unavailable') || r12.body.includes('not available');
      console.log(`  Account opening unavailable notice: ${hasUnavailable ? 'FOUND' : 'CHECK MANUALLY'}`);
      
      // Summary
      console.log('\n=== SUMMARY ===');
      console.log(`Homepage (GET /): ${r1.status}`);
      console.log(`Login page (GET /login): ${r2.status}`);
      console.log(`Login POST (admin): ${r3.status} (302=success)`);
      console.log(`Profile (admin): ${r4.status} (200=success)`);
      console.log(`Dashboard (admin): ${r5.status} (200=success)`);
      console.log(`Admin panel (admin): ${r6.status} (200=success)`);
      console.log(`Login POST (jdoe): ${r9.status} (302=success)`);
      if (r10) console.log(`Profile (jdoe): ${r10.status} (200=success)`);
      if (r11) console.log(`Dashboard (jdoe): ${r11.status} (200=success)`);
      console.log(`Signup: ${r12.status}`);
      
    } catch(e) {
      console.log('Test error:', e.message);
      console.log(e.stack);
    } finally {
      server.close();
      setTimeout(() => process.exit(0), 2000);
    }
  });
}

run();
