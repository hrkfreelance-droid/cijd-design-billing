import { NextResponse } from "next/server";

type CreateProjectPayload = {
  clientId?: unknown;
  name?: unknown;
  createdBy?: unknown;
};

export async function POST(request: Request) {
  let payload: CreateProjectPayload;

  try {
    payload = (await request.json()) as CreateProjectPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (typeof payload.clientId !== "string" || !payload.clientId.trim()) {
    return NextResponse.json({ error: "clientId is required." }, { status: 400 });
  }

  if (typeof payload.name !== "string" || !payload.name.trim()) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const createdBy = typeof payload.createdBy === "string" && payload.createdBy.trim() ? payload.createdBy.trim() : "Telegram";
  const now = new Date().toISOString();

  return NextResponse.json({
    project: {
      id: `project-${crypto.randomUUID()}`,
      clientId: payload.clientId.trim(),
      name: payload.name.trim(),
      date: now.slice(0, 10),
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy,
      status: "IN_PROGRESS",
    },
  }, { status: 201 });
}

