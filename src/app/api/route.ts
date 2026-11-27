import { NextResponse } from "next/server";

// Web-tier liveness probe (the API's own health endpoints live under
// /health/live and /health/ready on the NestJS service).
export async function GET() {
  return NextResponse.json({ status: "ok", service: "serviceos-web" });
}
