import re

with open('app/api/admin/ai-provider-health/test/route.ts', 'r') as f:
    content = f.read()

content = content.replace('../@/lib/auth', '@/lib/auth')
content = content.replace('../@/lib/audit', '@/lib/audit')
content = content.replace('../@/lib/ai-provider-health', '@/lib/ai-provider-health')
content = content.replace('../@/lib/timeout-config', '@/lib/timeout-config')

# Also fix the structuredOutput type issues
content = content.replace('let structuredOutput = null;', 'let structuredOutput: any = null;')
content = content.replace('const res = await withTimeout(', 'const res: any = await withTimeout(')

# Fix implicit any for 'p' in callback
content = content.replace('(p) => { chunkProvider = p; }', '(p: string) => { chunkProvider = p; }')

with open('app/api/admin/ai-provider-health/test/route.ts', 'w') as f:
    f.write(content)
