import { forgeHeaders } from "@/lib/forge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stream a stored export binary through the bridge (bytes never cached). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ readonly bookId: string; readonly exportId: string }> },
): Promise<Response> {
  const { exportId } = await params;
  try {
    const response = await fetch(
      `${process.env.FORGE_BASE_URL ?? "http://localhost:4000"}/exports/${exportId}`,
      { headers: forgeHeaders(), cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) {
      return new Response(JSON.stringify({ error: "export_not_found" }), {
        status: response.status === 404 ? 404 : 502,
        headers: { "content-type": "application/json" },
      });
    }
    const data = await response.arrayBuffer();
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/epub+zip",
        "content-disposition": response.headers.get("content-disposition") ?? "attachment",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "forge_unreachable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
