"use strict";

const assert = require("node:assert/strict");
const packs = require("../domain-packs.js");

function run() {
  const all = packs.list();
  assert.equal(all.length, 7);
  assert.deepEqual(
    all.map((pack) => pack.id),
    [
      "cooperative",
      "strata",
      "club-association",
      "mosque-surau",
      "resident-association",
      "ngo-society",
      "professional-association",
    ]
  );

  const resident = packs.get("resident-association", "1.0");
  assert.equal(resident.status, "planned");
  assert.equal(resident.ruleProfileId, "resident-association.my.v1");
  assert.equal(resident.capabilities.nominations, true);
  assert.deepEqual(resident.defaults, {
    noticeDays: 14,
    quorumMode: "configured_fraction",
    votingMode: "show_of_hands_or_poll",
  });
  assert.equal(packs.get("cooperative", "1.0").defaults.noticeDays, 21);

  const defaultContext = packs.resolveOrganization({ id: "org-1", settings: {} });
  assert.equal(defaultContext.pack.id, "cooperative");
  assert.equal(defaultContext.entityVariant, "cooperative");

  const residentContext = packs.resolveOrganization({
    id: "org-2",
    domainPackId: "resident-association",
    domainPackVersion: "1.0",
    entityVariant: "neighbourhood",
  });
  assert.equal(residentContext.pack.id, "resident-association");
  assert.equal(residentContext.entityVariant, "neighbourhood");
  assert.equal(residentContext.ruleProfileId, "resident-association.my.v1");

  assert.throws(
    () => packs.resolveOrganization({ domainPackId: "unknown", domainPackVersion: "1.0" }),
    /Unsupported domain pack/
  );
  assert.throws(
    () => packs.resolveOrganization({ domainPackId: "strata", entityVariant: "cooperative" }),
    /Unsupported strata entity variant/
  );
  assert.throws(
    () => packs.resolveOrganization({ domainPackId: "cooperative", ruleProfileId: "wrong.profile" }),
    /invalid rule profile/
  );
  assert.throws(
    () => packs.validate({
      id: "invalid-defaults",
      version: "1.0",
      status: "planned",
      entityVariants: ["default"],
      displayName: { en: "Invalid" },
      participantLabel: { en: "Members" },
      organizationLabel: { en: "Organization" },
      meetingTypes: ["agm"],
      capabilities: {},
      defaults: { noticeDays: -1, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "invalid-defaults.v1",
    }),
    /invalid noticeDays default/
  );

  assert.equal(Object.isFrozen(resident), true);
  console.log("domain-pack registry and organization resolution passed");
}

run();
