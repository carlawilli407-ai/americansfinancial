import subprocess, re, time, os

base = "https://americansfinancialsewqa.vercel.app"
jar = "/tmp/vercel_debug.txt"

def run_curl(args, timeout=30):
    try:
        return subprocess.run(["curl"] + args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return type('obj', (object,), {'stdout': 'TIMEOUT', 'stderr': 'TIMEOUT', 'returncode': -1})()

print("=== Vercel Debug Test ===\n")

if os.path.exists(jar):
    os.remove(jar)

# GET /login for CSRF token
r = run_curl(["-s", "-c", jar, "-D", "-", f"{base}/login", "--max-time", "15"])
print(f"GET /login: HTTP {r.stdout.split(chr(10))[0] if r.stdout else 'no response'}")

# Extract CSRF token
with open(jar) as f:
    content = f.read()
csrf = re.search(r'csrf_token\s+(\S+)', content)
token = csrf.group(1) if csrf else ""

# POST /login
print(f"\nPOST /login ...")
r = run_curl(["-s", "-b", jar, "-c", jar, "-X", "POST",
              "--data-urlencode", "username=jdoe",
              "--data-urlencode", "password=password",
              "--data-urlencode", f"_csrf={token}",
              f"{base}/login", "-D", "-", "--max-time", "30"])

if r.stdout == "TIMEOUT":
    print("  RESULT: *** TIMEOUT ***")
else:
    lines = r.stdout.split('\r\n') if '\r\n' in r.stdout else r.stdout.split('\n')
    print(f"  Status: {lines[0]}")
    # Find body (after empty line)
    try:
        idx = lines.index('')
        body = '\n'.join(lines[idx+1:])
    except ValueError:
        body = '\n'.join(lines[1:])
    print(f"  Body ({len(body)} bytes):")
    print(f"  {body[:500]}")

# Cleanup
if os.path.exists(jar):
    os.remove(jar)
