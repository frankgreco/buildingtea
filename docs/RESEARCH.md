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
  - `type` values observed: `CorporateOwner`, `Agent`, `HeadOfficer`, `SiteManager` (other values exist, e.g. individual owners; treat as an enum you discover from the snapshot).
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
  - `complaint_category` is a 2-character code. Decoder: the dataset attachment `DOBComplaints_complaint_category_list.pdf` (https://data.cityofnewyork.us/api/views/eabe-havv/files/dc709ed2-7af1-429c-92c9-71ec3a4c23fa?download=true&filename=DOBComplaints_complaint_category_list.pdf, rev. 12/18). Codes that matter for a renter: `45` Illegal Conversion, `05` Permit – None, `04` After Hours Work, `31` Certificate of Occupancy – None/Illegal/Contrary, `30` Building Shaking/Structural Stability, `37` Egress Locked/Blocked, `62`/`63` Elevator – Danger Condition/Shaft Open (priority A/B), `80` Elevator Not Inspected/Illegal, `81` Elevator Accident, `56` Boiler – Fumes/Smoke/CO, `58` Boiler – Defective, `59` Electrical Wiring Defective, `65` Gas Hook-Up Illegal/Defective, `73` Failure to Maintain, `94` Plumbing Defective/Leaking, `4A` Illegal Hotel Rooms, `2B` Failure to Comply with Vacate Order. Newer codes such as `6S`, `6Y` are **not** in the 2018 PDF; store the raw code and show it unlabelled until DOB publishes an updated list.
  - 311 DOB rows (`agency='DOB'`) are the same complaints as this feed, keyed by BBL in 311 and BIN here.

### 2.10 311 — Service Requests from 2020 to Present

- Agency: 311 / Office of Technology and Innovation (OTI)
- Page: https://data.cityofnewyork.us/d/erm2-nwe9
- Id: `erm2-nwe9` — endpoint `https://data.cityofnewyork.us/resource/erm2-nwe9.json`
- Rows: 22,659,530. Update: **Daily** (last 2026-10-02). Churn: 572,658 in 2 days (upsert; ~560k rows/day change because `status`/`closed_date` update).
- Join key: `bbl` (text) **only**. No BIN. Also `incident_address` (`1130 ANDERSON AVENUE`), `incident_zip`, `address_type`.
- Columns to keep: `unique_key`, `created_date`, `closed_date`, `agency`, `complaint_type`, `descriptor`, `descriptor_2`, `location_type`, `status`, `resolution_description`, `resolution_action_updated_date`, `incident_address`, `incident_zip`, `bbl`.
- Live per address: **yes, for one BBL** (0.37 s with a 12-month filter), but see the strategy section; the dossier needs it daily for watches.
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
- Why: you need `buildingid` for the HPD Online deep link, and this table has it even when there are no violations.

### 2.16 Other official sets worth knowing (not in v1)

| Dataset | Id | Rows | Cadence | Join | Use |
|---|---|---|---|---|---|
| DOI Evictions (marshal-executed) | `6z8x-wfk4` | 134,824 | Daily | `bin`, `bbl`, `eviction_address` | Count of executed residential evictions; sensitive, show as a count only |
| DOB Certificate of Occupancy (BIS) | `bs8b-p36w` | 143,204 | Daily | `bin` | CO status / no-CO; no rows for the test BIN, so coverage is partial |
| DOB NOW Certificate of Occupancy | `pkdm-hqz6` | 82,494 | Daily | `bin` | Newer COs |
| DOB NOW Safety Boiler | `52dp-yji6` | 889,047 | Daily | `bin` | Boiler inspection filings |
| DOB NOW Safety Facades (FISP/LL11) | `xubg-57si` | 87,302 | Weekdays | `bin` | Facade status for 6+ story buildings |
| DOB Job Application Filings (BIS) / DOB NOW Build | `ic3t-wcy2` / `w9ak-ipjd` | 2.72M / 964k | Daily | `bin` | Active construction |
| DOF Property Valuation and Assessment (classes 1–4) | `8y4t-faws` | large | Annually (2026-09-14) | `parid` = BBL (text) | `owner`, `units`, `yrbuilt`, `curmkttot`, `curtaxclass`; verified `parid=2025050046` → owner `1130 SHEVA REALTY HOUSING DEVELOPMENT FU ND CORP`, market value 1,312,000, tax class 2. Returns duplicate rows per year; dedupe. |
| ACRIS Real Property Legals → Master → Parties | `8h5j-fqxa` → `bnx9-e6tj` → `636b-3b5g` | very large | Monthly | `borough`+`block`+`lot` → `document_id` | Last deed and grantee (true owner of record). Verified legals by `borough=2&block=2505&lot=46` returns document ids. Three-hop join; defer. |
| OATH Hearings Division Case Status | `jz4z-kudi` | 22.1M | Daily | ticket number | Only if ECB extract proves insufficient |

---

## 3. Live vs. snapshot

Measured latency per filtered SODA call without an app token: 0.3–0.5 s. Eight parallel calls finish in under a second, so a cold search with no cache is fine for interactive use. The reasons to snapshot are the watch feature (you must diff daily anyway), BBL-only joins that need an index you control, and three datasets whose date columns are text.

| Dataset | Mode | Why |
|---|---|---|
| GeoSearch | Live | No alternative; cache resolved address → BIN/BBL forever (PAD version changes quarterly; re-resolve on `version` change) |
| HPD violations `wvxf-dwi5` | **Both**: live on search, daily incremental into Postgres | 11.3M rows but indexed by BIN; daily diff needed for watches; `:updated_at` works (upsert, ~82k/day) |
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

Rule of thumb for v1: **serve the first search live** (so there is nothing to build before launch), write the merged result to a `dossier_snapshot` row, and let the daily jobs fill the local tables that the watch diff and PDF use.

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
4. **Merge** into one JSON (shape in §6), stamp `fetched_at`, each section's `source_updated_at` from the dataset's `rowsUpdatedAt`, and the PAD `version`.
5. **Persist** the merged JSON keyed by `(bin, bbl, fetched_at)` so the PDF and the watch diff read the same object the user saw.

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
8. **Watch diff**: nightly, re-run the summary from local tables for every watched `(bin, bbl)`, diff against the last stored JSON, and queue notifications on new open B/C, new ECB/DOB active, new vacate order, new litigation, bedbug filing change, or ownership/registration change.
