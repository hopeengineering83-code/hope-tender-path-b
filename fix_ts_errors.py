import os

# Fix lib/ai-provider-registry.ts
path = 'lib/ai-provider-registry.ts'
with open(path, 'r') as f:
    content = f.read()

content = content.replace('model: proposal,', 'model: proposal ?? null,')
content = content.replace('model: analysis,', 'model: analysis ?? null,')
content = content.replace('model: fast,', 'model: fast ?? null,')

with open(path, 'w') as f:
    f.write(content)

# Fix tests/zai-forbidden-regression.test.ts
path = 'tests/zai-forbidden-regression.test.ts'
with open(path, 'r') as f:
    content = f.read()

content = content.replace('zaiModelValidity(env)', 'zaiModelValidity(env as NodeJS.ProcessEnv)')
content = content.replace('isProviderConfigured("zai", env)', 'isProviderConfigured("zai", env as NodeJS.ProcessEnv)')

with open(path, 'w') as f:
    f.write(content)
