
import { NextResponse } from "next/server";
import { adminClient, authenticated } from "@/lib/supabase";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await authenticated(req);

  if (!user) {
    return NextResponse.json(
      { error: "Ingen tilgang" },
      { status: 401 }
    );
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Ugyldig forespørsel" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Ugyldig forespørsel" },
      { status: 400 }
    );
  }

  const input = body as Record<string, unknown>;
  const { item_id, counted_quantity } = input;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (
    typeof item_id !== "string" ||
    !uuidPattern.test(item_id) ||
    typeof counted_quantity !== "number" ||
    !Number.isSafeInteger(counted_quantity) ||
    counted_quantity < 0 ||
    counted_quantity > 100000
  ) {
    return NextResponse.json(
      { error: "Ugyldig vare eller antall" },
      { status: 400 }
    );
  }

  const { data, error } = await adminClient().rpc(
    "confirm_inventory_count",
    {
      p_item_id: item_id,
      p_counted_quantity: counted_quantity,
      p_user_id: user.id,
    }
  );

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: true,
    quantity: data,
  });
}
