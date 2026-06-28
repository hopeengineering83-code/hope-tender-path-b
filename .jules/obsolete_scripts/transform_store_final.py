import re

with open('lib/engine/provider-health-store.ts', 'r') as f:
    content = f.read()

# 1. Update imports
content = content.replace(
    'recordProviderSuccess,\n  isProviderCooledDown,',
    'recordProviderSuccess,\n  recordProviderAnalysisSuccess,\n  recordProviderPingSuccess,\n  isProviderCooledDown,'
)

# 2. Add markProviderPingOK
content = content.replace(
    'export async function markProviderOK(provider: string): Promise<void> {',
    '''export async function markProviderPingOK(provider: string): Promise<void> {
  recordProviderPingSuccess(provider as AiProviderName);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastPingSucceededAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastPingSucceededAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderPingOK:", err instanceof Error ? err.message : String(err));
  }
}

export async function markProviderOK(provider: string): Promise<void> {'''
)

# 3. Update markProviderAnalysisOK
content = re.sub(
    r'export async function markProviderAnalysisOK\(provider: string\): Promise<void> \{[\s\S]*?\}',
    '''export async function markProviderAnalysisOK(provider: string): Promise<void> {
  recordProviderAnalysisSuccess(provider as any);
  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastAnalysisSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastAnalysisSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderAnalysisOK:", err instanceof Error ? err.message : String(err));
  }
}''',
    content
)

# 4. Update markProviderOK
content = re.sub(
    r'export async function markProviderOK\(provider: string\): Promise<void> \{[\s\S]*?\}',
    '''export async function markProviderOK(provider: string): Promise<void> {
  recordProviderSuccess(provider as AiProviderName);

  try {
    await prisma.providerHealthSnapshot.upsert({
      where: { provider },
      update: {
        lastGenerationSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
        lastFailureCategory: null,
        lastSafeErrorMessage: null,
      },
      create: {
        provider,
        lastGenerationSucceededAt: new Date(),
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        cooldownUntil: null,
      },
    });
  } catch (err) {
    console.warn("[provider-health-store] Failed to persist markProviderOK:", err instanceof Error ? err.message : String(err));
  }
}''',
    content
)

# 5. Update loadProviderHealthIntoMemory
content = content.replace(
    'restoreProviderState(snap.provider as AiProviderName, {\n        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,',
    '''restoreProviderState(snap.provider as AiProviderName, {
        lastSuccessAt: snap.lastSuccessAt ? snap.lastSuccessAt.getTime() : null,
        lastPingSucceededAt: (snap as any).lastPingSucceededAt ? (snap as any).lastPingSucceededAt.getTime() : null,
        lastGenerationSucceededAt: (snap as any).lastGenerationSucceededAt ? (snap as any).lastGenerationSucceededAt.getTime() : null,
        lastAnalysisSucceededAt: (snap as any).lastAnalysisSucceededAt ? (snap as any).lastAnalysisSucceededAt.getTime() : null,'''
)

# 6. Update getProviderHealthSummary lastTestedAt logic
content = content.replace(
    'lastTestedAt: r.lastFailureAt ?? r.lastSuccessAt ?? r.updatedAt,',
    'lastTestedAt: r.lastFailureAt ?? r.lastSuccessAt ?? (r as any).lastPingSucceededAt ?? (r as any).lastAnalysisSucceededAt ?? (r as any).lastGenerationSucceededAt ?? r.updatedAt,'
)

with open('lib/engine/provider-health-store.ts', 'w') as f:
    f.write(content)
