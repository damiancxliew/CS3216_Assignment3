# golden-1819: history review sheet

For Kevin's check (H). Every historical claim in `fixtures/golden-1819.json` is listed with its source label and
what supports it. Built from `packages/engine/scripts/golden-1819.ts`; edit there, not in the JSON.

**Sources used**
- **T** – the teacher's handout: `packages/generation/fixtures/sources/singapore-1819-handout.txt` (label "from the teacher").
- **TR** – Treaty of Friendship and Alliance, 6 February 1819, Wikisource transcription, saved at
  `fixtures/sources/treaty-1819-wikisource.txt`. The test suite checks every real excerpt word for word against it.
- **NLB** – NLB Infopedia, "1819 Singapore Treaty" (archived 2018), citing Turnbull, *A History of Modern Singapore* (2009).
- **JSBRAS** – Raffles to Colonel Addenbrooke, 10 June 1819, *Journal of the Straits Branch of the RAS* vol. 2 (1878), on Wikisource.

**Legend:** ✅ directly supported · ⚠️ inference or simplification, please check · 🎭 invented by design (labelled "invented")

## Setting and role
| Claim | Source | Status |
|---|---|---|
| Raffles arrived off Singapore on 28 Jan and landed near the river mouth the next day, with Farquhar | T p.1–2 | ✅ |
| Farquhar had been Resident of Malacca until it was returned to the Dutch | T p.1 | ✅ |
| The Dutch were extending their authority over Riau | T p.1 | ✅ |
| Ahmad, a Malay interpreter from Malacca who worked for Farquhar | — | 🎭 the role (TD1: fictional go-between) |

## Stage 1: The landing (29–30 January 1819)
| Id | Claim | Label | Status |
|---|---|---|---|
| d1-not-sovereign (core) | The Temenggong governs Singapore for the Sultan of Johor but is not the sovereign; only the Sultan can lawfully grant land | T p.2 | ✅ |
| d1-throne (core) | Sultan Mahmud died 1812; the younger son Abdul Rahman was installed with Bugis support and later recognised by the Dutch; Hussein was away and passed over | T p.3 | ✅ |
| d1-agreement (core) | The preliminary agreement was made by the Temenggong for himself and on behalf of the Sultan, to be confirmed when the Sultan arrived | TR Art. 1 ("for himself and for Sultan Hussein") | ⚠️ "to be settled when the Sultan arrives" comes from a secondary summary of Article 5 of the preliminary agreement (Braddell 1915, via the Singapore Law Gazette), which I could not fetch to verify. TR Art. 1 supports "for himself and for the Sultan" |
| d1-free-port | Raffles meant to make Singapore a free port with no duties | T p.4 (he *declared* it a free port) | ⚠️ the handout says he declared it; the plan to do so on 29 Jan is inferred |
| d1-calcutta | Instructions: found a post at the southern end of the Straits but avoid any collision with the Dutch | T p.1 | ✅ |
| d1-inhabitants | About 1,000 people, mostly Orang Laut (Kallang, Seletar, Gelam), some Malays and a few Chinese | NLB (Turnbull p.25); T p.2 | ✅ |
| d1-riau-claim | The Riau court regards the Temenggong as a servant of Sultan Abdul Rahman with no authority to give land | T p.3–4 (Dutch recognised Abdul Rahman as the only lawful ruler) | ⚠️ the Riau letter itself is invented; the position it states is supported |
| d1-riau-fear | The Temenggong feared punishment from Riau and the Dutch | invented | 🎭 plausible (handout question 2 asks about his risks), but not cited, so labelled invented |

**Documents (stage 1)**: all three are invented, labelled so, and written in period style: *Draft articles of agreement*
(paraphrasing what is known of the 30 Jan articles: the factory, protection, $3,000 a year, and the Sultan's
confirmation), *Instructions from Calcutta* (paraphrasing T p.1), and *A letter from Riau* (the slanted document:
"chosen by the will of his late father" is the slant). ⚠️ Please check that the $3,000 stipend belongs in the
*preliminary* articles; TR Art. 3 says the Company "settled on His Highness the yearly sum of Spanish Dollars Three
Thousand" in return for the preliminary grant, so I placed it there.

**Slants**: the Temenggong says the island is his to dispose of (contradicted by d1-riau-claim). Raffles says the
island is almost empty (contradicted by d1-inhabitants; cf. his later "without inhabitant", JSBRAS).

## Stage 2: The disputed throne (1–6 February 1819)
| Id | Claim | Label | Status |
|---|---|---|---|
| (opening) | The Temenggong sent for Hussein, who arrived from Riau in early February | T p.3 | ✅ |
| d2-hussein-claim (core) | Hussein, the elder son passed over in 1812, claims the throne and wants recognition as Sultan | T p.3 | ✅ |
| d2-raffles-plan (core) | Raffles thought the elder son had the stronger claim and meant to recognise him so a ruler of Johor would sign | T p.3 | ✅ |
| d2-no-force (core) | The treaty protects the Sultan but the British are not bound to interfere in Johor's politics or uphold him by force | TR Art. 2, quoted | ✅ |
| d2-duties | The Temenggong is to get half of the duties collected from native vessels | TR Art. 9, quoted | ✅ |
| d2-hussein-needs | Hussein had been living in obscurity in Riau and needed an income and protection | T p.3 ("living in obscurity"); TR Art. 2 ($5,000, protection) | ✅ |
| d2-dutch-protest | Farquhar expects the Dutch to protest; they recognised Abdul Rahman as the only lawful ruler | T p.4 | ⚠️ the Dutch did protest at once (T); Farquhar *expecting* it is inferred |
| d2-bugis | Abdul Rahman was made Sultan with Bugis support while Hussein was away | T p.3 | ✅ (said by an invented messenger) |
| d2-riau-claim | Riau proclaims Abdul Rahman the only lawful Sultan, acknowledged by the Dutch | T p.3–4 | ✅ position; the proclamation is invented |

**Documents (stage 2)**: *Treaty of Friendship and Alliance (draft for signing)* is **real**: Articles 2 (from "the
said Company further agree…"), 8 and 9 (first sentence), quoted word for word from TR. ⚠️ It is shown as a draft
in Raffles's tent between 1 and 6 February; the wording we have is the signed text of 6 February. *Proclamation of
the Riau court* is invented (slanted: "whoever calls another man Sultan is a rebel").

**Slants**: Hussein believes the British will keep him on the throne by force (contradicted by d2-no-force). The Riau
messenger says there was never any dispute (contradicted by d1-throne).

## Endings
| Ending | Claim | Label | Status |
|---|---|---|---|
| e-historical | Raffles recognised Hussein as Sultan Hussein Shah; treaty signed 6 Feb 1819; $5,000 a year to the Sultan, $3,000 to the Temenggong; flag hoisted; Raffles sailed the next day leaving Farquhar as Resident | T p.3; NLB | ✅ |
| e-wait | Raffles waits; the Dutch press their claim; the post is never founded | invented | 🎭 plausible alternative (the Dutch protested at once, T p.4) |
| e-alone | Raffles signs with the Temenggong alone; Riau declares the grant void | invented | 🎭 plausible alternative (T p.2 "the agreement had a weakness") |
| e-secret | The treaty also names the Orang Laut and protects their moorings | invented | 🎭 a path history did not take; ⚠️ check it is plausible enough for 1819 |

## Reveal
| Claim | Label | Status |
|---|---|---|
| What happened (30 Jan articles → Hussein sent for → recognised → 6 Feb treaty, allowances, Raffles sails) | T; NLB | ✅ |
| Raffles later wrote the spot was "a wilderness and without inhabitant" (10 June 1819) | JSBRAS | ✅ quoted |
| Many historians stress Singapore's earlier history as a port and the Malay chiefs' own agency | NLB (Bicentennial framing) | ⚠️ summarised in general terms; please check the wording |
| Had Raffles waited, the Dutch might have occupied the island first; settled by the Anglo-Dutch Treaty of 1824 | T p.4 | ✅ (counterfactual framed as "might") |

## Character voices
- Raffles has one real phrase, "a great commercial emporium" (JSBRAS, June 1819). ⚠️ It is a few months after the
  episode; it reflects his stated aims, but please confirm you're happy using it in January–February dialogue.
- The Temenggong, Hussein and Farquhar have no documented English phrases in the sources used, so none are given.
- The batin of the Orang Laut and the Riau messenger are invented characters (labelled `real: false`).
