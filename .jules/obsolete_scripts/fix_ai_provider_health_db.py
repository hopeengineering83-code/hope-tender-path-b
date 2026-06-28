import re

with open('lib/ai-provider-health-db.ts', 'r') as f:
    content = f.read()

# Fix types in lib/ai-provider-health-db.ts
content = content.replace(
    'restoreProviderState(name, {',
    'restoreProviderState(name, {'
)

# I need to see what exactly is wrong in that file.
