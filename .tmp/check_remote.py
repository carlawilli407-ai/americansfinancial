import subprocess, json, re, sys

result = subprocess.run(["git", "config", "--global", "credential.https://github.com.helper"],
                       capture_output=True, text=True)
helper = result.stdout.strip()
match = re.search(r'password=([^\s;}]+)', helper)
token = match.group(1) if match else ""

REPO = "carlawilli407-ai/americansfinancial"

r = subprocess.run(["curl", "-s", "-H", f"Authorization: token {token}",
                     "-H", "Accept: application/vnd.github.v3+json",
                     f"https://api.github.com/repos/{REPO}/commits/master"],
                   capture_output=True, text=True, timeout=10)
commit = json.loads(r.stdout)
sha = commit.get('sha','')[:12]
msg = commit.get('commit',{}).get('message','').split('\n')[0]
print(f'Latest commit on master: {sha} - {msg}')

r = subprocess.run(["curl", "-s", "-H", f"Authorization: token {token}",
                     "-H", "Accept: application/vnd.github.v3+json",
                     f"https://api.github.com/repos/{REPO}/commits/{sha}/statuses"],
                   capture_output=True, text=True, timeout=10)
statuses = json.loads(r.stdout)
for s in statuses:
    ctx = s.get('context','?')
    state = s.get('state','?')
    created = s.get('created_at','')
    target = s.get('target_url','')[:80]
    print(f'  [{created}] {ctx}: {state} -> {target}')
