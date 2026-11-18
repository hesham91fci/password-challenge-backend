import {getDatabaseWithUrl} from "firebase-admin/database";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import {getFunctions} from "firebase-admin/functions";
import {GoogleAuth} from "google-auth-library";
import {logger} from "firebase-functions";
import {onValueWritten} from "firebase-functions/v2/database";
import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {
  OFFLINE_THRESHOLD_SECONDS,
  RTDB_INSTANCE,
  RTDB_URL,
} from "./constants/game_settings";
import {
  readPresence,
  shouldRemoveStaleRoomUser,
} from "./presence_logic";

interface RemoveStaleRoomUserTask {
  uid: string;
  roomId: string;
}

const REMOVE_STALE_ROOM_USER_FN = "removeStaleRoomUser";

let cachedFunctionUrl: string | undefined;
let cachedGoogleAuth: GoogleAuth | undefined;

/**
 * Resolves the HTTPS URL for a deployed Cloud Function.
 * @param {string} name Function name.
 * @param {string} location Cloud Functions region.
 * @return {Promise<string>} Deployed function URI.
 */
async function getFunctionUrl(
  name: string,
  location = "europe-west1",
): Promise<string> {
  if (cachedFunctionUrl) {
    return cachedFunctionUrl;
  }
  if (process.env.FUNCTIONS_EMULATOR === "true") {
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      "password-challenge-55651";
    return `http://127.0.0.1:5001/${projectId}/${location}/${name}`;
  }
  if (!cachedGoogleAuth) {
    cachedGoogleAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  const auth = cachedGoogleAuth;
  const projectId = await auth.getProjectId();
  const url =
    "https://cloudfunctions.googleapis.com/v2beta/" +
    `projects/${projectId}/locations/${location}/functions/${name}`;
  const client = await auth.getClient();
  const res = await client.request<{
    serviceConfig?: {uri?: string};
  }>({url});
  const uri = res.data?.serviceConfig?.uri;
  if (!uri) {
    throw new Error(`Unable to resolve Cloud Function URL for ${name}`);
  }
  cachedFunctionUrl = uri;
  return uri;
}

/**
 * Enqueues delayed room removal for an offline user.
 * No custom task id — a stuck per-uid id blocked all later removers.
 * The worker re-checks presence and is idempotent.
 * @param {RemoveStaleRoomUserTask} task Payload with uid and roomId.
 * @return {Promise<void>}
 */
async function enqueueRemoveStaleRoomUser(
  task: RemoveStaleRoomUserTask,
): Promise<void> {
  const queue = getFunctions().taskQueue(
    `locations/europe-west1/functions/${REMOVE_STALE_ROOM_USER_FN}`,
  );
  const targetUri = await getFunctionUrl(REMOVE_STALE_ROOM_USER_FN);
  await queue.enqueue(task, {
    scheduleDelaySeconds: OFFLINE_THRESHOLD_SECONDS,
    uri: targetUri,
  });
  logger.info("enqueued removeStaleRoomUser", task);
}

/**
 * When RTDB presence flips to offline, schedule room removal after
 * OFFLINE_THRESHOLD_SECONDS. Coming back online is handled by the
 * delayed worker re-checking presence (no-op if online / node gone).
 */
export const onPresenceWritten = onValueWritten(
  {
    ref: "/presence/{uid}",
    instance: RTDB_INSTANCE,
    region: "europe-west1",
  },
  async (event) => {
    const uid = event.params.uid;
    if (!uid) {
      return;
    }
    const after = readPresence(event.data.after.val());
    if (after?.state !== "offline") {
      return;
    }
    const roomId = after.roomId;
    if (typeof roomId !== "string" || roomId.length === 0) {
      logger.warn("offline presence missing roomId", {uid});
      return;
    }
    await enqueueRemoveStaleRoomUser({uid, roomId});
  },
);

/**
 * Removes the user from the Firestore room if they are still offline for
 * the same roomId after the offline threshold.
 */
export const removeStaleRoomUser = onTaskDispatched(
  {
    retryConfig: {
      maxAttempts: 3,
      minBackoffSeconds: 10,
    },
    rateLimits: {
      maxConcurrentDispatches: 20,
    },
  },
  async (req) => {
    const uid = req.data?.uid;
    const roomId = req.data?.roomId;
    if (typeof uid !== "string" || uid.length === 0) {
      logger.warn("removeStaleRoomUser missing uid");
      return;
    }
    if (typeof roomId !== "string" || roomId.length === 0) {
      logger.warn("removeStaleRoomUser missing roomId", {uid});
      return;
    }

    const presenceSnap = await getDatabaseWithUrl(RTDB_URL)
      .ref(`presence/${uid}`)
      .get();
    const presence = readPresence(presenceSnap.val());
    if (!shouldRemoveStaleRoomUser(presence, roomId)) {
      logger.info("skip stale removal; presence not offline for room", {
        uid,
        roomId,
        presence,
      });
      return;
    }

    const db = getFirestore();
    const roomRef = db.collection("rooms").doc(roomId);
    const userRef = roomRef.collection("users").doc(uid);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        return;
      }
      const roomSnap = await tx.get(roomRef);
      tx.delete(userRef);
      if (roomSnap.exists) {
        tx.update(roomRef, {usersCount: FieldValue.increment(-1)});
      }
    });

    // Clear presence so a later reconnect starts clean.
    await getDatabaseWithUrl(RTDB_URL).ref(`presence/${uid}`).remove();
    logger.info("removed stale room user", {uid, roomId});
  },
);
