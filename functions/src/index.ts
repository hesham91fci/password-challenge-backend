/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import {setGlobalOptions} from "firebase-functions";
import {onRequest} from "firebase-functions/https";
import type {Request} from "firebase-functions/https";
import {getStorage} from "firebase-admin/storage";
import {getFirestore} from "firebase-admin/firestore";
import * as admin from "firebase-admin";

/**
 * Image id under `images/{id}.png` in Storage; used in getImage URLs for
 * guest avatars.
 */
const GUEST_AVATAR_IMAGE_ID =
  "am-a-19-year-old-multimedia-artist-student-from-manila--21";

/**
 * Builds a full URL to the getImage function for the given storage image id.
 * @param {Request} req Incoming HTTP request (host / path for emulator).
 * @param {string} imageId File basename under images/ (no .png).
 * @return {string} Absolute getImage URL including id query param.
 */
function buildGetImageUrl(req: Request, imageId: string): string {
  const idParam = encodeURIComponent(imageId);
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

  if (host && orig.includes("us-central1")) {
    const base = orig.replace(/\/[^/]+$/, "/getImage");
    return `${proto}://${host}${base}?id=${idParam}`;
  }

  const projectId =
    process.env.GCLOUD_PROJECT || admin.app().options.projectId || "";
  return (
    `https://us-central1-${projectId}.cloudfunctions.net/getImage?id=` +
    idParam
  );
}

/**
 * Picks a random Guest_0..999999 not already used as displayName in users.
 * Does not write to Firestore.
 * @return {Promise<string>} Chosen displayName.
 */
async function allocateUniqueGuestDisplayName(): Promise<string> {
  const db = getFirestore();
  const users = db.collection("users");
  const maxAttempts = 40;

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = `Guest_${Math.floor(Math.random() * 1_000_000)}`;
    try {
      await db.runTransaction(async (tx) => {
        const taken = await tx.get(
          users.where("displayName", "==", candidate).limit(1),
        );
        if (!taken.empty) {
          throw new Error("collision");
        }
      });
      return candidate;
    } catch {
      // Retry with another candidate (collision or transaction conflict).
    }
  }

  throw new Error("Could not allocate a unique guest displayName");
}

/**
 * Merges guest displayName and photoUrl into users/{uid}. Fails if displayName
 * is taken by another user (e.g. concurrent allocation).
 * @param {string} uid Auth / app user id (document id).
 * @param {string} displayName Unique guest display name.
 * @param {string} photoUrl Avatar URL pointing at getImage.
 * @return {Promise<void>}
 */
async function mergeGuestProfileToFirestore(
  uid: string,
  displayName: string,
  photoUrl: string,
): Promise<void> {
  const db = getFirestore();
  const users = db.collection("users");
  await db.runTransaction(async (tx) => {
    const taken = await tx.get(
      users.where("displayName", "==", displayName).limit(1),
    );
    if (!taken.empty && taken.docs[0].id !== uid) {
      throw new Error("displayName taken");
    }
    tx.set(users.doc(uid), {
      displayName,
      photoUrl,
      uid,
    }, {merge: true});
  });
}

/**
 * Reads uid from query `?uid=` or JSON body `{ "uid": "..." }`.
 * @param {Request} req HTTP request.
 * @return {string} Trimmed uid or empty if missing.
 */
function getUidFromRequest(req: Request): string {
  const q = req.query.uid;
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
    "uid" in body &&
    typeof (body as {uid: unknown}).uid === "string"
  ) {
    const u = (body as {uid: string}).uid.trim();
    return u;
  }
  return "";
}
// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({maxInstances: 10});
admin.initializeApp();
// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

/**
 * PATCH /updateGuestProfile
 * Updates an existing Auth user's guest profile in Firestore only: assigns a
 * unique Guest_0..Guest_999999 displayName and guest avatar photoUrl.
 * Call with `uid` in the query string or JSON body. Returns 404 if the Auth
 * user does not exist. Response body is JSON `{ uid, displayName, email,
 * photoUrl }` (email from Auth, unchanged).
 */
export const updateGuestProfile = onRequest(async (req, res) => {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    res.status(405).json({success: false});
    return;
  }

  const uid = getUidFromRequest(req);
  if (!uid) {
    res.status(400).json({success: false});
    return;
  }

  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUser(uid);
  } catch (e: unknown) {
    const code =
      e && typeof e === "object" && "code" in e ?
        String((e as {code: unknown}).code) :
        "";
    if (code === "auth/user-not-found") {
      res.status(404).json({success: false});
      return;
    }
    res.status(500).json({success: false});
    return;
  }

  const photoUrl = buildGetImageUrl(req, GUEST_AVATAR_IMAGE_ID);

  try {
    const displayName = await (async (): Promise<string> => {
      const maxAttempts = 40;
      for (let a = 0; a < maxAttempts; a++) {
        const name = await allocateUniqueGuestDisplayName();
        try {
          await mergeGuestProfileToFirestore(uid, name, photoUrl);
          return name;
        } catch {
          if (a === maxAttempts - 1) {
            throw new Error("Could not persist guest profile");
          }
        }
      }
      throw new Error("unreachable");
    })();

    const email = userRecord.email ?? null;
    res.json({uid, displayName, email, photoUrl});
  } catch {
    res.status(500).json({success: false});
  }
});

export const getImage = onRequest({cors: true}, async (req, res) => {
  // 1. Get the image name from the URL (e.g., /getImage?id=123)
  const imageId = req.query.id;

  if (!imageId) {
    res.status(400).send("Missing Image ID");
    return;
  }

  try {
    const bucket = getStorage().bucket();
    // Use the real, long filename here that you've stored in your DB
    const file = bucket.file(`${imageId}.png`);

    // 2. Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).send("Image not found");
      return;
    }

    // 3. Stream the file directly to the user
    // This hides the Firebase URL entirely!
    const stream = file.createReadStream();

    res.setHeader("Content-Type", "image/png");
    stream.pipe(res);
  } catch {
    res.status(500).send("Error fetching image");
  }
});
