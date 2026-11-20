const OFFSETS = Object.freeze({ UTC: "+00:00", EST: "-05:00", PST: "-08:00", JST: "+09:00" })

function validDate(day) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const stamp = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === day
}

export function normalizeDeadline(deadline) {
  if (!deadline || !validDate(deadline.date) || !Object.hasOwn(OFFSETS, deadline.zone)) {
    throw new Error("Source has an invalid date or unsupported time zone.")
  }
  if (!["registration", "submission"].includes(deadline.stage)) {
    throw new Error("Source is missing a recognized deadline stage.")
  }
  if (deadline.time === undefined) return { ...deadline, instant: null }
  if (typeof deadline.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(deadline.time)) {
    throw new Error("Source has an invalid clock time.")
  }
  return { ...deadline, instant: Date.parse(`${deadline.date}T${deadline.time}:00${OFFSETS[deadline.zone]}`) }
}

export function kst(instant) {
  if (!Number.isFinite(instant)) return null
  const local = new Date(instant + 9 * 60 * 60 * 1000).toISOString()
  return `${local.slice(0, 10)} ${local.slice(11, 16)} KST`
}

function compareDeadlines(left, right) {
  if (left.stage !== right.stage) return "different_stage"
  if (left.instant !== null && right.instant !== null) {
    return left.instant === right.instant ? "aligned" : "conflict"
  }
  if (left.zone === right.zone && left.date !== right.date) return "conflict"
  return "time_unknown"
}

function normalizeSource(source) {
  if (!["open", "required", "unknown"].includes(source.student)) {
    throw new Error("Source has an invalid student-eligibility field.")
  }
  const deadline = normalizeDeadline(source.deadline)
  return { ...source, deadline, kst: kst(deadline.instant) }
}

export function auditSources(listing, rules) {
  const sources = [listing, rules].filter(Boolean).map(normalizeSource)
  if (sources.length !== 2) {
    return { status: "incomplete", notice: "Both sources are needed to compare.", sources }
  }
  const [left, right] = sources.map((source) => source.deadline)
  const deadline = compareDeadlines(left, right)
  const eligibility = [listing.student, rules.student].includes("unknown") ? "unknown"
    : listing.student === rules.student ? listing.student : "conflict"
  return {
    status: deadline === "conflict" || eligibility === "conflict" ? "conflict"
      : deadline !== "aligned" || eligibility === "unknown" ? "incomplete" : "aligned",
    deadline,
    eligibility,
    sources,
    earlier: deadline === "conflict" && sources.every((row) => row.kst !== null)
      ? kst(Math.min(left.instant, right.instant)) : null,
  }
}
