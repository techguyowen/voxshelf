import { NextResponse } from "next/server";
import { GeminiError } from "./gemini";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function toApiError(err: unknown) {
  if (err instanceof GeminiError) {
    return apiError(err.message, err.status);
  }
  return apiError(err instanceof Error ? err.message : "Request failed", 500);
}
