import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, supabase, useSupabase } from "./config.js";
import { assertNoError } from "./db.js";

// Birthday photos are kept out of the submissions table on purpose: every
// write re-syncs that whole table and the dashboard ships every row to the
// browser, so a few hundred embedded images would make both crawl. Only the
// photo's path is stored on the record; the bytes live in a private Supabase
// Storage bucket (or data/birthday-photos locally) and are only ever served
// to signed-in admins.
const birthdayPhotoBucket = "birthday-photos";
const birthdayPhotoDir = join(dataDir, "birthday-photos");
const MAX_PHOTO_BYTES = 1_500_000;

// Accepts only a base64 data URL whose bytes really are a JPEG, PNG or WebP
// (checked by signature, not just the declared type), since these bytes are
// later served back to admins with an image content type.
export function parsePhoto(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match) throw new Error("Please add a photo (JPEG, PNG or WebP).");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Please choose a smaller one.");
  const signatures = {
    jpeg: buffer[0] === 0xff && buffer[1] === 0xd8,
    png: buffer.subarray(0, 4).toString("hex") === "89504e47",
    webp: buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP"
  };
  if (!signatures[match[1]]) throw new Error("That file does not look like a valid image.");
  return { buffer, contentType: `image/${match[1]}`, extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

export async function savePhoto(path, photo) {
  if (!useSupabase) {
    mkdirSync(birthdayPhotoDir, { recursive: true });
    writeFileSync(join(birthdayPhotoDir, path), photo.buffer);
    return;
  }
  const upload = () => supabase.storage.from(birthdayPhotoBucket).upload(path, photo.buffer, { contentType: photo.contentType, upsert: true });
  let { error } = await upload();
  if (error && /bucket not found/i.test(error.message)) {
    // First photo ever on this Supabase project: create the private bucket
    // instead of requiring a manual dashboard step before the form works.
    const created = await supabase.storage.createBucket(birthdayPhotoBucket, { public: false });
    if (created.error && !/already exists/i.test(created.error.message)) assertNoError(created.error, "create bucket (birthday-photos)");
    ({ error } = await upload());
  }
  assertNoError(error, "upload (birthday-photos)");
}

export async function readPhoto(path) {
  if (!useSupabase) {
    const filePath = join(birthdayPhotoDir, path);
    return existsSync(filePath) ? readFileSync(filePath) : null;
  }
  const { data, error } = await supabase.storage.from(birthdayPhotoBucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// Best-effort: a leftover file is harmless, a failed record deletion is not.
export async function deletePhoto(path) {
  try {
    if (!useSupabase) {
      const filePath = join(birthdayPhotoDir, path);
      if (existsSync(filePath)) unlinkSync(filePath);
      return;
    }
    await supabase.storage.from(birthdayPhotoBucket).remove([path]);
  } catch {
    // ignore
  }
}
