import re

with open('app/api/admin/ai-provider-health/test/route.ts', 'r') as f:
    content = f.read()

# Fix structuredOutput type
content = content.replace(
    'let structuredOutput = null;',
    'let structuredOutput: any = null;'
)

# Fix res type in withTimeout usage
content = content.replace(
    'const res = await withTimeout(',
    'const res: any = await withTimeout('
)

# Fix p type in analyzeWithAI callbacks if any (wait, I already have that in lib/ai.ts)

with open('app/api/admin/ai-provider-health/test/route.ts', 'w') as f:
    f.write(content)
