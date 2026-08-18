import subprocess, json, re

# Get GitHub token from git config
result = subprocess.run(["git", "config", "--global", "credential.https://github.com.helper"],
                       capture_output=True, text=True, timeout=5)
helper = result.stdout.strip()
match = re.search(r'password=([^\s;}]+)', helper)
token = match.group(1) if match else ""

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
    author = commit.get('commit', {}).get('author', {})
    print(f"Latest commit: {sha}")
    print(f"Author: {author.get('name')} <{author.get('email')}>")
    print(f"Message: {msg}")
except Exception as e:
    print(f"Error: {r.stdout[:300]}")

# Check commit statuses (Vercel deployment)
print(f"\n=== Commit Statuses ({sha}) ===")
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
            desc = s.get('description', '')[:100]
            print(f"  {ctx}: {state} - {desc}")
    else:
        print(f"No statuses found")
except:
    print(f"Error: {r.stdout[:300]}")
