import re

with open('lib/ai-provider-health-db.ts', 'r') as f:
    content = f.read()

# Fix types in lib/ai-provider-health-db.ts to match InternalState
# Start fresh with restoreProviderState replacement
content = re.sub(
    r'restoreProviderState\(snap\.provider as AiProviderName, \{[\s\S]*?\}\);',
    '''restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastPingSucceededAt: (snap as any).lastPingSucceededAt ? (snap as any).lastPingSucceededAt.getTime() : null,
        lastGenerationSucceededAt: (snap as any).lastGenerationSucceededAt ? (snap as any).lastGenerationSucceededAt.getTime() : null,
        lastAnalysisSucceededAt: (snap as any).lastAnalysisSucceededAt ? (snap as any).lastAnalysisSucceededAt.getTime() : null,
        lastFailureAt: snap.lastFailureAt ? snap.lastFailureAt.getTime() : null,
        lastFailureCategory: (snap.lastFailureCategory as AiProviderFailureCategory | null) ?? null,
        lastFailureMessage: snap.lastSafeErrorMessage ?? null,
        consecutiveFailures: snap.consecutiveFailures,
        cooldownUntil: cooldownUntilMs,
      });''',
    content
)

with open('lib/ai-provider-health-db.ts', 'w') as f:
    f.write(content)
