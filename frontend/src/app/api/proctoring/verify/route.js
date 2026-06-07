import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabase/admin.js";

export async function POST(req) {
  try {
    const { sessionId, imageBase64 } = await req.json();

    if (!sessionId || !imageBase64) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Convert base64 to buffer
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    
    // Create a unique filename
    const filename = `${sessionId}/${Date.now()}.jpg`;

    // Upload audit snapshot to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from("proctoring_audits")
      .upload(filename, buffer, {
        contentType: "image/jpeg",
        upsert: true
      });

    if (uploadError) {
      console.error("[Proctoring Verify] Failed to upload audit image:", uploadError);
      return NextResponse.json({ error: "Failed to save audit trail" }, { status: 500 });
    }

    // Optional: Log the verification event to the session
    const { data: session } = await supabaseAdmin
      .from("sessions")
      .select("antiCheatingLog")
      .eq("id", sessionId)
      .single();

    if (session) {
      const log = Array.isArray(session.antiCheatingLog) ? session.antiCheatingLog : [];
      log.push({
        type: "SERVER_AUDIT_SNAPSHOT",
        timestamp: new Date().toISOString(),
        snapshotUrl: filename
      });
      
      await supabaseAdmin
        .from("sessions")
        .update({ antiCheatingLog: log })
        .eq("id", sessionId);
    }

    return NextResponse.json({ success: true, message: "Audit snapshot verified and stored safely" });

  } catch (error) {
    console.error("[Proctoring Verify] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
