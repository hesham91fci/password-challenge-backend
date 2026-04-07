import type {RoomUser} from "./room_user";

type AssignedTeam = Exclude<RoomUser["team"], null>;
type AssignedRole = Exclude<RoomUser["role"], null>;

/** Team assignment for the room setup stage. */
export type TeamAssignment = {userId: string} & Pick<RoomUser, "team"> & {
  team: AssignedTeam;
};

/** Role assignment after teams are chosen. */
export type RoleAssignment = TeamAssignment & Pick<RoomUser, "role"> & {
  role: AssignedRole;
};

/** Final assignment that marks whose turn is active. */
export type FinalAssignment = RoleAssignment &
  Pick<RoomUser, "isActiveTurn">;
