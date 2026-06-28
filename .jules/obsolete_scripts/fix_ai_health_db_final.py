import re

with open('lib/ai-provider-health-db.ts', 'r') as f:
    content = f.read()

# Fix types in lib/ai-provider-health-db.ts to match InternalState
content = content.replace(
    'restoreProviderState(snap.provider as AiProviderName, {',
    '''restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastPingSucceededAt: (snap as any).lastPingSucceededAt ? (snap as any).lastPingSucceededAt.getTime() : null,
        lastGenerationSucceededAt: (snap as any).lastGenerationSucceededAt ? (snap as any).lastGenerationSucceededAt.getTime() : null,
        lastAnalysisSucceededAt: (snap as any).lastAnalysisSucceededAt ? (snap as any).lastAnalysisSucceededAt.getTime() : null,'''
)

# Remove the redundant lastSuccessAt from the replacement since I included it
content = content.replace(
    '''lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,''',
    'lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,'
)

# Fix persistAllHealthToDb to use InternalState properties safely
content = content.replace(
    'const s = getProviderStateSnapshot(provider);',
    'const s = getProviderStateSnapshot(provider); if (!s) continue;'
)

with open('lib/ai-provider-health-db.ts', 'w') as f:
    f.write(content)
