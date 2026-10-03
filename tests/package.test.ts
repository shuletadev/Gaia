import { describe, expect, it } from "vitest";
import { forbiddenPaths, packageName, personalIdentifiers, startHere } from "../scripts/packageLib.ts";

describe("package", () => {
  it("blocks personal config, local data, icons and secrets", () => {
    const paths = ["README.md", "labctl.config.json", "labctl.config.example.json", "data/labctl.db", "web/public/azure-icons/a.svg", "web/public/gaia.svg", "blueprints/custom-x/main.bicep", "blueprints/apim-classic/main.bicep", ".env.local", "certs/lab.pfx", "server/index.ts"];
    expect(forbiddenPaths(paths)).toEqual(["labctl.config.json", "data/labctl.db", "web/public/azure-icons/a.svg", "blueprints/custom-x/main.bicep", ".env.local", "certs/lab.pfx"]);
  });

  it("collects identifiers from config and audits, skipping generic and allowed names", () => {
    const ids = personalIdentifiers(
      {
        tenantId: "11111111-2222-3333-4444-555555555555",
        owner: "me@example.com",
        subscriptions: [{ id: "00000000-0000-0000-0000-000000000000", name: "Lab Sandbox" }],
        excludedResourceGroups: ["GovernanceRG", "NetworkWatcherRG"],
      },
      [{ subscription: { name: "Lab Sandbox" }, resourceGroups: [{ name: "SharedEnv" }, { name: "MC_rg_aks_eastus" }, { name: "rg" }], findings: [{ name: "HubFirewall-pip" }], topResources: [{ name: "contoso-apim" }] }],
      ["contoso-apim"],
    );
    expect(ids).toEqual(["11111111-2222-3333-4444-555555555555", "GovernanceRG", "HubFirewall-pip", "Lab Sandbox", "me@example.com", "SharedEnv"]);
  });

  it("names the package and stamps the note with version and build", () => {
    expect(packageName({ version: "0.2.0", commit: "abc1234" })).toBe("Gaia-0.2.0-abc1234");
    const note = startHere({ version: "0.2.0", commit: "abc1234", date: "2026-10-03" });
    expect(note).toContain("Version 0.2.0 · build abc1234 · packaged 2026-10-03");
    expect(note).toContain("127.0.0.1");
    expect(note).toContain("npm start");
  });
});
