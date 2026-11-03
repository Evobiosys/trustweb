# Five rings: the Web view as an overview of your field

SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later

Status: DESIGNED, with a PROTOTYPE behind a device-local flag (`apps/trustweb/src/five_rings.ts`, branch
`cloud/five-rings`). Nothing here changes the shipped Web view until the flag is on.

Owner frame (Jakob, 2026-11-03): not Gorski's circles. Dunbar's layers (5 / 15 / 50 / 150 / 500) are the
relevant estimate, read from recent data, and the point of the rings is an **overview of who is in your
field**, not a capacity limit. Claims below are marked SHIPPED (in `origin/main` at 3665e27, wave 28),
PROTOTYPE (on this branch, behind the flag) or DESIGNED (written down, not built). Confidence is given
where below 0.9. Sources are tagged [A] peer-reviewed, [B] book or analytic, [C] community; ⚠️ = older
than ten years.

## 0. The one sentence

The Web view already draws five warm rings (wave 25 added "Closest few"); this document makes them the
model: each ring is one rung of the share-sink trust-zone ladder, each carries a Dunbar layer as a gentle
comparison, the five-step "lean" on acquaintances turns into a move the owner accepts or not, the Tana
ring field grows from four to five options, and the grey "not yet sorted" ring stays as a sixth, holding
ring, not a trust ring.

## 1. The five rings: names and meaning

Centre outwards. Ids are the stored `Ring` values (`model.ts`); labels and hints are the shipped strings
(`strings.ts`, `ringLabel` / `ringHint`); the last column is the Dunbar layer, cumulative (this ring and
everyone closer), see §2 and §3.

| # | id | label (SHIPPED) | hint (SHIPPED) | Dunbar layer, cumulative |
|---|----|-----------------|----------------|--------------------------|
| 1 | `closest` | Closest few | the few you would call at 3 am | about 5 (3–7) |
| 2 | `close` | Close friends and allies | you stand up for each other | about 15 (10–20) |
| 3 | `friend` | Friends & acquainted community members | community members per tag | about 50 (30–70) |
| 4 | `acquaintance` | Acquaintances | you have been in contact with | about 150 (100–250) |
| 5 | `intending` | Intending | not yet acquainted: you intend to connect or reached out | about 500 (300–800), see §3 |

Three things sit outside the five and keep their own place (all SHIPPED):

- **Family** (`Ring.Family`, purple): orthogonal to closeness. A family member sits on the ring their
  closeness says (`fields['tw-closeness']`, `ringSlot`); every function below reads family through that.
- **Not yet sorted** (`Ring.Unsorted`, grey): the sixth, holding ring (§7).
- **Not in my web** (`Ring.None`): archived (`trustzones.ts isArchived`); never drawn, listed or counted.

Why not Dunbar's own layer names (support clique, sympathy group, affinity group, active network,
acquaintances): the app speaks plainly and its labels are the share-sink ladder's words (§5). The Dunbar
names appear once, here, so a reader of the papers can line the two up.

## 2. Why Dunbar, and why "hint, never cap"

Dunbar's layers describe how most people's social attention is **distributed**: about a third of it goes
to the innermost five, each layer is roughly three times the one inside it, the whole active network is
about 150, with a wider circle of about 500 people one knows by name and face. That distribution is what
a Web view can reflect: how many people sit in each ring, and whether the shape of a field looks like most
people's, or deliberately not.

Two reasons the number is a hint and never a cap, and the panel copy follows them (no "limit", "max",
"cap" or "too many" anywhere):

1. **The estimate is wide.** The brain-size derivation of 150 has a 95 % interval from a handful to a few
   hundred (Lindenfors, Wartel & Lind 2021 [A]); phone and online datasets reproduce the layer *ratios*
   well and the absolute sizes within a factor of about two (§3). Sizes shift with age, sex, personality,
   life stage and culture while the nested shape stays (§3.4).
2. **The product goal is an overview, not compliance.** Invariants I7 (honest labelling) and I9
   (conservative defaults) both say: show what is, say what the number means, never nudge towards a target.
   The panel therefore reads "most people: about 15", never "15 max".

## 3. Evidence per ring and its uncertainty

How this was checked (2026-11-03): every reference was matched to a DOI or publisher record by web search;
full texts could not be fetched from this sandbox (Royal Society, PMC, arXiv and Oxford's repository did
not resolve), so figures come from abstracts, index records and, where marked, press coverage. Figures
marked *unconfirmed* should be checked against the full text before anyone quotes them further.

### 3.1 The layering itself

- Dunbar 2020, Proc. R. Soc. A [A]: human and primate networks share a fractal layered structure built on
  trust and time constraints; the series 1.5 / 5 / 15 / 50 / 150 / 500 / 1500, each layer about 3× the
  one inside (the per-layer figures in the full text are unconfirmed here).
- Dunbar 2018, Trends Cogn. Sci., "The Anatomy of Friendship" [A]: "many constancies, notably in their size
  and their hierarchical structuring"; 500 / 1500 as the outer layers (wording unconfirmed).
- Zhou, Sornette, Hill & Dunbar 2005, Proc. R. Soc. B [A] ⚠️: the base dataset for the discrete hierarchy,
  "a preferred scaling ratio close to three".
- West et al. 2020 PNAS [A] and West, Culbreth, Dunbar & Grigolini 2023 Proc. R. Soc. A [A]: models of
  network complexity peak near 150, with a secondary peak at 500 and smaller ones at 5, 15 and 50. Theory,
  not measurement.
- Tamarit, Sánchez & Cuesta 2022, Sci. Rep., "Beyond Dunbar circles" [A]: a continuous version of the
  resource model estimates the ratio between adjacent circles at about 6, not 3. Where the boundaries
  fall depends partly on the model.

### 3.2 Phone and online datasets

- Mac Carron, Kaski & Dunbar 2016, Social Networks [A]: a European call-detail-record dataset screened to
  about 27 000 users who each called at least 100 people. Cumulative layers averaged across methods
  **4.1 / 11.0 / 29.8 / 128.9** (figures from press coverage; the abstract says "slightly smaller" than the
  conventional sizes "but within their natural range of variation"). Inner and outer layers matched earlier
  studies; the middle layers showed "large variability". The screening favours large networks.
- Dunbar, Arnaboldi, Conti & Passarella 2015, Social Networks [A] ⚠️: two Facebook and one Twitter dataset,
  more than 185 000 egos; Facebook fits four layers, Twitter five; sizes and contact frequencies "match very
  closely" offline values; an innermost layer of about 1.5 in all three.
- Dunbar 2016, R. Soc. Open Sci. [A]: UK Facebook users named about 4 people for support and about 14 for
  sympathy, whatever the size of their friend list.
- Tamarit, Cuesta, Dunbar & Sánchez 2018, PNAS [A]: a fixed cognitive budget spent at different costs per
  relationship reproduces the layers and predicts an *inverted* regime in small communities; both regimes
  were found in five communities, migrant groups among them.
- Saramäki et al. 2014 PNAS [A] ⚠️ and Heydari, Iñiguez, Kertész & Saramäki 2024 EPJ Data Sci. [A]: each
  person keeps a stable "social signature" (how unevenly contact is spread) even as the contacts turn over.
- No 2020–2025 call-record or messaging study refuting the layering was found; given the full-text gap,
  that absence is weak evidence.

### 3.3 The critique and the reply

- Lindenfors, Wartel & Lind 2021, Biology Letters [A]: rerunning the neocortex-to-group-size regression
  with more data and phylogenetic methods gives mean human group sizes of 69–109 (Bayesian, 95 % CI
  **4–520**) or 16–42 (GLS, 95 % CI **2–336**); "a cognitive limit on human group size cannot be derived in
  this manner". The claim is about the *derivation* of 150 from brain size, not about layered ego networks.
- Dunbar's reply ran in The Conversation, May 2021 [C], Lind & Lindenfors answered there in June 2021 [C];
  no formal reply in Biology Letters was found. Fair reading: the brain-size *prediction* is fragile; the
  *empirical* layering rests on separate data and is less affected.

### 3.4 Variation across people (why "hint")

- Personality: extraverts have larger layers at every level, modestly (Pollet, Roberts & Dunbar 2011 [A]
  ⚠️, journal unconfirmed); the effect fades once age is controlled (Roberts et al. 2008 ⚠️).
- Sex and age: from phone data, the young and young men most of all have more contacts; contacts decline
  with age at different rates for men and women (Bhattacharya et al. 2016, R. Soc. Open Sci. [A]).
- Life transitions: after moving to college, 78 % of new contacts landed in the two outer layers while the
  inner layers kept their size (Adv. Life Course Res. 2024 [A], authors not retrieved).
- Culture: personal-network structure predicts migrants' cultural background (Molina et al. 2022, PNAS
  Nexus [A]); inverted layers in small communities (Tamarit et al. 2018).
- Recognition ceiling: about 5 000 known faces, with large individual differences (Jenkins, Dowsett &
  Burton 2018, Proc. R. Soc. B [A]).

### 3.5 Per ring

| ring | canonical | observed in the sources above | confidence |
|------|-----------|-------------------------------|------------|
| Closest few | 5 | 4.1 (calls 2016); about 4 (Facebook survey 2016); core of about 1.5 (online 2015) | **high**: replicated offline, phone, online |
| Close friends and allies | 15 | 11.0 (calls); about 14 (Facebook survey) | **medium**: middle layers vary widely |
| Friends & community | 50 | 29.8 (calls) | **low–medium**: few direct measures |
| Acquaintances | 150 | 128.9 (calls); 153.5 maximum / 124.9 contacted (Christmas cards, Hill & Dunbar 2003 ⚠️); brain-size prediction 16–109, CI 2–520 | **medium** as an average, **low** as a limit |
| Intending | 500 | no direct dataset; 500 is a model peak (West 2023); about 5 000 known faces | **low**: mostly theory, and see below |

The Intending ring is the weakest mapping (confidence 0.5) and is said so in the code comment: Dunbar's
500 are people one *knows* by name and face; TrustWeb's Intending are people one knows *of* and wants to
connect with, plus those who reached out. The 500 is shown as "the pool you draw from", the ring the field
grows out of, not as a measure of it. If the owner prefers, the hint for Intending can be dropped with one
table entry; the other four stand on data.

The prototype's `DUNBAR_HINT` carries the canonical figure and a range of roughly ±50 % for rings 2–4
(the design implication of the table), and the panel shows only the canonical figure.

## 4. How the rings replace the lean

SHIPPED: `Person.lean`, a five-step note-to-self on acquaintances only ("-2 more friend ... 2 more
acquaintance"), local, never sent (`cascade.ts` strips it, tested), and by its own doc comment "never
changes the ring". It was the pressure valve of a three-ring model (wave 7): "acquaintance" was wide.

With five rings the valve is redundant: a person who leans towards friend belongs on the Friend ring, and
the Closest ring absorbs the other end of the old scale. But a move widens who may ask about Friend-zone
lines, so the record must not move people on its own (I9). The lean therefore becomes **a move the owner
accepts** (PROTOTYPE `leanMoves`, `migrateLean`):

| stored lean on an acquaintance | implied move |
|--------------------------------|--------------|
| -2, -1 (more friend) | to Friend, offered, one tap for all |
| 0 or absent | none |
| +1, +2 (more acquaintance) | none: Acquaintance is already the outermost field ring |

Rules, all tested: only confirmed acquaintances (not `ringSuggested`, not archived, not blocked) are
offered; accepting sets `ring = friend` and deletes `lean`; a lean left on someone no longer on
Acquaintance is dropped when a set is accepted; an empty acceptance changes nothing; the function is
idempotent. Nothing runs in the boot chain (`schema_version.ts` is untouched).

DESIGNED, once the flag is default: the lean row on the card goes (the "Add a note" link next to it stays,
it belongs to the general note); `lean` is read for one more release so an un-accepted lean still shows
in the panel, then stops being written. No file is deleted; superseded code moves to `archive/`.

## 5. One-to-one map onto the share-sink trust-zone ladder

SHIPPED (`share_sink/zones.ts`, wave 23): the ladder `Zone`, outer to inner: public < intending <
acquaintance < community < friend < close < closest < self. `zoneOfPerson` maps a ring to its zone through
a table; `rank`, `mostIntimate`, `effectiveZone` (an item shared to a ring that is off moves one ring IN,
never out, I9). The ladder is TrustWeb's adaptation of Social-Fabric's TrustZones v1.2.2.

The five rings are five of the eight rungs, one to one:

| ring | zone | note |
|------|------|------|
| `closest` | `closest` | the table in `zones.ts` lacked this row since wave 25 added the ring; `zoneOfPerson` returned undefined for a closest person. Fixed on this branch (one line, tested). |
| `close` | `close` | |
| `friend` | `friend` | |
| `acquaintance` | `acquaintance` | |
| `intending` | `intending` | |
| (none) | `community` | derived, not a ring: acquaintances holding the picked community tag join the friends zone in the view (`trustzones.ts zoneFor`). Stays derived. |
| `unsorted`, `none` | `public` | the grey ring and the archive are strangers to the ladder |
| (the owner) | `self` | |
| `family` | by closeness | `ringSlot` |

PROTOTYPE: `ringZone(person)` and `zoneRing(zone)` make the map explicit in both directions and are tested
to be mutual inverses on the five rings and to agree with `zoneOfPerson` on every ring. The share page's
default zone (`AppState.shareDefaultZone`) and the line audiences (`Audience`, three tiers plus Only me,
`audienceAdmits`) are not changed on this branch.

DESIGNED: `Audience` grows to the five rungs plus Only me, read through `zoneRing`, so "who can ask about
this line" and "which ring is this person on" are the same scale read from two sides. `audienceAdmits`
today fails closed for Family, Unsorted and None; a five-rung audience that reads family through its
closeness would admit a family member the shipped matcher does not. That widening is a decision for
DECISIONS.md when it is made, not a side effect of this one.

## 6. The Tana ring field: 4 → 5 options, and the record migration

SHIPPED (`apps/crm/src/person_fields.ts`, `apps/crm/src/rings.ts`): the `tw-ring` options field offers
`close`, `friend`, `acquaintance`, `intending`; the Tana side also knows `unsorted`. `rings.ts` says it
itself: "Closest has no option in Tana's ring field yet: its edit is a manual item (tana_sync.ts)". The
Curator's `RING_ORDER` already lists five.

DESIGNED: the field gets its fifth option, `closest` ("Closest few"), first in the list. Its Tana option id
is created once in the owner's workspace and added to `TANA_RING_OPTIONS`; `tana_sync.ts` then writes it
like the others and drops the manual item. `intending` stays an option (it is a ring of the view) and
`unsorted` stays a placement state. No stored value changes meaning, so there is no value migration to
run; an older sync that does not know `closest` keeps treating it as a manual item.

PROTOTYPE: `RING_FIELD_OPTIONS_V2` (the five-option table, ids = `RINGS` in order, tested) and
`ringFieldValue` (passes the five ids and the placement states, leaves anything else alone). The CRM files
are not edited on this branch.

Record migration (lean → ring) is §4: owner-accepted, never automatic.

## 7. Does the grey "not yet sorted" ring stay a sixth?

Yes, as a **holding ring, not a trust ring**. SHIPPED: it is drawn only while someone is on it
(`rings_layout.ts`), hidden by default in the TrustZones view (`uiRings.unsorted`), never offered by the
ring picker, maps to `public` on the ladder and admits nothing. The field overview lists its count under
the rows ("not yet sorted: N"), not as a sixth row with an estimate. Reasons:

- Imports and suggestions need a place that is visibly "no decision yet"; folding them into ring 5 would
  turn a non-decision into a claim about the person.
- Dunbar's outer layers are about people one *knows*; an unsorted import may be anyone. Keeping it grey
  keeps the five estimates honest.

So the view draws up to six circles (five warm, one grey) and the field has five rings. `TONE_ORDER`
already encodes exactly this: five oranges and one grey.

## 8. The prototype on this branch

Flag: `localStorage['tw-five-rings'] = '1'`, or open the app once with `?five_rings=1` (`?five_rings=0`
turns it off). Device-local, not in the record, not in Settings: a preview, not a feature.

With the flag on, the Web view shows a **Your field** panel under the rings: one row per ring with its
tone, label, count on this ring, "N up to here · most people: about M" (cumulative, because the Dunbar
layers are cumulative); then "not yet sorted: N"; when acquaintances lean towards friend, "N acquaintances
lean towards friend" with one button "Move them to friends" (§4); a footer "Dunbar's layers are an
average, not a limit. The rings show who is in your field." Counts take the whole field (everyone not
archived and not blocked), not the view's display filters, since the overview is about the field, not the
drawing. The drawn rings, cards and ring chips are unchanged: the prototype answers "do real webs look
sensible against the five layers?" before any drawing changes.

With the flag off: byte-identical UI, nothing written.

Files: `src/five_rings.ts` (flag, hints, ladder map, lean moves, field table, overview data; pure),
`src/five_rings_view.ts` (the panel), `src/share_sink/zones.ts` (the Closest row), `strings.ts`,
`styles.css`, `main.ts` (two hooks), `test/unit/five_rings.test.mjs` and the zones test.

## 9. What ships next, in order (DESIGNED)

1. Read the field overview against three or four real webs (the owner's and consenting testers'). If the
   Intending hint reads wrong, drop that table row; if the counts surprise, that is the finding.
2. The Tana option for `closest` (§6).
3. The lean row goes; `leanMoves` surfaces in the TrustZones zzz strip (`moveKinds`) instead of the panel.
4. `Audience` grows to the five rungs through `zoneRing` (§5), with the Family decision taken on purpose.
5. Flag becomes default.

## 10. What this document does not claim

No claim that the Dunbar numbers are right for any one person, that TrustWeb webs will look like phone
networks, or that a ring count tells anyone what to do. The numbers are a backdrop for an overview; the
overview exists so the owner can see the field, not so the app can grade it.

## Sources

1. Lindenfors P., Wartel A., Lind J. "'Dunbar's number' deconstructed." Biology Letters 17: 20210158. Royal Society, 2021. https://doi.org/10.1098/rsbl.2021.0158 [A]
2. Dunbar R.I.M. "Structure and function in human and primate social networks: implications for diffusion, network stability and health." Proc. R. Soc. A 476: 20200446. Royal Society, 2020. https://doi.org/10.1098/rspa.2020.0446 [A]
3. West B.J., Culbreth G., Dunbar R.I.M., Grigolini P. "Fractal structure of human and primate social networks optimizes information flow." Proc. R. Soc. A 479: 20230028. Royal Society, 2023. https://doi.org/10.1098/rspa.2023.0028 [A]
4. Mac Carron P., Kaski K., Dunbar R. "Calling Dunbar's numbers." Social Networks 47: 151–155. Elsevier, 2016. https://doi.org/10.1016/j.socnet.2016.06.003 [A]
5. Dunbar R.I.M. "Do online social media cut through the constraints that limit the size of offline social networks?" R. Soc. Open Sci. 3: 150292. Royal Society, 2016. https://doi.org/10.1098/rsos.150292 [A]
6. Bhattacharya K., Ghosh A., Monsivais D., Dunbar R.I.M., Kaski K. "Sex differences in social focus across the life cycle in humans." R. Soc. Open Sci. 3: 160097. Royal Society, 2016. https://doi.org/10.1098/rsos.160097 [A]
7. Tamarit I., Sánchez A., Cuesta J.A. "Beyond Dunbar circles: a continuous description of social relationships and resource allocation." Scientific Reports. Springer Nature, 2022. https://doi.org/10.1038/s41598-022-06066-1 [A]
8. Heydari S., Iñiguez G., Kertész J., Saramäki J. "Disentangling degree and tie strength heterogeneity in egocentric social networks." EPJ Data Science 13: 76. Springer, 2024. https://doi.org/10.1140/epjds/s13688-024-00513-x [A]
9. Dunbar R.I.M. "The social brain hypothesis – thirty years on." Annals of Human Biology 51(1). Taylor & Francis, 2024. https://doi.org/10.1080/03014460.2024.2359920 [A]
10. "How the size and structure of egocentric networks change during a life transition." Advances in Life Course Research 61. Elsevier, 2024. https://doi.org/10.1016/j.alcr.2024.100632 [A] (authors not retrieved)
11. Jenkins R., Dowsett A.J., Burton A.M. "How many faces do people know?" Proc. R. Soc. B 285: 20181319. Royal Society, 2018. https://doi.org/10.1098/rspb.2018.1319 [A]
12. Dunbar R.I.M. "The Anatomy of Friendship." Trends in Cognitive Sciences 22(1): 32–51. Cell Press/Elsevier, 2018. https://ora.ox.ac.uk/objects/uuid:ec201b93-8447-4d03-bcfc-99d8a3980860 [A]
13. Dunbar R.I.M., Arnaboldi V., Conti M., Passarella A. "The structure of online social networks mirrors those in the offline world." Social Networks 43: 39–47. Elsevier, 2015. https://doi.org/10.1016/j.socnet.2015.04.005 [A] ⚠️
14. Saramäki J., Leicht E.A., López E., Roberts S.G.B., Reed-Tsochas F., Dunbar R.I.M. "Persistence of social signatures in human communication." PNAS 111(3): 942–947. 2014. https://doi.org/10.1073/pnas.1308540110 [A] ⚠️
15. Pollet T.V., Roberts S.G.B., Dunbar R.I.M. "Extraverts have larger social network layers but do not feel emotionally closer to individuals at any layer." 2011 (journal unconfirmed). https://research.rug.nl/en/publications/extraverts-have-larger-social-network-layers-but-do-not-feel-emot/ [A] ⚠️
16. Zhou W.-X., Sornette D., Hill R.A., Dunbar R.I.M. "Discrete hierarchical organization of social group sizes." Proc. R. Soc. B 272: 439–444. Royal Society, 2005. https://doi.org/10.1098/rspb.2004.2970 [A] ⚠️
17. Hill R.A., Dunbar R.I.M. "Social network size in humans." Human Nature 14: 53–72. Springer, 2003. https://doi.org/10.1007/s12110-003-1016-y [A] ⚠️
18. Tamarit I., Cuesta J.A., Dunbar R.I.M., Sánchez A. "Cognitive resource allocation determines the organization of personal networks." PNAS 115(33): 8316–8321. 2018. https://doi.org/10.1073/pnas.1719233115 [A]
19. West B.J., Massari G.F., Culbreth G., Failla R., Bologna M., Dunbar R.I.M., Grigolini P. "Relating size and functionality in human social networks through complexity." PNAS 117(31): 18355–18358. 2020. https://doi.org/10.1073/pnas.2006875117 [A]
20. Molina J.L., Ozaita J., Tamarit I., Sánchez A., McCarty C., Bernard H.R. "Structural measures of personal networks predict migrants' cultural backgrounds." PNAS Nexus. OUP, 2022. https://doi.org/10.1093/pnasnexus/pgac195 [A]
21. Dunbar R. Friends: Understanding the Power of Our Most Important Relationships. Little, Brown, 2021. ISBN 9781408711736 [B]
22. Dunbar R. "Dunbar's number: why my theory that humans can only maintain 150 friendships has withstood 30 years of scrutiny." The Conversation, May 2021. [C]
23. Lind J., Lindenfors P. "Why we dispute 'Dunbar's number'." The Conversation, June 2021. https://theconversation.com/why-we-dispute-dunbars-number-the-claim-humans-can-only-maintain-150-friendships-161944 [C]
