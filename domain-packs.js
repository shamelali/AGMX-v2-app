// ============================================================
// AGMX — Versioned governance domain-pack registry
// ------------------------------------------------------------
// The authenticated organization selects the domain pack. Commercial plans,
// organization variants, meeting types, and rule profiles remain separate.
// This registry is deliberately metadata-only: it does not make legal
// determinations or replace server-side authorization.
// ============================================================

(function (root) {
  "use strict";

  const PACKS = [
    {
      id: "cooperative",
      version: "1.0",
      status: "baseline",
      entityVariants: ["cooperative", "federation"],
      displayName: { ms: "Koperasi", en: "Cooperative" },
      participantLabel: { ms: "Anggota", en: "Members" },
      organizationLabel: { ms: "Koperasi", en: "Cooperative" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: false,
        nominations: true,
        elections: true,
        hybridMeeting: true,
        propertyUnits: false,
      },
      defaults: { noticeDays: 21, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "cooperative.my.v1",
    },
    {
      id: "strata",
      version: "1.0",
      status: "specified",
      entityVariants: ["jmb", "mc", "sub-mc"],
      displayName: { ms: "Pengurusan Strata", en: "Strata Management" },
      participantLabel: { ms: "Pemilik/Pembeli", en: "Owners/Purchasers" },
      organizationLabel: { ms: "Badan Pengurusan", en: "Management Body" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: true,
        nominations: true,
        elections: true,
        hybridMeeting: true,
        propertyUnits: true,
      },
      defaults: { noticeDays: null, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "strata.my.v1",
    },
    {
      id: "club-association",
      version: "1.0",
      status: "specified",
      entityVariants: ["club", "association"],
      displayName: { ms: "Kelab/Persatuan", en: "Club/Association" },
      participantLabel: { ms: "Ahli", en: "Members" },
      organizationLabel: { ms: "Kelab/Persatuan", en: "Club/Association" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: false,
        nominations: true,
        elections: true,
        hybridMeeting: false,
        propertyUnits: false,
      },
      defaults: { noticeDays: null, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "club-association.my.v1",
    },
    {
      id: "mosque-surau",
      version: "1.0",
      status: "specified",
      entityVariants: ["mosque", "surau"],
      displayName: { ms: "Masjid/Surau", en: "Mosque/Surau" },
      participantLabel: { ms: "Ahli Kariah", en: "Registered Congregants" },
      organizationLabel: { ms: "Masjid/Surau", en: "Mosque/Surau" },
      meetingTypes: ["special-election", "special"],
      capabilities: {
        proxies: false,
        weightedVoting: false,
        nominations: true,
        elections: true,
        hybridMeeting: false,
        propertyUnits: false,
      },
      defaults: { noticeDays: null, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "mosque-surau.my.v1",
    },
    {
      id: "resident-association",
      version: "1.0",
      status: "planned",
      entityVariants: ["neighbourhood", "community"],
      displayName: { ms: "Persatuan Penduduk", en: "Resident Association" },
      participantLabel: { ms: "Penduduk", en: "Residents" },
      organizationLabel: { ms: "Persatuan", en: "Association" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: false,
        nominations: true,
        elections: true,
        hybridMeeting: true,
        propertyUnits: false,
      },
      defaults: { noticeDays: 14, quorumMode: "configured_fraction", votingMode: "show_of_hands_or_poll" },
      ruleProfileId: "resident-association.my.v1",
    },
    {
      id: "ngo-society",
      version: "1.0",
      status: "planned",
      entityVariants: ["ngo", "society"],
      displayName: { ms: "NGO/Pertubuhan", en: "NGO/Society" },
      participantLabel: { ms: "Ahli", en: "Members" },
      organizationLabel: { ms: "Pertubuhan", en: "Society" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: false,
        nominations: true,
        elections: true,
        hybridMeeting: true,
        propertyUnits: false,
      },
      defaults: { noticeDays: null, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "ngo-society.my.v1",
    },
    {
      id: "professional-association",
      version: "1.0",
      status: "planned",
      entityVariants: ["professional", "chapter"],
      displayName: { ms: "Persatuan Profesional", en: "Professional Association" },
      participantLabel: { ms: "Ahli Profesional", en: "Professional Members" },
      organizationLabel: { ms: "Persatuan", en: "Association" },
      meetingTypes: ["agm", "egm", "special"],
      capabilities: {
        proxies: true,
        weightedVoting: true,
        nominations: true,
        elections: true,
        hybridMeeting: true,
        propertyUnits: false,
      },
      defaults: { noticeDays: null, quorumMode: "configured", votingMode: "configured" },
      ruleProfileId: "professional-association.my.v1",
    },
  ];

  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.keys(value).forEach((key) => freeze(value[key]));
    return Object.freeze(value);
  }

  function key(id, version) {
    return `${id}@${version}`;
  }

  function validate(pack) {
    if (!pack || typeof pack !== "object") throw new Error("Domain pack must be an object.");
    ["id", "version", "status", "displayName", "participantLabel", "organizationLabel",
      "meetingTypes", "capabilities", "defaults", "ruleProfileId"].forEach((field) => {
      if (!pack[field]) throw new Error(`Domain pack is missing ${field}.`);
    });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pack.id)) throw new Error("Domain pack id is invalid.");
    if (!/^\d+\.\d+$/.test(pack.version)) throw new Error("Domain pack version is invalid.");
    if (!Array.isArray(pack.meetingTypes) || pack.meetingTypes.length === 0) {
      throw new Error(`Domain pack ${pack.id} needs a meeting type.`);
    }
    if (!Array.isArray(pack.entityVariants) || pack.entityVariants.length === 0) {
      throw new Error(`Domain pack ${pack.id} needs an entity variant.`);
    }
    const defaults = pack.defaults;
    if (defaults.noticeDays !== null &&
        (!Number.isSafeInteger(defaults.noticeDays) || defaults.noticeDays < 0)) {
      throw new Error(`Domain pack ${pack.id} has invalid noticeDays default.`);
    }
    if (typeof defaults.quorumMode !== "string" || !defaults.quorumMode.trim() ||
        typeof defaults.votingMode !== "string" || !defaults.votingMode.trim()) {
      throw new Error(`Domain pack ${pack.id} has invalid governance defaults.`);
    }
    return true;
  }

  PACKS.forEach((pack) => validate(pack));
  const byKey = new Map(PACKS.map((pack) => [key(pack.id, pack.version), freeze(pack)]));

  const api = Object.freeze({
    defaultId: "cooperative",
    defaultVersion: "1.0",
    list() { return Array.from(byKey.values()); },
    validate,
    get(id, version = "1.0") {
      const pack = byKey.get(key(id, version));
      if (!pack) throw new Error(`Unsupported domain pack: ${id}@${version}`);
      return pack;
    },
    resolveOrganization(organization) {
      const org = organization || {};
      let settings = org.settings || {};
      if (typeof settings === "string") {
        try { settings = JSON.parse(settings); } catch (_) { settings = {}; }
      }
      const id = org.domainPackId || settings.domainPackId || this.defaultId;
      const version = org.domainPackVersion || settings.domainPackVersion || this.defaultVersion;
      const pack = this.get(id, version);
      if (pack.status === "disabled") {
        throw new Error(`Domain pack is disabled: ${id}@${version}`);
      }
      const variant = org.entityVariant || settings.entityVariant || pack.entityVariants[0];
      if (!pack.entityVariants.includes(variant)) {
        throw new Error(`Unsupported ${id} entity variant: ${variant}`);
      }
      const storedRuleProfile = org.ruleProfileId || settings.ruleProfileId || "";
      if (storedRuleProfile && storedRuleProfile !== pack.ruleProfileId) {
        throw new Error(`Domain pack ${id}@${version} has an invalid rule profile.`);
      }
      return Object.freeze({
        pack,
        entityVariant: variant,
        domainPackId: pack.id,
        domainPackVersion: pack.version,
        ruleProfileId: pack.ruleProfileId,
      });
    },
  });

  root.AGMX_DOMAIN_PACKS = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
