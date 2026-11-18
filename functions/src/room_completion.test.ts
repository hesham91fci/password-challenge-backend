import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  planRoomCompletion,
  type RoomCompletionPlan,
  type RoomCompletionUser,
} from "./room_completion";
import type {FinalAssignment} from "./models/room_assignment";

const fourNullTeams = (): RoomCompletionUser[] => [
  {id: "u1", role: null, team: null},
  {id: "u2", role: null, team: null},
  {id: "u3", role: null, team: null},
  {id: "u4", role: null, team: null},
];

const fourTeamed = (): RoomCompletionUser[] => [
  {id: "u1", role: null, team: "team1"},
  {id: "u2", role: null, team: "team1"},
  {id: "u3", role: null, team: "team2"},
  {id: "u4", role: null, team: "team2"},
];

describe("planRoomCompletion", () => {
  it("assigns roles when roles are cleared after restart", () => {
    const plan: RoomCompletionPlan | null = planRoomCompletion(
      fourTeamed(),
      {pickStarter: () => "team2"},
    );
    assert.notEqual(plan, null);
    const completed = plan as RoomCompletionPlan;
    assert.equal(completed.startingTeam, "team2");
    assert.equal(completed.assignments.length, 4);

    const team1 = completed.assignments.filter((a) => a.team === "team1");
    const team2 = completed.assignments.filter((a) => a.team === "team2");
    assert.equal(team1.length, 2);
    assert.equal(team2.length, 2);
    assert.equal(team1.filter((a) => a.role === "clueGiver").length, 1);
    assert.equal(team2.filter((a) => a.role === "clueGiver").length, 1);

    const active = completed.assignments.filter((a) => a.isActiveTurn);
    assert.equal(active.length, 1);
    assert.equal(active[0].team, "team2");
    assert.equal(active[0].role, "clueGiver");
  });

  it("preserves client-selected 2v2 teams", () => {
    const users = fourTeamed();
    const plan: RoomCompletionPlan | null = planRoomCompletion(
      users,
      {pickStarter: () => "team1"},
    );
    assert.notEqual(plan, null);
    const completed = plan as RoomCompletionPlan;
    assert.equal(completed.startingTeam, "team1");
    for (const u of users) {
      const assigned: FinalAssignment | undefined =
        completed.assignments.find((a) => a.userId === u.id);
      assert.notEqual(assigned, undefined);
      assert.equal(assigned?.team, u.team);
    }
    const active = completed.assignments.filter((a) => a.isActiveTurn);
    assert.equal(active.length, 1);
    assert.equal(active[0].team, "team1");
    assert.equal(active[0].role, "clueGiver");
  });

  it("returns null when users have no teams", () => {
    const plan = planRoomCompletion(fourNullTeams());
    assert.equal(plan, null);
  });

  it("returns null when teams are not 2v2", () => {
    const users = fourTeamed();
    users[3] = {id: "u4", role: null, team: "team1"};
    const plan = planRoomCompletion(users);
    assert.equal(plan, null);
  });

  it("returns null when any user still has a role", () => {
    const users = fourTeamed();
    users[0] = {id: "u1", role: "clueGiver", team: "team1"};
    const plan = planRoomCompletion(users, {pickStarter: () => "team1"});
    assert.equal(plan, null);
  });

  it("returns null when lobby size is not four", () => {
    const plan = planRoomCompletion(
      fourTeamed().slice(0, 3),
      {pickStarter: () => "team1"},
    );
    assert.equal(plan, null);
  });
});
