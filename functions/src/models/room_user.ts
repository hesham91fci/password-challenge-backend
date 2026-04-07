import type {Role} from "./role";
import type {Team} from "./team";

/** Matches Dart `RoomUser`. */
export interface RoomUser {
  userId: string | null;
  displayName: string | null;
  photoUrl: string | null;
  role: Role | null;
  team: Team | null;
  isHost: boolean;
  isActiveTurn: boolean;
}
