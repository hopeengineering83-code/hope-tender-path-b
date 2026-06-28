import re
import os

files = ['tests/ai-provider-health-order-alignment.test.ts']

for file_path in files:
    if not os.path.exists(file_path): continue
    with open(file_path, 'r') as f:
        content = f.read()

    content = content.replace('"not_configured"', '"NOT_CONFIGURED"')
    content = content.replace('"runtime_verified"', '"GENERATION_VERIFIED"')
    content = content.replace('"rate_limited"', '"RATE_LIMITED"')
    content = content.replace('"unauthorized"', '"UNAUTHORIZED"')
    content = content.replace('"timeout"', '"TIMEOUT"')
    content = content.replace('"unavailable"', '"BILLING_BLOCKED"')
    content = content.replace('"configured"', '"CONFIGURED"')
    content = content.replace('"unknown"', '"UNKNOWN"')

    with open(file_path, 'w') as f:
        f.write(content)
