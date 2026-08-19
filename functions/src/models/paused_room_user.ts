import type {Role} from "./role";
import type {Team} from "./team";

/** Matches Dart `PausedRoomUser`. */
export interface PausedRoomUser {
  userId?: string | null;
  role?: Role | null;
  team?: Team | null;
}
