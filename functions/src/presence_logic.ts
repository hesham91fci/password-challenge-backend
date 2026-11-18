export type PresenceState = "online" | "offline";

export interface PresencePayload {
  state?: PresenceState;
  roomId?: string;
  lastChanged?: number;
}

/**
 * @param {unknown} value RTDB snapshot value.
 * @return {PresencePayload | null} Parsed presence or null.
 */
export function readPresence(value: unknown): PresencePayload | null {
  if (value == null || typeof value !== "object") {
    return null;
  }
  return value as PresencePayload;
}

/**
 * @param {PresencePayload | null} presence Current presence payload.
 * @param {string} roomId Room id from the delayed task.
 * @return {boolean} Whether the user should be removed from the room.
 */
export function shouldRemoveStaleRoomUser(
  presence: PresencePayload | null,
  roomId: string,
): boolean {
  return presence?.state === "offline" && presence.roomId === roomId;
}
