export function apiError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 400 });
}

export async function jsonBody<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("JSON body required");
  return request.json() as Promise<T>;
}
