import {onRequest} from "firebase-functions/https";
import type {Request} from "firebase-functions/https";
import {FieldValue, getFirestore} from "firebase-admin/firestore";
import type {Firestore} from "firebase-admin/firestore";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import type {Room} from "./models/room";
import type {
  FinalAssignment,
  RoleAssignment,
  TeamAssignment,
} from "./models/room_assignment";
import type {RoomUser} from "./models/room_user";
import type {RoomType} from "./models/room_type";
import type {Team} from "./models/team";

const CODE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Thrown from the createRoom transaction when the candidate code is already
 * taken (caller should pick another code).
 */
class CodeTakenError extends Error {
  /** Creates a code-taken error. */
  constructor() {
    super("CODE_TAKEN");
    this.name = "CodeTakenError";
  }
}

/**
 * Parses JSON body for POST handlers.
 * @param {Request} req HTTP request.
 * @return {unknown} Parsed object or null.
 */
function parseJsonBody(req: Request): unknown {
  const raw: unknown = req.body;
  if (Buffer.isBuffer(raw)) {
    const s = raw.toString("utf8").trim();
    if (!s) {
      return null;
    }
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object") {
    return raw;
  }
  return null;
}

/**
 * Builds a random 6-character room code using A–Z and a–z.
 * @return {string} Six-character code.
 */
function randomRoomCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    const idx = Math.floor(Math.random() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[idx];
  }
  return code;
}

/**
 * Shuffles users in a new array.
 * @param {string[]} users User ids.
 * @return {string[]} Shuffled user ids.
 */
function shuffleUsers(users: string[]): string[] {
  const shuffled = [...users];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Splits shuffled users into team1 and team2.
 * @param {string[]} shuffledUserIds Shuffled user ids.
 * @return {TeamAssignment[]} Team assignments.
 */
function assignTeams(shuffledUserIds: string[]): TeamAssignment[] {
  if (shuffledUserIds.length !== 4) {
    throw new Error("assignTeams requires exactly 4 users");
  }
  return shuffledUserIds.map((userId, index) => ({
    userId,
    team: index < 2 ? "team1" : "team2",
  }));
}

/**
 * Assigns one clueGiver and one clueGuesser per team.
 * @param {TeamAssignment[]} teamAssignments Team assignments.
 * @return {RoleAssignment[]} Team and role assignments.
 */
function assignRolesPerTeam(
  teamAssignments: TeamAssignment[],
): RoleAssignment[] {
  const teams: Team[] = ["team1", "team2"];
  const result: RoleAssignment[] = [];

  for (const team of teams) {
    const usersInTeam = teamAssignments.filter((u) => u.team === team);
    if (usersInTeam.length !== 2) {
      throw new Error(`assignRolesPerTeam requires 2 users in ${team}`);
    }

    const giverIndex = Math.floor(Math.random() * 2);
    result.push({
      userId: usersInTeam[giverIndex].userId,
      team,
      role: "clueGiver",
    });
    result.push({
      userId: usersInTeam[1 - giverIndex].userId,
      team,
      role: "clueGuesser",
    });
  }

  return result;
}

/**
 * Chooses the starting team.
 * @return {Team} Selected starting team.
 */
function pickStartingTeam(): Team {
  return Math.random() < 0.5 ? "team1" : "team2";
}

/**
 * Marks active turn on selected team's clueGiver only.
 * @param {RoleAssignment[]} roleAssignments Team and role assignments.
 * @param {Team} startingTeam Team selected to start.
 * @return {FinalAssignment[]} Final assignments with active turn marker.
 */
function markActiveTurn(
  roleAssignments: RoleAssignment[],
  startingTeam: Team,
): FinalAssignment[] {
  return roleAssignments.map((assignment) => ({
    ...assignment,
    isActiveTurn:
      assignment.team === startingTeam && assignment.role === "clueGiver",
  }));
}

/**
 * Picks a candidate room code using read-only checks: no `rooms` doc has this
 * `code` field at read time. Not atomic with writes; the createRoom transaction
 * is authoritative.
 * @param {Firestore} db Firestore instance.
 * @return {Promise<string>} A code unused in the `code` field at read time.
 */
async function allocateUniqueRoomCode(db: Firestore): Promise<string> {
  const roomsCol = db.collection("rooms");
  const maxAttempts = 50;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const roomCode = randomRoomCode();
    const snap = await roomsCol.where("code", "==", roomCode).get();
    if (snap.empty) {
      return roomCode;
    }
  }

  throw new Error("Could not allocate a unique room code");
}

/**
 * POST /createRoom
 * Body: `{ "uid": string, "roomType": "public" | "private" }`.
 * Verifies `users/{uid}` exists, then creates `rooms/{autoId}` with Firestore’s
 * generated document id stored as `id` and a distinct random `code` field.
 * Host is written to `rooms/{roomId}/users/{uid}`.
 */
export const createRoom = onRequest({cors: true}, async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({success: false});
    return;
  }

  const body = parseJsonBody(req);
  if (!body || typeof body !== "object") {
    res.status(400).json({success: false, error: "Invalid JSON body"});
    return;
  }

  const uid =
    "uid" in body && typeof (body as {uid: unknown}).uid === "string" ?
      (body as {uid: string}).uid.trim() :
      "";
  const roomTypeRaw =
    "roomType" in body &&
    typeof (body as {roomType: unknown}).roomType === "string" ?
      (body as {roomType: string}).roomType.trim() :
      "";

  if (!uid) {
    res.status(400).json({success: false, error: "Missing uid"});
    return;
  }

  let roomType: RoomType;
  if (roomTypeRaw === "public") {
    roomType = "public";
  } else if (roomTypeRaw === "private") {
    roomType = "private";
  } else {
    res.status(400).json({success: false, error: "Invalid roomType"});
    return;
  }

  const db = getFirestore();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    res.status(404).json({success: false, error: "User not found"});
    return;
  }

  const roomsCol = db.collection("rooms");
  const maxWriteAttempts = 50;

  try {
    let room: Room | undefined;
    for (let w = 0; w < maxWriteAttempts; w++) {
      const code = await allocateUniqueRoomCode(db);
      try {
        room = await db.runTransaction(async (tx) => {
          const taken = await tx.get(
            roomsCol.where("code", "==", code).limit(1),
          );
          if (!taken.empty) {
            throw new CodeTakenError();
          }
          const roomRef = roomsCol.doc();
          const hostRoomUser: RoomUser = {
            userId: uid,
            displayName: userSnap.data()?.displayName ?? null,
            photoUrl: userSnap.data()?.photoUrl ?? null,
            role: null,
            team: null,
            isHost: true,
            isActiveTurn: false,
          };
          const roomData: Room = {
            id: roomRef.id,
            code,
            type: roomType,
            turnsPerPlayerHistory: [],
            playersToGuess: [],
            usersCount: 1,
          };
          tx.set(roomRef, roomData);
          tx.set(roomRef.collection("users").doc(uid), hostRoomUser);
          return roomData;
        });
        break;
      } catch (e: unknown) {
        if (e instanceof CodeTakenError) {
          continue;
        }
        throw e;
      }
    }

    if (!room) {
      throw new Error("Could not create room with a unique code");
    }

    res
      .status(201)
      .type("application/json")
      .json({roomId: room.id});
  } catch {
    res.status(500).json({success: false});
  }
});

/**
 * When a room user doc is created, completes team/role assignment once four
 * distinct users exist and roles are not yet set.
 */
export const completeRoom = onDocumentCreated(
  {
    document: "rooms/{roomId}/users/{userId}",
    region: "europe-west1",
  },
  async (event) => {
    const roomId = event.params.roomId;
    if (!roomId) {
      return;
    }

    const db = getFirestore();
    const roomRef = db.collection("rooms").doc(roomId);

    try {
      await db.runTransaction(async (tx) => {
        const roomSnap = await tx.get(roomRef);
        if (!roomSnap.exists) {
          return;
        }
        const roomData = roomSnap.data() as Room | undefined;
        if (!roomData?.id) {
          return;
        }

        if (
          Array.isArray(roomData.turnsPerPlayerHistory) &&
          roomData.turnsPerPlayerHistory.length > 0
        ) {
          return;
        }

        const usersQuery = roomRef.collection("users").limit(16);
        const usersSnap = await tx.get(usersQuery);
        if (usersSnap.size !== 4) {
          return;
        }

        const userDocs = usersSnap.docs;
        const ids = userDocs.map((d) => d.id);
        if (new Set(ids).size !== 4) {
          return;
        }

        for (const d of userDocs) {
          const role = (d.data() as {role?: unknown}).role;
          if (role != null) {
            return;
          }
        }

        const shuffled = shuffleUsers([...ids]);
        const teamAssignments = assignTeams(shuffled);
        const roleAssignments = assignRolesPerTeam(teamAssignments);
        const startingTeam = pickStartingTeam();
        const finalAssignments = markActiveTurn(
          roleAssignments,
          startingTeam,
        );

        const assignmentByUserId = new Map(
          finalAssignments.map((a) => [a.userId, a]),
        );

        for (const d of userDocs) {
          const uid = d.id;
          const row = d.data() as Partial<RoomUser>;
          const a = assignmentByUserId.get(uid);
          if (!a) {
            throw new Error(`Missing assignment for user ${uid}`);
          }
          tx.set(
            roomRef.collection("users").doc(uid),
            {
              userId: typeof row.userId === "string" ? row.userId : uid,
              displayName:
                typeof row.displayName === "string" ? row.displayName : null,
              photoUrl: typeof row.photoUrl === "string" ? row.photoUrl : null,
              role: a.role,
              team: a.team,
              isHost: row.isHost === true,
              isActiveTurn: a.isActiveTurn,
            },
            {merge: true},
          );
        }

        tx.set(
          roomRef,
          {
            turnsPerPlayerHistory: FieldValue.arrayUnion(startingTeam),
          },
          {merge: true},
        );
      });
    } catch (error) {
      console.error("Error completing room setup:", error);
    }
  },
);
