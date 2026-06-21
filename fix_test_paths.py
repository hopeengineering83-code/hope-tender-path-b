import re

with open('app/api/admin/ai-provider-health/test/route.ts', 'r') as f:
    content = f.read()

content = content.replace('../../../../lib/auth', '@/lib/auth')
content = content.replace('../../../../lib/audit', '@/lib/audit')
content = content.replace('../../../../lib/ai-provider-health', '@/lib/ai-provider-health')
content = content.replace('../../../../../lib/timeout-config', '@/lib/timeout-config')

with open('app/api/admin/ai-provider-health/test/route.ts', 'w') as f:
    f.write(content)
