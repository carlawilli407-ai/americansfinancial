import subprocess, json, re

result = subprocess.run(["git", "config", "--global", "credential.https://github.com.helper"],
                       capture_output=True, text=True, timeout=5)
helper = result.stdout.strip()
match = re.search(r'password=([^\s;}]+)', helper)
token = match.group(1) if match else ""

REPO = "carlawilli407-ai/americansfinancial"

r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: token {token}",
     "-H", "Accept: application/vnd.github.v3+json",
     f"https://api.github.com/repos/{REPO}/commits/master"],
    capture_output=True, text=True, timeout=10
)
commit = json.loads(r.stdout)
sha = commit.get('sha', '')[:12]

r = subprocess.run(
    ["curl", "-s", "-H", f"Authorization: token {token}",
     "-H", "Accept: application/vnd.github.v3+json",
     f"https://api.github.com/repos/{REPO}/commits/{sha}/statuses"],
    capture_output=True, text=True, timeout=10
)
statuses = json.loads(r.stdout)
print(f"=== Detailed Statuses for {sha} ===")
for s in statuses:
    ctx = s.get('context', '?')
    state = s.get('state', '?')
    desc = s.get('description', '')[:100]
    target = s.get('target_url', 'none')
    created = s.get('created_at', '?')
    print(f"  [{created}] {ctx}: {state}")
    print(f"    Description: {desc}")
    print(f"    Target URL: {target}")
