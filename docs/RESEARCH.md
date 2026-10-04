# NYC Building Dossier — Data Map (v1 research)

Verified against live APIs on **2026-10-02**. Every dataset id, column name, row count, update cadence and example query below was pulled from the Socrata metadata endpoint (`https://data.cityofnewyork.us/api/views/{id}.json`) or executed against the SODA endpoint and inspected. Nothing in this document is from memory. Row counts are the live `count(*)` on that date.

Test building used throughout: **1130 Anderson Avenue, Bronx 10452** — BIN `2003068`, BBL `2025050046`, HPD BuildingID `45427`, HPD RegistrationID `209634`. It has open class A/B/C HPD violations, an active ECB elevator summons, an active DOB NOW elevator violation, a prior partial vacate order, and a pending tenant-action litigation, so it exercises every join.

---

## 1. Address resolution (do this first)

### 1.1 GeoSearch

- Service: NYC Planning Labs GeoSearch v2 (Pelias, backed by DCP's Property Address Directory, PAD). Docs: https://geosearch.planninglabs.nyc/docs/
- Forward geocode (use for a pasted, complete address):
  `GET https://geosearch.planninglabs.nyc/v2/search?text={urlencoded address}&size=5`
- Typeahead (use only while the user is typing; throttle):
  `GET https://geosearch.planninglabs.nyc/v2/autocomplete?text={partial}`
  Autocomplete hits also carry the PAD addendum (verified: `1130 Anderson Av` → bin 2003068).
- No API key. No documented rate limit. Response is GeoJSON.
- Optional params verified live: `size`, `boundary.gid` (restrict to a borough), `focus.point.lat/lon` (bias). Pelias `boundary.rect.*` also accepted.

Borough `boundary.gid` values (read from live responses):

| Borough | `boundary.gid` |
|---|---|
| Manhattan | `whosonfirst:borough:421205771` |
| Bronx | `whosonfirst:borough:421205773` |
| Brooklyn | `whosonfirst:borough:421205765` |
| Queens | `whosonfirst:borough:421205767` |
| Staten Island | `whosonfirst:borough:421205775` |

### 1.2 What to keep from a hit

`features[0]` (verified shape, `350 Fifth Avenue, Manhattan`):

```json
{
  "geometry": {"type":"Point","coordinates":[-73.985656, 40.748441]},
  "properties": {
    "label": "350 FIFTH AVENUE, New York, NY, USA",
    "name": "350 FIFTH AVENUE",
    "housenumber": "350",
    "street": "FIFTH AVENUE",
    "postalcode": "10118",
    "borough": "Manhattan",
    "borough_gid": "whosonfirst:borough:421205771",
    "locality": "New York",
    "neighbourhood": "Midtown West",
    "layer": "venue",
    "source": "nycpad",
    "match_type": "fallback",
    "confidence": 0.8,
    "accuracy": "point",
    "addendum": {"pad": {"bbl": "1008350041", "bin": "1015862", "version": "26c"}}
  }
}
```

Persist: `label`, `borough`, `addendum.pad.bin`, `addendum.pad.bbl`, `housenumber`, `street`, `postalcode`, `geometry.coordinates` (lon, lat), `addendum.pad.version`.

### 1.3 Identifier primer

- **BIN** (Building Identification Number, 7 digits, first digit = borough 1–5). One per structure. HPD, DOB, elevator, bedbug, litigation and eviction datasets all carry it. This is the primary join key.
- **BBL** (Borough-Block-Lot, 10 digits: 1 + 5 + 4). One per tax lot. PLUTO, DOF and 311 only have BBL. A lot can hold many BINs (Stuyvesant Town BBL `1009720001` has 39 buildings per PLUTO `numbldgs`, and 35 distinct BINs with HPD violations).
- **Condo billing lots**: condos get a lot in the 75xx range (e.g. 100 West 93rd St → BBL `1012237503`, lot 7503). Verified that PLUTO, HPD violations and HPD registration all use the 7503 billing BBL for that building, so BBL joins still work. ACRIS (deeds) uses the per-unit lots (1001…), so deed lookups need block + lot range, not the billing lot.
- **Placeholder "million" BINs**: `1000000`, `2000000`, … mean "no specific building". GeoSearch returns these for named places and some addresses (`TIMES SQUARE` → 1000000, `1 LINCOLN CENTER PLAZA` → 1000000, `1 MAIN STREET, Manhattan` (Roosevelt Island) → 1000000). Treat `bin % 1000000 == 0` as "lot only": skip BIN-keyed datasets, run BBL-keyed ones, and tell the user.
- **HPD BuildingID / RegistrationID**: HPD's own keys. Every HPD dataset carries `buildingid` (or `building_id`) alongside BIN; `registrationid` links to owner contacts. HPD Online URLs use BuildingID, not BIN. The crosswalk is in `kj4p-ruqc` (Buildings Subject to HPD Jurisdiction) and in `tesw-yqqr`.

### 1.4 What fails, and the fallback

Observed behaviour (all live, 2026-10-02):

| Input | Result | Fallback |
|---|---|---|
| `Broadway and 42nd Street, Manhattan` (intersection) | Garbage: `42 ST OF ARTS AND CULTURE, Brooklyn`. GeoSearch does not geocode intersections. | Detect `and`/`&`/`at`/`/` between two street names and reject with "enter a house number", or call the NYC Geoclient API v2 intersection endpoint (key from https://api-portal.nyc.gov/). An intersection has no BIN anyway, so the dossier cannot be built from it. |
| `One Penn Plaza, New York` (spelled-out vanity) | Wrong: `31 PENN PLAZA`, then 11 and 21. | Normalise number words (`One`→`1`) before searching; `4 Times Square` resolves correctly as a digit. Keep a small alias table for marketing names (e.g. "Empire State Building" → 350 Fifth Avenue). |
| `100 Broadway` (no borough or zip) | Brooklyn first, Manhattan third. All hits have identical `confidence: 0.8`, `match_type: "fallback"`, so the score cannot rank them. | Require borough or zip. Pass `boundary.gid` for the borough, and reject a hit whose `postalcode` disagrees with a user-supplied zip. If neither given, show the top 5 labels and let the user pick. |
| `37-11 35th Avenue, Queens` (hyphenated) | Works: BIN `4009644`. `3711 35th Avenue Queens` (no hyphen) also resolves to the same BIN. | None needed, but `35 AVENUE` vs `35 STREET` both come back; zip or an exact street-type match is the tiebreaker. |
| `252 First Avenue, Manhattan` (Stuy Town, multi-building lot) | Correct per-building BIN `1082875` on BBL `1009720001`. | Join building datasets on BIN. For BBL-only datasets (311, PLUTO, DOF) label the numbers "whole lot (39 buildings)" using PLUTO `numbldgs`. |
| `Parkchester, Bronx` (place name) | Returns venues (`PARKCHESTER SCHOOL`), not a residence. | Require a house number in the input validator. |
| Named place / placeholder BIN | `bin` ends in `000000`. | Lot-only mode as described above. |

Validation rule for the resolver: accept the first hit only if it has `housenumber`, a non-placeholder `bin`, and (when supplied) borough and zip agree. Otherwise return the candidate list.

---

## 2. Dataset catalog

Conventions:
- Open Data page: `https://data.cityofnewyork.us/d/{id}` (302s to the canonical slug page).
- SODA endpoint: `https://data.cityofnewyork.us/resource/{id}.json` (also `.csv`).
- "Churn" = rows with `:updated_at` in the last 2 days, measured 2026-10-02. Equal to the row count means the publisher does a full replace, so `:updated_at` is useless for incremental pulls.
- Type notes matter: a `number` column must be queried as `bbl=2025050046`; a `text` column as `bbl='2025050046'` in `$where` (bare `col=value` query params work for both).

### 2.1 HPD — Housing Maintenance Code Violations

- Agency: Department of Housing Preservation and Development (HPD)
- Page: https://data.cityofnewyork.us/d/wvxf-dwi5
- Id: `wvxf-dwi5` — endpoint `https://data.cityofnewyork.us/resource/wvxf-dwi5.json`
- Rows: 11,281,174. Update: **Daily** (automated; last rows update 2026-10-01). Churn: 89,105 (upsert, ~82k/day).
- Join keys: `bin` (text), `bbl` (text), `buildingid` (number), `registrationid` (number), `boroid`+`block`+`lot` (numbers, not zero-padded).
- Columns to keep: `violationid`, `class`, `violationstatus`, `currentstatus`, `currentstatusdate`, `inspectiondate`, `approveddate`, `novissueddate`, `originalcorrectbydate`, `originalcertifybydate`, `certifieddate`, `novdescription`, `apartment`, `story`, `rentimpairing`, `novtype`, `buildingid`, `registrationid`, `bin`, `bbl`.
- Live per address: **yes** (0.30 s for `bin=…&violationstatus=Open`).
- Example:
  `https://data.cityofnewyork.us/resource/wvxf-dwi5.json?bin=2003068&violationstatus=Open&$where=class in('B','C')&$select=class,count(*)&$group=class`
  → `[{"class":"B","count":"39"},{"class":"C","count":"28"}]`
- Gotchas:
  - `class` is `A` (non-hazardous), `B` (hazardous), `C` (immediately hazardous), `I` (information/order violations, e.g. failure to register; not a condition in the apartment — exclude from hazard counts). Citywide open: A 675,309 / B 1,380,424 / C 583,344 / I 229,104.
  - `violationstatus` is exactly `Open` or `Close` (not "Closed"). `currentstatus` is the detailed workflow state (`NOV SENT OUT`, `VIOLATION DISMISSED`, `VIOLATION CLOSED`, `FALSE CERTIFICATION`, `NOT COMPLIED WITH`, …). Use `violationstatus` for open/closed.
  - Open violations can be years old and owner-certified-but-not-reinspected; show `inspectiondate` with the count.
  - `rentimpairing` = `Y` on ~7% of rows; worth surfacing.
  - Dates are `calendar_date` (ISO), so `$where=inspectiondate > '2025-10-01'` works.
  - Lat/long, `nta`, `communityboard` are present; not needed.
  - **Violation history (all statuses), verified 2026-10-03.** `violationstatus` is `Open` or `Close`. There is no closing-date column: `currentstatusdate` is when `currentstatus` last changed, which for a closed row is when it was closed or dismissed (`VIOLATION CLOSED`, `VIOLATION DISMISSED`). Other dates: `approveddate` (inspection approved), `novissueddate` (notice sent), `originalcorrectbydate`/`newcorrectbydate`, `originalcertifybydate`/`newcertifybydate`, `certifieddate` (owner certified the repair). `ordernumber` is HPD's order number (`501`, `530`, `722`), `novid` the notice id, `novtype` `Original` or a reissue. The report fetches every status in one query, open first, then newest inspection (query u in §5); the open list the cards use is cut from it.
  - 1130 Anderson: 291 rows, 77 `Open` / 214 `Close` (`VIOLATION DISMISSED` 153, `VIOLATION CLOSED` 61). Heaviest BINs by row count (grouped query over the whole set, 30 s): placeholder BINs `3000000`, `2000000`, `1000000` and a null BIN, then `3343260` (765 Lincoln Ave, Brooklyn, 5,722), `2025588` (1742 E 172 St, Bronx, 4,874), `2004223` (530 E 169 St, Bronx, 4,849, with 1,155 open, 160 BIS, 107 DOB NOW and 132 ECB rows: the size test building).

### 2.2 HPD — Housing Maintenance Code Complaints and Problems

- Agency: HPD
- Page: https://data.cityofnewyork.us/d/ygpa-z7cr
- Id: `ygpa-z7cr` — endpoint `https://data.cityofnewyork.us/resource/ygpa-z7cr.json`
- The older split datasets `uwyv-629c` (Complaints) and `a2nx-4u46` (Complaint Problems) now return `authentication_required`; they are retired. Use this one.
- Rows: 16,345,381. Update: **Daily** (data change frequency daily; last 2026-10-01). Churn: 38,852 (upsert, ~34k/day).
- Join keys: `bin` (number), `bbl` (number), `building_id` (number), `block`+`lot` (numbers).
- Grain: one row per **problem** (`problem_id`) within a complaint (`complaint_id`). Count distinct `complaint_id` for "complaints".
- Columns to keep: `complaint_id`, `problem_id`, `received_date`, `type`, `major_category`, `minor_category`, `problem_code`, `complaint_status`, `complaint_status_date`, `problem_status`, `status_description`, `apartment`, `unit_type`, `space_type`, `unique_key`, `bin`, `bbl`.
- Live per address: **yes** (0.39 s with a 12-month `received_date` filter).
- Example:
  `https://data.cityofnewyork.us/resource/ygpa-z7cr.json?bin=2003068&$where=received_date>'2025-10-01'&$select=type,major_category,count(*)&$group=type,major_category&$order=count DESC`
  → top rows `NON EMERGENCY / UNSANITARY CONDITION 24`, `EMERGENCY / HEAT/HOT WATER 15`, …
- Gotchas:
  - `type` values: `EMERGENCY`, `NON EMERGENCY`, `IMMEDIATE EMERGENCY`, `HAZARDOUS`, `REFERRAL`.
  - `complaint_status` and `problem_status` are `OPEN` / `CLOSE`.
  - `major_category` values match 311 HPD complaint types (`HEAT/HOT WATER`, `UNSANITARY CONDITION`, `PLUMBING`, `ELEVATOR`, …).
  - `unique_key` equals the 311 `unique_key` for the same complaint (verified `70572907` in both). **311 HPD rows and this dataset are the same complaints; do not add them together.**
  - `complaint_anonymous_flag`, `problem_duplicate_flag` exist; filter `problem_duplicate_flag='N'` if counting problems.
  - `apartment` is free text cut to six characters: `BLDG`, `BUILDI`, `WHOLEB`, `BASEME`, `2NDFLO`, `APT3A` all occur (verified 2026-10-03). Only show it as a unit when it looks like one. `unit_type` is clean (`APARTMENT`, `BUILDING-WIDE`, `PUBLIC AREA`, `PUBLIC PARTS`) and says where the problem is; `space_type` names the room or area (`KITCHEN`, `LOBBY`, `ENTIRE BUILDING`, …). A complaint can mix scopes, e.g. apartment `D5` with one problem in the kitchen and one at the building entrance.
  - There are only ~60 `major_category`/`minor_category` pairs in a year; `HEAT/HOT WATER`'s minor category is the scope (`ENTIRE BUILDING`/`APARTMENT ONLY`) and `problem_code` says what (`NO HEAT`, `NO HOT WATER`, `NO HEAT AND NO HOT WATER`, `HEAT ON IN SUMMER`).
  - `major_category` over the five years to 2026-10-01 (problems): `HEAT/HOT WATER` 1,388,971, `UNSANITARY CONDITION` 670,945, `PLUMBING` 388,826, `PAINT/PLASTER` 357,377, `DOOR/WINDOW` 277,832, `WATER LEAK` 226,439, `GENERAL` 184,694, `ELECTRIC` 165,524, `FLOORING/STAIRS` 156,687, `APPLIANCE` 123,984, `SAFETY` 103,185, `OUTSIDE BUILDING` 9,658, `ELEVATOR` 9,642, `LINE OF TRAVEL` 8,222. `UNSANITARY CONDITION`'s minor categories in the last year: `PESTS` 84,566, `MOLD` 44,928, `GARBAGE/RECYCLING STORAGE` 22,400, `SEWAGE` 4,544 (verified 2026-10-03).
  - Complaint topics on the report (`topics`, set in `computeComplaints` from these categories only, never from free text): `HEAT/HOT WATER` is heat; `PLUMBING` and `WATER LEAK` are plumbing; `UNSANITARY CONDITION` with minor `PESTS` is pest. A complaint with several problems carries every topic they have.

### 2.3 HPD — Multiple Dwelling Registrations (building → registration)

- Agency: HPD
- Page: https://data.cityofnewyork.us/d/tesw-yqqr
- Id: `tesw-yqqr` — endpoint `https://data.cityofnewyork.us/resource/tesw-yqqr.json`
- Rows: 203,887. Update: **Monthly** (last rows update 2026-08-12). Churn: 0.
- Join keys: `bin` (number), `buildingid` (number), `boroid`+`block`+`lot` (numbers). Output key: `registrationid`.
- Columns to keep: `registrationid`, `buildingid`, `bin`, `housenumber`, `lowhousenumber`, `highhousenumber`, `streetname`, `zip`, `lastregistrationdate`, `registrationenddate`.
- Live per address: yes, but snapshot anyway (small, monthly).
- Example: `https://data.cityofnewyork.us/resource/tesw-yqqr.json?bin=2003068`
  → `registrationid 209634`, `lastregistrationdate 2025-10-08`, `registrationenddate 2026-09-01`.
- Gotchas:
  - Registration is required for buildings with 3+ residential units and 1–2 family homes where the owner does not live on site. 1–2 family owner-occupied homes will have no row; that is expected, not an error.
  - `registrationenddate` in the past = lapsed registration (itself an HPD class I violation).
  - Condos and co-ops do register (verified: condo BIN 1032526 has `registrationid 139040`).

### 2.4 HPD — Registration Contacts (owner / agent / manager)

- Agency: HPD
- Page: https://data.cityofnewyork.us/d/feu5-w2e2
- Id: `feu5-w2e2` — endpoint `https://data.cityofnewyork.us/resource/feu5-w2e2.json`
- Rows: 810,494. Update: **Monthly** (last 2026-08-12). Churn: 0.
- Join key: `registrationid` (number) from 2.3. No BIN/BBL on this table.
- Columns to keep: `registrationcontactid`, `type`, `contactdescription`, `corporationname`, `title`, `firstname`, `middleinitial`, `lastname`, `businesshousenumber`, `businessstreetname`, `businessapartment`, `businesscity`, `businessstate`, `businesszip`.
- Live per address: yes (second hop), but snapshot (small, monthly).
- Example: `https://data.cityofnewyork.us/resource/feu5-w2e2.json?registrationid=209634`
  → `CorporateOwner | 1130 SHEVA REALTY HDFC, INC`, `Agent | LANGSAM PROPERTY SERVICES CORP (GREG GADSON)`, `HeadOfficer | MARK ENGEL`, `SiteManager | JOE MARTE`.
- Gotchas:
  - `type` values observed: `CorporateOwner`, `Agent`, `HeadOfficer`, `SiteManager` (other values exist, e.g. individual owners; treat as an enum you discover from the snapshot). Full list (2026-10-03): `Agent`, `CorporateOwner`, `HeadOfficer`, `IndividualOwner`, `JointOwner`, `Lessee`, `Officer`, `Shareholder`, `SiteManager`.
  - `contactdescription` is not a role: it is the registration's ownership structure (`GEN.PART`, `CORP`, `INC`, `INDIV`, `JOINT`, `CO-OP`, `CONDO`, `LLC`, `TRUST`, ...), repeated on every contact of the registration. The report labels contacts by `type`.
  - Self-reported by the owner; names can be LLC shells. Show "registered owner" and "managing agent", not "owner".
  - Pair with PLUTO `ownername` / DOF `owner` for a second opinion (see 2.11, 2.15).

### 2.5 HPD — Bedbug Reporting

- Agency: HPD
- Page: https://data.cityofnewyork.us/d/wz6d-d3jb
- Id: `wz6d-d3jb` — endpoint `https://data.cityofnewyork.us/resource/wz6d-d3jb.json`
- Rows: 722,511. Update: **Monthly** (last 2026-09-15). Churn: 0.
- Join keys: `bin` (text), `bbl` (text), `building_id` (text), `registration_id` (text).
- Columns to keep: `filing_date`, `filing_period_start_date`, `filling_period_end_date` (sic, the column really is misspelled), `of_dwelling_units`, `infested_dwelling_unit_count`, `eradicated_unit_count`, `re_infested_dwelling_unit`, `bin`, `bbl`.
- Live per address: yes, but snapshot (monthly).
- Example: `https://data.cityofnewyork.us/resource/wz6d-d3jb.json?bin=2003068&$order=filing_date DESC&$limit=1`
  → filed `2025-12-03` for period `2024-11-01`→`2025-10-31`, 42 units, 0 infested, 0 eradicated, 0 re-infested.
- Gotchas:
  - Annual owner self-report (Local Law 69/2017): period Nov 1–Oct 31, filed in December. "0 infested" means the owner reported zero, not that there were none. A missing filing for the latest period is itself a signal.
  - Multiple rows per building (one per year; this building has 9). Take the max `filing_date`.
  - Only registered multiple dwellings file, so 1–2 family homes and most condos/co-ops without rentals will be absent.

### 2.6 DOB — Violations (BIS, legacy)

- Agency: Department of Buildings (DOB)
- Page: https://data.cityofnewyork.us/d/3h2n-5cm9
- Id: `3h2n-5cm9` — endpoint `https://data.cityofnewyork.us/resource/3h2n-5cm9.json`
- Rows: 2,477,110. Update: **Every weekday** (last 2026-10-01). Churn: 273 (upsert, very low; this is the legacy BIS feed).
- Join keys: `bin` (text). `boro`/`block`/`lot` are **zero-padded text** (`02505`, `00046`), so do not join on them without padding.
- Columns to keep: `isn_dob_bis_viol`, `number`, `violation_number`, `violation_category`, `violation_type_code`, `violation_type`, `issue_date`, `disposition_date`, `disposition_comments`, `description`, `device_number`, `ecb_number`, `bin`.
- Live per address: yes (small result sets).
- Example:
  `https://data.cityofnewyork.us/resource/3h2n-5cm9.json?bin=2003068&$select=violation_category,count(*)&$group=violation_category`
  → `V*-DOB VIOLATION - Resolved 17`, `V*-DOB VIOLATION - DISMISSED 9`, `V-DOB VIOLATION - ACTIVE 3`.
- Gotchas:
  - Open/closed lives in `violation_category`. Active values citywide: `V-DOB VIOLATION - ACTIVE`, `VW-VIOLATION WORK WITHOUT PERMIT - ACTIVE`, `VP-VIOLATION UNSERVED ECB-ACTIVE`, `VH-VIOLATION HAZARDOUS - ACTIVE`, `VWH-VIOLATION WORK W/OUT PMT HAZARDOUS - ACTIVE`, `VPW-VIOLATION UNSERVED ECB-WORK WITHOUT PERMIT-ACTIVE`. Dismissed/resolved categories contain `*`. `V%-DOB VIOLATION` (1,054 rows) has no status word; treat as active. Simplest rule: active = category does not contain `*`.
  - `issue_date` and `disposition_date` are `YYYYMMDD` **text**; lexicographic compare works (`issue_date > '20250101'`).
  - `violation_type` is a padded string (`E-ELEVATOR … ELEVATORREQUIRED`); match on the prefix before the first `-` (`E` elevator, `LL6291` boilers, `BENCH` benchmarking, `C` construction, `P` plumbing, `AEUHAZ1` ECB hazard affirmation, …).
  - DOB says this set holds **older** civil penalties and that newer ones are in `855j-jady` (2.7) with **some duplication** between the two. De-duplicate on `violation_number` / `number` when both are present.
  - The duplicate's BIS `number` is the DOB NOW `violation_number` with a `V` (or `V*` once resolved) in front: BIS `V062624AEUHAZ100065` is DOB NOW `062624AEUHAZ100065`. 1130 Anderson has four such pairs (two `AEUHAZ1`, two `BENCH`); the violation history lists each once, as the DOB NOW row, and notes the BIS number.
  - **Violation history, verified 2026-10-03.** Active can't be sorted on (it is "the category has no `*`"), so the history is its own query, every row newest first (query x in §5), next to the existing active query (d). A closed row's closing date is `disposition_date` (`YYYYMMDD`); `disposition_comments` says how (`000810 PAID INVOICE 90490015`). 1130 Anderson: 29 rows, 5 active.

### 2.7 DOB — Safety Violations (DOB NOW, newer civil penalties)

- Agency: DOB
- Page: https://data.cityofnewyork.us/d/855j-jady
- Id: `855j-jady` — endpoint `https://data.cityofnewyork.us/resource/855j-jady.json`
- Rows: 1,109,123. Update: **Daily** (last 2026-10-01).
- Join keys: `bin` (text), `bbl` (number), `block`/`lot` (numbers).
- Columns to keep: `violation_number`, `violation_type`, `violation_remarks`, `violation_status`, `violation_issue_date`, `device_number`, `device_type`, `cycle_end_date`, `bin`.
- Live per address: yes.
- Example: `https://data.cityofnewyork.us/resource/855j-jady.json?bin=2003068&violation_status=Active`
  → `VIO-FTC-VT-PER-202312-0012649` (Failure to file 2023 periodic elevator affirmation of correction), `VIO-FTC-VT-CAT1-202412-0009589` (Failure to file 2024 Cat1 elevator test affirmation).
- Gotchas:
  - `violation_status` values: `Active`, `Dismissed`, `Disputed Successfully`, `Waived - Pending Dismissal`, `Pending Dismissal`, `Cured`, `Paid  - Pending Dismissal` (two spaces).
  - `violation_type` codes: `LBLVIO`/`HBLVIO` boiler, `LL6291` boiler, `FTC-VT-CAT1-CO` / `FTC-VT-PER-CO` / `FTF-VT-*` elevator filing failures, `FTF-EN-BENCH` benchmarking, `FTC-AEU-HAZ` ECB hazard affirmation, `ACC1` elevator affirmation. Elevator = `device_type='Elevators'`.
  - Most rows are paperwork failures (failure to file), not physical hazards. Label them that way.
  - Citywide `violation_status` counts (2026-10-03): `Active` 683,044, `Dismissed` 422,842, `Disputed Successfully` 2,593, `Waived - Pending Dismissal` 492, `Pending Dismissal` 213, `Cured` 81, `Paid  - Pending Dismissal` 8, null 3. There is no closing-date column.
  - **Violation history.** One query for every status, active first, then newest (query v in §5); the active list the cards use is cut from it (status `Active`, same order, first 50). Ordering by `case(violation_status='Active',1,true,0) DESC` rather than by the status text keeps a null or new status from sorting ahead of `Active`. 1130 Anderson: 6 rows, 3 active.

### 2.8 DOB — ECB Violations (OATH summonses issued by DOB)

- Agency: DOB (adjudicated by OATH, formerly the Environmental Control Board)
- Page: https://data.cityofnewyork.us/d/6bgk-3dad
- Id: `6bgk-3dad` — endpoint `https://data.cityofnewyork.us/resource/6bgk-3dad.json`
- Rows: 1,838,146. Update: **Every weekday** (last 2026-10-01). Churn: 5,563 (upsert).
- Join keys: `bin` (text). `block`/`lot` zero-padded text.
- Columns to keep: `ecb_violation_number`, `ecb_violation_status`, `dob_violation_number`, `issue_date`, `served_date`, `hearing_date`, `hearing_status`, `severity`, `violation_type`, `violation_description`, `infraction_code1`, `section_law_description1`, `penality_imposed` (sic), `amount_paid`, `balance_due`, `respondent_name`, `aggravated_level`, `certification_status`, `bin`.
- Live per address: yes.
- Example: `https://data.cityofnewyork.us/resource/6bgk-3dad.json?bin=2003068&ecb_violation_status=ACTIVE&$order=issue_date DESC`
  → `39205015P`, issued `20260922`, `CLASS - 2`, type `Elevators`, "car top is not maintained in a safe and code-compliant condition", penalty 625, balance due 625, hearing `20261204` PENDING.
- Gotchas:
  - `ecb_violation_status` is `ACTIVE` / `RESOLVE` (not "RESOLVED"); 3 rows `Unknown`.
  - `severity` text like `CLASS - 1` (immediately hazardous), `CLASS - 2` (major), `CLASS - 3` (lesser).
  - Dates are `YYYYMMDD` text. `hearing_time` is `830`-style text.
  - `balance_due` > 0 on an ACTIVE row is an unpaid penalty; useful to show.
  - The full OATH case feed is `jz4z-kudi` (22,090,200 rows, daily); not needed for v1 since this DOB extract already carries hearing status.
  - Citywide `hearing_status` (2026-10-03): `IN VIOLATION` 682,066, `DISMISSED` 299,240, `WRITTEN OFF` 246,118, `CURED/IN-VIO` 214,953, `DEFAULT` 164,234, `STIPULATION/IN-VIO` 92,165, `POP/IN-VIO` 57,982, `ADMIT/IN-VIO` 37,923, `PENDING` 23,211, null 20,405. `certification_status`: `CERTIFICATE ACCEPTED` 1,004,932, `N/A - DISMISSED` 277,877, `CURE ACCEPTED` 214,943, `NO COMPLIANCE RECORDED` 166,817, null 111,121, `COMPLIANCE-INSP/DOC` 58,227, `CERTIFICATE DISAPPROVED` 2,699, `CERTIFICATE PENDING` 990, `REINSPECTION SHOWS VIOLATION GOOD` 657, `REINSPECTION SHOWS STILL IN VIOLATION` 34. There is no resolve date.
  - A `PENDING` row already carries `penality_imposed` and `balance_due` (39205015P: 625 and 625, hearing 2026-12-04), but nothing is decided until the hearing, so the report never calls it a fine: it is labelled by hearing status ("Hearing pending") and the amount is shown as "Penalty listed, hearing pending". Only a decided hearing (`IN VIOLATION`, `DEFAULT`, `*/IN-VIO`) shows "Fine imposed".
  - **Violation history.** One query for every status, active first, then newest (query w in §5); the active list the cards use is cut from it (status `ACTIVE`, same order, first 50). It also selects `amount_paid`, `certification_status`, `served_date`, `hearing_time`, `infraction_code1`, `section_law_description1`, `aggravated_level`, `respondent_name` and `dob_violation_number`. 1130 Anderson: 20 rows, 4 active.

### 2.9 DOB — Complaints Received

- Agency: DOB
- Page: https://data.cityofnewyork.us/d/eabe-havv
- Id: `eabe-havv` — endpoint `https://data.cityofnewyork.us/resource/eabe-havv.json`
- Rows: 3,138,033. Update: **Daily** (last 2026-10-01). Churn: **3,138,033 = full replace every day**; `:updated_at` is useless here.
- Join key: `bin` (text) **only**. No BBL column.
- Columns to keep: `complaint_number`, `status`, `date_entered`, `complaint_category`, `unit`, `disposition_date`, `disposition_code`, `inspection_date`, `house_number`, `house_street`, `zip_code`, `bin`.
- Live per address: yes.
- Example: `https://data.cityofnewyork.us/resource/eabe-havv.json?bin=2003068&$select=status,count(*)&$group=status`
  → `CLOSED 30` (no ACTIVE for this BIN; citywide ACTIVE 20,911 / CLOSED 3,117,122).
- Gotchas:
  - `status` is `ACTIVE` / `CLOSED`.
  - All dates (`date_entered`, `disposition_date`, `inspection_date`) are `MM/DD/YYYY` **text**. You cannot range-filter them in SoQL; filter client-side or in Postgres after the daily pull. `dobrundate` is `YYYYMMDDHHMMSS` text.
  - `complaint_category` is a 2-character code. Decoder: the dataset attachment `DOBComplaints_complaint_category_list.pdf` (https://data.cityofnewyork.us/api/views/eabe-havv/files/dc709ed2-7af1-429c-92c9-71ec3a4c23fa?download=true&filename=DOBComplaints_complaint_category_list.pdf, rev. 12/18). Codes that matter for a renter: `45` Illegal Conversion, `05` Permit – None, `04` After Hours Work, `31` Certificate of Occupancy – None/Illegal/Contrary, `30` Building Shaking/Structural Stability, `37` Egress Locked/Blocked, `62`/`63` Elevator – Danger Condition/Shaft Open (priority A/B), `80` Elevator Not Inspected/Illegal, `81` Elevator Accident, `56` Boiler – Fumes/Smoke/CO, `58` Boiler – Defective, `59` Electrical Wiring Defective, `65` Gas Hook-Up Illegal/Defective, `73` Failure to Maintain, `94` Plumbing Defective/Leaking, `4A` Illegal Hotel Rooms, `2B` Failure to Comply with Vacate Order. Newer codes such as `6S`, `6Y` are **not** in the 2018 PDF.
  - The **current** list is DOB's "Complaint Categories", Rev. 9/21, 180 codes: https://www.nyc.gov/assets/buildings/pdf/complaint_category.pdf (the dataset's data-dictionary attachment `DD_DOB_Complaints_Received_2019-08-21.xlsx` names it as the current list). It adds `6S`/`6M` (elevator, single/multiple devices), `7J` (work without a permit, occupied multiple dwelling), `8A`, `1X`, `4S`, and more, and rewords `63` to "Elevator: Defective/Inoperative". With the three retired codes only in the 2018 list (`4C`, `4D`, `4F`) it labels 99.6% of all rows and 96.5% of 2025–26 rows (verified 2026-10-03). Still unlisted: `7R`, `2S`–`2Y`, `7P`, `7Q`, `7S`, `8P`, `1N`, `4Q`; show those as the raw code. Transcribed in `src/lib/translate.ts` (`DOB_COMPLAINT_CATEGORY`).
  - `unit` is the DOB unit that dispositioned the complaint (`QNS.`, `BKLYN`, `ERT`, `ELEVR`, `BOILR`, …), **not** an apartment. Disposition codes are listed at https://www.nyc.gov/assets/buildings/pdf/bis_complaint_disposition_codes.pdf (not decoded yet).
  - 311 DOB rows (`agency='DOB'`) are the same complaints as this feed, keyed by BBL in 311 and BIN here.

### 2.10 311 — Service Requests from 2020 to Present

- Agency: 311 / Office of Technology and Innovation (OTI)
- Page: https://data.cityofnewyork.us/d/erm2-nwe9
- Id: `erm2-nwe9` — endpoint `https://data.cityofnewyork.us/resource/erm2-nwe9.json`
- Rows: 22,659,530. Update: **Daily** (last 2026-10-02). Churn: 572,658 in 2 days (upsert; ~560k rows/day change because `status`/`closed_date` update).
- Join key: `bbl` (text) **only**. No BIN. Also `incident_address` (`1130 ANDERSON AVENUE`), `incident_zip`, `address_type`.
- Columns to keep: `unique_key`, `created_date`, `closed_date`, `agency`, `complaint_type`, `descriptor`, `descriptor_2`, `location_type`, `status`, `resolution_description`, `resolution_action_updated_date`, `incident_address`, `incident_zip`, `bbl`.
- Live per address: **yes, for one BBL** (0.37 s with a 12-month filter), but see the strategy section.
- Complaint topics (verified 2026-10-03): every `complaint_type` starting `Noise` is noise; the Health Dept's (`agency='DOHMH'`) `Rodent` type is pest (25,410 requests citywide in the year to 2026-10-01; no other complaint type that year matches rodent, pest or rat). DOB complaint codes with a topic are in `DOB_COMPLAINT_TOPIC` (`src/lib/translate.ts`): the four `Boiler: ...` codes (56, 57, 58, 82) are heat; 1W, 66, 6B, 76 and 94 are plumbing.
- Example:
  `https://data.cityofnewyork.us/resource/erm2-nwe9.json?bbl=2025050046&complaint_type=HEAT/HOT WATER&$where=created_date>'2025-10-01'&$select=count(*)`
  → `14`.
- Complaint types to keep (verified citywide volumes, last 12 months):
  - HPD: `HEAT/HOT WATER` (359k; descriptors `ENTIRE BUILDING`, `APARTMENT ONLY`), `UNSANITARY CONDITION` (137k; descriptors `PESTS`, `MOLD`, `GARBAGE/RECYCLING STORAGE`, `SEWAGE`), `PLUMBING` (84k), `PAINT/PLASTER`, `DOOR/WINDOW`, `WATER LEAK`, `GENERAL`, `ELECTRIC`, `FLOORING/STAIRS`, `APPLIANCE`, `SAFETY`, `ELEVATOR` (2.2k).
  - DOB: `Elevator` (25.6k; descriptors `Elevator - Single Device On Property/No Alternate Service`, `Elevator - Multiple Devices On Property`), `General Construction/Plumbing`, `Building/Use`, `Boilers`, `Plumbing`, `Electrical`.
  - DOHMH: `Rodent` (25k).
  - Noise: NYPD `Noise - Residential` (433k; `Loud Music/Party`, `Banging/Pounding`), `Noise - Commercial`, `Noise - Street/Sidewalk`; DEP `Noise`.
- Gotchas:
  - `bbl` is null on a small share of rows (123 of ~55.7k HPD rows in Sept 2026); those are lost to a BBL join. `address_type='ADDRESS'` on all HPD rows checked.
  - BBL-level, so on a multi-building lot the count covers the whole complex.
  - HPD rows duplicate `ygpa-z7cr` (same `unique_key`). Pick one source for HPD counts; v1 uses 311 because it is the one feed we snapshot for all agencies.
  - Noise complaints are about the address reported, which is often the neighbour; present as "noise reported at/near".
  - Sizing for a local table: all rows since 2024-10-01 = 7.56M; HPD+DOB only = 1.87M.

### 2.11 DCP — PLUTO (Primary Land Use Tax Lot Output)

- Agency: Department of City Planning (DCP)
- Page: https://data.cityofnewyork.us/d/64uk-42ks
- Id: `64uk-42ks` — endpoint `https://data.cityofnewyork.us/resource/64uk-42ks.json`
- Rows: 858,284 (one per tax lot). Update: **Quarterly** (current `version 26v2`, rows updated 2026-08-24).
- Join key: `bbl` (**number**). `bbl=2025050046` works; the value comes back as `"2025050046.00000000"`, so cast on ingest. Also `borough` (`BX`), `block`, `lot` numbers.
- Columns to keep (cover page): `address`, `zipcode`, `ownername`, `ownertype`, `yearbuilt`, `yearalter1`, `yearalter2`, `unitsres`, `unitstotal`, `numbldgs`, `numfloors`, `bldgclass`, `landuse`, `zonedist1`, `zonedist2`, `overlay1`, `spdist1`, `lotarea`, `bldgarea`, `resarea`, `histdist`, `landmark`, `condono`, `assesstot`, `latitude`, `longitude`, `version`.
- Live per address: yes, but snapshot (quarterly, one table, cheap).
- Example:
  `https://data.cityofnewyork.us/resource/64uk-42ks.json?bbl=2025050046&$select=address,ownername,yearbuilt,unitsres,unitstotal,numbldgs,numfloors,bldgclass,zonedist1`
  → `1130 ANDERSON AVENUE`, owner `1130 SHEVA REALTY HOUSING DEVELOPMENT FU ND CORP`, built 1928, 42/42 units, 1 building, 6 floors, class `D1`, zoning `R7-1`.
- Gotchas:
  - `ownername` is DOF's assessment-roll owner, truncated and sometimes stale ("FU ND CORP"). Good for the cover page, not for "who to call".
  - `yearbuilt` is often an estimate (many old buildings carry 1899/1900/1920/1931 placeholders).
  - Lot-level: for Stuy Town it returns 8,764 units and 39 buildings. Show `numbldgs` so the user understands.
  - Condo billing BBL rows exist (`1012237503` → `THE 100 WEST 93 CONDOMINIUM`, `condono 1645`, 279 units).
  - `ownertype` `X` = mixed/unknown; `C` city, `O` other public, `P` private, `M` mixed — show only `ownername`.

### 2.12 DOB NOW — Elevator Safety Compliance (device inventory + latest filings)

- Agency: DOB
- Page: https://data.cityofnewyork.us/d/e5aq-a4j2
- Id: `e5aq-a4j2` — endpoint `https://data.cityofnewyork.us/resource/e5aq-a4j2.json`
- Rows: 120,534 (one per device). Update: **Daily** (last 2026-10-01). Churn: 840.
- Join keys: `bin` (text), `bbl` (text), `block`/`lot` text.
- Columns: `device_number`, `device_type`, `device_status`, `status_date`, `equipment_type`, `periodic_report_year`, `periodic_latest_inspection`, `cat1_report_year`, `cat1_latest_report_filed`, `cat5_latest_report_filed`, `bin`, `bbl`.
- Live per address: yes (handful of rows), and snapshot is trivial.
- Example: `https://data.cityofnewyork.us/resource/e5aq-a4j2.json?bin=2003068`
  → device `2P907`, `Elevator`, `Active`, periodic inspection `2026-03-12`, Cat1 filed `2025-07-21` (report year 2025), Cat5 filed `2024-02-01`.
- Gotchas:
  - This is **not** a violation table. It tells you which devices exist and when the owner last filed. `device_status` values: `Active`, `Removed`, `Work in Progress`, `Dismantled`, `Deleted`, `Withdrawn`, `Sealed`. Count only `Active` devices of `device_type='Elevator'`.
  - "Open elevator issue" has to be assembled from three places: this table (missing/late Cat1 filing for the prior year), `855j-jady` (`device_type='Elevators'`, `violation_status='Active'`), and `6bgk-3dad` (`violation_type='Elevators'`, `ecb_violation_status='ACTIVE'`). Plus 311 `Elevator` complaints for recency.
  - `juyv-2jek` (DOB NOW: Build Elevator Device Details) has **no BIN/BBL column** (only `physical_address` text); skip it. `kfp4-dz4h` (Elevator Permit Applications) is job filings, not compliance; optional later.
  - Data dictionary attachment: https://data.cityofnewyork.us/api/views/e5aq-a4j2/files/cd2360da-acb0-4b1d-b172-92dcee8b7d4a?download=true&filename=Data_Dictionary_DOB_NOW_Elevator_Safety_Compliance_Filings.xlsx

### 2.13 HPD — Housing Litigations (add; strong signal)

- Page: https://data.cityofnewyork.us/d/59kj-x8nc — Id `59kj-x8nc`
- Rows: 241,562. Update: **Monthly** (last 2026-10-01).
- Join: `bin` (text), `bbl` (text), `buildingid`.
- Keep: `litigationid`, `casetype`, `caseopendate`, `casestatus`, `casejudgement`, `findingofharassment`, `findingdate`, `penalty`, `respondent`.
- Example: `https://data.cityofnewyork.us/resource/59kj-x8nc.json?bin=2003068&$order=caseopendate DESC`
  → `Tenant Action` opened `2026-08-28` `PENDING`; `Tenant Action/Harrassment` 2025 `CLOSED`, `No Harassment`.
- Gotcha: `casetype` includes HPD-initiated (`Heat and Hot Water`, `Comprehensive`) and tenant-initiated cases; a `findingofharassment` of `Harassment` is a headline fact.

### 2.14 HPD — Order to Repair / Vacate Orders (add; small)

- Page: https://data.cityofnewyork.us/d/tb8q-a3ar — Id `tb8q-a3ar`
- Rows: 8,906. Update: **Daily** (last 2026-09-30).
- Join: `bin` (number), `bbl` (number), `building_id`.
- Keep: `vacate_order_number`, `primary_vacate_reason`, `vacate_type`, `vacate_effective_date`, `actual_rescind_date`, `number_of_vacated_units`.
- Example: `https://data.cityofnewyork.us/resource/tb8q-a3ar.json?bin=2003068` → partial vacate, `Fire Damage`, effective `2022-01-24`, rescinded `2023-04-13`, 5 units.
- Gotcha: a row with null `actual_rescind_date` is a live vacate order; that overrides everything else on the page.

### 2.15 HPD — Buildings Subject to HPD Jurisdiction (add; the BuildingID↔BIN crosswalk)

- Page: https://data.cityofnewyork.us/d/kj4p-ruqc — Id `kj4p-ruqc`
- Rows: 380,119. Update: **Monthly** (last 2026-08-12).
- Join: `bin` (number) → `buildingid`, `registrationid`.
- Keep: `buildingid`, `registrationid`, `legalstories`, `legalclassa` (legal class A, i.e. permanent, units), `legalclassb` (transient/SRO units), `dobbuildingclass`, `managementprogram` (`PVT` private; others are HPD programs such as AEP), `lifecycle`, `recordstatus`.
- Example: `https://data.cityofnewyork.us/resource/kj4p-ruqc.json?bin=2003068` → `buildingid 45427`, 6 stories, 42 class A units, `NEW LAW TENEMENT`, `PVT`, `Active`.
- `managementprogram` values (citywide, 2026-10-03): `PVT` 375,520; `NYCHA` 1,978; `CENTRAL MGT` 1,413; `M-L (STATE)` 464; `M-L (NRF CITY)` 231; `LOFT LAW` 204; `M-L (RF CITY)` 141; `DRES` 75; `ALT MGT` 31; `7A` 28; `HPD O SITE` 18; `UNDEFINED` 13; `DRES RES PRO`, `LOW INCOME RENT`, `NYPD HPD_J` 1 each. HPD publishes no code list (the dataset's attachment only says the field "determines who is responsible for the management of this building"). The plain words in `src/lib/translate.ts` (`housingProgram`) cover the codes whose meaning is clear from the code and from PLUTO's owner for sample buildings (`CENTRAL MGT` and `ALT MGT` buildings are owned by HPD); `DRES`, `DRES RES PRO`, `HPD O SITE` and `NYPD HPD_J` show title-cased, and `UNDEFINED` shows nothing. `recordstatus` is `Active`, `Inactive` or `Pending`.
- Why: you need `buildingid` for the HPD Online deep link, and this table has it even when there are no violations.

### 2.16 Other official sets worth knowing (not in v1)

| Dataset | Id | Rows | Cadence | Join | Use |
|---|---|---|---|---|---|
| DOI Evictions (marshal-executed) | `6z8x-wfk4` | 134,824 | Daily | `bin`, `bbl`, `eviction_address` | Now in the report: executed residential evictions in the last three years with apartment, court index and docket numbers, marshal, and possession/ejectment type (§5 t) |
| DOB Certificate of Occupancy (BIS) | `bs8b-p36w` | 143,214 | Daily | `bin_number` | Now in the report: the "Legal apartments" tile (§2.22). No rows for the test BIN, so coverage is partial |
| DOB NOW Certificate of Occupancy | `pkdm-hqz6` | 82,494 | Daily | `bin` | Newer COs; not read (the request budget, §5) |
| DOB NOW Safety Boiler | `52dp-yji6` | 889,703 | Daily | `bin_number` | Now in the report: the "Boiler inspection" tile (§2.22) |
| DOB NOW Safety Facades (FISP/LL11) | `xubg-57si` | 87,325 | Weekdays | `bin` | Now in the report: the "Facade inspection" tile (§2.22) |
| DOB Job Application Filings (BIS) / DOB NOW Build | `ic3t-wcy2` / `w9ak-ipjd` | 2.72M / 964k | Daily | `bin` | Active construction |
| DOF Property Valuation and Assessment (classes 1–4) | `8y4t-faws` | large | Annually (2026-09-14) | `parid` = BBL (text) | `owner`, `units`, `yrbuilt`, `curmkttot`, `curtaxclass`; verified `parid=2025050046` → owner `1130 SHEVA REALTY HOUSING DEVELOPMENT FU ND CORP`, market value 1,312,000, tax class 2. Returns duplicate rows per year; dedupe. |
| ACRIS Real Property Legals → Master → Parties | `8h5j-fqxa` → `bnx9-e6tj` → `636b-3b5g` | very large | Monthly | `borough`+`block`+`lot` → `document_id` | The first two hops are now in the report: last sale and newest mortgage (§2.20). Parties (the names on a deed) would be a third hop and are not read. |
| OATH Hearings Division Case Status | `jz4z-kudi` | 22.1M | Daily | ticket number | Only if ECB extract proves insufficient |

Sections 2.17 to 2.23 were added and verified live on **2026-10-03**. Second test building for them: **1018 Eastern Parkway, Brooklyn 11213** (BIN `3037516`, BBL `3013950033`, HPD BuildingID `287492`), which has rows in most of these sets.

### 2.17 DOHMH — Rodent Inspection (Violations section: failed rat inspections)

- Agency: Department of Health and Mental Hygiene (DOHMH)
- Page: https://data.cityofnewyork.us/d/p937-wjvj
- Id: `p937-wjvj` — endpoint `https://data.cityofnewyork.us/resource/p937-wjvj.json`
- Rows: 3,131,494. Update: **Daily** (last 2026-10-03).
- Join keys: `bbl` (number), `boro_code`+`block`+`lot`, `bin` (text). The dictionary says "inspections are conducted at the taxlot level", so the report joins on BBL and calls the record the lot's. 103,299 rows have no `bbl`.
- Columns to keep: `job_id`, `inspection_date`, `inspection_type`, `result`, `letter_type`, `observations`, `house_number`, `street_name`.
- Live per address: yes.
- Example: `https://data.cityofnewyork.us/resource/p937-wjvj.json?bbl=3013950033&$select=result,count(*)&$group=result`
  → `Bait applied 74`, `Failed for Rat Activity 31`, `Failed for Rat Activity and Other Reason 26`, `Passed 7`, `Monitoring visit 5`, `Failed for Other Reason 2`: 145 visits, 59 of them failed inspections, the newest failure 2020-02-27, the newest visit a pass on 2026-02-27.
- Gotchas:
  - One row per **visit**, and most visits are not inspections. `inspection_type`: `Initial` 2,157,302, `Compliance` 480,611 (the follow-up after a failed initial), `Treatments` 475,859, `Stoppage` 14,298, `Clean Ups` 3,424. `result`: `Passed` 1,845,352, `Bait applied` 428,264, `Failed for Rat Activity` 402,576, `Failed for Other Reason` 259,931, `Failed for Rat Activity and Other Reason` 130,054, `Monitoring visit` 47,595, `Stoppage done` 14,298, `Cleanup done` 3,424.
  - "Rat activity" is tracks, droppings, burrows, runways, gnawing or live rats. "Other reason" is garbage, harborage (clutter and overgrowth rats nest in), mice, or another animal nuisance such as pigeon droppings: so a `Failed for Other Reason` row can have nothing to do with rats. `observations` says which (`Burrows` 185,742, `Harborage` 151,300, `Droppings` 100,906, ..., `Mice` 20,677, `Animal Nuisance` 7,611); the headline names it when it is only mice or an animal.
  - `job_id` is a case, not a visit: an initial inspection, its compliance inspection and every baiting visit that followed share one (one job at 1018 Eastern Parkway has 12 rows). It is not a row key.
  - `letter_type` is `COTA` (1,397,639; the Commissioner's Order to Abate), `Summons Issued` (160,458), `City Agency Referral` (28,956) or blank. The dictionary says blank means a treatment or a pass, but `COTA` also appears on rows that passed.
  - There is no "resolved" column. The report closes a failed inspection when the lot passes a later one, and gives that pass's date as the closing date (docs/RULES.md).
  - No lot has more than 487 rows, and 76 lots have more than 200 (grouped query over the whole set). The query takes up to 500 visits of every kind, newest first (query y in §5), so today it never cuts a lot off; the rows listed are the failed ones, capped at 200.
  - 1018 Eastern Parkway's rows go back to 2009, so its 59 failed inspections are spread over 17 years; each row carries its date.

### 2.18 HPD — Emergency repair charges (Violations section: city emergency repairs)

- Agency: HPD. Two tables of the "HPD Charge Data" collection:
  - Open Market Order (OMO) Charges — https://data.cityofnewyork.us/d/mdbu-nrqn — `mdbu-nrqn`: work HPD contracted out. Rows: 514,504. Update: **Daily**.
  - Handyman Work Order (HWO) Charges — https://data.cityofnewyork.us/d/sbnd-xujn — `sbnd-xujn`: work done by HPD's own staff. Rows: 99,690. Update: **Daily**.
- Join keys: `buildingid` (number, on every row), `bin` (text; missing on 1,102 OMO and 129 HWO rows), `bbl` (text), `boro`+`block`+`lot`.
- Columns to keep, OMO: `omonumber`, `apartment`, `lifecycle`, `worktypegeneral`, `omostatusreason`, `omoawardamount`, `omocreatedate`, `netchangeorders`, `omoawarddate`, `isaep`, `iscommercialdemolition`, `servicechargeflag`, `femaevent`, `omodescription`. HWO: `hwonumber`, `lifecycle`, `worktypegeneral`, `hwostatusreason`, `hwocreatedate`, `isaep`, `iscommercialdemolition`, `femaevent`, `hwodescription`, `hwoapprovedamount`, `salestax`, `adminfee`, `chargeamount`, `datetransferdof`.
- Live per address: yes.
- Example: `https://data.cityofnewyork.us/resource/mdbu-nrqn.json?bin=3037516&$select=count(*),sum(omoawardamount)` → `90`, `74901.00` (2004-07-14 to 2022-09-29); the same on `sbnd-xujn` with `sum(chargeamount)` → `23`, `3464.14`. 113 orders in all, 66 of them carried out.
- **Keyed by BIN, not by HPD BuildingID.** `buildingid` is the datasets' own key, but the report only learns it from the jurisdiction or registration query, so keying on it would mean a second, serial round of requests that fails whenever those two do, and it is null for a building HPD has no record of. BIN is how every other HPD feed here is read, returns the same rows for both test buildings (90 and 23; 8 and 1 at 1130 Anderson), and also covers the 1.1% of BINs that have more than one HPD BuildingID (about 4,000 of the 357,000 in `kj4p-ruqc`). The cost is the 0.2% of orders with no BIN.
- Gotchas:
  - An order is not a repair. `omostatusreason` / `hwostatusreason` is why the order was closed: `OMO Completed` (286,936 OMO; 45,941 HWO, which use the same wording), `No Access` (67,553), `Landlord Complied` (26,929), `Utility Account Picked Up By ESB` (26,316), `Owner Refused Access` (21,605), `Refused Access`, `Other`, `Fuel Delivered`, `Work Done by Others`, `Work Partially Completed`, `LL/Agent refused access`, `Duplicate OMO`, `Condition Different than Stated`, `Complainant Refused`, `Tenant Refused Access`, `Work Not Started`, ..., and blank on 7,273 OMOs. The report says the city **made** the repair only for the reasons that say so (docs/RULES.md) and that it **ordered** it otherwise.
  - Amounts are not the bill. HPD's dictionary (`HPD Charge Open Data.pdf`, notes 4 to 6 and 14): `omoawardamount` is what the vendor was awarded for the first scope of work, `netchangeorders` moves it, utility orders are awarded $1 because billing comes later, and a cancelled order with `servicechargeflag = True` owes the vendor a service charge, not the award. HWO has the real charge: `chargeamount` = `hwoapprovedamount` + `salestax` + `adminfee`, "total lienable amount to be transferred to DoF", with `datetransferdof`. The row's `amount` is award plus change orders (OMO) or `chargeamount` (HWO), and the summary's total counts only orders carried out.
  - `worktypegeneral` is a code HPD publishes no list for. OMO: `GC` 289,221, `DELEAD` 120,837, `UTIL` 38,955, `PLUMB` 20,519, `HEAT` 15,976, `ASBEST` 7,857, `ELEC` 7,536, `STOPAG` 4,560, `DEMOL` 4,554, `ELEV` 1,674, `EXTERM` 883, `MISC` 882, `AEPFEE` 405, `7AFA` 399, `RUB` 105, `INTCOM` 55, `MOVE` 49, `ENGINR` 12, `APPL` 10, `IRON` 7, `MOLD` 6. HWO adds `7AWIND`, `7AHEAT`, `CCC`, `DE-50K`. The plain words in `compute.ts` (`REPAIR_WORK`) cover the codes that are plain from the code and from their orders' descriptions (`STOPAG` orders unclog drains and waste lines, `RUB` ones remove rubbish, `IRON` ones fix fire escapes); `MISC`, `MOVE`, `CCC` and the rest show as the code. `AEPFEE` (fees for program work) and `7AFA` (7A Financial Assistance, dictionary note 7) are charges rather than repairs and get their own headlines.
  - `omodescription` is cut at 150 characters by the publisher, lower-cased, and both descriptions carry control characters (`\u001a`) where the source had line breaks; the report strips those. Descriptions can name tenants ("keep the belongings of ... in storage").
  - HWO has no `apartment` column; the apartment is only in the description ("at apt # 16r"). OMO's `apartment` is empty on 130,824 rows. The report reads the apartment from the description when the column has none.
  - The files hold charges "since July 1999"; 1018 Eastern Parkway's run from 2004 to 2022.

### 2.19 HPD — City programs (Legal section)

Three small HPD lists, each read by `bin` (number), each also carrying `building_id`:

- **Alternative Enforcement Program** — https://data.cityofnewyork.us/d/hcir-3275 — `hcir-3275`. Rows: 4,387 (862 `AEP Active`, 3,525 `AEP Discharged`). Update: **Monthly** (last 2026-10-01). Each year HPD picks 250 "severely distressed" buildings (200 in rounds 1 to 6, 187 in round 7); round 19 began 2026-02-02.
  - Keep: `aep_start_date`, `aep_round`, `current_status`, `discharge_date`, `of_b_c_violations_at_start`.
  - One row per **stint**: a building can be selected again after a discharge (BuildingID `77585` has five rows). 1018 Eastern Parkway has two: round 6, 2013-01-31 to 2018-10-31, and round 16 from 2023-01-31, still `AEP Active`.
  - `of_b_c_violations_at_start` is documented as the count of B and C violations open on the selection date, but it is the **same number on every one of a building's rows** (2,725 on both of 1018 Eastern Parkway's; 3,629 on all five of BuildingID `77585`'s), so it is one figure per building, not per stint. The report shows it and says so when a building has several stints.
- **Heat Sensor Program** — https://data.cityofnewyork.us/d/h4mf-f24e — `h4mf-f24e`. Rows: 200. Update: **Monthly** (last 2026-08-01). Every two years from July 2020 HPD picks 50 buildings with heat violations and complaints that must install heat sensors.
  - Keep: `program_start_date`, `current_status`, `discharge_date`.
  - All 200 rows are `Active` and none has a `discharge_date`, including the ones from 2020: either nothing has been discharged or discharges aren't published. The report would close a row that had one. Neither test building is on it (example: BIN `1053660`, 70 West 128 Street, started 2025-06-11).
- **Certification of No Harassment pilot building list** — https://data.cityofnewyork.us/d/bzxi-2tsw — `bzxi-2tsw`. Rows: 1,599. Update: **As needed** (last 2026-09-25; 1,147 rows were added 2022-06-24, the rest since). The owner of a listed building has to show there was no tenant harassment before the buildings department will approve demolition or major alteration permits.
  - Keep: `date_added` and the six yes/no columns that say why the building is listed: `bqi` (Building Qualification Index over the threshold), `aep_order`, `discharged_7a`, `hpd_vacate_order`, `dob_vacate_order`, `harassment_finding`.
  - `aep_order` is not an AEP order: its label and description are "Discharged AEP", "building was discharged from the HPD Alternative Enforcement Program". 1018 Eastern Parkway is listed with `bqi = Yes` and everything else `No`, although it was discharged from AEP in 2018 and is in it again.
  - A building is on the list while it has a row; there is no removal date, so the record is always open.

### 2.20 DOF — ACRIS (Landlord section: last sale, latest mortgage)

- Agency: Department of Finance (DOF), Automated City Register Information System.
- Real Property Legals — https://data.cityofnewyork.us/d/8h5j-fqxa — `8h5j-fqxa`: one row per document per lot it touches. Join: `borough`, `block`, `lot` (numbers). Keep: `document_id`.
- Real Property Master — https://data.cityofnewyork.us/d/bnx9-e6tj — `bnx9-e6tj`: one row per document. Join: `document_id` (text). Keep: `doc_type`, `document_date`, `document_amt`, `recorded_datetime`, `percent_trans`.
- Document Control Codes — `7isb-wh4c` (126 rows): what each `doc_type` is, and its class. Read once here, not per report.
- Update: **Monthly** (both last 2026-09-08).
- Two requests (query ae in §5): the lot's document ids, then those documents' types, dates and amounts.
- Example: `borough=2&block=2505&lot=46` → 73 documents; among them `MTGE 2018-03-14 $1,475,000`, `DEED 2017-06-21 $1`, `DEED 1996-04-02 $0`, `MTGE 1992-09-04 $280,000`. For `borough=3&block=1395&lot=33`: 8 documents, the newest deed and mortgage both dated 1974-08-28 with amount 0.
- Gotchas:
  - **Slow when cold.** The legals query took 0.3 s to 10 s for a lot it hadn't just served (three query shapes, fifteen lots), whatever the shape; repeats take 0.3 s. Against the Worker's 9 s timeout some builds will lose the two lines.
  - Document ids from 2003 on are 16 digits that start with the recording date (`2017062700295001`); older ones start with a borough prefix (`FT_2900005131590`, `BK_7430073200374`). The legals query sorts the digit ones first, newest first, and takes 120, since the only way to say "newest" is the id. Lot `1/972/1` (Stuyvesant Town) has 513 legal rows for 77 documents, hence the `$group`.
  - Deeds: of the 34 types in the "deeds and other conveyances" class, the report counts `DEED`, `DEEDO`, `DEEDP`, `DEED, LE`, `DEED, RC`, `IDED` and `REIT`. Not corrections and confirmations (`CORRD`, `DEED COR`, `CONDEED`), timeshare deeds (`DEED, TS`), transfer-on-death deeds (`TODD`), leases, easements or contracts. Mortgages: `MTGE`, `M&CON`, `CMTG`. Not `AGMT` ("agreement", 8,777 recorded in 2026): it is often the consolidation of a building's older loans into one, with the full amount on it (lot `1/835/41`: an `AGMT` for $300,000,000 six weeks after a `MTGE` for $31,000,000), but it is also any other agreement, and nothing on the row says which. So "Latest mortgage" can understate what a building owes.
  - `document_amt` is 0 on most documents from before the 1990s and on transfers that weren't sales; nominal amounts ($1, $10) are common too (1130 Anderson's 2017 deed is for $1). The report calls a deed a sale only above $100, shows "No sale price on record" when no deed qualifies, and notes a newer no-price deed beside an older sale.
  - One deed can convey several lots and carries one amount for all of them. 530 East 169 Street's last sale is a 2013 deed for $51,500,000 that also conveys 2410 Washington Avenue (`8h5j-fqxa?document_id=2013102300198001` → 2 lots). Telling takes a third request, the deed's other legal rows, which the report doesn't make, so the line under the price says it is the deed's and can cover other lots.
  - `document_date` is blank on some rows and decades before `recorded_datetime` on others (a 1974 deed recorded in 2009); the report uses the document's date, or the recording date when the document's is missing or not a plausible date.
  - `percent_trans` is the share conveyed (100, or 0 on old rows); below 100 the line says so.
  - **Condos**: the building's BBL is its billing lot (7501 to 7599), which has no deeds (`1/1223/7503` → 0 rows); each apartment is its own lot. The report asks ACRIS nothing for a billing lot and shows neither line.

### 2.21 DOF — Tax Lien Sale Lists (Landlord section)

- Page: https://data.cityofnewyork.us/d/9rz4-mjek — Id `9rz4-mjek`
- Rows: 264,142. Update: **Every 6 months** (last 2025-12-01).
- Join: `borough`, `block`, `lot` (numbers). Keep: `month`, `cycle`, `water_debt_only`.
- Example: `https://data.cityofnewyork.us/resource/9rz4-mjek.json?borough=3&block=1395&lot=33&$order=month DESC` → 8 rows: the 90, 60, 30 and 10 day notices of the 2025 sale (2025-02-01 to 2025-05-01) and of the 2021 sale, all `water_debt_only = NO`.
- Gotchas:
  - A row is a **notice that the lot could be in the next lien sale**, not a sale: each sale has a `90 Day Notice`, `60 Day Notice`, `30 Day Notice`, `10 Day Notice` list and then `Final Sale` (2025: 29,972 → 26,511 → 21,546 → 18,445 → 4,545 sold). 1018 Eastern Parkway was on all four 2025 notices and not on the final list, so its debt was paid or pulled before the sale. The report shows the stage with the month.
  - Sales in the data: 2019, 2020 (notices only), 2021, 2025. None from 2022 to 2024.
  - `water_debt_only` is `YES`/`NO` in most years and `Y`/`N` in others; `cycle` is "10 Day Notice" or "10 Days Notice".
  - No lot has more than 19 rows.

### 2.22 Building facts tiles

One request each, by BIN unless noted; a tile shows only when its dataset has something to say.

- **Flood zone** — PLUTO (`64uk-42ks`, §2.11), no extra request: `firm07_flag` and `pfirm15_flag` are `1` when any part of the lot is in the 1%-a-year floodplain on FEMA's 2007 map or its 2015 preliminary map, and absent otherwise. Citywide: both 33,201 lots, 2007 only 1,535, 2015 only 32,625, neither 790,923. Neither test lot is in one.
- **Facade inspection** — DOB NOW: Safety Facades Compliance Filings, https://data.cityofnewyork.us/d/xubg-57si — `xubg-57si`, 87,325 rows, every weekday. Keep: `cycle`, `filing_type`, `current_status`, `filing_status`, `filing_date`, `submitted_on`.
  - `cycle` is **text** (`6` to `10`; `10` sorts before `6`), so the newest cycle is picked in code.
  - Two status columns. `filing_status` is what that one report said (`SAFE`, `SWARMP`, `UNSAFE`, `No Report Filed`); `current_status` is where the cycle stands and is the same on every row of the cycle (350 Fifth Avenue, cycle 6: an initial report filed `UNSAFE`, an amended one `SWARMP`, and `current_status = SWARMP` on both). A cycle-10 report still under review has no `current_status` (252 rows have none); the report then uses its `filing_status`. `SWARMP` is "safe with a repair and maintenance program".
  - `filing_type = Auto-Generated` (19,358 rows) is a row the city makes for a building that owes a report. 1130 Anderson Avenue has exactly one row: cycle 9, auto-generated, `No Report Filed`, with `late_filing_amt` and `failure_to_file_amt` of 56,000. PLUTO gives it six floors, so "only buildings over six stories" is not a rule to filter on. The dictionary doesn't say what the three amount columns are (accrued, assessed or billed), so they are not shown.
  - 1018 Eastern Parkway (four floors) has no rows and gets no tile.
- **Boiler inspection** — DOB NOW: Safety Boiler, https://data.cityofnewyork.us/d/52dp-yji6 — `52dp-yji6`, 889,703 rows, daily. Join: `bin_number` (number; not `bin`). Keep: `tracking_number`, `boiler_id`, `report_type`, `inspection_date`, `defects_exist`, filtered to `report_status` starting `Accepted` (873,360 rows; the rest are drafts and rejections).
  - `inspection_date` is `MM/DD/YYYY 00:00:00` **text** and can't be sorted in the query; `tracking_number` starts with the filing year (`2026-30000000151Y1111-866761`), so the query sorts on that and the date is parsed in code.
  - One row per filing per boiler. `report_type = Subsequent` (22,960) is the filing that corrects an inspection's defects (1130 Anderson, 2024: `Initial` 04/13 with defects, `Subsequent` 07/02 without). The tile takes each boiler's newest filing; a boiler whose newest inspection is more than two years before the building's newest is taken as replaced.
  - 1018 Eastern Parkway: one boiler, inspected 2026-05-13, `defects_exist = Yes`. 1130 Anderson: 2026-03-10, `No`.
- **Legal apartments** — DOB Certificate of Occupancy, https://data.cityofnewyork.us/d/bs8b-p36w — `bs8b-p36w`, 143,214 rows, daily. Join: `bin_number` (text). Keep: `c_o_issue_date`, `pr_dwelling_unit`, `issue_type`.
  - The description says it holds certificates "issued from 7/12/2012 to March 2021", but the newest are from 2026-10-02: it is still updated. It has only certificates issued since 2012 through the older system, so a prewar building that never needed a new one has no row (neither test building does), and newer ones can be in `pkdm-hqz6` instead, which is not read.
  - `pr_dwelling_unit` is present on 98,649 rows. 93,806 rows are `Temporary` certificates, renewed every few months, so a building can have dozens. One row is dated `2105-11-05`; the tile takes the newest certificate that isn't in the future.
- **Work permits in 12 months** — DOB NOW: Build – Approved Permits, https://data.cityofnewyork.us/d/rbx6-tga4 — `rbx6-tga4`, 1,010,055 rows, daily. Keep (aggregated): `work_type`, `count(distinct work_permit)`, `max(issued_date)`, where `issued_date` is in the last 365 days.
  - One row per **issuance**: `filing_reason` is `Initial Permit` (685,442), `Renewal Permit Without Changes` (261,161), `Renewal Permit with Changes` (56,325). 1130 Anderson's sidewalk shed has four rows since 2024 for one permit, so permits are counted by `work_permit`.
  - DOB NOW only: permits filed in the older system (`ipu4-2q9a`, whose count by BIN timed out at 30 s), and electrical, elevator and limited-alteration permits, are in other datasets. So no tile is shown for zero. 1018 Eastern Parkway: none in twelve months. 1130 Anderson: 1, `Sidewalk Shed`.
- **Asbestos abatement filings** — DEP Asbestos Control Program (ACP7), https://data.cityofnewyork.us/d/vq35-j9qm — `vq35-j9qm`, 406,103 rows for 72,924 projects, monthly. Keep (grouped): `tru`, `start_date`, `status_description`.
  - One row per floor and material of a project; `tru` is the project. Filings start 2017-11.
  - `end_date` is "date filed + 364 days", not when the work ended, so it is not shown. `status_description`: `Closed` 282,817, `Submitted` 72,849, `Postponed` 50,437.
  - 13 projects have start dates after 2027, up to the year 2423; the tile's "latest" is the newest that starts within a year of the report. Neither test building has a filing.

### 2.23 Rent stabilization hint from tax exemptions

The question: can one request say that a lot has a 421-a or J-51 tax benefit, which generally comes with rent-stabilized apartments? Yes, as a hint.

- **J-51 Exemption and Abatement (Historical)** — `y7az-s7wc`: "data earlier than tax year 2019 and is not updated" (rows last updated 2019-03-14). It can say a building once had J-51, not that it does now. Not used.
- **Property Exemption Detail** — https://data.cityofnewyork.us/d/muvi-b6kx — `muvi-b6kx`, about 3.6 million rows, **every 6 months** (last 2026-09-15): one row per lot, exemption, tax year (`year` 2021 to 2027) and roll (`period` 1 tentative, 3 final). Join: `parid` (text) = BBL. A query by `boro`/`block`/`lot` finds nothing because `block` and `lot` are text; and 1018 Eastern Parkway has no rows by `parid` either: it has no exemption.
- The dataset's dictionary doesn't define `exmp_code`. DOF's **Exemption Classification Codes** (`myn9-hwsy`, 243 rows) does: `1920` is `J51`; `5110`, `5113`, `5114`, `5116`, `5117`, `5118`, `5119`, `5120`, `5121`, `5122`, `5123` are `421A ...` (10 to 35 year schedules). Its lettered variants (`1920S`, `5110-C`) never appear in `exmp_code`. Neighbours that are something else: `5112` UDAAP, `5129` DAMP, `5130` Article XI (1130 Anderson's), `5124` on 467-m, `5132` on 485-x, `1925` 421-g.
- The signal: a row for the lot with one of those twelve codes, `status` starting `A` (approved; blank and `DL` rows are lapsed or revoked exemptions with zero value), `curexmptot > 0`, and `year` equal to the tax year the report is made in (July to June, named for the year it ends in). On the FY2027 final roll 16,542 J-51 rows and about 42,200 421-a rows are approved.
- Why it is only a hint, and worded "May be rent stabilized": the benefit is the lot's, not an apartment's; units a condo or co-op owner lives in aren't regulated, and under the newest 421-a schedules market-rate units above a rent threshold aren't either. A condo building's exemptions sit on its apartments' lots, so its billing lot shows nothing. J-51 **abatements** without an exemption are in another dataset (`rgyu-ii48`) and are missed. No tile claims the absence of rent stabilization.

---

## 3. Live vs. snapshot

Measured latency per filtered SODA call without an app token: 0.3–0.5 s. Eight parallel calls finish in under a second, so a cold search with no cache is fine for interactive use. The reasons to snapshot are BBL-only joins that need an index you control, and three datasets whose date columns are text.

| Dataset | Mode | Why |
|---|---|---|
| GeoSearch | Live | No alternative; cache resolved address → BIN/BBL forever (PAD version changes quarterly; re-resolve on `version` change) |
| HPD violations `wvxf-dwi5` | **Both**: live on search, daily incremental into Postgres | 11.3M rows but indexed by BIN; `:updated_at` works (upsert, ~82k/day) |
| HPD complaints `ygpa-z7cr` | Both, same pattern | 16.3M rows; upsert ~34k/day |
| DOB violations `3h2n-5cm9` | Both | 2.5M; upsert, tiny churn |
| DOB safety violations `855j-jady` | Both | 1.1M; daily |
| ECB `6bgk-3dad` | Both | 1.8M; upsert |
| DOB complaints `eabe-havv` | **Daily full replace** into Postgres; live for the first search | 3.1M rows, publisher replaces everything daily; dates are text so range filters must run locally |
| 311 `erm2-nwe9` | **Daily into Postgres**, filtered; live only as a fallback | 22.7M rows, ~560k rows/day change; pull only `agency in (HPD,DOB,DOHMH,NYPD,DEP)` and the complaint types above, `created_date >= now()-2y` (≈2M rows), then incremental by `:updated_at` with the same filter |
| Registrations `tesw-yqqr`, Contacts `feu5-w2e2`, HPD Jurisdiction `kj4p-ruqc` | Monthly full replace | 204k / 810k / 380k rows, monthly |
| Bedbug `wz6d-d3jb` | Monthly full replace | 723k, monthly |
| Litigations `59kj-x8nc` | Monthly full replace | 242k |
| Vacate orders `tb8q-a3ar` | Daily full replace | 8.9k |
| Elevator compliance `e5aq-a4j2` | Daily full replace (or incremental) | 121k |
| PLUTO `64uk-42ks` | Quarterly full replace | 858k; re-pull when `version` changes |

Rule of thumb for v1: **serve the first search live** (so there is nothing to build before launch), write the merged result to a `dossier_snapshot` row, and let the daily jobs fill the local tables that the PDF uses.

---

## 4. Socrata app token, throttling, daily pull pattern

Source: https://dev.socrata.com/docs/app-tokens.html and https://dev.socrata.com/docs/system-fields.html (fetched 2026-10-02).

- **Without a token** requests share an IP-based pool and "may be subject to throttling"; **with a token** Socrata states it does not throttle "unless those requests are determined to be abusive or malicious". Throttled responses are HTTP `429`. Always send the token.
- Get a token: sign in at https://data.cityofnewyork.us (any Socrata login) → profile → Developer Settings → Create new app token. Send it as the `X-App-Token` header (preferred) or `$$app_token=` query param. Treat it as a secret (another app using it burns your quota).
- SODA version: all datasets here are SODA 2.1. Default `$limit` is 1,000; `$limit=100000` verified working. Response headers include `X-SODA2-Truth-Last-Modified` (useful as a cheap "did anything change" check before a pull).
- System fields `:id`, `:created_at`, `:updated_at` are available via `$select=:id,:updated_at,*`. They are `fixed_timestamp` (UTC), so `$where=:updated_at > '2026-10-01T00:00:00'` works.
- **Full-replace detection**: if `count(*) where :updated_at > yesterday` equals the total, the publisher replaced the dataset (true for `eabe-havv`). For those, do a full re-download, not an incremental.

Daily pull pattern:

1. Initial load: bulk CSV, not paged JSON.
   `https://data.cityofnewyork.us/api/views/{id}/rows.csv?accessType=DOWNLOAD` (verified for `wvxf-dwi5`; column headers are the display names, e.g. `ViolationID`, not the API field names, so map them). Load into a staging table with `COPY`, then swap.
2. Incremental (datasets marked upsert): once a day, after the agency's run (HPD lands ~14:50 UTC, DOB ~17:00–20:30 UTC, 311 ~01:40 UTC, measured from `rowsUpdatedAt`):
   `GET /resource/{id}.json?$select=:id,:updated_at,*&$where=:updated_at > '{last_watermark}'&$order=:id&$limit=50000&$offset={n}`
   Page until a short page. Upsert on the dataset's natural key (`violationid`, `problem_id`, `unique_key`, `isn_dob_bis_viol`, `ecb_violation_number`, `violation_number`, `device_number`). Store the max `:updated_at` seen as the next watermark, minus a 1-hour overlap.
3. Full replace (`eabe-havv`, monthly HPD sets, PLUTO, bedbug): re-download CSV when `X-SODA2-Truth-Last-Modified` (HEAD request) is newer than your copy.
4. Deletions: Socrata upserts do not expose deletes. For HPD violations this does not matter (rows close, they don't vanish). For full-replace sets the swap handles it.
5. Budget: a full 311 filtered backfill is ~2M rows ≈ 40 pages of 50k; nightly incrementals are ~100k rows after the agency/type filter. Well under anything Socrata will notice. Add 1–2 s between pages anyway.

---

## 5. Exact request path

Input: `"1130 Anderson Ave, Bronx"` (free text).

1. **Normalise**: trim, collapse spaces, replace number words (`One`→`1`), detect intersection pattern (`\b(and|&|at)\b` between two street tokens) → reject with a message. Extract a 5-digit zip if present; map a borough word to its `boundary.gid`.
2. **GeoSearch**:
   `GET https://geosearch.planninglabs.nyc/v2/search?text=1130%20Anderson%20Ave%2C%20Bronx&size=5[&boundary.gid=whosonfirst:borough:421205773]`
   Take `features[0]`; require `properties.housenumber`, `addendum.pad.bin` not ending in `000000`, borough/zip agreement. Else return `features[0..4].label` for the user to pick.
   Result: `bin=2003068`, `bbl=2025050046`, label `1130 ANDERSON AVENUE, Bronx, NY, USA`, zip `10452`.
3. **Parallel SODA calls** (all with `X-App-Token`, 5 s timeout each, each failure degrades to "unavailable" rather than failing the page):
   - a. `GET https://data.cityofnewyork.us/resource/wvxf-dwi5.json?bin=2003068&violationstatus=Open&$select=class,count(*)&$group=class`
   - b. `GET https://data.cityofnewyork.us/resource/wvxf-dwi5.json?bin=2003068&violationstatus=Open&$where=class in('B','C')&$select=violationid,class,inspectiondate,apartment,novdescription,currentstatus&$order=inspectiondate DESC&$limit=25`
   - c. `GET https://data.cityofnewyork.us/resource/ygpa-z7cr.json?bin=2003068&$where=received_date > '2025-10-02'&$select=major_category,count(distinct complaint_id) as complaints&$group=major_category&$order=complaints DESC`
   - d. `GET https://data.cityofnewyork.us/resource/3h2n-5cm9.json?bin=2003068&$where=not contains(violation_category,'*')&$select=number,violation_type,issue_date,description&$order=issue_date DESC`
   - e. `GET https://data.cityofnewyork.us/resource/855j-jady.json?bin=2003068&violation_status=Active&$select=violation_number,violation_type,violation_remarks,violation_issue_date,device_type`
   - f. `GET https://data.cityofnewyork.us/resource/6bgk-3dad.json?bin=2003068&ecb_violation_status=ACTIVE&$select=ecb_violation_number,issue_date,severity,violation_type,violation_description,balance_due,hearing_date,hearing_status`
   - g. `GET https://data.cityofnewyork.us/resource/eabe-havv.json?bin=2003068&status=ACTIVE&$select=complaint_number,date_entered,complaint_category,unit`
   - h. `GET https://data.cityofnewyork.us/resource/e5aq-a4j2.json?bin=2003068&device_status=Active&$select=device_number,device_type,cat1_report_year,cat1_latest_report_filed,periodic_latest_inspection`
   - i. `GET https://data.cityofnewyork.us/resource/wz6d-d3jb.json?bin=2003068&$order=filing_date DESC&$limit=1`
   - j. `GET https://data.cityofnewyork.us/resource/tesw-yqqr.json?bin=2003068&$select=registrationid,buildingid,lastregistrationdate,registrationenddate`
     then `GET https://data.cityofnewyork.us/resource/feu5-w2e2.json?registrationid=209634` (dependent hop; from the local snapshot when available)
   - k. `GET https://data.cityofnewyork.us/resource/erm2-nwe9.json?bbl=2025050046&$where=created_date > '2025-10-02'&$select=agency,complaint_type,count(*) as n&$group=agency,complaint_type&$order=n DESC`
   - l. `GET https://data.cityofnewyork.us/resource/64uk-42ks.json?bbl=2025050046&$select=address,ownername,yearbuilt,unitsres,unitstotal,numbldgs,numfloors,bldgclass,zonedist1,histdist,landmark,condono,version`
   - m. `GET https://data.cityofnewyork.us/resource/59kj-x8nc.json?bin=2003068&$order=caseopendate DESC&$limit=5`
   - n. `GET https://data.cityofnewyork.us/resource/tb8q-a3ar.json?bin=2003068`
   - o. `GET https://data.cityofnewyork.us/resource/kj4p-ruqc.json?bin=2003068&$select=buildingid,registrationid,legalstories,legalclassa,legalclassb,dobbuildingclass,managementprogram`
   (Replace the 12-month date literal with `now - 365 days` at request time.)

   Complaint history for the full report (verified 2026-10-03 for 1130 Anderson Ave). Plain query params and `$where` are ANDed. p and s use a five-year window, the same calendar day five years before the request. A result of exactly the `$limit` means older rows were cut off, and the page says "Showing the newest N".
   - p. HPD complaint problems, grouped into complaints by `complaint_id` in code:
     `GET https://data.cityofnewyork.us/resource/ygpa-z7cr.json?bin=2003068&problem_duplicate_flag=N&$where=received_date > '2021-10-03'&$select=complaint_id,problem_id,received_date,type,major_category,minor_category,problem_code,complaint_status,complaint_status_date,problem_status,status_description,apartment,unit_type,space_type,unique_key&$order=received_date DESC&$limit=1000`
     → 303 problem rows in 143 complaints. `type` `EMERGENCY`/`IMMEDIATE EMERGENCY`/`HAZARDOUS` marks the complaint as an emergency; `status_description` is HPD's outcome wording.
   - q. Lifetime HPD complaint count:
     `GET https://data.cityofnewyork.us/resource/ygpa-z7cr.json?bin=2003068&problem_duplicate_flag=N&$select=count(distinct complaint_id) as n` (same duplicate filter as the list, so the teaser count matches it)
     → `392` (571 without the duplicate filter).
   - r. DOB complaints, no date window (dates are `MM/DD/YYYY` text, parsed and sorted in code):
     `GET https://data.cityofnewyork.us/resource/eabe-havv.json?bin=2003068&$select=complaint_number,status,date_entered,complaint_category,unit,disposition_date,disposition_code,inspection_date&$order=complaint_number DESC&$limit=500`
     → 30 rows. Complaint numbers carry the borough digit first, so within one BIN the order is roughly chronological; the list is re-sorted by `date_entered`.
   - s. 311 requests other than HPD and DOB:
     `GET https://data.cityofnewyork.us/resource/erm2-nwe9.json?bbl=2025050046&$where=created_date > '2021-10-03' AND agency not in ('HPD','DOB')&$select=unique_key,created_date,closed_date,agency,complaint_type,descriptor,descriptor_2,location_type,status,resolution_description&$order=created_date DESC&$limit=500`
     → 281 rows (NYPD 265, DEP 11, DSNY 4, DOT 1). HPD and DOB rows are excluded because they are the same complaints as p and r (§2.2: same `unique_key` for HPD; §2.9). `status` is `Closed` or one of `Open`, `Assigned`, `In Progress`, `Pending`, `Started`, `Unspecified`. `descriptor_2` is often `N/A` or a short code repeated from `descriptor` (`FHE`, `WA4`).
   - t. Residential evictions carried out in the last three years, one row each (replaced a `count(*)` query with the same filters on 2026-10-03; the legal card's count is the row count and its "Evictions carried out, last 3 years" table lists each row):
     `GET https://data.cityofnewyork.us/resource/6z8x-wfk4.json?bin=2003068&residential_commercial_ind=Residential&$where=executed_date > '2023-10-04'&$select=executed_date,eviction_apt_num,court_index_number,docket_number,marshal_first_name,marshal_last_name,ejectment,eviction_possession&$order=executed_date DESC&$limit=100`
     → 5 rows (verified 2026-10-03), newest: `executed_date 2025-11-13`, `eviction_apt_num A7`, `court_index_number B311005/22`, `docket_number 119749`, `marshal_first_name Ileana`, `marshal_last_name Rivera`, `ejectment Not an Ejectment`, `eviction_possession Possession`. The others: 2025-10-16 (D5), 2025-01-21 (A3), 2024-03-06 (E2), 2024-02-06 (D6).
     Selected columns and how the table shows them: `executed_date` (Date), `eviction_apt_num` (Apartment), `eviction_possession` + `ejectment` (Type, e.g. "Possession, not an ejectment"), `court_index_number` (Court index no.), `docket_number` (Docket), `marshal_first_name` + `marshal_last_name` (Marshal). Citywide values: `eviction_possession` is `Possession`, `Eviction` or `Unspecified`; `ejectment` is `Not an Ejectment` or `Ejectment`.
     Not selected because the report already has them: `eviction_address` (this building's address, sometimes with the unit in parentheses), `borough`, `eviction_zip`, `bin`, `bbl`, `latitude`, `longitude`, `community_board`, `council_district`, `census_tract`, `nta`, and `residential_commercial_ind` (always `Residential` here, it is a filter).

   Violation history (added 2026-10-03; verified live for 1130 Anderson Ave and 530 E 169 St). Three of the open-only row queries became all-status queries sorted open first, and the open lists every card reads are cut from them in code with the old filter, order and cap (`deriveHpdOpenItems`, `deriveDobNowActive`, `deriveEcbActive` in `src/lib/datasets.ts`), so the cards are unchanged. BIS gets one added query. **28 requests per report** (27 in parallel plus the contacts hop), up from 27. (Now 29: a count of the last year's housing violations by status was added the same day, because the capped row list holds open rows first and so can't say how many recent violations were closed on a building past the cap.) A result of exactly the `$limit` means some rows were cut off, and the page says so in one line. Live check on four buildings (2026-10-03): the derived lists have the same rows in the same date order as the old queries; only the order among rows sharing one date differs, and the old query itself returns those ties in a different order from one call to the next.
   - u. HPD violations, every status (replaces the open-only row query; `hpdOpenItems` = `Open` rows, same order, first 300):
     `GET https://data.cityofnewyork.us/resource/wvxf-dwi5.json?bin=2003068&$select=violationid,class,inspectiondate,approveddate,novissueddate,originalcorrectbydate,originalcertifybydate,newcorrectbydate,newcertifybydate,certifieddate,apartment,story,ordernumber,novid,novtype,novdescription,currentstatus,currentstatusdate,violationstatus,rentimpairing&$order=case(violationstatus='Open',1,true,0) DESC,inspectiondate DESC&$limit=500`
     → 291 rows (77 open first). The limit is 500, not 1,000: a report is one D1 row (2 MB cap), and at 1,000 the stored report for 530 E 169 St was 1.68 MB; at 500 it is 1.31 MB (1,000 rows of that building are all open: it has 1,155).
   - v. DOB NOW violations, every status (replaces the `violation_status=Active` query; `dobNowActive` = `Active` rows, same order, first 50):
     `GET https://data.cityofnewyork.us/resource/855j-jady.json?bin=2003068&$select=violation_number,violation_type,violation_remarks,violation_status,violation_issue_date,device_type,device_number,cycle_end_date&$order=case(violation_status='Active',1,true,0) DESC,violation_issue_date DESC&$limit=300`
     → 6 rows, 3 active.
   - w. City summonses, every status (replaces the `ecb_violation_status=ACTIVE` query; `ecbActive` = `ACTIVE` rows, same order, first 50):
     `GET https://data.cityofnewyork.us/resource/6bgk-3dad.json?bin=2003068&$select=ecb_violation_number,ecb_violation_status,dob_violation_number,issue_date,served_date,severity,violation_type,violation_description,infraction_code1,section_law_description1,aggravated_level,respondent_name,penality_imposed,amount_paid,balance_due,hearing_date,hearing_time,hearing_status,certification_status&$order=case(ecb_violation_status='ACTIVE',1,true,0) DESC,issue_date DESC&$limit=300`
     → 20 rows, 4 active (39205015P `PENDING`, hearing 2026-12-04).
   - x. BIS violations, every status (added; the active query d stays as it is):
     `GET https://data.cityofnewyork.us/resource/3h2n-5cm9.json?bin=2003068&$select=number,violation_number,violation_type_code,violation_type,violation_category,issue_date,disposition_date,disposition_comments,description,device_number,ecb_number&$order=issue_date DESC&$limit=300`
     → 29 rows; 4 repeat a DOB NOW violation and are listed once (§2.6).

   Rat inspections, city repairs, city programs, property records and building facts (added 2026-10-03; verified live for 1018 Eastern Parkway, BIN `3037516`, BBL `3013950033`, and 1130 Anderson Ave; datasets in §2.17 to §2.23). Fifteen more requests: fourteen join the parallel round, and the ACRIS documents request follows it beside the contacts hop. **44 requests per report at most** (42 in parallel, then 2), where 29 were. A Worker invocation on the free plan gets 50 subrequests and the address lookup takes one or two, so a build now does nothing else that fetches: the eight dataset "last updated" stamps (one metadata request each when KV was cold) are no longer fetched, since no page shows them, and the landing page's sample gets its AI summary from a later request than the one that builds it. A condo building makes 42 (no ACRIS), and a lot with no documents or a building with no registration one fewer each.
   - y. Every health department visit to the lot, newest first; the failed inspections become rows:
     `GET https://data.cityofnewyork.us/resource/p937-wjvj.json?bbl=3013950033&$select=job_id,inspection_date,inspection_type,result,letter_type,observations,house_number,street_name&$order=inspection_date DESC&$limit=500`
     → 145 rows, 59 failed, all closed by the pass of 2022-09-27 or an earlier one.
   - z. Emergency repairs contracted out:
     `GET https://data.cityofnewyork.us/resource/mdbu-nrqn.json?bin=3037516&$select=omonumber,apartment,lifecycle,worktypegeneral,omostatusreason,omoawardamount,omocreatedate,netchangeorders,omoawarddate,isaep,iscommercialdemolition,servicechargeflag,femaevent,omodescription&$order=omocreatedate DESC&$limit=200`
     → 90 rows.
   - aa. Emergency repairs by HPD staff:
     `GET https://data.cityofnewyork.us/resource/sbnd-xujn.json?bin=3037516&$select=hwonumber,lifecycle,worktypegeneral,hwostatusreason,hwocreatedate,isaep,iscommercialdemolition,femaevent,hwodescription,hwoapprovedamount,salestax,adminfee,chargeamount,datetransferdof&$order=hwocreatedate DESC&$limit=200`
     → 23 rows.
   - ab. `GET https://data.cityofnewyork.us/resource/hcir-3275.json?bin=3037516&$select=aep_start_date,of_b_c_violations_at_start,current_status,discharge_date,aep_round&$order=aep_start_date DESC` → 2 rows.
   - ac. `GET https://data.cityofnewyork.us/resource/h4mf-f24e.json?bin=3037516&$select=program_start_date,current_status,discharge_date&$order=program_start_date DESC` → 0 rows.
   - ad. `GET https://data.cityofnewyork.us/resource/bzxi-2tsw.json?bin=3037516&$select=date_added,bqi,aep_order,discharged_7a,hpd_vacate_order,dob_vacate_order,harassment_finding&$order=date_added DESC` → 1 row, added 2022-06-24.
   - ae. The lot's newest 120 documents, then their types, dates and amounts (skipped for a condo billing lot, 7501 to 7599):
     `GET https://data.cityofnewyork.us/resource/8h5j-fqxa.json?borough=3&block=1395&lot=33&$select=document_id&$group=document_id&$order=case(document_id < 'A',1,true,0) DESC,document_id DESC&$limit=120`
     → 8 ids, then
     `GET https://data.cityofnewyork.us/resource/bnx9-e6tj.json?$where=document_id in ('2009090900739001','FT_3800001383980',…) AND doc_type in ('DEED','DEEDO','DEEDP','DEED, LE','DEED, RC','IDED','REIT','MTGE','M&CON','CMTG')&$select=document_id,doc_type,document_date,document_amt,recorded_datetime,percent_trans&$order=recorded_datetime DESC&$limit=120`
     → 4 rows: three deeds and a mortgage from 1974, all with amount 0.
   - af. `GET https://data.cityofnewyork.us/resource/9rz4-mjek.json?borough=3&block=1395&lot=33&$select=month,cycle,water_debt_only&$order=month DESC&$limit=50` → 8 rows, newest `2025-05-01`, `10 Day Notice`, `NO`.
   - ag. `GET https://data.cityofnewyork.us/resource/xubg-57si.json?bin=3037516&$select=cycle,filing_type,current_status,filing_status,filing_date,submitted_on&$order=submitted_on DESC&$limit=100` → 0 rows (1130 Anderson: 1, cycle 9, `No Report Filed`).
   - ah. `GET https://data.cityofnewyork.us/resource/52dp-yji6.json?bin_number=3037516&$where=starts_with(report_status,'Accepted')&$select=tracking_number,boiler_id,report_type,inspection_date,defects_exist&$order=tracking_number DESC&$limit=100` → 3 rows, newest `05/13/2026`, `defects_exist Yes`.
   - ai. `GET https://data.cityofnewyork.us/resource/bs8b-p36w.json?bin_number=3037516&$where=pr_dwelling_unit IS NOT NULL&$select=c_o_issue_date,pr_dwelling_unit,issue_type&$order=c_o_issue_date DESC&$limit=10` → 0 rows.
   - aj. `GET https://data.cityofnewyork.us/resource/rbx6-tga4.json?bin=3037516&$where=issued_date > '2025-10-03'&$select=work_type,count(distinct work_permit) as permits,max(issued_date) as latest&$group=work_type&$order=permits DESC` → 0 rows (1130 Anderson: `Sidewalk Shed 1`).
   - ak. `GET https://data.cityofnewyork.us/resource/vq35-j9qm.json?bin=3037516&$select=tru,start_date,status_description&$group=tru,start_date,status_description&$order=start_date DESC&$limit=500` → 0 rows.
   - al. `GET https://data.cityofnewyork.us/resource/muvi-b6kx.json?parid=3013950033&$where=status like 'A%' AND curexmptot > 0 AND exmp_code in ('1920','5110','5113','5114','5116','5117','5118','5119','5120','5121','5122','5123')&$select=year,period,exmp_code,curexmptot&$order=year DESC,period DESC&$limit=10` → 0 rows (lot `1000160185`: `2027`, `5116`, a 421-a exemption).
   - PLUTO (l) also selects `landuse`, `yearalter1`, `yearalter2`, `firm07_flag` and `pfirm15_flag`.

   Response times on the evening of 2026-10-03 were far from the 0.3 to 0.5 s of §3. A single filtered request on a small dataset (`tb8q-a3ar` by BIN) answered in 0.2 s or in 5 to 14 s, all of the wait before the first byte, so the server and not the network. Bursts drew `503 Service unavailable` within half a second on up to a third of their requests, mostly when one build followed another inside a minute. The 29-request build that predates these additions was hit like the 44-request one: three builds a minute or more apart had 3 `503`s and 8 of 29 requests over 9 s, then none and 13 of 44, then none and 12 of 44. Against the Worker's 9 s timeout either build would have lost datasets that evening. Worth measuring again on another day before reading anything into it.
4. **Merge** into one JSON (shape in §6), stamp `fetched_at` and the PAD `version`. (The per-dataset `rowsUpdatedAt` stamps were dropped with the "Where this comes from" section; `sources` is an empty list now.)
5. **Persist** the merged JSON keyed by `(bin, bbl, fetched_at)` so the PDF reads the same object the user saw.

---

## 6. v1 summary (no score)

Returned JSON, with the exact derivation:

```json
{
  "address": {
    "label": "1130 ANDERSON AVENUE, Bronx, NY, USA",
    "borough": "Bronx", "zip": "10452",
    "bin": "2003068", "bbl": "2025050046",
    "hpd_building_id": "45427",
    "lot_only": false
  },
  "cover": {                                  // PLUTO 64uk-42ks by bbl (+ kj4p-ruqc)
    "year_built": 1928, "units_res": 42, "units_total": 42,
    "floors": 6, "buildings_on_lot": 1,
    "building_class": "D1", "zoning": "R7-1",
    "pluto_owner": "1130 SHEVA REALTY HOUSING DEVELOPMENT FU ND CORP",
    "pluto_version": "26v2"
  },
  "hpd_violations": {                          // wvxf-dwi5, violationstatus=Open
    "open_class_a": 10, "open_class_b": 39, "open_class_c": 28,
    "open_bc_total": 67,
    "newest_open_c": {"inspectiondate": "2026-09-12", "apartment": "D5", "text": "…self-closing doors…"},
    "open_rent_impairing": 6
  },
  "hpd_complaints_12mo": {"complaints": 33, "problems": 71, "problems_by_category": {"UNSANITARY CONDITION": 25, "HEAT/HOT WATER": 15}},  // ygpa-z7cr: distinct complaint_id vs problem rows
  "dob": {
    "open_bis_violations": 3,                  // 3h2n-5cm9 category without '*'
    "open_dob_now_violations": 2,              // 855j-jady Active
    "open_ecb_summonses": 4, "ecb_balance_due": 625,   // 6bgk-3dad ACTIVE
    "open_dob_count": 9,                       // sum of the three; show the three separately too
    "active_dob_complaints": 0                 // eabe-havv ACTIVE
  },
  "elevator": {
    "active_devices": 1,                       // e5aq-a4j2 device_status=Active, device_type=Elevator
    "last_periodic_inspection": "2026-03-12",
    "cat1_last_filed": "2025-07-21",
    "open_issue": true,                        // any of: 855j-jady Active & device_type='Elevators'; 6bgk-3dad ACTIVE & violation_type='Elevators'; cat1_report_year < last year
    "open_issue_detail": ["ECB 39205015P class 2 elevator, hearing 2026-12-04", "DOB NOW: failure to file 2024 Cat1 affirmation"]
  },
  "bedbugs": {"last_filing_date": "2025-12-03", "period_end": "2025-10-31", "infested_units": 0, "eradicated_units": 0, "reinfested_units": 0, "dwelling_units": 42},  // wz6d-d3jb newest
  "heat_311_12mo": 14,                         // erm2-nwe9 bbl, complaint_type='HEAT/HOT WATER'
  "other_311_12mo": {"UNSANITARY CONDITION": 24, "ELEVATOR": 3, "Elevator (DOB)": 2, "Noise - Residential": 3},
  "ownership": {                               // tesw-yqqr -> feu5-w2e2
    "registration_id": "209634",
    "registration_expires": "2026-09-01",
    "registered_owner": "1130 SHEVA REALTY HDFC, INC",
    "head_officer": "MARK ENGEL",
    "managing_agent": "LANGSAM PROPERTY SERVICES CORP (GREG GADSON)",
    "site_manager": "JOE MARTE",
    "agent_address": "1601 BRONXDALE AVENUE, BRONX 10462"
  },
  "flags": {
    "active_vacate_order": false,              // tb8q-a3ar with null actual_rescind_date
    "open_hpd_litigation": "Tenant Action (opened 2026-08-28, PENDING)",   // 59kj-x8nc casestatus != CLOSED
    "harassment_finding": false,
    "registration_lapsed": false               // registrationenddate < today
  },
  "sources": {"wvxf-dwi5": "2026-10-01T14:51Z", "ygpa-z7cr": "2026-10-01T14:08Z", "…": "…"},
  "links": { "…see §7…" }
}
```

Display rules:
- Lead with class C, then B. Class A and I are a footnote.
- Every count carries "as of {source_updated_at}".
- On a lot with `numbldgs > 1`, prefix 311 and PLUTO numbers with "whole complex".
- If `lot_only` (placeholder BIN), hide the BIN sections and say why.
- Bedbug line reads "Owner reported N infested units for Nov 2024–Oct 2025 (filed Dec 3, 2025)". If the newest `filling_period_end_date` is older than the most recent Oct 31 plus 60 days, say "no filing for the latest period".

---

## 7. Verification links for a human

| Target | URL pattern | Verified |
|---|---|---|
| HPD Online building page | `https://hpdonline.nyc.gov/hpdonline/building/{hpd_building_id}/overview` → `https://hpdonline.nyc.gov/hpdonline/building/45427/overview` | Returns 200; it is a single-page app, so curl cannot confirm the route renders. Uses HPD BuildingID (from `kj4p-ruqc` / `tesw-yqqr` / `wvxf-dwi5.buildingid`), **not** BIN. Confirm once in a browser. |
| DOB BIS property profile | `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin={bin}` or `?boro={1-5}&block={block}&lot={lot}` | Returns 403 to non-browser clients (bot protection). Link only; never fetch server-side. |
| DOB NOW public portal | `https://a810-dobnow.nyc.gov/publish/Index.html#!/` (search by BIN in-page; no deep link) | 403 to curl; browser only. |
| ZoLa (DCP zoning/lot) | `https://zola.planning.nyc.gov/l/lot/{boro}/{block}/{lot}` → `https://zola.planning.nyc.gov/l/lot/2/2505/46` | 200 |
| Open Data: filtered table (HPD violations) | `https://data.cityofnewyork.us/d/wvxf-dwi5/explore/query/SELECT%20*%20WHERE%20bin%3D%222003068%22%20AND%20violationstatus%3D%22Open%22/page/filter` | 200 |
| Open Data: raw rows | `https://data.cityofnewyork.us/resource/wvxf-dwi5.csv?bin=2003068&violationstatus=Open` (same for `.json`) | 200 |
| Open Data dataset pages | `https://data.cityofnewyork.us/d/{id}` for each id in §2 | 302 to canonical page |
| 311 portal | `https://portal.311.nyc.gov/` (no per-address deep link) | 200 |
| GeoSearch result | `https://geosearch.planninglabs.nyc/v2/search?text=…` | 200 |

Build the "explore" link generically: `https://data.cityofnewyork.us/d/{id}/explore/query/{urlencode("SELECT * WHERE bin='" + bin + "'")}/page/filter` (use `bbl` for 311/PLUTO).

---

## 8. Implement next

1. **Resolver service**: normaliser + GeoSearch client + validation rules from §1.4; returns `{bin, bbl, label, zip, borough, lot_only}` or a candidate list. Unit-test against the eight inputs in the table.
2. **SODA client**: one function `soda(id, params)` with `X-App-Token`, 5 s timeout, retry on 429/5xx with backoff, and a per-dataset type map (text vs number keys, text-date columns).
3. **Live dossier endpoint**: fan out the 15 calls in §5 with `Promise.allSettled`, merge to the §6 JSON, persist `(bin, bbl, fetched_at, json)`.
4. **Postgres tables + nightly jobs**: CSV bulk load then `:updated_at` incrementals for `wvxf-dwi5`, `ygpa-z7cr`, `3h2n-5cm9`, `855j-jady`, `6bgk-3dad`; full replace for `eabe-havv`, `tb8q-a3ar`, `e5aq-a4j2`; monthly for `tesw-yqqr`, `feu5-w2e2`, `kj4p-ruqc`, `wz6d-d3jb`, `59kj-x8nc`; quarterly `64uk-42ks`. Index every table on `bin` and `bbl`.
5. **311 filtered mirror**: backfill 2 years for the agencies/types in §2.10, then nightly incremental; index on `bbl, created_date`.
6. **Code tables**: load the DOB complaint category PDF into a lookup, the DOB violation-type prefixes, and the status enums listed per dataset; store raw codes alongside labels.
7. **Links block + "as of" stamps**: generate §7 URLs and surface `rowsUpdatedAt` per section; confirm the HPD Online route in a browser once.
