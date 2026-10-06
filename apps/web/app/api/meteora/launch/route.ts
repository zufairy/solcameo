import { NextRequest } from "next/server";
import { handleDbcLaunch } from "@/lib/server/dbcLaunchRoute";
export const maxDuration = 60;
export async function POST(req: NextRequest) { return handleDbcLaunch(req); }
