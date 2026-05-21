import {onRequest} from "firebase-functions/https";
import type {Request} from "firebase-functions/https";
import type {Response} from "express";
import {getStorage} from "firebase-admin/storage";
import {getFirestore} from "firebase-admin/firestore";
import * as admin from "firebase-admin";

/**
 * Image id under `images/{id}.png` in Storage; served by the avatarImage
 * endpoint (guest default).
 */
export const GUEST_AVATAR_IMAGE_ID =
  "am-a-19-year-old-multimedia-artist-student-from-manila--21";

/**
 * Builds a full URL to a Cloud Function in europe-west1 (emulator or prod).
 * @param {Request} req Incoming HTTP request (host / path for emulator).
 * @param {string} functionName Deployed function name (final path segment).
 * @param {Record<string, string>} query Optional query params.
 * @return {string} Absolute function URL.
 */
function buildCloudFunctionUrl(
  req: Request,
  functionName: string,
  query: Record<string, string> = {},
): string {
  const qs = new URLSearchParams(query).toString();
  const suffix = qs ? `?${qs}` : "";
  const host = req.get("host");
  const proto =
    (typeof req.headers["x-forwarded-proto"] === "string" ?
      req.headers["x-forwarded-proto"].split(",")[0]?.trim() :
      undefined) ||
    (req.secure ? "https" : "http");

  const orig =
    "originalUrl" in req &&
    typeof (req as Request & {originalUrl?: string}).originalUrl === "string" ?
      (req as Request & {originalUrl: string}).originalUrl.split("?")[0] :
      req.path;

  if (host && orig.includes("europe-west1")) {
    const base = orig.replace(/\/[^/]+$/, `/${functionName}`);
    return `${proto}://${host}${base}${suffix}`;
  }

  const projectId =
    process.env.GCLOUD_PROJECT || admin.app().options.projectId || "";
  return (
    `https://europe-west1-${projectId}.cloudfunctions.net/${functionName}` +
    suffix
  );
}

/**
 * Builds a full URL to an image-serving function for the given storage id.
 * @param {Request} req Incoming HTTP request (host / path for emulator).
 * @param {string} imageId File basename in Storage (no .png).
 * @param {string} functionName Target function (e.g. `getImage`).
 * @return {string} Absolute URL with `id` query param.
 */
export function buildAvatarImageUrl(
  req: Request,
  imageId: string,
  functionName: string,
): string {
  return buildCloudFunctionUrl(req, functionName, {id: imageId});
}

/**
 * Guest default avatar URL (avatarImage endpoint, no query params).
 * @param {Request} req Incoming HTTP request.
 * @return {string} Absolute avatarImage URL.
 */
export function buildGuestAvatarImageUrl(req: Request): string {
  return buildCloudFunctionUrl(req, "avatarImage");
}

/**
 * Streams a PNG from Storage by image id (basename without .png).
 * @param {string} imageId Storage object basename.
 * @param {Response} res HTTP response to pipe the image into.
 * @return {Promise<void>}
 */
async function streamImageById(imageId: string, res: Response): Promise<void> {
  const bucket = getStorage().bucket();
  const file = bucket.file(`${imageId}.png`);
  const [exists] = await file.exists();
  if (!exists) {
    res.status(404).send("Image not found");
    return;
  }
  const stream = file.createReadStream();
  res.setHeader("Content-Type", "image/png");
  stream.pipe(res);
}

const INVALID_DISPLAY_NAME_CHARS = /[\]:[{}'"#$!%^&*()+=\s\\/-]/;

/**
 * Reads displayName from query `?displayName=` or JSON body
 * `{ "displayName": "..." }`.
 * @param {Request} req HTTP request.
 * @return {string} Trimmed displayName or empty if missing.
 */
function getDisplayNameFromRequest(req: Request): string {
  const q = req.query.displayName;
  if (typeof q === "string" && q.trim()) {
    return q.trim();
  }
  if (Array.isArray(q) && typeof q[0] === "string" && q[0].trim()) {
    return q[0].trim();
  }

  let body: unknown = req.body;
  if (Buffer.isBuffer(body)) {
    const s = body.toString("utf8").trim();
    if (!s) {
      return "";
    }
    try {
      body = JSON.parse(s) as unknown;
    } catch {
      return "";
    }
  } else if (typeof body === "string" && body.trim()) {
    try {
      body = JSON.parse(body) as unknown;
    } catch {
      return "";
    }
  }

  if (
    body &&
    typeof body === "object" &&
    "displayName" in body &&
    typeof (body as {displayName: unknown}).displayName === "string"
  ) {
    return (body as {displayName: string}).displayName.trim();
  }
  return "";
}

/**
 * GET /checkDisplayName
 * Query or body: `displayName`. Returns `{ available: true }` when the name
 * is at least 6 characters, passes character rules, and is not already used
 * in `users`.
 * Otherwise `{ available: false }`.
 */
export const checkDisplayName = onRequest(async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({available: false});
    return;
  }

  const displayName = getDisplayNameFromRequest(req);
  if (
    !displayName ||
    displayName.length < 6 ||
    INVALID_DISPLAY_NAME_CHARS.test(displayName)
  ) {
    res.json({available: false});
    return;
  }

  const snapshot = await getFirestore()
    .collection("users")
    .where("displayName", "==", displayName)
    .limit(1)
    .get();

  res.json({available: snapshot.empty});
});

export const getImage = onRequest({cors: true}, async (req, res) => {
  const rawId = req.query.id;
  const imageId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!imageId || typeof imageId !== "string") {
    res.status(400).send("Missing Image ID");
    return;
  }

  try {
    await streamImageById(imageId, res);
  } catch {
    res.status(500).send("Error fetching image");
  }
});

/** Default guest avatar; no query params. */
export const avatarImage = onRequest({cors: true}, async (req, res) => {
  try {
    await streamImageById(GUEST_AVATAR_IMAGE_ID, res);
  } catch {
    res.status(500).send("Error fetching image");
  }
});
