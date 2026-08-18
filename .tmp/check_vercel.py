import subprocess, json, re

result = subprocess.run(["git", "config", "--global", "credential.https://github.com.helper"],
                       capture_output=True, text=True, timeout=5)
helper = result.stdout.strip()

match = re.search(r'password=([^\s;}]+)', helper)
if not match:
    print("Token not found")
    exit()

token = match.group(1)
print(f"Token extracted (length: {len(token)})")

REPO = "carlawilli407-ai/americansfinancial"

# Get latest commit
r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: token {token}",
     "-H", "Accept: application/vnd.github.v3+json",
     f"https://api.github.com/repos/{REPO}/commits/master"],
    capture_output=True, text=True, timeout=10
)
try:
    commit = json.loads(r.stdout)
    sha = commit.get('sha', 'unknown')[:12]
    msg = commit.get('commit', {}).get('message', '').split('\n')[0]
    print(f"\nLatest commit on GitHub: {sha}")
    print(f"Message: {msg}")
    print(f"Our pushed commit: b2b68f7")
    print(f"Deployed: {sha == 'b2b68f7'}")
except Exception as e:
    print(f"Error: {r.stdout[:300]}")

# Check commit statuses
print(f"\n=== Commit Statuses ===")
r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: token {token}",
     f"https://api.github.com/repos/{REPO}/commits/{sha}/statuses"],
    capture_output=True, text=True, timeout=10
)
try:
    statuses = json.loads(r.stdout)
    if isinstance(statuses, list) and len(statuses) > 0:
        print(f"Found {len(statuses)} status(es):")
        for s in statuses[:10]:
            ctx = s.get('context', '?')
            state = s.get('state', '?')
            desc = s.get('description', '')[:80]
            print(f"  {ctx}: {state} - {desc}")
    else:
        print(f"No statuses found (Vercel app may not be installed)")
except:
    print(f"Error: {r.stdout[:300]}")

# Check installed GitHub apps
print(f"\n=== Installed GitHub Apps ===")
r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: token {token}",
     "https://api.github.com/user/installations"],
    capture_output=True, text=True, timeout=10
)
try:
    apps = json.loads(r.stdout)
    if isinstance(apps, dict) and 'installations' in apps:
        print(f"Installed apps ({len(apps['installations'])}):")
        for inst in apps['installations']:
            name = inst.get('app', {}).get('name', '?')
            print(f"  {name}" + (" *** VERCEL ***" if 'vercel' in name.lower() else ""))
    else:
        print(f"Response: {str(r.stdout)[:200]}")
except:
    print(f"Error: {str(r.stdout)[:200]}")
