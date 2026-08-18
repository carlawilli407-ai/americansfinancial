import subprocess, re, os

base = "https://americansfinancialsewqa.vercel.app"
jar = "/tmp/vercel_full2.txt"

def run_curl(args, timeout=30):
    try:
        return subprocess.run(["curl"] + args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return type('obj', (object,), {'stdout': 'TIMEOUT', 'stderr': 'TIMEOUT', 'returncode': -1})()

print("=== Vercel Full Flow Test (with error details) ===\n")

if os.path.exists(jar):
    os.remove(jar)

# 1. GET /login for CSRF
r = run_curl(["-s", "-c", jar, f"{base}/login", "-o", "/dev/null", "--max-time", "15"])
with open(jar) as f:
    content = f.read()
csrf = re.search(r'csrf_token\s+(\S+)', content)
token = csrf.group(1) if csrf else ""

# 2. POST /login as jdoe
r = run_curl(["-s", "-b", jar, "-c", jar, "-X", "POST",
              "--data-urlencode", "username=jdoe",
              "--data-urlencode", "password=password",
              "--data-urlencode", f"_csrf={token}",
              f"{base}/login", "-D", "-", "-o", "/dev/null", "--max-time", "30"])
login_status = r.stdout.split('\n')[0] if r.stdout else "no response"
print(f"POST /login (jdoe): {login_status}")

if "302" in login_status:
    # Re-read CSRF from updated jar
    with open(jar) as f:
        content = f.read()
    csrf = re.search(r'csrf_token\s+(\S+)', content)
    token = csrf.group(1) if csrf else ""
    
    # 3. GET /profile
    print(f"\nGET /profile ...")
    r = run_curl(["-s", "-b", jar, "-D", "-", f"{base}/profile", "--max-time", "30"])
    if r.stdout == "TIMEOUT":
        print("  RESULT: *** TIMEOUT ***")
    else:
        lines = r.stdout.split('\r\n') if '\r\n' in r.stdout else r.stdout.split('\n')
        print(f"  Status: {lines[0]}")
        try:
            idx = lines.index('')
            body = '\n'.join(lines[idx+1:])
        except ValueError:
            body = '\n'.join(lines[1:])
        
        if 'Internal Server Error' in body:
            print(f"  *** 500 ERROR ***")
            print(f"  Error details:\n{body[:800]}")
        elif '[object Promise]' in body:
            print(f"  *** [object Promise] found ***")
        elif 'My Profile' in body:
            print(f"  SUCCESS: Profile page rendered correctly")
            print(f"  Body size: {len(body)} bytes")
        else:
            print(f"  Response body ({len(body)} bytes):")
            print(f"  {body[:500]}")
    
    # 4. GET /dashboard for comparison
    print(f"\nGET /dashboard ...")
    r = run_curl(["-s", "-b", jar, "-o", "/dev/null", "-w", "%{http_code}", f"{base}/dashboard", "--max-time", "15"])
    print(f"  HTTP {r.stdout.strip()}")
    
    # 5. Test all GET routes
    print(f"\n--- All GET Routes ---")
    for page in ["/profile", "/portfolio", "/trading", "/alerts", "/accounts", 
                 "/trading", "/charting", "/activity", "/watchlists", "/transfer",
                 "/deposit", "/pay-bills", "/move-money", "/external-transfer",
                 "/research", "/planning", "/fixed-income"]:
        r = run_curl(["-s", "-b", jar, "-o", "/dev/null", "-w", "%{http_code}", f"{base}{page}", "--max-time", "15"])
        status = r.stdout.strip()
        mark = " *** 500 ***" if status.startswith("5") else (" OK" if status == "200" else " -> " + status)
        print(f"  GET {page}: {status}{mark}")

if os.path.exists(jar):
    os.remove(jar)
