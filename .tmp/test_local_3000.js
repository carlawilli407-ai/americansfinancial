const http = require('http');
require('dotenv').config();

const PORT = 3000;
let cookies = {};

function parseCookies(setCookieHeader) {
  const parsed = {};
  if (setCookieHeader) {
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const c of list) {
      const m = c.match(/^([^=]+)=([^;]*)/);
      if (m) parsed[m[1].trim()] = m[2].trim();
    }
  }
  return parsed;
}

function request(method, path, postData) {
  const headers = { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') };
  if (postData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path, method, headers }, (res) => {
      Object.assign(cookies, parseCookies(res.headers['set-cookie']));
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function login(username, password) {
  cookies = {};
  await request('GET', '/login');
  const csrf = cookies.csrf_token;
  const r = await request('POST', '/login', `_csrf=${encodeURIComponent(csrf)}&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
  return r;
}

async function main() {
  console.log('=== Testing localhost:3000 with Supabase ===\n');

  const home = await request('GET', '/');
  console.log(`GET /: ${home.status}${home.body.includes('Internal Server Error') ? ' *** 500 ***' : ''}`);

  const jdoeLogin = await login('jdoe', 'password');
  console.log(`POST /login (jdoe): ${jdoeLogin.status} -> ${jdoeLogin.headers.location || 'none'}`);

  const pages = ['/profile?debug=1', '/dashboard', '/portfolio', '/trading', '/activity', '/accounts', '/transfer', '/external-transfer'];
  for (const p of pages) {
    const r = await request('GET', p);
    const err = r.body.includes('Internal Server Error') ? ' *** 500 ***' : '';
    console.log(`GET ${p}: ${r.status}${err}`);
    if (r.status >= 500) console.log(r.body.slice(0, 500));
  }

  console.log('\n=== Admin login ===');
  await login('admin', 'admin123');
  const adminPages = ['/admin', '/admin/transactions', '/admin/transactions/pending'];
  for (const p of adminPages) {
    const r = await request('GET', p);
    const err = r.body.includes('Internal Server Error') ? ' *** 500 ***' : '';
    console.log(`GET ${p}: ${r.status}${err}`);
    if (r.status >= 500) console.log(r.body.slice(0, 500));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
