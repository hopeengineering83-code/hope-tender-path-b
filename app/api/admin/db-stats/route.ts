import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Import prisma at runtime to avoid edge runtime issues
  const { prisma } = await import('@/lib/prisma');

  try {
    const [tenderCount, tenderFileCount, generatedDocCount, companyDocCount, requirementCount] =
      await Promise.all([
        prisma.tender.count(),
        prisma.tenderFile.count(),
        prisma.generatedDocument.count(),
        prisma.companyDocument.count(),
        prisma.tenderRequirement.count(),
      ]);

    let tableSizes: Record<string, string> = {};
    try {
      const rows = await prisma.$queryRaw<Array<{ relname: string; size: string }>>`
        SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
        FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 15
      `;
      tableSizes = Object.fromEntries(rows.map(r => [r.relname, r.size]));
    } catch {
      tableSizes = { note: 'Table size query unavailable on this tier' };
    }

    return NextResponse.json({
      rowCounts: {
        Tender: tenderCount,
        TenderFile: tenderFileCount,
        GeneratedDocument: generatedDocCount,
        CompanyDocument: companyDocCount,
        Requirement: requirementCount,
      },
      tableSizes,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Stats query failed', timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
