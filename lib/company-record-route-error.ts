import { NextResponse } from "next/server";
import { logger } from "./observability";

export function companyRecordRuntimeError(args: {
  route: string;
  code: string;
  message: string;
  requestId: string;
  error: unknown;
}) {
  logger.error(`${args.route} failed`, {
    requestId: args.requestId,
    errorClass: args.error instanceof Error ? args.error.constructor.name : "UnknownError",
  });
  return NextResponse.json(
    {
      ok: false,
      error: args.message,
      code: args.code,
      requestId: args.requestId,
    },
    { status: 500 },
  );
}
