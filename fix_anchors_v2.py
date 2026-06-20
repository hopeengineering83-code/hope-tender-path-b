import re

with open('lib/ai.ts', 'r') as f:
    content = f.read()

# I want EXACTLY 2 spaces
content = content.replace('    // Provider chain for proposal generation:', '  // Provider chain for proposal generation:')
content = content.replace('    // Provider chain for sections:', '  // Provider chain for sections:')

with open('lib/ai.ts', 'w') as f:
    f.write(content)
