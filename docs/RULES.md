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

## Watch digests

The monthly job lists a change when any of these increases: open class C, open class B, open complaints, active DOB violations, active summonses, open elevator issues, pending court cases. It also lists a change when a vacate order starts or ends, a new bedbug report is filed, the registration state changes, or the registered owner changes. The digest goes out every month whether or not anything changed.
