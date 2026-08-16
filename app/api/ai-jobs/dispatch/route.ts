import { dispatchWorkerRequest } from "../../../../lib/ai-jobs/worker-dispatch";

/**
 * Short authenticated hand-off between request-scoped wakes and /run-next.
 * The implementation lives outside the route module so Next.js sees only
 * supported route exports here.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return dispatchWorkerRequest(req);
}
