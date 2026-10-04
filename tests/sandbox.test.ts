import { describe, expect, it } from "vitest";
import { ArmError } from "../server/azure/arm.ts";
import { openDb } from "../server/db.ts";
import { AZ900, getCourse } from "../server/sandbox/courses.ts";
import { GraphDirectory, type Directory, type DirectoryUser } from "../server/sandbox/graph.ts";
import { groupNameFor, guidFrom, LOCK_ROLE_NAME, markEnded, provisionSandbox, reprovisionSandbox, sandboxPlan, slugOf, substitutionNote, syncSandboxes } from "../server/sandbox/sandbox.ts";
import { getSandbox, listSandboxes } from "../server/sandbox/store.ts";
import { OTHER_SUB, SUB, config } from "./helpers.ts";

const NOW = new Date("2026-10-05T15:00:00Z");
const maria: DirectoryUser = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", displayName: "María Pérez", userPrincipalName: "maria.perez_correo.cr#EXT#@negocio.onmicrosoft.com", mail: "maria.perez@correo.cr", userType: "Guest" };
const juan: DirectoryUser = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", displayName: "Juan Mora", userPrincipalName: "maria.perez@otro.cr", mail: "maria.perez@otro.cr" };

const directory = (users: DirectoryUser[]): Directory => ({ find: async (q) => users.filter((u) => u.mail === q || u.userPrincipalName === q) });

/** An ARM stand-in that remembers which paths exist and records every write, in order. */
function fakeArm(opts: { existing?: string[]; failOn?: string; failWith?: ArmError } = {}) {
  const existing = new Set((opts.existing ?? []).map((p) => p.toLowerCase()));
  const calls: { method: string; path: string; body?: any }[] = [];
  const arm = {
    get: async (path: string) => {
      if (!existing.has(path.split("?")[0]!.toLowerCase())) throw new ArmError("nf", 404, "ResourceGroupNotFound");
      return {};
    },
    raw: async (method: string, path: string, body?: unknown) => {
      if (opts.failOn && path.includes(opts.failOn)) throw opts.failWith ?? new ArmError("denied", 403, "AuthorizationFailed");
      calls.push({ method, path, body });
      if (method === "PUT" && /\/resourcegroups\/[^/?]+\?/i.test(path)) existing.add(path.split("?")[0]!.toLowerCase());
      return { status: 200, headers: new Headers(), body: {} };
    },
    lro: async (method: string, path: string) => {
      calls.push({ method, path });
      existing.delete(path.split("?")[0]!.toLowerCase());
      return undefined;
    },
  };
  return { arm: arm as never, calls, existing };
}

const deps = (arm: unknown, users: DirectoryUser[] = [maria], db = openDb(":memory:")) => ({ arm: arm as never, db, config, directory: directory(users), now: () => NOW });
const RG = `/subscriptions/${SUB}/resourcegroups/stu-maria-perez-az900`;

describe("naming", () => {
  it("makes a short lower-case slug from an email", () => {
    expect(slugOf("María.Pérez+clase@correo.cr")).toBe("mar-a-p-rez-clase");
    expect(slugOf("a_very.long.address.that.keeps.going.on@x.cr").length).toBeLessThanOrEqual(24);
    expect(slugOf("@@")).toBe("student");
    expect(groupNameFor("maria.perez@correo.cr", AZ900)).toBe("stu-maria-perez-az900");
  });

  it("derives the same GUID from the same names and a different one otherwise", () => {
    expect(guidFrom("a", "b")).toBe(guidFrom("A", "B"));
    expect(guidFrom("a", "b")).not.toBe(guidFrom("a", "c"));
    expect(guidFrom("a", "b")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("the plan for one sandbox", () => {
  const plan = sandboxPlan({ sub: SUB, rgName: "stu-maria-perez-az900", course: AZ900, objectId: maria.id, location: "centralus", tags: { managedBy: "labctl" }, owner: "me@example.com", now: NOW });

  it("gives the student Contributor plus only the lock role, on their group, and never on the subscription", () => {
    expect(plan.roleAssignments.map((r) => r.label)).toEqual(["Contributor", LOCK_ROLE_NAME]);
    for (const r of plan.roleAssignments) {
      expect(r.path).toContain(`/resourceGroups/stu-maria-perez-az900/providers/Microsoft.Authorization/roleAssignments/`);
      expect(r.body.properties).toMatchObject({ principalId: maria.id, principalType: "User" });
    }
    expect(plan.roleAssignments[0]!.body.properties.roleDefinitionId).toMatch(/b24988ac-6180-42a0-ab88-20f7382dd24c$/);
    expect(plan.roleAssignments[1]!.body.properties.roleDefinitionId).toContain(plan.lockRole.id);
  });

  it("defines a lock role that can do nothing else, assignable in this subscription only", () => {
    const p = plan.lockRole.body.properties;
    expect(p.permissions[0]!.actions).toEqual(["Microsoft.Authorization/locks/read", "Microsoft.Authorization/locks/write", "Microsoft.Authorization/locks/delete"]);
    expect(p.assignableScopes).toEqual([`/subscriptions/${SUB}`]);
    expect(JSON.stringify(p)).not.toMatch(/roleAssignments|policy|\*/);
  });

  it("assigns the two policies at the group with the parameter names Azure defines", () => {
    const [loc, types] = plan.policies;
    expect(loc!.body.properties.policyDefinitionId).toMatch(/e56962a6-4747-49cd-b67b-bf8b01975c4c$/);
    expect((loc!.body.properties.parameters as any).listOfAllowedLocations.value).toEqual(AZ900.allowedLocations);
    expect(types!.body.properties.policyDefinitionId).toMatch(/6c112d4e-5bc7-47ae-a041-ea2d9dccd749$/);
    expect((types!.body.properties.parameters as any).listOfResourceTypesNotAllowed.value).toEqual(AZ900.blockedTypes);
    for (const p of plan.policies) expect(p.path).toContain(`/resourceGroups/stu-maria-perez-az900/providers/Microsoft.Authorization/policyAssignments/`);
  });

  it("does not block what the AZ-900 labs use: a VM, its network and disk, storage, locks, and a Central US group", () => {
    const used = ["Microsoft.Compute/virtualMachines", "Microsoft.Compute/disks", "Microsoft.Network/virtualNetworks", "Microsoft.Network/networkInterfaces", "Microsoft.Network/networkSecurityGroups", "Microsoft.Network/publicIPAddresses", "Microsoft.Storage/storageAccounts", "Microsoft.Authorization/locks"];
    for (const t of used) expect(AZ900.blockedTypes, t).not.toContain(t);
    expect(AZ900.allowedLocations).toContain("centralus");
  });

  it("sets a monthly budget on the group that mails the owner at 80% and 100%", () => {
    const b = plan.budget.body.properties;
    expect(plan.budget.path).toContain("/resourceGroups/stu-maria-perez-az900/providers/Microsoft.Consumption/budgets/");
    expect(b).toMatchObject({ amount: 25, timeGrain: "Monthly", timePeriod: { startDate: "2026-10-01T00:00:00Z" } });
    expect(Object.values(b.notifications).map((n: any) => [n.threshold, n.contactEmails])).toEqual([[80, ["me@example.com"]], [100, ["me@example.com"]]]);
  });
});

describe("provisioning", () => {
  it("creates the role, the group, two role assignments, two policies and a budget, in that order, and records it", async () => {
    const { arm, calls } = fakeArm();
    const d = deps(arm);
    const r = await provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" });
    const kind = (path: string) => (/roleDefinitions/.test(path) ? "role" : /roleAssignments/.test(path) ? "assignment" : /policyAssignments/.test(path) ? "policy" : /budgets/.test(path) ? "budget" : "group");
    expect(calls.map((c) => `${c.method} ${kind(c.path)}`)).toEqual(["PUT role", "PUT group", "PUT assignment", "PUT assignment", "PUT policy", "PUT policy", "PUT budget"]);
    expect(calls[1]!.path).toContain("/resourcegroups/stu-maria-perez-az900?");
    expect(calls[1]!.body.tags).toMatchObject({ managedBy: "labctl", owner: "me@example.com", kind: "student-sandbox", course: "az-900", student: "maria.perez@correo.cr", expiresOn: "2026-10-19T15:00:00.000Z" });
    expect(r.record).toMatchObject({ rg_name: "stu-maria-perez-az900", status: "active", object_id: maria.id, expires_on: "2026-10-19T15:00:00.000Z", budget_usd: 25 });
    expect(getSandbox(d.db, "stu-maria-perez-az900")?.status).toBe("active");
    expect(r.note).toContain("IntroAzureRG");
    expect(r.note).toContain("stu-maria-perez-az900");
  });

  it("honours a lifetime in days and rejects nonsense", async () => {
    const r = await provisionSandbox(deps(fakeArm().arm), { student: "maria.perez@correo.cr", course: "az-900", days: 3 });
    expect(r.record.expires_on).toBe("2026-10-08T15:00:00.000Z");
    for (const days of [0, 91, 1.5]) await expect(provisionSandbox(deps(fakeArm().arm), { student: "maria.perez@correo.cr", course: "az-900", days })).rejects.toThrow(/Days/);
  });

  it("refuses an unknown course, a subscription outside the allow-list, and people it cannot pin down", async () => {
    await expect(provisionSandbox(deps(fakeArm().arm), { student: "maria.perez@correo.cr", course: "az-104" })).rejects.toThrow(/Unknown course/);
    await expect(provisionSandbox(deps(fakeArm().arm), { student: "maria.perez@correo.cr", course: "az-900", subscriptionId: OTHER_SUB })).rejects.toThrow(/allow-list/);
    await expect(provisionSandbox(deps(fakeArm().arm, []), { student: "nadie@correo.cr", course: "az-900" })).rejects.toThrow(/No one in the business tenant/);
    const twin = { ...juan, mail: "maria.perez@correo.cr" };
    await expect(provisionSandbox(deps(fakeArm().arm, [maria, twin]), { student: "maria.perez@correo.cr", course: "az-900" })).rejects.toThrow(/2 people match/);
  });

  it("does not create a second active sandbox for the same student, and does not take over an unrelated group", async () => {
    const { arm } = fakeArm();
    const d = deps(arm);
    await provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" });
    await expect(provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" })).rejects.toThrow(/already has the sandbox/);
    await expect(provisionSandbox(deps(fakeArm({ existing: [RG] }).arm), { student: "maria.perez@correo.cr", course: "az-900" })).rejects.toThrow(/already exists and is not an active sandbox/);
  });

  it("gives a second student with the same name part a suffixed group instead of colliding", async () => {
    const { arm } = fakeArm();
    const d = deps(arm, [maria, juan]);
    await provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" });
    const second = await provisionSandbox(d, { student: "maria.perez@otro.cr", course: "az-900" });
    expect(second.record.rg_name).toBe("stu-maria-perez-az900-bbbb");
  });

  it("removes the half-built group and records the failure when a step is refused", async () => {
    const { arm, calls, existing } = fakeArm({ failOn: "policyAssignments" });
    const d = deps(arm);
    await expect(provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" })).rejects.toThrow(/Could not create the sandbox: denied/);
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(existing.has(RG)).toBe(false);
    expect(getSandbox(d.db, "stu-maria-perez-az900")).toMatchObject({ status: "failed", error: expect.stringContaining("denied") });
  });

  it("treats an already-existing identical role assignment as done", async () => {
    const { arm } = fakeArm({ failOn: "roleAssignments", failWith: new ArmError("exists", 409, "RoleAssignmentExists") });
    const r = await provisionSandbox(deps(arm), { student: "maria.perez@correo.cr", course: "az-900" });
    expect(r.record.status).toBe("active");
  });
});

describe("after the student's group is gone", () => {
  it("marks the sandbox ended, and creates it again with the same group name, student and a new expiry", async () => {
    const { arm, existing } = fakeArm();
    const d = deps(arm);
    await provisionSandbox(d, { student: "maria.perez@correo.cr", course: "az-900" });
    await expect(reprovisionSandbox(d, "stu-maria-perez-az900")).rejects.toThrow(/still exists/);
    existing.delete(RG); // the student deleted it, as the lab says
    expect((await syncSandboxes(d, NOW))[0]).toMatchObject({ status: "ended", ended_at: NOW.toISOString() });
    const again = await reprovisionSandbox({ ...d, now: () => new Date("2026-10-10T00:00:00Z") }, "stu-maria-perez-az900", 7);
    expect(again.record).toMatchObject({ status: "active", expires_on: "2026-10-17T00:00:00.000Z", object_id: maria.id, ended_at: null });
    expect(listSandboxes(d.db)).toHaveLength(1);
  });

  it("will not reprovision a sandbox it does not know, and markEnded ignores one it does not know", async () => {
    await expect(reprovisionSandbox(deps(fakeArm().arm), "stu-nobody-az900")).rejects.toThrow(/No sandbox named/);
    expect(() => markEnded(openDb(":memory:"), "stu-nobody-az900")).not.toThrow();
  });
});

describe("the message for the student", () => {
  it("names the group to use instead of the lab's, the regions, locks, Cloud Shell and the end date", () => {
    const note = substitutionNote("stu-maria-perez-az900", AZ900, "2026-10-19T15:00:00.000Z");
    expect(note).toContain("`IntroAzureRG`");
    expect(note).toContain("stu-maria-perez-az900");
    expect(note).toContain("centralus");
    expect(note).toMatch(/Cloud Shell/);
    expect(note).toContain("2026-10-19");
  });
});

describe("looking people up in the directory", () => {
  const graph = (body: unknown, status = 200) => {
    const urls: string[] = [];
    const g = new GraphDirectory({ getToken: async () => "tok", fetchImpl: (async (u: string, init: { headers: Record<string, string> }) => {
      urls.push(`${u} ${init.headers.authorization}`);
      return new Response(JSON.stringify(body), { status });
    }) as never });
    return { g, urls };
  };

  it("searches sign-in name and mail with the token, and escapes the address", async () => {
    const { g, urls } = graph({ value: [maria] });
    await expect(g.find("maria.perez@correo.cr")).resolves.toEqual([maria]);
    expect(decodeURIComponent(urls[0]!)).toContain("userPrincipalName eq 'maria.perez@correo.cr' or mail eq 'maria.perez@correo.cr'");
    expect(urls[0]).toContain("Bearer tok");
    await expect(g.find("o'brien@correo.cr")).resolves.toBeDefined();
    expect(decodeURIComponent(urls[1]!)).toContain("o''brien@correo.cr");
  });

  it("rejects anything that is not an email address, and explains a refusal", async () => {
    await expect(graph({ value: [] }).g.find("x' or 1 eq 1 or '")).rejects.toThrow(/does not look like an email/);
    await expect(graph({}, 403).g.find("a@b.cr")).rejects.toThrow(/not be allowed to read users/);
  });
});

describe("course packs", () => {
  it("only AZ-900 exists for now, and every pack has regions, a budget and a lifetime", () => {
    expect(getCourse("az-900")).toBe(AZ900);
    expect(() => getCourse("az-104")).toThrow(/Unknown course/);
    expect(AZ900.budgetUsd).toBeGreaterThan(0);
    expect(AZ900.ttlDays).toBeGreaterThan(0);
  });
});
