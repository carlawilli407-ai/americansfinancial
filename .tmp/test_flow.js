// Full flow test with real database
process.env.DATABASE_URL = "postgresql://postgres.ksnqvngdnbhkwzdeyzdw:" + "wHpXzP0jDdIkhWVu" + "@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
process.argv[1] = 'test';
process.env.NODE_ENV = 'development';

const http = require('http');
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

function getCookie(name) {
  return cookies[name] || null;
}

function getCsrfFromCookie() {
  return getCookie('csrf_token') || null;
}

async function request(method, path, postData) {
  const cookieHeader = Object.entries(cookies).map(([k,v]) => k + '=' + v).join('; ');
  const headers = { 'Cookie': cookieHeader };
  if (postData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }
  
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: 54324, path: path, method: method, headers: headers
    }, (res) => {
      const setCookies = res.headers['set-cookie'];
      if (setCookies) Object.assign(cookies, parseCookies(setCookies));
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  const app = require('../server.js');
  const server = app.listen(54324, '127.0.0.1', async () => {
    console.log('Server started on port 54324\n');
    await new Promise(r => setTimeout(r, 5000));
    
    try {
      // Test 1: Homepage
      console.log('=== Test 1: Homepage ===');
      const r1 = await request('GET', '/');
      console.log('GET /: ' + r1.status);
      
      // Test 2: Login page (get CSRF token cookie)
      console.log('\n=== Test 2: Login page ===');
      const r2 = await request('GET', '/login');
      console.log('GET /login: ' + r2.status);
      const csrfToken = getCsrfFromCookie();
      console.log('CSRF token from cookie: ' + (csrfToken ? 'found' : 'NOT FOUND'));
      
      // Test 3: Login as admin
      console.log('\n=== Test 3: Login as admin ===');
      const loginData = '_csrf=' + encodeURIComponent(csrfToken) + '&username=admin&password=admin123';
      const r3 = await request('POST', '/login', loginData);
      console.log('POST /login (admin): ' + r3.status);
      console.log('  Location: ' + (r3.headers.location || 'none'));
      
      if (r3.status === 302) {
        console.log('\n=== Test 4: Profile (admin) ===');
        const r4 = await request('GET', '/profile');
        console.log('GET /profile: ' + r4.status + ' (len=' + r4.body.length + ')');
        
        console.log('\n=== Test 5: Dashboard (admin) ===');
        const r5 = await request('GET', '/dashboard');
        console.log('GET /dashboard: ' + r5.status + ' (len=' + r5.body.length + ')');
        
        console.log('\n=== Test 6: Admin panel (admin) ===');
        const r6 = await request('GET', '/admin');
        console.log('GET /admin: ' + r6.status + ' (len=' + r6.body.length + ')');
        
        // Logout
        await request('GET', '/logout');
      }
      
      // Test 7: Login as jdoe
      console.log('\n=== Test 7: Login as jdoe ===');
      await request('GET', '/login');
      const csrfToken2 = getCsrfFromCookie();
      const jdoeData = '_csrf=' + encodeURIComponent(csrfToken2) + '&username=jdoe&password=password';
      const r7 = await request('POST', '/login', jdoeData);
      console.log('POST /login (jdoe): ' + r7.status);
      console.log('  Location: ' + (r7.headers.location || 'none'));
      
      if (r7.status === 302) {
        console.log('\n=== Test 8: Profile (jdoe) ===');
        const r8 = await request('GET', '/profile');
        console.log('GET /profile: ' + r8.status + ' (len=' + r8.body.length + ')');
        
        console.log('\n=== Test 9: Dashboard (jdoe) ===');
        const r9 = await request('GET', '/dashboard');
        console.log('GET /dashboard: ' + r9.status + ' (len=' + r9.body.length + ')');
      }
      
      // Test 10: Signup page
      console.log('\n=== Test 10: Signup ===');
      const r10 = await request('GET', '/signup');
      console.log('GET /signup: ' + r10.status + ' (len=' + r10.body.length + ')');
      const hasUnavailable = r10.body.includes('unavailable') || r10.body.includes('not available');
      console.log('  Account opening unavailable notice: ' + (hasUnavailable ? 'FOUND' : 'CHECK MANUALLY'));
      
      // Summary
      console.log('\n=== SUMMARY ===');
      console.log('Homepage: ' + r1.status);
      console.log('Login page: ' + r2.status);
      console.log('Login (admin): ' + r3.status + ' (302=success)');
      if (r3.status === 302) {
        console.log('Profile (admin): ' + r4.status + ' (200=success)');
        console.log('Dashboard (admin): ' + r5.status + ' (200=success)');
        console.log('Admin (admin): ' + r6.status + ' (200=success)');
      }
      console.log('Login (jdoe): ' + r7.status + ' (302=success)');
      if (r7.status === 302) {
        console.log('Profile (jdoe): ' + r8.status + ' (200=success)');
        console.log('Dashboard (jdoe): ' + r9.status + ' (200=success)');
      }
      console.log('Signup: ' + r10.status);
      
    } catch(e) {
      console.log('Test error:', e.message);
    } finally {
      server.close();
      setTimeout(() => process.exit(0), 2000);
    }
  });
}

run();
