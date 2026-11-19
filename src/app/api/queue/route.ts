import { queueState, startWorker } from "@/lib/queue";
import { ok } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  startWorker();
  return ok({ jobs: queueState().map((j) => ({ ...j, log: undefined })) });
}
