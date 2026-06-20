import re

with open('lib/ai.ts', 'r') as f:
    content = f.read()

# The script expects specific anchors with exact spacing.
# It uses .indexOf() which is sensitive to every character.

# Let's see what we have for proposal chain
content = re.sub(
    r'// Provider chain for proposal generation:.*',
    '  // Provider chain for proposal generation:',
    content
)

# And for sections chain
content = re.sub(
    r'// Provider chain for sections:.*',
    '  // Provider chain for sections:',
    content
)

# Make sure Gemini first tier has 2 spaces
content = content.replace('// Gemini — first tier', '  // Gemini — first tier')

# Make sure Claude last resort has 2 spaces
content = content.replace('// Claude (Anthropic) — last resort', '  // Claude (Anthropic) — last resort')
content = content.replace('// Claude — last resort', '  // Claude — last resort')

with open('lib/ai.ts', 'w') as f:
    f.write(content)
