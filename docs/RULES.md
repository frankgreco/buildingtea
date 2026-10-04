# Status rules

Every status on the page comes from `src/lib/compute.ts` and is covered by `test/compute.test.ts`. There is no score. Each card answers one question with one of five states: **Looks good**, **Heads up**, **Serious**, **Critical**, **N/A**.

Open hazardous conditions are HPD violations with `violationstatus = Open` and class `B` (hazardous) or `C` (immediately hazardous). Class `A` is minor and class `I` is paperwork; neither counts as hazardous.

## Is it safe?

| Condition | Status |
|---|---|
| Active vacate order (`tb8q-a3ar` row with no rescind date) | Critical |
| Any open class C inspected within the last 365 days | Critical |
| Open class C, or 5+ open class B, inspected within the last 730 days | Serious |
| Any open B or C, all older than that | Heads up (labelled stale) |
| None open | Looks good |

## Heat, water & plumbing

Counts are distinct HPD complaints in the last 12 months by `major_category`.

| Condition | Status |
|---|---|
| 8+ heat/hot water complaints | Serious |
| 3 to 7 heat/hot water, or 5+ plumbing/water-leak | Heads up |
| Otherwise | Looks good |

## Pests & bedbugs

| Condition | Status |
|---|---|
| Any open violation mentioning roaches, mice, rats, vermin or bedbugs | Serious |
| Landlord's latest bedbug report shows 1+ infested units, or the latest required report is missing, or 5+ unsanitary-condition complaints in 12 months | Heads up |
| Building is not a registered multiple dwelling and has nothing above | N/A |
| Otherwise | Looks good |

"Latest required report is missing" means: the filing period ends Oct 31 and reports are due by Dec 31, so once 60 days have passed after Oct 31 we expect a row whose `filling_period_end_date` is that Oct 31 or later.

## Elevators

Devices are `e5aq-a4j2` rows with `device_type = Elevator` and `device_status = Active`.

| Condition | Status |
|---|---|
| No active elevators | N/A |
| Any open elevator issue: DOB NOW active violation with device type Elevators, active ECB summons of type Elevators, or active BIS violation of type `E-` | Serious |
| Any elevator with no Category 1 filing for last year, or no periodic inspection in 400 days | Heads up |
| Otherwise | Looks good |

## Who's the landlord?

Registration state from `tesw-yqqr`: **current** (end date in the future), **grace** (ended within 60 days, renewal may not be published yet), **lapsed** (ended more than 60 days ago), **none** (no row).

| Condition | Status |
|---|---|
| Lapsed | Serious |
| None, and 3+ residential units | Serious |
| Grace | Heads up |
| None, fewer than 3 units | N/A |
| Current | Looks good |

## Any legal trouble?

| Condition | Status |
|---|---|
| Active vacate order | Critical |
| Any housing court case not closed, or a court finding of harassment | Serious |
| 3+ evictions executed in 3 years, or any unpaid city summons balance | Heads up |
| Otherwise | Looks good |

## Is it noisy?

Counts are 311 requests at this lot (`erm2-nwe9` by BBL) in the last 12 months whose `complaint_type` starts with `Noise` (NYPD `Noise - Residential`, `Noise - Street/Sidewalk`, `Noise - Commercial`, `Noise - Vehicle`, ..., EDC `Noise - Helicopter`, DEP `Noise`), summed from the same 12-month aggregate the rest of the report uses.

| Condition | Status |
|---|---|
| The 311 query failed | N/A |
| 10+ noise complaints | Heads up |
| Otherwise | Looks good |

Never Serious or Critical: 311 noise reports cover the whole lot and the address the caller gave, so some are about neighbors or the street. The answer names the most common noise type; the card's table lists each type with its count.

## Records that change no status

Rat inspections, city emergency repairs and city programs are listed in the Violations and Legal sections. None of them changes a card's status or a snapshot number: "Open violations", "Violations unfixed in 12 months", the open hazard count and the searched apartment's count are of housing violations, buildings violations and summonses only, and "Open legal matters" is of court cases and vacate orders only (`shared/snapshot.ts`). Each row still has an open or closed state of its own:

| Record | Open | Closed |
|---|---|---|
| Failed rat inspection (`p937-wjvj`, result starts with `Failed`) | No later inspection of the lot has the result `Passed`. Baiting, monitoring, stoppage and clean-up visits don't count, and neither does a pass at the same moment | The lot passed a later inspection; the closing date is the first such pass |
| City emergency repair (`mdbu-nrqn`, `sbnd-xujn`) | Never | Always. The headline says "made" when the status reason is `OMO Completed`, `Work Partially Completed`, `Repair Comp, Problem Resolved`, `Repair Completed,New HWO Needed`, `Fuel Delivered` or `HPD Clean/Dust Tested`, and "ordered" for any other reason or none |
| Alternative Enforcement Program, Heat Sensor Program (`hcir-3275`, `h4mf-f24e`) | No discharge date, and the status doesn't say discharged | Discharged; the closing date is the discharge date |
| Certification of No Harassment pilot list (`bzxi-2tsw`) | The building has a row | Never: a building taken off the list has no row |

The Landlord section's "Last sold" is the newest deed for more than $100; a deed for less is a transfer, and is noted beside the sale when it is newer. The "May be rent stabilized" tile shows only for an approved 421-a or J-51 exemption with a value above zero on the current tax year's roll.
