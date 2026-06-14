import { livenessResponse } from "../../../lib/liveness";

export const dynamic = "force-dynamic";

export async function GET() {
  return livenessResponse();
}
