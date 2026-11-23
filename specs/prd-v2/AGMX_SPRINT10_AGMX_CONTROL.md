# AGMX v2.0 — Sprint 10 Spec: AGMX Control

Source: AGMX Master PRD v2.0 (§8 Functional Requirements — AGMX Control, §2 workspace table, §4 IA, §5 stage 9/10).

## Objective
Mission control for operating an AGM: agenda control, speaker queue/mic, question moderation, election control centre, AV/broadcast console, system health, emergency controls, incident register.

## Control requirements (§8)
- Live counts: physical, online, total present, quorum threshold and quorum status
- Agenda controller: start/complete/pause agenda item and associate events
- Speaker queue and microphone pause/control
- Question moderation without deleting original audit record
- Open/close/suspend voting with maker-checker approval for critical actions
- Election Control Centre: eligible voters, ballots issued/cast, rejected attempts, time remaining and verification
- AV/Broadcast console: venue cameras, presenter, screen share and stream state
- System health: connection, recording, voting, database and backup state
- Emergency controls: Technical Recess, Pause AGM, Suspend Voting, Adjourn AGM
- Incident Register with timestamp, actor, description, evidence and resolution

## IA mapping (§4)
AGMX Control: Mission Control, Attendance & Quorum, Agenda Control

## Roles (§11)
- Technical Operator: AV/LIVE/system health; no governance decision rights.
- Chairman: agenda, speakers, procedural controls; votes subject to permissions.
- Election Committee: configure/operate election, verify tally, publish authorised result.

## Acceptance criteria (this sprint)
- [ ] Operator can run AGM from Mission Control with live counts and quorum status.
- [ ] Agenda controller can start/complete/pause agenda items.
- [ ] Speaker queue and microphone pause/control available.
- [ ] Question moderation preserves original audit record.
- [ ] Open/close/suspend voting requires maker-checker approval for critical actions.
- [ ] Election Control Centre displays eligible voters, ballots issued/cast, rejected attempts, time remaining.
- [ ] AV/Broadcast console manages venue cameras, presenter, screen share, stream state.
- [ ] System health monitors connection, recording, voting, database, backup state.
- [ ] Emergency controls: Technical Recess, Pause AGM, Suspend Voting, Adjourn AGM.
- [ ] Incident Register records timestamp, actor, description, evidence and resolution.
