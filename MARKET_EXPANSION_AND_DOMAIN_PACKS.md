# AGMX Market Expansion and Domain Packs

**Status:** Decision record and implementation specification  
**Decision date:** 2026-10-15  
**Owner:** AGMX product and engineering  

## 1. Decision

AGMX will expand from a cooperative-only product into a configurable
**membership-governance operating system**. The shared governance engine will
remain common across markets; each market will be represented by a versioned
**domain pack** rather than a separate codebase.

The first expansion market will be **Resident Associations and Neighbourhood
Committees**, beginning with a narrow JMB/MC-style governance workflow. NGO and
Professional Association packs will follow after the first expansion pack has
passed its acceptance tests.

This is an architectural expansion, not a claim that every market is already
production-ready. Each domain pack must be reviewed against its applicable
constitution, legislation, regulator guidance, and customer operating rules
before being used for a live meeting.

## 2. Product editions

The current supplied specifications define four domain editions:

1. **Cooperative** — the original AGMX Governance / Hub / Control / LIVE
   product, governed by cooperative rules such as GP14, applicable legislation,
   and the cooperative's UUK.
2. **Condo / Strata** — JMB, MC, and Sub-MC governance. These are entity
   variants within one strata pack, not three separate products.
3. **Club / Association** — registered clubs and associations with AGM/EGM,
   member registers, committee elections, and constitution-based rules.
4. **Mosque / Surau** — mosque and surau governance, kariah registration,
   nomination, committee selection, and authority appointment workflows.

The commercial plan (`Small`, `Growth`, `Enterprise`, or equivalent) is not a
domain edition. Meeting type (`AGM`, `EGM`, or a special meeting) is not a
domain edition either. These concepts must remain separate in data and code.

The next three target packs are:

| Order | Domain pack | Why now | Initial scope |
|---|---|---|---|
| 1 | Resident Association | Closest adjacency to strata and cooperative governance; lower complexity than regulated religious workflows | Committee, residents/owners, notices, quorum, motions, elections, resolutions, actions |
| 2 | NGO / Society | Large reusable member-governance pattern with constitution-driven rules | Member classes, AGM/EGM, committee elections, annual reports, audit documents |
| 3 | Professional Association | Strong recurring need for member eligibility, delegates, elections, and branch governance | Membership classes, branch/delegate voting, credential status, resolutions |

## 3. Shared governance core

The following capabilities remain common to every pack:

- organization and user tenancy;
- member or participant registry;
- roles and permissions;
- meeting lifecycle;
- notice and delivery evidence;
- meeting pack and document versions;
- registration, attendance, and quorum calculation;
- agenda, questions, motions, and resolutions;
- nominations and elections;
- voting and ballot receipts;
- minutes drafting, human verification, and lock;
- action tracking and resolution follow-up;
- compliance tasks and findings;
- evidence vault and audit events;
- physical, hybrid, and online participation where enabled;
- subscription, invoice, payment, and usage controls.

The core must not assume that all participants are cooperative members, that
all votes are one-person-one-vote, or that every meeting is an AGM. Those rules
belong to the active domain pack and meeting configuration.

## 4. Domain-pack contract

Every organization must resolve to a canonical, versioned pack:

```text
domainPackId       = resident-association
domainPackVersion  = 1.0
entityVariant      = neighbourhood | jmb | mc | sub-mc
commercialPlan     = small | growth | enterprise
ruleProfileId      = resident-association.my.v1
```

`domainPackId` is authoritative on the authenticated organization. A browser
query parameter, hostname, or client-supplied organization value must never be
used to authorize access or override the organization's pack.

The first implementation should expose the following stable contract to the
UI and API:

```js
{
  id: "resident-association",
  version: "1.0",
  entityVariant: "neighbourhood",
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
    propertyUnits: false
  },
  defaults: {
    noticeDays: 14,
    quorumMode: "configured_fraction",
    votingMode: "show_of_hands_or_poll"
  },
  ruleProfileId: "resident-association.my.v1"
}
```

The exact storage representation may be PocketBase records, Neon tables, or a
checked-in registry module, but the contract must be validated and versioned.
Do not use unvalidated arbitrary JSON as the only source of product behavior.

### Separation of concerns

| Concept | Meaning | Example |
|---|---|---|
| Domain pack | Governance vocabulary and rules | `cooperative`, `resident-association` |
| Entity variant | Subtype inside a pack | `jmb`, `mc`, `sub-mc` |
| Commercial plan | Capacity, support, and usage entitlement | `small`, `growth`, `enterprise` |
| Meeting type | The event being conducted | `agm`, `egm`, `special` |
| Rule profile | Versioned legal/constitutional configuration | `strata.my.putrajaya.v1` |

## 5. Resident Association pack — phase 1

### Target customer

Resident associations, neighbourhood committees, and community management
bodies that need a defensible record of membership, notices, attendance,
decisions, committee elections, and follow-up actions.

The first release intentionally does **not** attempt to become a full property
management or accounting system. It manages governance events and links to
supporting evidence.

### Core roles

- association administrator;
- secretary;
- chairperson;
- treasurer;
- committee member;
- resident/member;
- proxy or authorized representative;
- observer or invited guest;
- property or community manager, where configured.

### Core records

- association and governance profile;
- resident/member register;
- household or unit reference, when the association uses one;
- committee and committee members;
- AGM, EGM, or special meeting;
- notice, acknowledgement, and delivery event;
- attendance and proxy record;
- agenda item, motion, question, and resolution;
- candidate, nomination, and election result;
- minutes draft, verification, and locked minutes;
- action item and evidence document;
- incident and audit event.

### Initial workflow

```text
Create association
  → configure constitution/rule profile
  → maintain resident/member register
  → create AGM/EGM
  → publish notice and meeting pack
  → accept motions and nominations
  → register attendance and proxies
  → establish quorum
  → conduct agenda, discussion, and voting
  → elect committee where applicable
  → verify minutes and resolutions
  → track actions and archive evidence
```

### Rules that must be configurable

The pack must not hard-code one universal rule. At minimum it must support:

- ordinary and special meeting types;
- notice period by meeting/resolution type;
- quorum as a fraction, fixed minimum, or configured fallback;
- whether proxies are permitted and how they are validated;
- eligibility to attend, propose, second, vote, and stand for election;
- show-of-hands, poll, secret ballot, or administrator-recorded vote;
- one-person-one-vote or weighted vote mode;
- committee size and office requirements;
- notice and document delivery evidence;
- required post-meeting filings or acknowledgements;
- constitutional exceptions and effective dates.

### Explicit non-goals for phase 1

- maintenance-fee collection or arrears enforcement;
- contractor or facility work-order management;
- full strata title, parcel, or share-unit accounting;
- legal determination of ownership;
- automatic legal compliance certification;
- replacing the applicable management body or government authority.

## 6. NGO / Society pack — phase 2

The NGO/Society pack reuses the member-governance core but adds constitution
and membership-class configuration.

### Initial scope

- ordinary and extraordinary general meetings;
- member classes and voting eligibility;
- committee and office-bearer elections;
- proposer/seconder and motion deadlines;
- annual report, audited statement, and constitution documents;
- branch or chapter support where the society has multiple units;
- post-meeting resolutions, action owners, and evidence.

### Required differences from Resident Association

- membership may be individual, institutional, student, honorary, or life
  membership;
- quorum and notice rules must be sourced from the constitution or applicable
  regulator requirements;
- some members may attend but not vote, while others may vote by delegate;
- annual reports and audited statements are first-class meeting-pack items;
- the pack must support constitution amendments and effective-date tracking.

## 7. Professional Association pack — phase 3

The Professional Association pack targets associations with credentialed
members, branches, chapters, or delegate structures.

### Initial scope

- member classes and professional status;
- branch/chapter membership;
- delegate appointment and entitlement;
- elections and secret ballots;
- annual general meetings, special meetings, and resolutions;
- credential, licence, or CPD status displayed only where authorized;
- committee, council, and subcommittee records.

### Required differences from NGO / Society

- eligibility may depend on current professional status, not only active
  membership;
- a branch may nominate delegates or candidates;
- voting may be by member, branch, or weighted delegate entitlement;
- professional data must be minimized and access-controlled;
- the pack should support regional or national roll-ups without exposing
  private member records to another branch.

## 8. Data and authorization rules

### Canonical organization context

The authenticated organization remains the only authority for tenancy and pack
selection. A future hostname resolver may select public branding, but it must
not grant access, change `organizationId`, or override `domainPackId`.

The organization context returned to the browser should include:

```text
organizationId
domainPackId
domainPackVersion
entityVariant
commercialPlan
ruleProfileId
capabilities
labels
```

### Migration constraints

- Existing cooperative organizations must receive an explicit `cooperative@1.0`
  default pack during migration.
- The existing commercial `plan` field must not be repurposed as a domain
  identifier.
- The existing AGM `edition` field is reserved for meeting sequence/version
  semantics and must not be reused for market identity.
- Pack changes must be audited and must not rewrite historical meeting rules,
  ballots, minutes, or evidence.
- New domain-specific fields should be added through forward migrations.
- A pack can be disabled for new organizations without making historical
  records unreadable.

### Rule selection

Compliance and workflow rules must be selected by:

```text
organization.domainPackId
organization.domainPackVersion
organization.ruleProfileId
meeting.settings overrides
```

The runtime must never execute every global rule for every organization. Rules
must carry source, version, effective date, jurisdiction, pack applicability,
and an enabled state. A human administrator remains responsible for confirming
the active rule profile.

## 9. Implementation sequence

### Step 0 — Freeze the contract

- add a domain-pack contract and validation rules;
- distinguish domain pack, entity variant, plan, meeting type, and rule profile;
- document the four existing editions and their source references;
- keep cooperative behavior unchanged by default.

### Step 1 — Add the registry and organization assignment

- add a checked-in pack registry for development and a persistent organization
  reference for runtime;
- assign existing organizations to `cooperative@1.0`;
- expose pack metadata through the client workspace model;
- reject unknown, disabled, or unsupported pack versions.

### Step 2 — Implement Resident Association foundations

- add resident/participant terminology and labels;
- add meeting types and configurable notice/quorum settings;
- support attendance, proxies, nominations, committee elections, resolutions,
  minutes, actions, and evidence;
- use a dedicated fixture and test organization;
- keep property-unit and weighted-vote features disabled unless the selected
  entity variant requires them.

### Step 3 — Make compliance pack-scoped

- add source/version/applicability fields to compliance rules;
- load only rules applicable to the organization's pack and rule profile;
- test cooperative and resident rules in the same test run;
- preserve rule snapshots on checks and reports.

### Step 4 — Adapt the live shell

- replace hardcoded labels with pack-provided labels;
- conditionally expose capabilities and navigation;
- update login and empty states without implying that demo data is production
  data;
- decide whether the legacy SPA remains supported or is clearly marked as a
  cooperative-only legacy surface.

### Step 5 — Add NGO and Professional Association packs

- implement only after the Resident Association acceptance gate passes;
- reuse the same contract and test fixture pattern;
- add constitution/delegate/credential extensions as pack capabilities, not
  global assumptions.

### Step 6 — Add public branding and custom domains

- resolve public branding separately from authorization;
- update metadata, manifest, design tokens, and marketing copy per deployment;
- test that a branded domain cannot cross a tenant or pack boundary.

## 10. Acceptance criteria

The domain-pack foundation is ready when:

1. An existing cooperative organization still loads the cooperative labels,
   rules, navigation, and workflows without behavior changes.
2. A Resident Association organization resolves to a versioned pack and shows
   Resident Association terminology without browser-supplied overrides.
3. A pack can declare meeting types, capabilities, labels, notice defaults,
   quorum mode, and voting mode through a validated contract.
4. Compliance checks execute only rules applicable to the active pack and rule
   profile.
5. Historical meetings retain the pack/rule snapshot used when they were
   configured or completed.
6. Tenant isolation prevents a user from reading or changing another
   organization's pack or records.
7. Unsupported or disabled pack versions fail with an actionable error rather
   than silently falling back to cooperative behavior.
8. A Resident Association fixture can complete the minimum flow from meeting
   creation through minutes, resolution, action, and evidence record.

## 11. Product and legal guardrails

- Domain packs are configuration and workflow aids; they are not legal advice.
- The product must show the active rule source and version wherever a deadline,
  quorum, eligibility result, or compliance finding is displayed.
- The product must not claim that a meeting is legally valid solely because a
  checklist passed.
- Secret-ballot, encryption, immutability, compliance, and regulatory claims
  require implementation evidence and appropriate review before marketing.
- Customer-specific constitutions and house rules may override defaults only
  through an authorized, auditable configuration workflow.

## 12. Immediate work queue

- [ ] Define the machine-readable domain-pack schema and validator.
- [ ] Add `cooperative.v1` as the explicit default for existing organizations.
- [ ] Add `resident-association.v1` registry metadata and a fixture.
- [x] Add pack applicability and version fields to compliance rules.
- [x] Replace global compliance-rule loading with pack-scoped selection.
- [ ] Add Resident Association workflow regression tests.
- [ ] Update the authenticated shell to consume pack labels/capabilities.
- [ ] Review and approve the pack against the relevant customer constitution or
      regulatory source before any live deployment.
