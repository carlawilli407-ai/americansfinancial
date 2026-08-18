import subprocess, re, os

base = "https://americansfinancialsewqa.vercel.app"
jar = "/tmp/vercel_debug2.txt"

def run_curl(args, timeout=30):
    try:
        return subprocess.run(["curl"] + args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return type('obj', (object,), {'stdout': 'TIMEOUT', 'stderr': 'TIMEOUT', 'returncode': -1})()

print("=== Vercel Debug Login Test ===\n")

if os.path.exists(jar):
    os.remove(jar)

# GET /login?debug=1 for CSRF token
r = run_curl(["-s", "-c", jar, f"{base}/login?debug=1", "-D", "-", "-o", "/dev/null", "--max-time", "15"])
print(f"GET /login?debug=1: {r.stdout.split(chr(10))[0] if r.stdout else 'no response'}")

# Get CSRF token from cookie
with open(jar) as f:
    content = f.read()
csrf = re.search(r'csrf_token\s+(\S+)', content)
token = csrf.group(1) if csrf else ""

# POST /login?debug=1 WITH debug param to get error details
print(f"\nPOST /login?debug=1 ...")
r = run_curl(["-s", "-b", jar, "-c", jar, "-X", "POST",
              "--data-urlencode", "username=jdoe",
              "--data-urlencode", "password=password",
              "--data-urlencode", f"_csrf={token}",
              f"{base}/login?debug=1", "-D", "-o", "-", "--max-time", "30"])

if r.stdout == "TIMEOUT":
    print("  *** TIMEOUT ***")
else:
    lines = r.stdout.split('\r\n') if '\r\n' in r.stdout else r.stdout.split('\n')
    print(f"  Status: {lines[0]}")
    # Extract body
    body_start = None
    for i, line in enumerate(lines):
        if line == '' or line == '\r':
            body_start = i + 1
            break
    if body_start is None:
        body_start = 1
    body = '\n'.join(lines[body_start:])
    print(f"  Body:\n{body[:600]}")

if os.path.exists(jar):
    os.remove(jar)
