const http = require('http');
require('dotenv').config();

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
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}
function getCsrfToken() {
  return cookies.csrf_token ? decodeURIComponent(cookies.csrf_token) : null;
}

async function request(port, method, path, postData) {
  const headers = { Cookie: buildCookieHeader() };
  if (postData) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    headers['Content-Length'] = Buffer.byteLength(postData);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      Object.assign(cookies, parseCookies(res.headers['set-cookie']));
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function run() {
  const PORT = 54324;
  process.env.NODE_ENV = 'production';
  const app = require('../server.js');
  const server = app.listen(PORT, '127.0.0.1', async () => {
    console.log(`Server on ${PORT}, DATABASE_URL set: ${!!process.env.DATABASE_URL}`);
    await new Promise((r) => setTimeout(r, 4000));

    const routes = ['/', '/login', '/profile', '/dashboard', '/admin'];
    try {
      const loginPage = await request(PORT, 'GET', '/login?debug=1');
      console.log(`GET /login: ${loginPage.status}`);
      const csrf = getCsrfToken();
      if (!csrf) {
        console.log('FAIL: no CSRF token');
        console.log(loginPage.body.slice(0, 300));
        return;
      }

      const login = await request(PORT, 'POST', '/login', `_csrf=${encodeURIComponent(csrf)}&username=admin&password=${process.env.ADMIN_PASS || 'admin123'}`);
      console.log(`POST /login: ${login.status} -> ${login.headers.location || 'no redirect'}`);

      for (const path of routes) {
        const r = await request(PORT, 'GET', path + (path === '/profile' ? '?debug=1' : ''));
        const err = r.body.includes('Internal Server Error') ? ' *** 500 ***' : '';
        console.log(`GET ${path}: ${r.status}${err}`);
        if (r.status >= 500) console.log(r.body.slice(0, 400));
      }
    } catch (e) {
      console.error('Test error:', e.message);
    } finally {
      server.close();
      process.exit(0);
    }
  });
}

run();
