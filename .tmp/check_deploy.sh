#!/bin/bash
# Extract GitHub token from git config credential helper
HELPER=$(git config --global credential.https://github.com.helper)
TOKEN=$($HELPER 2>/dev/null | grep '^password=' | cut -d'=' -f2-)

if [ -n "$TOKEN" ]; then
  echo "Token obtained (length: ${#TOKEN})"
  
  # Get latest commit SHA
  SHA=$(curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/carlawilli407-ai/americansfinancial/commits/master" \
    2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sha','unknown')[:12])" 2>/dev/null)
  echo "Latest commit on GitHub: $SHA"
  
  # Check commit statuses (Vercel status checks appear here)
  echo "---"
  curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/repos/carlawilli407-ai/americansfinancial/commits/$SHA/statuses" \
    2>/dev/null | python3 -c "
import sys, json
try:
    statuses = json.load(sys.stdin)
    if statuses:
        print(f'Commit statuses ({len(statuses)}):')
        for s in statuses[:10]:
            ctx = s.get('context','?')
            state = s.get('state','?')
            desc = s.get('description','')[:80]
            print(f'  {ctx}: {state} - {desc}')
    else:
        print('No commit statuses (Vercel app may not be installed)')
except:
    print('Could not parse status response')
" 2>/dev/null
  
  # Check installed GitHub apps
  echo "---"
  curl -s -H "Authorization: token $TOKEN" \
    "https://api.github.com/user/installations" 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if 'installations' in d:
        print(f'Installed GitHub apps ({len(d[\"installations\"])}):')
        for inst in d['installations']:
            name = inst.get('app',{}).get('name','?')
            print(f'  {name}')
            if 'vercel' in name.lower():
                print('  *** VERCEL FOUND ***')
    else:
        print('No apps installed')
except:
    print('Could not parse apps response')
" 2>/dev/null
else
  echo "Could not obtain GitHub token from git config"
fi
