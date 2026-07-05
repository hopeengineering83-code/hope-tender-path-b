import re

with open('components/ai-health-panel.tsx', 'r') as f:
    content = f.read()

# Replace lowercase status checks with uppercase ones
content = content.replace('"not_configured"', '"NOT_CONFIGURED"')
content = content.replace('"runtime_verified"', '"GENERATION_VERIFIED"') # Map verified to GENERATION_VERIFIED for green pill
content = content.replace('"rate_limited"', '"RATE_LIMITED"')
content = content.replace('"unauthorized"', '"UNAUTHORIZED"')
content = content.replace('"timeout"', '"TIMEOUT"')
content = content.replace('"unavailable"', '"BILLING_BLOCKED"') # Mapping unavailable to BILLING_BLOCKED or similar
content = content.replace('"configured"', '"CONFIGURED"')
content = content.replace('"unknown"', '"UNKNOWN"')

# Also handle the logic where runtimeVerified is used
# Map runtime_verified to a combined state if needed, but components use status mainly.

with open('components/ai-health-panel.tsx', 'w') as f:
    f.write(content)
