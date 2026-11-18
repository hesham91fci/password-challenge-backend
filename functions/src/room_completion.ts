import type {
  FinalAssignment,
  RoleAssignment,
  TeamAssignment,
} from "./models/room_assignment";
import type {Team} from "./models/team";
import {logger} from "firebase-functions/v2";

/** Minimal user doc fields needed to plan room completion. */
export type RoomCompletionUser = {
  id: string;
  role: unknown;
  team: unknown;
};

/** Result of planning a full lobby team/role/active-turn assignment. */
export type RoomCompletionPlan = {
  assignments: FinalAssignment[];
  startingTeam: Team;
};

/**
 * Assigns one clueGiver and one clueGuesser per team.
 * @param {TeamAssignment[]} teamAssignments Team assignments.
 * @return {RoleAssignment[]} Team and role assignments.
 */
export function assignRolesPerTeam(
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
export function pickStartingTeam(): Team {
  return Math.random() < 0.5 ? "team1" : "team2";
}

/**
 * Marks active turn on selected team's clueGiver only.
 * @param {RoleAssignment[]} roleAssignments Team and role assignments.
 * @param {Team} startingTeam Team selected to start.
 * @return {FinalAssignment[]} Final assignments with active turn marker.
 */
export function markActiveTurn(
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
 * Builds team assignments from each user's existing `team` field.
 * Returns null when any team is missing or the lobby is not exactly 2v2.
 * @param {RoomCompletionUser[]} users User snapshots.
 * @return {TeamAssignment[] | null} Assignments or null if invalid.
 */
export function teamAssignmentsFromExistingUsers(
  users: RoomCompletionUser[],
): TeamAssignment[] | null {
  const assignments: TeamAssignment[] = [];
  let team1Count = 0;
  let team2Count = 0;
  for (const u of users) {
    const team = u.team;
    if (team !== "team1" && team !== "team2") {
      return null;
    }
    if (team === "team1") {
      team1Count += 1;
    } else {
      team2Count += 1;
    }
    assignments.push({userId: u.id, team});
  }
  if (team1Count !== 2 || team2Count !== 2) {
    return null;
  }
  return assignments;
}

export type RoomCompletionRng = {
  pickStarter?: () => Team;
};

/**
 * Plans role/active-turn assignment when the lobby has four users with all
 * roles cleared and client-selected 2v2 teams. Ignores prior `turnsPerRound`
 * so restart can re-complete.
 * @param {RoomCompletionUser[]} users Lobby users.
 * @param {RoomCompletionRng | undefined} rng Optional deterministic helpers.
 * @return {RoomCompletionPlan | null} Plan to persist, or null to no-op.
 */
export function planRoomCompletion(
  users: RoomCompletionUser[],
  rng?: RoomCompletionRng,
): RoomCompletionPlan | null {
  logger.info("going to complete the room");
  if (users.length !== 4) {
    return null;
  }
  const ids = users.map((u) => u.id);
  if (new Set(ids).size !== 4) {
    return null;
  }
  for (const u of users) {
    if (u.role != null) {
      return null;
    }
  }
  logger.info("Planning room completion", {users});
  const teamAssignments = teamAssignmentsFromExistingUsers(users);
  if (teamAssignments == null) {
    return null;
  }

  const roleAssignments = assignRolesPerTeam(teamAssignments);
  const pickStarter = rng?.pickStarter ?? pickStartingTeam;
  const startingTeam = pickStarter();
  const assignments = markActiveTurn(roleAssignments, startingTeam);
  return {assignments, startingTeam};
}
