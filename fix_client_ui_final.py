import sys

with open('components/client-submission-details-panel.tsx', 'r') as f:
    content = f.read()

# Fix the escaped characters
fixed = content.replace('\\"', '"').replace('\\`', '`').replace('\\$', '$').replace('\\{', '{').replace('\\}', '}')

with open('components/client-submission-details-panel.tsx', 'w') as f:
    f.write(fixed)
