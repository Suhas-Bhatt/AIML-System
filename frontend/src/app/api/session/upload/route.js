import { createLogger } from '../../../../lib/logger.js';
import { supabaseAdmin } from '../../../../lib/supabase/admin.js';
import { NextResponse } from "next/server";

const log = createLogger("api/session/upload");

/**
 * Upload a file (audio recording or screenshot) to Supabase Storage.
 *
 * Expects multipart FormData with:
 *   - file: Blob/File
 *   - sessionId: string
 *   - type: "recording" | "screenshot"
 *   - filename: string (optional, used as the storage path suffix)
 */
export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const sessionId = formData.get("sessionId");
    const type = formData.get("type");
    const filename = formData.get("filename");

    if (!file || !sessionId || !type) {
      return NextResponse.json(
        { error: "Missing required fields: file, sessionId, type" },
        { status: 400 },
      );
    }

    if (type !== "recording" && type !== "screenshot") {
      return NextResponse.json(
        { error: 'type must be "recording" or "screenshot"' },
        { status: 400 },
      );
    }

    const bucket = type === "recording" ? "recordings" : "screenshots";
    const defaultExt = type === "recording"
      ? (file.type?.includes("mp4") || file.type?.includes("m4a") ? "m4a" : "webm")
      : "jpg";
    const storagePath = `${sessionId}/${filename || `${Date.now()}.${defaultExt}`}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    const defaultContentType = type === "recording"
      ? (file.type?.includes("mp4") ? "audio/mp4" : "audio/webm")
      : "image/jpeg";

    const { error: uploadError } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: file.type || defaultContentType,
        upsert: false,
      });

    if (uploadError) {
      log.error("Storage error:", bucket, uploadError);
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 },
      );
    }

    const { data: signedData, error: signedError } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

    if (signedError || !signedData?.signedUrl) {
      log.error("Signed URL error:", bucket, signedError);
      return NextResponse.json(
        { error: "Failed to generate signed URL" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      url: signedData.signedUrl,
      path: storagePath,
      bucket,
    });
  } catch (err) {
    log.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 },
    );
  }
}
