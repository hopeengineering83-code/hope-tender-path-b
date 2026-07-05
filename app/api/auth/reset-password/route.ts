import { handleSecurePasswordReset } from "../../../../lib/secure-password-reset";

export async function POST(req: Request) {
  return handleSecurePasswordReset(req);
}
