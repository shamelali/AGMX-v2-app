# AGMX v2.0 — Sprint 11 Spec: AGMX LIVE

Source: AGMX Master PRD v2.0 (§9 AGMX LIVE, §9.1 LIVE screen components, §4 IA, §17 Phase 2).

## Objective
Hybrid & Virtual AGM Chamber: video/audio engine native to AGMX with self-hosted WebRTC; meeting media, governance controls, voting per agenda/Q&A.

## AGMX LIVE (§9)
- Native to AGMX; video/audio engine with self-hosted WebRTC
- Meeting media, governance controls, voting per agenda/Q&A
- Each participant at UI AGMX

## Mode comparison (§9 table)
| Mode | Physical | Hybrid | Online |
|---|---|---|---|
| Attendance | QR/check-in | Physical check-in + online presence | Online identity + check-in |
| Media | Optional venue AV | Venue broadcast + remote participants | Full online chamber |
| Quorum | Physical present | Physical + online eligible present | Online eligible present |
| Voting | Phone/kiosk/digital | Same ballot engine for both channels | Online ballot |
| Failure mode | Manual/second-screen fallback | Audio/text/backup connectivity | Audio/text/reconnect continuity |

## LIVE screen components (§9.1)
Main stage video/presentation, current agenda, quorum indicator, raise hand, speaker queue status, Q&A, motion card, voting overlay, election overlay, captioning/transcript, connection quality and reconnect state.

## Phase 2 gate
Hybrid/online AGM can operate without leaving AGMX; tested failure/reconnect paths.

## Acceptance criteria (this sprint)
- [ ] AGMX LIVE chamber runs natively in AGMX with self-hosted WebRTC.
- [ ] Hybrid mode supports physical check-in + online presence into one quorum view with timestamped presence events.
- [ ] Same ballot engine serves both physical and online voting channels.
- [ ] All §9.1 screen components present (stage, agenda, quorum, raise hand, speaker queue, Q&A, motion card, voting overlay, election overlay, captioning/transcript, connection quality/reconnect).
- [ ] Failure/reconnect paths tested (Phase 2 gate).
- [ ] Graceful degradation: video → audio → text (§15 resilience).
